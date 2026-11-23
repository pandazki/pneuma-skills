import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../index.js";

test("a missing backend leaves viewing and replay usable until the next explicit attempt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pneuma-deferred-agent-"));
  const sessionFile = join(dir, "session.json");
  await writeFile(sessionFile, JSON.stringify({ editing: false }));
  let checks = 0;
  const gate = Promise.withResolvers<void>();
  const checking = Promise.withResolvers<void>();
  const running = await startServer({
    port: 0, workspace: dir, stateDir: dir, editing: false, replayMode: true,
    async ensureAgentAvailable() {
      checks++;
      if (checks <= 2) throw new Error("Install the selected backend");
      checking.resolve();
      await gate.promise;
    },
  });
  let launches = 0;
  running.onReplayContinue!(async () => {});
  const base = `http://127.0.0.1:${running.server.port}`;
  const edit = () => fetch(base + "/api/session/editing", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ editing: true }),
  });

  try {
    expect((await (await fetch(base + "/api/config")).json()).editing).toBe(false);
    expect((await edit()).status).toBe(503);
    expect(checks).toBe(0);
    running.onEditingLaunch!(async () => { launches++; });
    const replay = await fetch(base + "/api/replay/continue", { method: "POST" });
    expect(replay.status).toBe(500);
    expect((await (await fetch(base + "/api/replay/status")).json()).replayMode).toBe(true);
    expect((await (await edit()).json()).error).toBe("Install the selected backend");
    expect((await (await fetch(base + "/api/config")).json()).editing).toBe(false);
    expect(JSON.parse(await readFile(sessionFile, "utf8")).editing).toBe(false);
    expect(launches).toBe(0);

    const pending = edit();
    await checking.promise;
    expect((await edit()).status).toBe(409);
    gate.resolve();
    expect((await (await pending).json()).agentStatus).toBe("launched");
    expect(JSON.parse(await readFile(sessionFile, "utf8")).editing).toBe(true);
    expect(launches).toBe(1);
    expect(checks).toBe(3);
  } finally {
    gate.resolve();
    await running.cleanup?.();
    running.server.stop(true);
    await rm(dir, { recursive: true, force: true });
  }
});
