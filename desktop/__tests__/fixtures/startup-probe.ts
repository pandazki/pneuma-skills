import { mock } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

mock.module("electron", () => ({ app: { isPackaged: true } }));
Object.defineProperty(process, "resourcesPath", { value: process.env.TEST_RESOURCES });
const { spawnLauncherProcess, killAllProcesses, getLauncherUrl } = await import("../../src/main/bun-process.js");
const scenario = process.env.TEST_SCENARIO;
try {
const pending = spawnLauncherProcess();
// Observe rejection from the outset, including while waiting for the stub PID.
const outcome = pending.then(() => "ready", () => "cancelled");
if (scenario === "cancel-shell") {
  killAllProcesses();
  assert.equal(await outcome, "cancelled");
  assert.equal(existsSync(process.env.TEST_CHILD_PID!), false);
} else if (scenario === "cancel-child") {
  const deadline = Date.now() + 2000;
  while (!existsSync(process.env.TEST_CHILD_PID!) && Date.now() < deadline) await Bun.sleep(5);
  assert.equal(existsSync(process.env.TEST_CHILD_PID!), true);
  const pid = Number(readFileSync(process.env.TEST_CHILD_PID!, "utf8"));
  killAllProcesses();
  assert.equal(await outcome, "cancelled");
  let running = true;
  while (running && Date.now() < deadline) {
    try { process.kill(pid, 0); await Bun.sleep(5); }
    catch { running = false; }
  }
  assert.equal(running, false);
} else {
  assert.equal(await outcome, "ready");
  assert.equal(getLauncherUrl(), "http://localhost:32123");
  killAllProcesses();
}

} finally {
  killAllProcesses();
}
