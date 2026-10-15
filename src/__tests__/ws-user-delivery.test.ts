import { expect, test } from "bun:test";

test("real user-message transport publishes only delivered drafts and preserves retry context", async () => {
  // Existing queue tests mock ws.js process-wide; run the real transport in a
  // fresh process and deliver accepted messages to an actual local WebSocket.
  const child = Bun.spawn([process.execPath, new URL("./fixtures/ws-user-delivery.fixture.ts", import.meta.url).pathname], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ code, stderr: code ? stderr : "", stdout }).toEqual({ code: 0, stderr: "", stdout: "real user delivery flow passed\n" });
});
