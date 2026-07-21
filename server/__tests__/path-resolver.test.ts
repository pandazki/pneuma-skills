/**
 * PATH discovery regression tests.
 *
 * The historical bug these lock down: the capture script interpolated the
 * value as `"___PATH_START___$PATH___PATH_END___"`. Underscores are legal
 * identifier characters, so bash, zsh AND fish all read that as one variable
 * named `PATH___PATH_END___` — always empty. The marker regex never matched,
 * so `captureUserShellPath()` silently returned `buildFallbackPath()` on every
 * platform and shell. It stayed invisible until an agent CLI installed outside
 * the hardcoded fallback list (Kimi Code's `~/.kimi-code/bin`) went undetected
 * in the GUI-launched desktop app, where `process.env.PATH` is minimal.
 */

import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter } from "node:path";

import {
  buildFallbackPath,
  captureUserShellPath,
  parseCapturedPath,
} from "../path-resolver.ts";

const MARKER_START = "___PNEUMA_PATH_START___";
const MARKER_END = "___PNEUMA_PATH_END___";

const wrap = (body: string) => `${MARKER_START}\n${body}\n${MARKER_END}\n`;

describe("parseCapturedPath", () => {
  test("extracts a plain colon-delimited PATH", () => {
    expect(parseCapturedPath(wrap("/usr/bin:/bin"))).toBe("/usr/bin:/bin");
  });

  test("ignores greeter output printed before the markers", () => {
    const noise = "  ,xNMM.\n .OMMMMo\nOS: macOS Tahoe\n";
    expect(parseCapturedPath(noise + wrap("/usr/bin:/bin"))).toBe("/usr/bin:/bin");
  });

  test("strips ANSI escape sequences", () => {
    const raw = `\x1B[1G\x1B[16A${MARKER_START}\n/usr/bin:/bin\n${MARKER_END}`;
    expect(parseCapturedPath(raw)).toBe("/usr/bin:/bin");
  });

  test("rejects a capture whose markers are absent", () => {
    // This is what the old script produced: the variable expanded to nothing
    // and the end marker was swallowed into the identifier.
    expect(parseCapturedPath("___PATH_START___\n")).toBeNull();
  });

  test("rejects an empty body", () => {
    expect(parseCapturedPath(wrap(""))).toBeNull();
  });

  test("rejects a body with no existing directory (greeter text, not a PATH)", () => {
    expect(parseCapturedPath(wrap("Shell: fish 4.2.0"))).toBeNull();
  });

  test("rejects fish-style space-joined output", () => {
    // `echo $PATH` under fish yields spaces, not colons — a single bogus entry.
    expect(parseCapturedPath(wrap("/usr/bin /bin /sbin"))).toBeNull();
  });
});

describe("buildFallbackPath", () => {
  test("includes Kimi Code's install dir when it exists", () => {
    const home = process.env.HOME;
    if (!home || !existsSync(`${home}/.kimi-code/bin`)) return; // not installed here
    expect(buildFallbackPath().split(delimiter)).toContain(`${home}/.kimi-code/bin`);
  });

  test("only lists directories that exist", () => {
    for (const dir of buildFallbackPath().split(delimiter).filter(Boolean)) {
      expect(existsSync(dir)).toBe(true);
    }
  });
});

describe("captureUserShellPath", () => {
  const shells = ["/bin/bash", "/bin/zsh", "/opt/homebrew/bin/fish", "/usr/bin/fish"];

  for (const shell of shells) {
    test(`recovers a real PATH from ${shell}`, () => {
      if (process.platform === "win32" || !existsSync(shell)) return;

      // Read the shell's own login PATH independently, then assert our
      // capture agrees on at least one entry it could not have guessed.
      let expectedEntries: string[];
      try {
        expectedEntries = execSync(
          `${shell} -lic ${JSON.stringify(`printenv PATH`)}`,
          { encoding: "utf-8", timeout: 15_000 },
        )
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.includes(delimiter))
          .pop()
          ?.split(delimiter)
          .filter(Boolean) ?? [];
      } catch {
        return; // shell refused to start in this environment
      }
      if (expectedEntries.length === 0) return;

      const prevShell = process.env.SHELL;
      process.env.SHELL = shell;
      try {
        const captured = captureUserShellPath().split(delimiter).filter(Boolean);
        expect(captured.length).toBeGreaterThan(0);
        // Colon-delimited, not fish's space-joined form.
        expect(captured.every((dir) => !dir.includes(" /"))).toBe(true);
        expect(captured.some((dir) => expectedEntries.includes(dir))).toBe(true);
      } finally {
        if (prevShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = prevShell;
      }
    });
  }
});
