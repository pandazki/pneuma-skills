import { describe, expect, test } from "bun:test";
import enChatPanel from "../locales/en/chat-panel.json";
import { systemText } from "../system-text.js";

/**
 * `systemText` exists so `ws.ts` can translate without importing the Vite-only
 * i18n bootstrap. These tests run with i18next uninitialized — exactly the
 * shape any non-browser consumer sees — so they pin the fallback path.
 */
describe("systemText", () => {
  test("returns the English source text when i18next has no resources", () => {
    expect(systemText("chat-panel:steer_failed", "Steer-in failed: {{reason}}", {
      reason: "no active turn",
    })).toBe("Steer-in failed: no active turn");
  });

  test("leaves a placeholder alone when nothing was passed for it", () => {
    expect(systemText("chat-panel:system_error", "Error: {{detail}}")).toBe("Error: {{detail}}");
  });

  test("English fallbacks stay identical to the shipped English strings", () => {
    // A drifting fallback would silently ship two different English texts —
    // one to the browser, one to anything running outside the bundle.
    expect(enChatPanel.system_error).toBe("Error: {{detail}}");
    expect(enChatPanel.auth_error).toBe("Authentication error: {{detail}}");
    expect(enChatPanel.steer_failed).toBe("Steer-in failed: {{reason}}");
    expect(enChatPanel.steer_failed_reason).toBe("the active turn no longer accepts guidance");
    expect(enChatPanel.steer_failed_unsupported)
      .toBe("the current agent connection does not support steer-in");
    expect(enChatPanel.steer_failed_no_active_turn)
      .toBe("there is no active agent turn to steer");
  });
});
