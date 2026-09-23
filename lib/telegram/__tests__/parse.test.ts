import { describe, expect, it } from "vitest";
import { parseCallbackData, parseCommand, parseUpdate } from "@/lib/telegram/parse";

describe("parseUpdate", () => {
  it("parses a plain text message", () => {
    const event = parseUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: -100123, type: "channel" },
        date: 1700000000,
        text: "hello",
      },
    });
    expect(event).toEqual({
      kind: "content_message",
      updateId: 1,
      chatId: -100123,
      messageId: 10,
      isForwarded: false,
      text: "hello",
      voiceFileId: null,
    });
  });

  it("parses a voice message", () => {
    const event = parseUpdate({
      update_id: 2,
      message: {
        message_id: 11,
        chat: { id: -100123, type: "channel" },
        date: 1700000000,
        voice: { file_id: "abc", file_unique_id: "u1", duration: 5 },
      },
    });
    expect(event?.kind).toBe("content_message");
    if (event?.kind === "content_message") {
      expect(event.voiceFileId).toBe("abc");
      expect(event.text).toBeNull();
    }
  });

  it("flags a forwarded message via forward_origin", () => {
    const event = parseUpdate({
      update_id: 3,
      message: {
        message_id: 12,
        chat: { id: -100123, type: "channel" },
        date: 1700000000,
        text: "old note",
        forward_origin: { type: "user" },
      },
    });
    expect(event?.kind).toBe("content_message");
    if (event?.kind === "content_message") {
      expect(event.isForwarded).toBe(true);
    }
  });

  it("flags a forwarded message via legacy forward_date", () => {
    const event = parseUpdate({
      update_id: 4,
      message: {
        message_id: 13,
        chat: { id: -100123, type: "channel" },
        date: 1700000000,
        text: "old note",
        forward_date: 1690000000,
      },
    });
    expect(event?.kind).toBe("content_message");
    if (event?.kind === "content_message") {
      expect(event.isForwarded).toBe(true);
    }
  });

  it("parses a channel_post the same as a message", () => {
    const event = parseUpdate({
      update_id: 5,
      channel_post: {
        message_id: 14,
        chat: { id: -100123, type: "channel" },
        date: 1700000000,
        text: "posted",
      },
    });
    expect(event?.kind).toBe("content_message");
  });

  it("parses a callback_query", () => {
    const event = parseUpdate({
      update_id: 6,
      callback_query: {
        id: "cbq1",
        data: "draft:abc-123:approve",
        message: {
          message_id: 15,
          chat: { id: -100123, type: "channel" },
          date: 1700000000,
        },
      },
    });
    expect(event).toEqual({
      kind: "callback_query",
      updateId: 6,
      chatId: -100123,
      messageId: 15,
      callbackQueryId: "cbq1",
      data: "draft:abc-123:approve",
    });
  });

  it("returns null for malformed payloads", () => {
    expect(parseUpdate({ not: "an update" })).toBeNull();
    expect(parseUpdate(null)).toBeNull();
  });

  it("returns unsupported for updates with no recognised payload", () => {
    const event = parseUpdate({ update_id: 7 });
    expect(event).toEqual({ kind: "unsupported", updateId: 7 });
  });
});

describe("parseCommand", () => {
  it("parses a bare command", () => {
    expect(parseCommand("/status")).toEqual({ name: "status", args: [] });
  });

  it("parses a command with args", () => {
    expect(parseCommand("/draft 5")).toEqual({ name: "draft", args: ["5"] });
  });

  it("strips a bot username suffix", () => {
    expect(parseCommand("/draft@MeeraVoiceBot 5")).toEqual({ name: "draft", args: ["5"] });
  });

  it("returns null for non-command text", () => {
    expect(parseCommand("this has a / slash in it")).toBeNull();
  });

  it("treats a transcript that merely mentions a command as content, not a command", () => {
    // A voice transcript is never passed through parseCommand for voice notes,
    // but even as text, only a leading slash counts.
    expect(parseCommand("she said use /bank next time")).toBeNull();
  });
});

describe("parseCallbackData", () => {
  it("parses a well-formed approve action", () => {
    expect(parseCallbackData("draft:abc-123:approve")).toEqual({
      action: "approve",
      draftId: "abc-123",
    });
  });

  it("rejects an unknown action", () => {
    expect(parseCallbackData("draft:abc-123:delete")).toBeNull();
  });

  it("rejects a malformed prefix", () => {
    expect(parseCallbackData("frag:abc-123:approve")).toBeNull();
  });

  it("rejects missing parts", () => {
    expect(parseCallbackData("draft:abc-123")).toBeNull();
    expect(parseCallbackData("")).toBeNull();
  });
});
