import OpenAI from "openai";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getEnv } from "@/lib/env";

let cached: OpenAI | undefined;

export function getOpenAI(): OpenAI {
  if (cached) return cached;
  cached = new OpenAI({ apiKey: getEnv().OPENAI_API_KEY });
  return cached;
}

export class StageGenerationError extends Error {
  constructor(
    message: string,
    public readonly stage: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StageGenerationError";
  }
}

export interface StructuredResult<T> {
  data: T;
  tokensIn: number;
  tokensOut: number;
  retried: boolean;
}

/**
 * Some models (reasoning models such as the o-series) reject an explicit
 * `temperature`. Rather than hardcode a model-name allowlist, we send it and
 * transparently drop it on the one specific "unsupported parameter" error.
 */
function isUnsupportedTemperatureError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("temperature") && message.toLowerCase().includes("unsupported");
}

async function callOnce(params: {
  model: string;
  temperature?: number;
  prompt: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
}): Promise<{ raw: string; tokensIn: number; tokensOut: number }> {
  const client = getOpenAI();
  const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: params.model,
    messages: [{ role: "user", content: params.prompt }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: params.schemaName,
        schema: params.jsonSchema,
        strict: true,
      },
    },
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
  };

  let completion: OpenAI.Chat.ChatCompletion;
  try {
    completion = await client.chat.completions.create(body);
  } catch (err) {
    if (params.temperature !== undefined && isUnsupportedTemperatureError(err)) {
      const { temperature: _drop, ...withoutTemperature } = body;
      completion = await client.chat.completions.create(withoutTemperature);
    } else {
      throw err;
    }
  }

  const raw = completion.choices[0]?.message?.content;
  if (typeof raw !== "string") {
    throw new StageGenerationError("Model returned no content", params.schemaName);
  }
  return {
    raw,
    tokensIn: completion.usage?.prompt_tokens ?? 0,
    tokensOut: completion.usage?.completion_tokens ?? 0,
  };
}

/**
 * Runs one LLM stage with a strict JSON schema, validates the result with
 * the same zod schema the JSON schema was derived from, and retries once
 * with the validation error appended to the prompt on failure. Throws
 * StageGenerationError if the retry also fails validation.
 */
export async function generateStructured<T>(params: {
  stage: string;
  model: string;
  temperature?: number;
  prompt: string;
  schema: ZodType<T>;
  schemaName: string;
}): Promise<StructuredResult<T>> {
  const jsonSchema = zodToJsonSchema(params.schema, params.schemaName).definitions?.[
    params.schemaName
  ] ?? zodToJsonSchema(params.schema, params.schemaName);

  let tokensIn = 0;
  let tokensOut = 0;

  const first = await callOnce({
    model: params.model,
    temperature: params.temperature,
    prompt: params.prompt,
    schemaName: params.schemaName,
    jsonSchema: jsonSchema as Record<string, unknown>,
  });
  tokensIn += first.tokensIn;
  tokensOut += first.tokensOut;

  const firstParsed = safeJsonParse(first.raw);
  const firstResult = firstParsed.ok ? params.schema.safeParse(firstParsed.value) : null;
  if (firstResult?.success) {
    return { data: firstResult.data, tokensIn, tokensOut, retried: false };
  }

  const validationError = firstParsed.ok
    ? firstResult?.error?.message
    : `Response was not valid JSON: ${firstParsed.error}`;

  const retryPrompt = `${params.prompt}\n\n<previous_attempt_failed_validation>\nYour previous response failed schema validation with this error:\n${validationError}\n\nReturn corrected JSON that matches the schema exactly.\n</previous_attempt_failed_validation>`;

  const second = await callOnce({
    model: params.model,
    temperature: params.temperature,
    prompt: retryPrompt,
    schemaName: params.schemaName,
    jsonSchema: jsonSchema as Record<string, unknown>,
  });
  tokensIn += second.tokensIn;
  tokensOut += second.tokensOut;

  const secondParsed = safeJsonParse(second.raw);
  const secondResult = secondParsed.ok ? params.schema.safeParse(secondParsed.value) : null;
  if (secondResult?.success) {
    return { data: secondResult.data, tokensIn, tokensOut, retried: true };
  }

  throw new StageGenerationError(
    `Stage "${params.stage}" failed schema validation twice: ${
      secondParsed.ok ? secondResult?.error?.message : secondParsed.error
    }`,
    params.stage,
  );
}

function safeJsonParse(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function transcribeAudio(buffer: Buffer, filename: string): Promise<string> {
  const client = getOpenAI();
  const file = await OpenAI.toFile(buffer, filename);
  const transcription = await client.audio.transcriptions.create({
    file,
    model: getEnv().OPENAI_TRANSCRIBE_MODEL,
  });
  return transcription.text;
}
