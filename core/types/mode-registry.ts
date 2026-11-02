/** A community-published mode, separate from the release's pinned mode catalog. */
export interface PublishedMode {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  publishedAt: string;
  archiveUrl: string;
  icon?: string;
}

/**
 * `/api/registry` always returns its local buckets without waiting for the CDN.
 * `published` retains the last successful list during refresh or failure.
 * Consumers of that bucket poll while loading; `refreshPublished=1` retries a
 * terminal error. A ready empty list is distinct from a pending/failed list.
 */
export type PublishedRegistryStatus =
  | { state: "loading" | "ready" }
  | { state: "error"; error: string };

export function isPublishedMode(value: unknown): value is PublishedMode {
  if (!value || typeof value !== "object") return false;
  const mode = value as Record<string, unknown>;
  return ["name", "displayName", "version", "publishedAt", "archiveUrl"]
    .every((key) => typeof mode[key] === "string")
    && ["description", "icon"].every((key) => mode[key] === undefined || typeof mode[key] === "string");
}
