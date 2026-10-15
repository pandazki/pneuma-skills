import { expect, test } from "bun:test";

test("private composer stages, edits, queues and retains collaboration feedback through delivery failures", async () => {
  // Isolate transport mocks from the full frontend suite's WebSocket tests.
  const child = Bun.spawn([process.execPath, new URL("./fixtures/chat-input-feedback.fixture.tsx", import.meta.url).pathname], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ code, stderr: code ? stderr : "", stdout }).toEqual({ code: 0, stderr: "", stdout: "composer feedback flow passed\n" });
});
