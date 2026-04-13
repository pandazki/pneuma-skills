import type { SourceProvider, SourceContext, Source } from "../types/source.js";
import { MemorySource, type MemorySourceConfig } from "./memory.js";
import { FileGlobSource, type FileGlobConfig } from "./file-glob.js";
import { JsonFileSource, type JsonFileConfig } from "./json-file.js";
import { AggregateFileSource, type AggregateFileConfig } from "./aggregate-file.js";

export { BaseSource } from "./base.js";
export { MemorySource, type MemorySourceConfig } from "./memory.js";
export { FileGlobSource, type FileGlobConfig } from "./file-glob.js";
export { JsonFileSource, type JsonFileConfig } from "./json-file.js";
export { AggregateFileSource, type AggregateFileConfig } from "./aggregate-file.js";

/**
 * The four built-in providers, ready to register with a SourceRegistry.
 * Ordering matters only for debug output; providers are keyed by `kind`.
 */
export const BUILT_IN_PROVIDERS: SourceProvider[] = [
  {
    kind: "memory",
    create<T>(config: unknown, _ctx: SourceContext): Source<T> {
      return new MemorySource<T>((config ?? {}) as MemorySourceConfig<T>);
    },
  },
  {
    kind: "file-glob",
    create<T>(config: unknown, ctx: SourceContext): Source<T> {
      if (!ctx.files) {
        throw new Error(
          "file-glob source requires SourceContext.files (FileChannel). " +
            "This usually means the provider is being instantiated outside " +
            "the browser runtime.",
        );
      }
      const fgc = config as FileGlobConfig;
      // The generic T is pinned to ViewerFileContent[] at the call site,
      // but we return Source<T> here because the registry signature is
      // erased. Callers passing the wrong T get a TS error at the
      // manifest declaration site, not here.
      return new FileGlobSource(fgc, ctx.files) as unknown as Source<T>;
    },
  },
  {
    kind: "json-file",
    create<T>(config: unknown, ctx: SourceContext): Source<T> {
      if (!ctx.files) {
        throw new Error(
          "json-file source requires SourceContext.files (FileChannel).",
        );
      }
      const jfc = config as JsonFileConfig<T>;
      return new JsonFileSource<T>(jfc, ctx.files);
    },
  },
  {
    kind: "aggregate-file",
    create<T>(config: unknown, ctx: SourceContext): Source<T> {
      if (!ctx.files) {
        throw new Error(
          "aggregate-file source requires SourceContext.files (FileChannel).",
        );
      }
      const afc = config as AggregateFileConfig<T>;
      return new AggregateFileSource<T>(afc, ctx.files);
    },
  },
];
