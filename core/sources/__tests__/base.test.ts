import { describe, test, expect } from "bun:test";
import { BaseSource } from "../base.js";
import type { SourceEvent } from "../../types/source.js";

// A minimal concrete subclass for testing BaseSource directly.
// doWrite() just echoes the value back as a "self" event and resolves.
class TestSource<T> extends BaseSource<T> {
  public doWriteCalls: T[] = [];
  public doWriteDelay = 0;
  public doWriteError: Error | null = null;

  protected async doWrite(value: T): Promise<void> {
    this.doWriteCalls.push(value);
    if (this.doWriteDelay > 0) {
      await new Promise((r) => setTimeout(r, this.doWriteDelay));
    }
    if (this.doWriteError) throw this.doWriteError;
    this.emit({ kind: "value", value, origin: "self" });
  }

  // Test hooks for driving events from outside
  public testEmitInitial(value: T): void {
    this.emit({ kind: "value", value, origin: "initial" });
  }
  public testEmitExternal(value: T): void {
    this.emit({ kind: "value", value, origin: "external" });
  }
  public testEmitError(code: string, message: string): void {
    this.emit({ kind: "error", code, message });
  }
}

describe("BaseSource", () => {
  test("current() returns null before any event", () => {
    const s = new TestSource<number>();
    expect(s.current()).toBeNull();
  });

  test("emit updates current() synchronously", () => {
    const s = new TestSource<number>();
    s.testEmitInitial(42);
    expect(s.current()).toBe(42);
  });

  test("subscribe receives future events, not a synthetic initial", () => {
    const s = new TestSource<number>();
    s.testEmitInitial(1);
    const events: SourceEvent<number>[] = [];
    s.subscribe((e) => events.push(e));
    expect(events).toHaveLength(0);  // no synthetic on subscribe
    s.testEmitExternal(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "value", value: 2, origin: "external" });
  });

  test("multiple subscribers all receive the same event", () => {
    const s = new TestSource<number>();
    const a: SourceEvent<number>[] = [];
    const b: SourceEvent<number>[] = [];
    s.subscribe((e) => a.push(e));
    s.subscribe((e) => b.push(e));
    s.testEmitExternal(7);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  test("unsubscribe stops that listener only", () => {
    const s = new TestSource<number>();
    const a: SourceEvent<number>[] = [];
    const b: SourceEvent<number>[] = [];
    const offA = s.subscribe((e) => a.push(e));
    s.subscribe((e) => b.push(e));
    offA();
    s.testEmitExternal(7);
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });

  test("write calls doWrite and emits self event", async () => {
    const s = new TestSource<string>();
    const events: SourceEvent<string>[] = [];
    s.subscribe((e) => events.push(e));
    await s.write("hello");
    expect(s.doWriteCalls).toEqual(["hello"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "value", value: "hello", origin: "self" });
    expect(s.current()).toBe("hello");
  });

  test("write Promise resolves AFTER the self event is delivered", async () => {
    const s = new TestSource<string>();
    s.doWriteDelay = 20;
    let eventSeenAt = 0;
    let writeResolvedAt = 0;
    s.subscribe((e) => {
      if (e.kind === "value" && e.origin === "self") {
        eventSeenAt = performance.now();
      }
    });
    const before = performance.now();
    await s.write("x");
    writeResolvedAt = performance.now();
    // Event must be delivered before or at the same instant write resolves
    expect(eventSeenAt).toBeGreaterThan(0);
    expect(eventSeenAt).toBeLessThanOrEqual(writeResolvedAt);
    // And the write took roughly the doWriteDelay
    expect(writeResolvedAt - before).toBeGreaterThanOrEqual(15);
  });

  test("concurrent write calls are serialized in call order", async () => {
    const s = new TestSource<number>();
    s.doWriteDelay = 10;
    const writes = [s.write(1), s.write(2), s.write(3)];
    await Promise.all(writes);
    expect(s.doWriteCalls).toEqual([1, 2, 3]);
    expect(s.current()).toBe(3);
  });

  test("a failed write propagates its error to the caller", async () => {
    const s = new TestSource<number>();
    s.doWriteError = new Error("disk full");
    await expect(s.write(1)).rejects.toThrow("disk full");
  });

  test("a failed write does not block subsequent writes", async () => {
    const s = new TestSource<number>();
    s.doWriteError = new Error("first fails");
    await expect(s.write(1)).rejects.toThrow("first fails");
    s.doWriteError = null;
    await s.write(2);
    expect(s.current()).toBe(2);
  });

  test("destroy() is idempotent and makes write a no-op", async () => {
    const s = new TestSource<number>();
    s.destroy();
    s.destroy();  // second call is safe
    await s.write(1);  // resolves without calling doWrite
    expect(s.doWriteCalls).toEqual([]);
    expect(s.current()).toBeNull();
  });

  test("current() returns null after destroy even if a value was previously written", async () => {
    const s = new TestSource<number>();
    await s.write(42);
    expect(s.current()).toBe(42);
    s.destroy();
    expect(s.current()).toBeNull();
  });

  test("destroy while a write is queued prevents doWrite from running", async () => {
    const s = new TestSource<number>();
    s.doWriteDelay = 30;
    // Start write 1 (takes 30ms); queue write 2 behind it.
    const w1 = s.write(1);
    const w2 = s.write(2);
    // Destroy after w1 starts but before w1 finishes (and thus before w2 runs).
    // Give the first doWrite a chance to begin by yielding once.
    await new Promise((r) => setTimeout(r, 5));
    s.destroy();
    // Both promises settle without throwing.
    await w1;
    await w2;
    // doWrite for w1 already started before destroy (it's running concurrently),
    // so it's in doWriteCalls. But doWrite for w2 should NOT have been called.
    expect(s.doWriteCalls).toContain(1);
    expect(s.doWriteCalls).not.toContain(2);
  });

  test("destroy() removes all subscribers", () => {
    const s = new TestSource<number>();
    const events: SourceEvent<number>[] = [];
    s.subscribe((e) => events.push(e));
    s.destroy();
    s.testEmitExternal(1);  // after destroy, emit is a no-op
    expect(events).toHaveLength(0);
  });

  test("subscribe after destroy returns a no-op unsubscribe", () => {
    const s = new TestSource<number>();
    s.destroy();
    const off = s.subscribe(() => {});
    expect(typeof off).toBe("function");
    off();  // must not throw
  });

  test("error events do not update current()", () => {
    const s = new TestSource<number>();
    s.testEmitInitial(10);
    s.testEmitError("E_X", "bad");
    expect(s.current()).toBe(10);
  });

  test("error event is delivered to all subscribers", () => {
    const s = new TestSource<number>();
    const events: SourceEvent<number>[] = [];
    s.subscribe((e) => events.push(e));
    s.testEmitError("E_X", "bad");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "error", code: "E_X", message: "bad" });
  });

  test("a listener that throws does not prevent other listeners from running", () => {
    const s = new TestSource<number>();
    s.subscribe(() => { throw new Error("boom"); });
    const events: SourceEvent<number>[] = [];
    s.subscribe((e) => events.push(e));
    s.testEmitExternal(1);
    expect(events).toHaveLength(1);
  });
});
