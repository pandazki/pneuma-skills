import { describe, test, expect } from "bun:test";
import { SourceRegistry } from "../source-registry.js";
import { BUILT_IN_PROVIDERS } from "../sources/index.js";
import type {
  SourceProvider,
  SourceContext,
  FileChannel,
} from "../types/source.js";
import type { ModeManifest } from "../types/mode-manifest.js";

function noopCtx(files?: FileChannel): SourceContext {
  return {
    workspace: "/tmp/test",
    log: () => {},
    signal: new AbortController().signal,
    files,
  };
}

describe("SourceRegistry", () => {
  test("registers built-in providers and looks them up by kind", () => {
    const reg = new SourceRegistry();
    for (const p of BUILT_IN_PROVIDERS) reg.register(p);
    expect(reg.has("memory")).toBe(true);
    expect(reg.has("file-glob")).toBe(true);
    expect(reg.has("json-file")).toBe(true);
    expect(reg.has("aggregate-file")).toBe(true);
    expect(reg.has("redis")).toBe(false);
  });

  test("instantiates a memory source from a manifest declaration", async () => {
    const reg = new SourceRegistry();
    for (const p of BUILT_IN_PROVIDERS) reg.register(p);
    const manifest: Pick<ModeManifest, "sources"> = {
      sources: {
        state: { kind: "memory", config: { initial: 42 } },
      },
    };
    const instances = reg.instantiateAll(manifest.sources ?? {}, noopCtx());
    expect(instances.state).toBeDefined();
    await Promise.resolve();
    expect(instances.state.current()).toBe(42);
  });

  test("instantiateAll throws if an unknown kind is declared", () => {
    const reg = new SourceRegistry();
    for (const p of BUILT_IN_PROVIDERS) reg.register(p);
    expect(() =>
      reg.instantiateAll(
        { x: { kind: "does-not-exist", config: {} } },
        noopCtx(),
      ),
    ).toThrow(/does-not-exist/);
  });

  test("destroyAll destroys every instance", async () => {
    const reg = new SourceRegistry();
    for (const p of BUILT_IN_PROVIDERS) reg.register(p);
    const instances = reg.instantiateAll(
      { a: { kind: "memory" }, b: { kind: "memory" } },
      noopCtx(),
    );
    reg.destroyAll(instances);
    // After destroy, current() is null even if an initial was queued
    await Promise.resolve();
    expect(instances.a.current()).toBeNull();
    expect(instances.b.current()).toBeNull();
  });

  test("registering a provider with a duplicate kind throws", () => {
    const reg = new SourceRegistry();
    const p: SourceProvider = {
      kind: "memory",
      create: () => ({
        current: () => null,
        subscribe: () => () => {},
        write: async () => {},
        destroy: () => {},
      }),
    };
    reg.register(p);
    expect(() => reg.register(p)).toThrow(/memory/);
  });

  test("effectiveSources throws if manifest.sources is absent", () => {
    const manifestLike = {
      name: "legacy-external-mode",
      viewer: { watchPatterns: ["**/*.md"], ignorePatterns: [] },
      sources: undefined,
    };
    expect(() =>
      SourceRegistry.effectiveSources(manifestLike as unknown as ModeManifest),
    ).toThrow(/not compatible with pneuma-skills 2\.29\.0/);
  });

  test("effectiveSources error message includes the mode name and migration pointers", () => {
    const manifestLike = {
      name: "my-broken-mode",
      viewer: { watchPatterns: ["**/*.md"], ignorePatterns: [] },
      sources: undefined,
    };
    let captured: Error | null = null;
    try {
      SourceRegistry.effectiveSources(manifestLike as unknown as ModeManifest);
    } catch (e) {
      captured = e as Error;
    }
    expect(captured).not.toBeNull();
    const msg = captured!.message;
    // Mode name appears in the error
    expect(msg).toContain("my-broken-mode");
    // Version pivot is called out
    expect(msg).toContain("2.29.0");
    // Migration doc is referenced
    expect(msg).toContain("docs/migration/2.29-source-abstraction.md");
    // Escape hatch is documented
    expect(msg).toContain("pneuma-skills@2.28");
    // Common fix (file-glob snippet) is inline
    expect(msg).toContain("file-glob");
    // Headless opt-out is mentioned
    expect(msg).toContain("sources: {}");
  });

  test("effectiveSources preserves an explicit sources block unchanged", () => {
    const manifestLike = {
      viewer: { watchPatterns: ["**/*.md"], ignorePatterns: [] },
      sources: { custom: { kind: "memory", config: { initial: 1 } } },
    };
    const effective = SourceRegistry.effectiveSources(manifestLike as unknown as ModeManifest);
    expect(effective).toEqual({
      custom: { kind: "memory", config: { initial: 1 } },
    });
  });
});
