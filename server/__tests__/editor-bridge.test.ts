import { afterEach, describe, expect, it } from "bun:test";
import { cleanEditorEnv } from "../editor-bridge.js";

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
