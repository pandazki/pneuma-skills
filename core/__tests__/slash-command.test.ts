import { describe, expect, test } from "bun:test";
import { isSlashCommandMessage } from "../utils/slash-command.js";

describe("isSlashCommandMessage", () => {
  test("recognises bare and argumented commands, namespaced and hyphenated names", () => {
    for (const s of ["/compact", "  /compact ", "/compact\n", "/compact keep the file list", "/codex:rescue dig deeper", "/handoff-pneuma", "/borrow slide"]) {
      expect(isSlashCommandMessage(s), JSON.stringify(s)).toBe(true);
    }
  });

  test("leaves paths, mid-sentence slashes and malformed input alone", () => {
    for (const s of ["/Users/me/notes.md please edit", "please /compact", "", "/", "/ compact", "//compact", "/123", "a/b"]) {
      expect(isSlashCommandMessage(s), JSON.stringify(s)).toBe(false);
    }
  });
});
