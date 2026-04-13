import { describe, test, expect } from "bun:test";
import type {
  Source,
  SourceEvent,
  SourceProvider,
  SourceContext,
  SourceDescriptor,
  FileChannel,
  FileChangeEvent,
} from "../types/source.js";
import type { ModeManifest } from "../types/mode-manifest.js";

describe("Source contract shape", () => {
  test("SourceEvent discriminates on kind", () => {
    // Compile-time exhaustiveness check: if a new kind is added without
    // updating this function, tsc will complain about the unreachable case.
    function assertNever(x: never): never {
      throw new Error(`Unexpected: ${String(x)}`);
    }
    function reduce<T>(e: SourceEvent<T>): string {
      switch (e.kind) {
        case "value":
          return e.origin;
        case "error":
          return e.code;
        default:
          return assertNever(e);
      }
    }
    expect(
      reduce<number>({ kind: "value", value: 1, origin: "initial" }),
    ).toBe("initial");
    expect(
      reduce<number>({ kind: "error", code: "E_PARSE", message: "bad" }),
    ).toBe("E_PARSE");
  });

  test("Source<T> has the four required methods", () => {
    const stub: Source<number> = {
      current: () => null,
      subscribe: () => () => {},
      write: async () => {},
      destroy: () => {},
    };
    expect(typeof stub.current).toBe("function");
    expect(typeof stub.subscribe).toBe("function");
    expect(typeof stub.write).toBe("function");
    expect(typeof stub.destroy).toBe("function");
  });

  test("SourceProvider.create takes config and context, returns Source", () => {
    const provider: SourceProvider = {
      kind: "test",
      create<T>(_config: unknown, _ctx: SourceContext): Source<T> {
        return {
          current: () => null,
          subscribe: () => () => {},
          write: async () => {},
          destroy: () => {},
        };
      },
    };
    expect(provider.kind).toBe("test");
  });

  test("SourceContext exposes workspace, log, signal, optional files", () => {
    const ctx: SourceContext = {
      workspace: "/tmp/ws",
      log: () => {},
      signal: new AbortController().signal,
    };
    expect(ctx.workspace).toBe("/tmp/ws");
    expect(ctx.files).toBeUndefined();
  });

  test("FileChannel has snapshot, subscribe, write, delete", () => {
    const channel: FileChannel = {
      snapshot: () => [],
      subscribe: () => () => {},
      write: async () => {},
      delete: async () => {},
    };
    expect(channel.snapshot()).toEqual([]);
  });

  test("FileChangeEvent origin is one of initial|self|external", () => {
    const events: FileChangeEvent[] = [
      { path: "a.md", content: "x", origin: "initial" },
      { path: "a.md", content: "y", origin: "self" },
      { path: "a.md", content: "z", origin: "external" },
    ];
    expect(events).toHaveLength(3);
  });

  test("SourceDescriptor is assignable from manifest.sources entry", () => {
    const d: SourceDescriptor = {
      kind: "file-glob",
      config: { patterns: ["**/*.md"] },
    };
    expect(d.kind).toBe("file-glob");
  });

  test("ModeManifest.sources is optional and takes SourceDescriptors", () => {
    // Compile-time: this must typecheck without errors.
    const partial: Pick<ModeManifest, "sources"> = {
      sources: {
        files: { kind: "file-glob", config: { patterns: ["**/*.md"] } },
      },
    };
    expect(partial.sources?.files.kind).toBe("file-glob");
  });
});
