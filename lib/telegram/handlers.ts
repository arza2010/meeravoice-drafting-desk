import { answerCallbackQuery, sendMessage } from "@/lib/telegram/api";
import { parseCallbackData, parseCommand, type ParsedEvent } from "@/lib/telegram/parse";
import { handleCommand } from "@/lib/telegram/commands";
import { clearSession, getActiveSession, startSession } from "@/lib/telegram/flows";
import { createFragment, transcribeVoiceNote, type FragmentSource } from "@/lib/pipeline/ingest";
import { startPipelineForFragments } from "@/lib/pipeline/run";
import { applyEditInstruction, finalizeReject, approveDraft, regenerateDraft } from "@/lib/pipeline/actions";

async function resolveInstructionText(event: {
  text: string | null;
  voiceFileId: string | null;
}): Promise<string | null> {
  if (event.text && event.text.trim().length > 0) return event.text.trim();
  if (event.voiceFileId) return transcribeVoiceNote(event.voiceFileId);
  return null;
}

async function handleContentMessage(
  event: Extract<ParsedEvent, { kind: "content_message" }>,
): Promise<void> {
  if (event.text) {
    const command = parseCommand(event.text);
    if (command) {
      await handleCommand(event.chatId, command);
      return;
    }
  }

  const session = await getActiveSession(event.chatId);
  if (session) {
    if (session.mode === "edit") {
      const instruction = await resolveInstructionText(event);
      if (!instruction) {
        await sendMessage(event.chatId, "Send your edit as text or a voice note, or /cancel to exit.");
        return;
      }
      await clearSession(event.chatId);
      try {
        await applyEditInstruction(session.draftId, instruction);
      } catch (err) {
        await sendMessage(
          event.chatId,
          `Couldn't apply that edit (${err instanceof Error ? err.message : "unknown error"}). The original draft is unchanged.`,
        );
      }
      return;
    }

    if (session.mode === "reject_reason") {
      if (event.text?.trim() === "/skip") {
        await clearSession(event.chatId);
        await finalizeReject(session.draftId, null);
        return;
      }
      const reason = await resolveInstructionText(event);
      await clearSession(event.chatId);
      await finalizeReject(session.draftId, reason);
      return;
    }
  }

  // Not a command, not mid-flow: a new fragment.
  let transcript: string;
  let source: FragmentSource;

  if (event.voiceFileId) {
    try {
      transcript = await transcribeVoiceNote(event.voiceFileId);
    } catch {
      await sendMessage(event.chatId, "Couldn't transcribe that note, please resend.");
      return;
    }
    source = "voice";
  } else if (event.text) {
    transcript = event.text;
    source = event.isForwarded ? "forward" : "text";
  } else {
    return;
  }

  const fragment = await createFragment({
    source,
    telegramMessageId: event.messageId,
    transcript,
  });

  try {
    const result = await startPipelineForFragments([fragment.id]);
    if (result.kind === "not_draftable") {
      const missing =
        result.missingInfo.length > 0
          ? result.missingInfo.map((m) => `- ${m}`).join("\n")
          : "- nothing specific yet, just not enough substance for a post on its own";
      await sendMessage(
        event.chatId,
        `Banked - not quite enough to draft on its own yet.\n\n${missing}\n\nSend more detail, or /draft to combine it with other banked fragments.`,
      );
    }
  } catch (err) {
    await sendMessage(
      event.chatId,
      `Something went wrong drafting that note (${err instanceof Error ? err.message : "unknown error"}). It's banked - try /draft to retry.`,
    );
  }
}

async function handleCallbackQuery(
  event: Extract<ParsedEvent, { kind: "callback_query" }>,
): Promise<void> {
  const parsed = parseCallbackData(event.data);
  if (!parsed) {
    await answerCallbackQuery(event.callbackQueryId, "Unrecognised action.");
    return;
  }

  await answerCallbackQuery(event.callbackQueryId);

  try {
    switch (parsed.action) {
      case "approve":
        await approveDraft(parsed.draftId);
        return;
      case "edit":
        await startSession(event.chatId, "edit", parsed.draftId);
        await sendMessage(
          event.chatId,
          "Send your edit as text or a voice note - I'll apply the minimum change needed. /cancel to exit.",
        );
        return;
      case "regenerate":
        await sendMessage(event.chatId, "Regenerating a new candidate...");
        await regenerateDraft(parsed.draftId);
        return;
      case "reject":
        await startSession(event.chatId, "reject_reason", parsed.draftId);
        await sendMessage(event.chatId, "What was off? (optional - reply, or send /skip)");
        return;
    }
  } catch (err) {
    await sendMessage(
      event.chatId,
      `Couldn't complete that action (${err instanceof Error ? err.message : "unknown error"}).`,
    );
  }
}

export async function handleParsedEvent(event: ParsedEvent): Promise<void> {
  if (event.kind === "content_message") {
    await handleContentMessage(event);
  } else if (event.kind === "callback_query") {
    await handleCallbackQuery(event);
  }
}
