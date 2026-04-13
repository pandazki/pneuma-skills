import type {
  Source,
  SourceProvider,
  SourceContext,
  SourceDescriptor,
} from "./types/source.js";
import type { ModeManifest } from "./types/mode-manifest.js";

export class SourceRegistry {
  private providers = new Map<string, SourceProvider>();

  register(provider: SourceProvider): void {
    if (this.providers.has(provider.kind)) {
      throw new Error(
        `SourceRegistry: provider kind "${provider.kind}" is already registered`,
      );
    }
    this.providers.set(provider.kind, provider);
  }

  has(kind: string): boolean {
    return this.providers.has(kind);
  }

  instantiate(
    descriptor: SourceDescriptor,
    ctx: SourceContext,
  ): Source<unknown> {
    const provider = this.providers.get(descriptor.kind);
    if (!provider) {
      throw new Error(
        `SourceRegistry: no provider registered for kind "${descriptor.kind}"`,
      );
    }
    return provider.create<unknown>(descriptor.config, ctx);
  }

  instantiateAll(
    descriptors: Record<string, SourceDescriptor>,
    ctx: SourceContext,
  ): Record<string, Source<unknown>> {
    const out: Record<string, Source<unknown>> = {};
    for (const [id, desc] of Object.entries(descriptors)) {
      out[id] = this.instantiate(desc, ctx);
    }
    return out;
  }

  destroyAll(instances: Record<string, Source<unknown>>): void {
    for (const instance of Object.values(instances)) {
      try {
        instance.destroy();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[source-registry] destroy threw", err);
      }
    }
  }

  /**
   * Compute the effective `sources` declaration for a manifest. Since
   * pneuma-skills 2.29.0 every ModeManifest must declare `sources`
   * explicitly (use `sources: {}` for headless modes like evolve).
   * An absent `sources` field means the mode was authored against
   * the pre-2.29 contract and needs to be migrated.
   */
  static effectiveSources(
    manifest: ModeManifest,
  ): Record<string, SourceDescriptor> {
    if (!manifest.sources) {
      throw new Error(
        `\n` +
          `╔═══════════════════════════════════════════════════════════════╗\n` +
          `║  Mode "${manifest.name}" is not compatible with pneuma-skills 2.29.0+\n` +
          `╚═══════════════════════════════════════════════════════════════╝\n` +
          `\n` +
          `pneuma-skills 2.29.0 introduced the Source<T> abstraction. Every\n` +
          `ModeManifest must now declare a \`sources\` field describing the\n` +
          `data channels its viewer consumes. This mode's manifest does not.\n` +
          `\n` +
          `➤ TO FIX (most modes, 4 lines): add this to your manifest.ts\n` +
          `  alongside the existing \`viewer\` field:\n` +
          `\n` +
          `    sources: {\n` +
          `      files: {\n` +
          `        kind: "file-glob",\n` +
          `        config: { patterns: [/* copy from viewer.watchPatterns */] },\n` +
          `      },\n` +
          `    },\n` +
          `\n` +
          `  Then in your viewer component, replace the deprecated\n` +
          `  \`files: ViewerFileContent[]\` prop with \`sources\` +\n` +
          `  \`useSource(sources.files)\`. Full 5-minute guide:\n` +
          `    docs/migration/2.29-source-abstraction.md\n` +
          `\n` +
          `➤ TO FIX (viewers that write back to files): additionally\n` +
          `  destructure \`fileChannel\` from props and replace inline\n` +
          `  \`fetch('/api/files', ...)\` calls with\n` +
          `  \`fileChannel.write(path, content)\`. See the migration guide\n` +
          `  Pattern D section.\n` +
          `\n` +
          `➤ TO FIX (viewers that consume typed domain aggregates like\n` +
          `  slide/webcraft/illustrate): define a domain.ts with load/save\n` +
          `  pure functions and declare a \`kind: "aggregate-file"\` source.\n` +
          `  See modes/slide/domain.ts and modes/slide/manifest.ts as a\n` +
          `  working example. Migration guide Pattern C section.\n` +
          `\n` +
          `➤ IF YOU CANNOT MIGRATE NOW: pin the runtime to the previous\n` +
          `  minor version:\n` +
          `\n` +
          `    npm install -g pneuma-skills@2.28\n` +
          `\n` +
          `  or edit this mode's workspace using any 2.28.x release.\n` +
          `  Pneuma 2.28 remains the last release compatible with the\n` +
          `  pre-Source contract.\n` +
          `\n` +
          `➤ HEADLESS MODE (no viewer, agent-only): use \`sources: {}\`\n` +
          `  to explicitly opt out of file channels. See modes/evolve/\n` +
          `  manifest.ts.\n` +
          `\n` +
          `Full design rationale:\n` +
          `  docs/reference/viewer-agent-protocol.md (see "Sources" section)\n` +
          `  docs/superpowers/plans/2026-04-13-source-abstraction.md\n`,
      );
    }
    return manifest.sources;
  }
}
