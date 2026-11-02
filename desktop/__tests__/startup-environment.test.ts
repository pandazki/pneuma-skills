import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { captureShellPath, launcherEnvironment, parseShellPath } from "../src/main/startup-environment.js";
import { createLauncherReadyParser } from "../src/main/launcher-readiness.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function shellFixture(body: string) {
  const root = mkdtempSync(join(tmpdir(), "pneuma-shell-"));
  roots.push(root);
  const shell = join(root, "login shell");
  writeFileSync(shell, `#!/bin/sh\n${body}\n`);
  chmodSync(shell, 0o755);
  return { root, shell };
}

describe.skipIf(process.platform === "win32")("desktop shell environment", () => {
  test("captures noisy shell output without blocking the main event loop", async () => {
    const { root, shell } = shellFixture('printf "\\033[32mWelcome\\033[0m\\n"\n/bin/sleep 0.1\nexec /bin/sh -c "$2"');
    let timerRan = false;
    const timer = setTimeout(() => { timerRan = true; }, 0);
    const result = await captureShellPath({ PATH: `${root}:/usr/bin:/bin`, SHELL: shell });
    clearTimeout(timer);
    expect(timerRan).toBe(true);
    expect(result).toEqual({ path: `${root}:/usr/bin:/bin`, status: "captured" });
    const env = launcherEnvironment("/bundled/bun", result, { PATH: "/usr/bin:/bin", CLAUDECODE: "1" });
    expect(env.PATH?.split(delimiter)).toEqual(["/bundled", root, "/usr/bin", "/bin"]);
    expect(env.PNEUMA_DESKTOP_PATH_READY).toBe("1");
    expect(env.CLAUDECODE).toBeUndefined();
  });

  test("a stuck shell is bounded and explicitly falls back", async () => {
    const { shell } = shellFixture("exec /bin/sleep 30");
    const result = await captureShellPath({ PATH: "/usr/bin:/bin", SHELL: shell }, 30);
    expect(result).toEqual({ path: "/usr/bin:/bin", status: "fallback", reason: "shell timeout" });
  });

  test("quitting aborts the owned shell and resolves its bounded attempt", async () => {
    const { shell } = shellFixture("exec /bin/sleep 30");
    const abort = new AbortController();
    const pending = captureShellPath({ PATH: "/usr/bin:/bin", SHELL: shell }, 30_000, abort.signal);
    abort.abort();
    expect(await pending).toEqual({ path: "/usr/bin:/bin", status: "fallback", reason: "shell capture cancelled" });
  });

  test("missing and invalid shells retain inherited PATH with an observable reason", async () => {
    const { root, shell } = shellFixture('printf "hello\\n"');
    expect((await captureShellPath({ PATH: "/usr/bin", SHELL: join(root, "missing") })).reason).toBe("shell execution failed");
    expect(await captureShellPath({ PATH: "/usr/bin", SHELL: shell })).toEqual({
      path: "/usr/bin", status: "fallback", reason: "shell returned no valid PATH",
    });
  });

  test("rejects space-joined fish PATH and preserves markers on their own lines", () => {
    const wrap = (value: string) => `___PNEUMA_PATH_START___\n${value}\n___PNEUMA_PATH_END___\n`;
    expect(parseShellPath(wrap("/usr/bin /bin"))).toBeNull();
    expect(parseShellPath(`\x1b[1Gbanner\n${wrap("/usr/bin:/bin")}`)).toBe("/usr/bin:/bin");
    expect(parseShellPath("___PNEUMA_PATH_START___\n")).toBeNull();
  });
});

describe("launcher ready line protocol", () => {
  test("handles every byte boundary, including the arrow and partial URL", () => {
    const line = Buffer.from("noise\nMarketplace → http://localhost:17996\n");
    for (let split = 0; split < line.length; split++) {
      const parse = createLauncherReadyParser();
      expect(parse(line.subarray(0, split))).toBeUndefined();
      expect(parse(line.subarray(split))).toBe("http://localhost:17996");
    }
  });

  test("accepts colored legacy and session markers without swallowing URL escapes", () => {
    expect(createLauncherReadyParser()(Buffer.from("\x1b[32m模式画廊 → http://0.0.0.0:3000\x1b[0m\n"))).toBe("http://localhost:3000");
    expect(createLauncherReadyParser()(Buffer.from("[pneuma] ready http://localhost:3000?session=one&mode=doc\n"))).toBe("http://localhost:3000?session=one&mode=doc");
  });
});
