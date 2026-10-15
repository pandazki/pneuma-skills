import { expect, test } from "bun:test";
import { isSessionStatePath } from "../session-state.js";

test("runtime names are owned only at the resolved Session state root", () => {
  for (const path of ["config.json", "history.json", "thumbnail.png", "app-settings.json", "collaboration-room.json", "collaboration-imports/pending.json", "shadow.git/objects/entry"]) {
    expect(isSessionStatePath(path, true)).toBe(true);
    expect(isSessionStatePath(path, false)).toBe(false);
    expect(isSessionStatePath(`site/${path}`, true)).toBe(false);
  }
  expect(isSessionStatePath(".pneuma/config.json", false)).toBe(true);
  expect(isSessionStatePath("site/.pneuma/config.json", true)).toBe(false);
  expect(isSessionStatePath("index.html", true)).toBe(false);
  expect(isSessionStatePath("my-config.json", true)).toBe(false);
});
