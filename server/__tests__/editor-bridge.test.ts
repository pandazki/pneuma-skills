import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildOpenArgs,
  cleanEditorEnv,
  findProjectRoot,
} from "../editor-bridge.js";

describe("cleanEditorEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in saved)) delete process.env[k];
    }
    Object.assign(process.env, saved);
  });

  it("strips VS Code / Cursor integrated-terminal IPC + askpass injections", () => {
    // These leak in when Pneuma runs from a VS Code / Cursor terminal and
    // flip the bundled `cursor` launcher into remote-IPC mode, which crashes
    // recent Cursor's agent panel on file open.
    process.env.VSCODE_IPC_HOOK_CLI = "/tmp/vscode-ipc.sock";
    process.env.VSCODE_GIT_IPC_HANDLE = "/tmp/git.sock";
    process.env.VSCODE_NONCE = "abc";
    process.env.GIT_ASKPASS = "/some/askpass.sh";
    process.env.ELECTRON_RUN_AS_NODE = "1";
    process.env.NODE_OPTIONS = "--max-old-space-size=8192";

    const env = cleanEditorEnv();

    expect(env.VSCODE_IPC_HOOK_CLI).toBeUndefined();
    expect(env.VSCODE_GIT_IPC_HANDLE).toBeUndefined();
    expect(env.VSCODE_NONCE).toBeUndefined();
    expect(env.GIT_ASKPASS).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it("preserves unrelated vars like PATH and HOME", () => {
    process.env.PATH = "/usr/bin:/bin";
    process.env.HOME = "/Users/test";

    const env = cleanEditorEnv();

    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/Users/test");
  });
});

// Minimal KnownEditor stand-ins — buildOpenArgs only reads `family`.
const vscode = { family: "vscode" } as never;
const zed = { family: "zed" } as never;
const sublime = { family: "sublime" } as never;
const unknown = {} as never;

describe("buildOpenArgs", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pneuma-editor-"));
    file = join(dir, "src", "thing.ts");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(file, "x");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("vscode: folder-focus + --goto when root contains the file and a line is given", () => {
    expect(buildOpenArgs(vscode, file, dir, 42)).toEqual([dir, "--goto", `${file}:42`]);
  });

  it("vscode: folder-focus without a line", () => {
    expect(buildOpenArgs(vscode, file, dir, null)).toEqual([dir, file]);
  });

  it("vscode: no folder when there is no root", () => {
    expect(buildOpenArgs(vscode, file, null, 10)).toEqual(["--goto", `${file}:10`]);
  });

  it("zed / sublime: colon-suffix line instead of --goto", () => {
    expect(buildOpenArgs(zed, file, dir, 7)).toEqual([dir, `${file}:7`]);
    expect(buildOpenArgs(sublime, file, dir, 7)).toEqual([dir, `${file}:7`]);
  });

  it("drops the root when the file is not inside it", () => {
    expect(buildOpenArgs(vscode, file, "/some/other/place", 5)).toEqual([
      "--goto",
      `${file}:5`,
    ]);
  });

  it("directory target opens the folder itself, ignoring root/line", () => {
    expect(buildOpenArgs(vscode, dir, dir, 99)).toEqual([dir]);
  });

  it("unknown family falls back to the bare file path", () => {
    expect(buildOpenArgs(unknown, file, dir, 3)).toEqual([file]);
  });
});

describe("findProjectRoot", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pneuma-root-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("walks up to the nearest ancestor with a project marker", () => {
    mkdirSync(join(dir, ".git"));
    const deep = join(dir, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    const file = join(deep, "f.ts");
    writeFileSync(file, "x");
    expect(findProjectRoot(file)).toBe(dir);
  });

  it("returns null when no marker is found above the file", () => {
    const file = join(dir, "lonely.txt");
    writeFileSync(file, "x");
    expect(findProjectRoot(file)).toBeNull();
  });
});
