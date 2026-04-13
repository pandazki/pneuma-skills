import { describe, test, expect } from "bun:test";
import { MemorySource } from "../memory.js";
import type { SourceEvent } from "../../types/source.js";

describe("MemorySource", () => {
  test("starts with null current when no initial given", () => {
    const s = new MemorySource<number>({});
    expect(s.current()).toBeNull();
  });

  test("starts with initial value and emits initial event synchronously on create", () => {
    const s = new MemorySource<number>({ initial: 42 });
    // MemorySource fires its initial event in the next microtask, so after
    // one tick current() should be 42. We use a microtask await.
    return Promise.resolve().then(() => {
      expect(s.current()).toBe(42);
    });
  });

  test("subscribers registered before the first tick receive the initial event", async () => {
    const s = new MemorySource<number>({ initial: 42 });
    const events: SourceEvent<number>[] = [];
    s.subscribe((e) => events.push(e));
    await Promise.resolve();  // let the microtask run
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "value", value: 42, origin: "initial" });
  });

  test("write() emits a self event and updates current()", async () => {
    const s = new MemorySource<number>({ initial: 0 });
    await Promise.resolve();  // drain initial
    const events: SourceEvent<number>[] = [];
    s.subscribe((e) => events.push(e));
    await s.write(7);
    expect(s.current()).toBe(7);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "value", value: 7, origin: "self" });
  });

  test("destroy stops further writes", async () => {
    const s = new MemorySource<number>({ initial: 0 });
    s.destroy();
    await s.write(1);
    expect(s.current()).toBeNull();
  });
});
