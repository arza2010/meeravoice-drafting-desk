import { describe, expect, it } from "vitest";
import { isAllowedChat, verifyWebhookSecret } from "@/lib/telegram/guard";

describe("verifyWebhookSecret", () => {
  it("accepts the exact configured secret", () => {
    expect(verifyWebhookSecret("test-webhook-secret-00000000000000000000")).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(verifyWebhookSecret(null)).toBe(false);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(verifyWebhookSecret("test-webhook-secret-00000000000000000001")).toBe(false);
  });

  it("rejects a wrong secret of a different length", () => {
    expect(verifyWebhookSecret("short")).toBe(false);
  });
});

describe("isAllowedChat", () => {
  it("allows the configured chat id", () => {
    expect(isAllowedChat(-1001234567890)).toBe(true);
  });

  it("rejects any other chat id", () => {
    expect(isAllowedChat(999)).toBe(false);
    expect(isAllowedChat(-1001234567891)).toBe(false);
  });
});
