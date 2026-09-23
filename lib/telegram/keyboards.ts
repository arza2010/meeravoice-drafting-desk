export function draftActionKeyboard(draftId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `draft:${draftId}:approve` },
        { text: "✏️ Edit", callback_data: `draft:${draftId}:edit` },
      ],
      [
        { text: "🔁 Regenerate", callback_data: `draft:${draftId}:regenerate` },
        { text: "❌ Reject", callback_data: `draft:${draftId}:reject` },
      ],
    ],
  };
}
