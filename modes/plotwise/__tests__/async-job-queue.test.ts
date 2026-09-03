/**
 * async-job-queue.mjs — the play manager's scheduler. Everything the
 * manager relies on is pinned here: the concurrency cap, priority order
 * with FIFO inside a priority, the two shapes of cancellation (a pending
 * job never runs; an active job's `AbortSignal` fires, which is what
 * reaches fal as a remote cancel), bulk pruning, and the idle gate.
 *
 * No fakes: the queue is driven with real promises the test releases by
 * hand, so the assertions are about ordering, not about a mock.
 */

import { describe, expect, test } from "bun:test";

import { AsyncJobQueue } from "../skill/scripts/async-job-queue.mjs";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every already-settled microtask/timer turn drain. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("AsyncJobQueue", () => {
  test("never runs more than `concurrency` jobs at once", async () => {
    const queue = new AsyncJobQueue(2);
    const gates = new Map<string, Deferred<void>>();
    let active = 0;
    let peak = 0;
    const finished: string[] = [];

    for (const key of ["a", "b", "c", "d", "e"]) {
      const gate = deferred();
      gates.set(key, gate);
      queue.enqueue(key, 0, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
        finished.push(key);
      });
    }

    await tick();
    expect(active).toBe(2);
    expect(queue.snapshot().active.map((item) => item.key)).toEqual(["a", "b"]);
    expect(queue.snapshot().queued.map((item) => item.key)).toEqual(["c", "d", "e"]);
    expect(queue.snapshot().concurrency).toBe(2);

    for (const gate of gates.values()) gate.resolve();
    await queue.whenIdle();

    expect(peak).toBe(2);
    expect(finished.length).toBe(5);
    expect(queue.snapshot()).toEqual({ queued: [], active: [], concurrency: 2 });
  });

  test("runs the lowest priority number first, FIFO within a priority", async () => {
    const queue = new AsyncJobQueue(1);
    const blocker = deferred();
    const order: string[] = [];

    queue.enqueue("blocker", -1, async () => {
      await blocker.promise;
    });
    await tick();

    // Enqueued out of priority order on purpose.
    queue.enqueue("late-low", 5, async () => void order.push("late-low"));
    queue.enqueue("first-mid", 1, async () => void order.push("first-mid"));
    queue.enqueue("second-mid", 1, async () => void order.push("second-mid"));
    queue.enqueue("top", 0, async () => void order.push("top"));

    expect(queue.snapshot().queued.map((item) => item.key)).toEqual([
      "top",
      "first-mid",
      "second-mid",
      "late-low",
    ]);

    blocker.resolve();
    await queue.whenIdle();
    expect(order).toEqual(["top", "first-mid", "second-mid", "late-low"]);
  });

  test("re-enqueuing a pending key only sharpens its priority", async () => {
    const queue = new AsyncJobQueue(1);
    const blocker = deferred();
    const runs: string[] = [];

    queue.enqueue("blocker", -1, async () => {
      await blocker.promise;
    });
    await tick();

    expect(queue.enqueue("later", 9, async () => void runs.push("later:9"))).toBe(true);
    expect(queue.enqueue("first", 5, async () => void runs.push("first:5"))).toBe(true);
    // Same key, better priority — not a second job, and the original run wins.
    expect(queue.enqueue("later", 1, async () => void runs.push("later:1"))).toBe(false);

    expect(queue.snapshot().queued.map((item) => item.key)).toEqual(["later", "first"]);

    blocker.resolve();
    await queue.whenIdle();
    expect(runs).toEqual(["later:9", "first:5"]);
  });

  test("cancelling a pending job stops it from ever running", async () => {
    const queue = new AsyncJobQueue(1);
    const blocker = deferred();
    let ran = false;

    queue.enqueue("blocker", 0, async () => {
      await blocker.promise;
    });
    await tick();
    queue.enqueue("doomed", 0, async () => {
      ran = true;
    });

    expect(queue.cancel("doomed")).toBe("pending");
    expect(queue.snapshot().queued).toEqual([]);

    blocker.resolve();
    await queue.whenIdle();
    expect(ran).toBe(false);
  });

  test("cancelling an active job aborts its signal and frees the slot", async () => {
    const queue = new AsyncJobQueue(1);
    const started = deferred();
    const gate = deferred();
    let seen: AbortSignal | null = null;
    let aborted = false;
    let followerRan = false;

    queue.enqueue("running", 0, async (signal) => {
      seen = signal;
      started.resolve();
      signal.addEventListener("abort", () => {
        aborted = true;
        gate.resolve();
      });
      await gate.promise;
      // A real job rethrows the abort; the queue must absorb it.
      throw signal.reason;
    });
    queue.enqueue("follower", 0, async () => {
      followerRan = true;
    });

    await started.promise;
    expect(queue.cancel("running")).toBe("active");
    await queue.whenIdle();

    expect(aborted).toBe(true);
    expect(seen!.aborted).toBe(true);
    expect((seen!.reason as Error).name).toBe("AbortError");
    // A cancelled job must not poison the queue.
    expect(followerRan).toBe(true);
  });

  test("cancelling an unknown key reports nothing happened", () => {
    const queue = new AsyncJobQueue(1);
    expect(queue.cancel("ghost")).toBeUndefined();
  });

  test("cancelWhere prunes a whole subtree and counts both shapes", async () => {
    const queue = new AsyncJobQueue(1);
    const gate = deferred();
    const ran: string[] = [];
    let prunedSignal: AbortSignal | null = null;

    queue.enqueue("n2:s1", 0, async (signal) => {
      prunedSignal = signal;
      ran.push("n2:s1");
      await gate.promise;
    });
    await tick();
    queue.enqueue("n2:s2", 1, async () => void ran.push("n2:s2"));
    queue.enqueue("n2:s3", 2, async () => void ran.push("n2:s3"));
    queue.enqueue("n3:s1", 3, async () => void ran.push("n3:s1"));

    expect(queue.cancelWhere((key) => key.startsWith("n2:"))).toEqual({ pending: 2, active: 1 });
    expect(prunedSignal!.aborted).toBe(true);

    gate.resolve();
    await queue.whenIdle();
    expect(ran).toEqual(["n2:s1", "n3:s1"]);
  });

  test("whenIdle resolves immediately when there is nothing to wait for", async () => {
    const queue = new AsyncJobQueue(2);
    let resolved = false;
    void queue.whenIdle().then(() => {
      resolved = true;
    });
    await tick();
    expect(resolved).toBe(true);
  });

  test("whenIdle waits for a job cancelled while pending", async () => {
    const queue = new AsyncJobQueue(1);
    const gate = deferred();
    queue.enqueue("held", 0, async () => {
      await gate.promise;
    });
    await tick();
    queue.enqueue("dropped", 1, async () => {});

    let idle = false;
    void queue.whenIdle().then(() => {
      idle = true;
    });
    queue.cancel("dropped");
    await tick();
    expect(idle).toBe(false);

    gate.resolve();
    await queue.whenIdle();
    expect(idle).toBe(true);
  });

  test("setConcurrency drains the backlog straight away", async () => {
    const queue = new AsyncJobQueue(1);
    const gates = ["a", "b", "c"].map(() => deferred());
    let active = 0;

    ["a", "b", "c"].forEach((key, index) => {
      queue.enqueue(key, index, async () => {
        active += 1;
        await gates[index]!.promise;
        active -= 1;
      });
    });

    await tick();
    expect(active).toBe(1);

    queue.setConcurrency(3);
    await tick();
    expect(active).toBe(3);
    expect(queue.snapshot().concurrency).toBe(3);

    // Never below one, whatever a caller passes.
    queue.setConcurrency(0);
    expect(queue.snapshot().concurrency).toBe(1);

    for (const gate of gates) gate.resolve();
    await queue.whenIdle();
  });

  test("onChange fires for every transition of a key", async () => {
    const changes: string[] = [];
    const queue = new AsyncJobQueue(1, (key) => changes.push(key));
    queue.enqueue("only", 0, async () => {});
    await queue.whenIdle();
    // enqueued, started, finished.
    expect(changes.length).toBeGreaterThanOrEqual(3);
    expect(new Set(changes)).toEqual(new Set(["only"]));
  });

  test("a job that throws is contained and the queue keeps going", async () => {
    const queue = new AsyncJobQueue(1);
    const ran: string[] = [];
    queue.enqueue("bad", 0, async () => {
      ran.push("bad");
      throw new Error("boom");
    });
    queue.enqueue("good", 1, async () => void ran.push("good"));
    await queue.whenIdle();
    expect(ran).toEqual(["bad", "good"]);
  });
});
