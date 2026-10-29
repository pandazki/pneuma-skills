/**
 * `runFalJob` names the job it gave up on.
 *
 * Once fal has accepted a submit there is a `request_id` upstream, and any
 * later failure — FAILED, a deadline, an abort, a result that would not
 * download — leaves a job that may already be billed. A caller that records
 * the failure (the craft writer's `fail --request-id`) needs that id to
 * reconcile the record against fal's queue, so it rides on the thrown error
 * as `error.requestId`. A submit that fal refused never became a job and
 * carries none.
 *
 * Pinned against a real local server (`Bun.serve` on port 0), like the
 * plotwise suite: the module is a sequence of HTTP calls.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { runFalJob } from "../fal-queue.mjs";

interface Script {
  submitStatus?: number;
  status?: () => unknown;
  resultStatus?: number;
  onPoll?: (call: number) => void;
}

const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterEach(() => {
  while (servers.length) servers.pop()!.stop(true);
});

function fakeFal(script: Script): string {
  let origin = "";
  let polls = 0;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.method === "POST") {
        if (script.submitStatus && script.submitStatus !== 200) return new Response("bad request", { status: script.submitStatus });
        const id = "req-77";
        return json({
          request_id: id,
          status_url: `${origin}/requests/${id}/status`,
          response_url: `${origin}/requests/${id}`,
          cancel_url: `${origin}/requests/${id}/cancel`,
        });
      }
      if (req.method === "PUT") return json({ status: "CANCELLED" });
      if (path.endsWith("/status")) {
        polls += 1;
        script.onPoll?.(polls);
        return json(script.status ? script.status() : { status: "COMPLETED" });
      }
      if (script.resultStatus && script.resultStatus !== 200) return new Response("gone", { status: script.resultStatus });
      return json({ video: { url: "https://cdn.example/clip.mp4" } });
    },
  });
  servers.push(server);
  origin = `http://localhost:${server.port}`;
  return `${origin}/fal-ai/test-app`;
}

const FAST = { key: "test-key", pollMs: 1, retryDelaysMs: [] as number[], body: {} };

async function rejection(promise: Promise<unknown>): Promise<Error & { requestId?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { requestId?: string };
  }
  throw new Error("expected the job to reject");
}

describe("runFalJob — a job fal accepted is named on the error", () => {
  test("FAILED carries the request id", async () => {
    const url = fakeFal({ status: () => ({ status: "FAILED", error: "content policy" }) });
    const error = await rejection(runFalJob({ ...FAST, url }));
    expect(error.message).toContain("content policy");
    expect(error.requestId).toBe("req-77");
  });

  test("a deadline carries the request id", async () => {
    const url = fakeFal({ status: () => ({ status: "IN_PROGRESS" }) });
    const error = await rejection(runFalJob({ ...FAST, url, deadlineMs: 40, label: "clip" }));
    expect(error.message).toContain("clip exceeded");
    expect(error.requestId).toBe("req-77");
  });

  test("an abort carries the request id and is still an AbortError", async () => {
    const controller = new AbortController();
    const url = fakeFal({
      status: () => ({ status: "IN_QUEUE" }),
      onPoll: (call) => {
        if (call === 2) controller.abort();
      },
    });
    const error = await rejection(runFalJob({ ...FAST, url, signal: controller.signal }));
    expect(error.name).toBe("AbortError");
    expect(error.requestId).toBe("req-77");
  });

  test("a result that will not download carries the request id", async () => {
    const url = fakeFal({ resultStatus: 500 });
    const error = await rejection(runFalJob({ ...FAST, url }));
    expect(error.message).toContain("result HTTP 500");
    expect(error.requestId).toBe("req-77");
  });

  test("a submit fal refused never became a job and names none", async () => {
    const url = fakeFal({ submitStatus: 422 });
    const error = await rejection(runFalJob({ ...FAST, url }));
    expect(error.message).toContain("HTTP 422");
    expect(error.requestId).toBeUndefined();
  });
});
