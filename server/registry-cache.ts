import { isPublishedMode, type PublishedMode, type PublishedRegistryStatus } from "../core/types/mode-registry.js";

const REGISTRY_URL = "https://pneuma-storage.vibecoding.icu/registry/index.json";
const REGISTRY_TTL_MS = 60_000;

/** Local locale-specific SWR and the independent shared published list. */
export function createRegistryCache<T extends object>(
  buildLocal: (locale: string) => Promise<T>,
  options: { fetch?: (url: string, init?: RequestInit) => Promise<Response>; now?: () => number; ttlMs?: number } = {},
) {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? REGISTRY_TTL_MS;
  const cache = new Map<string, { value: T; fetchedAt: number }>();
  const inflight = new Map<string, Promise<T>>();
  let generation = 0;
  let published: PublishedMode[] = [];
  let publishedStatus: PublishedRegistryStatus = { state: "loading" };
  let publishedAttemptAt = -Infinity;
  let publishedInflight: Promise<void> | undefined;

  function refreshPublished(force: boolean) {
    if (publishedInflight || (!force && now() - publishedAttemptAt < ttlMs)) return;
    publishedStatus = { state: "loading" };
    publishedInflight = Promise.resolve().then(async () => {
      try {
        const response = await request(REGISTRY_URL, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`Published mode registry returned HTTP ${response.status}`);
        const data = await response.json() as { modes?: unknown };
        if (!Array.isArray(data.modes) || !data.modes.every(isPublishedMode)) {
          throw new Error("Published mode registry returned an invalid mode list");
        }
        published = data.modes;
        publishedStatus = { state: "ready" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishedStatus = { state: "error", error: message };
        console.warn(`[registry-cache] published refresh failed: ${message}`);
      } finally {
        publishedAttemptAt = now();
        publishedInflight = undefined;
      }
    });
  }

  function getLocal(locale: string): Promise<T> {
    const cached = cache.get(locale);
    if (cached && now() - cached.fetchedAt < ttlMs) return Promise.resolve(cached.value);
    if (!inflight.has(locale)) {
      const startedGeneration = generation;
      const pending = Promise.resolve().then(() => buildLocal(locale)).then((value) => {
        // An install/library/locale mutation invalidates both cached and in-flight
        // local snapshots. An older read must not put the old bucket back.
        if (startedGeneration !== generation) return getLocal(locale);
        cache.set(locale, { value, fetchedAt: now() });
        return value;
      }).catch((error) => {
        if (startedGeneration !== generation) return getLocal(locale);
        if (!cached) throw error;
        console.warn(`[registry-cache] revalidate failed (${locale}): ${error}`);
        return cached.value;
      }).finally(() => {
        if (inflight.get(locale) === pending) inflight.delete(locale);
      });
      inflight.set(locale, pending);
    }
    return cached ? Promise.resolve(cached.value) : inflight.get(locale)!;
  }

  return {
    async get(locale: string, forcePublished = false): Promise<T & { published: PublishedMode[]; publishedStatus: PublishedRegistryStatus }> {
      refreshPublished(forcePublished);
      const local = await getLocal(locale);
      return { ...local, published, publishedStatus };
    },
    invalidate() {
      generation++;
      cache.clear();
      inflight.clear();
    },
  };
}
