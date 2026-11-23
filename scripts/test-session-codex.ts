// The app-server owns both the rollout and its indexes. Never write the personal SQLite database.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolveBinary } from "../server/path-resolver.js";

export type CodexCall = (method: string, params: object) => Promise<unknown>;

export async function withCodex<T>(run: (call: CodexCall) => Promise<T>): Promise<T> {
  const binary = resolveBinary("codex");
  if (!binary) throw new Error("Codex CLI unavailable");
  const child = spawn(binary, ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
  const lines = createInterface({ input: child.stdout });
  let sequence = 0;
  let pending: { id: number; resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;
  let closed = false;
  const close = (error: Error) => { closed = true; pending?.reject(error); };
  child.on("error", close);
  child.stdin.on("error", close);
  child.once("exit", () => close(new Error("Codex app-server exited")));
  lines.on("line", line => {
    try {
      const reply = JSON.parse(line);
      if (!pending || reply.id !== pending.id || reply.method) return;
      if (reply.error) pending.reject(new Error(String(reply.error.message)));
      else pending.resolve(reply.result);
    } catch { close(new Error("Invalid Codex app-server response")); }
  });
  const call: CodexCall = async (method, params) => {
    if (closed || pending) throw new Error("Codex app-server unavailable");
    const id = ++sequence;
    const timer = setTimeout(() => close(new Error(`Codex ${method} timed out`)), 15_000);
    try {
      return await new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      });
    } finally {
      clearTimeout(timer);
      pending = undefined;
    }
  };
  try {
    await call("initialize", { clientInfo: { name: "pneuma-test-cleanup", version: "1" }, capabilities: { experimentalApi: true } });
    child.stdin.write('{"method":"initialized","params":{}}\n');
    return await run(call);
  } finally {
    lines.close();
    child.stdin.end();
    child.kill();
  }
}
