import type {
  MemorySource,
  MemoryEntry,
  MemorySearchResult,
} from "../../core/types/plugin.js";

interface ObsidianConfig {
  apiUrl: string;
  apiKey: string;
}

/**
 * Obsidian Local REST API client implementing MemorySource protocol.
 *
 * API docs: https://coddingtonbear.github.io/obsidian-local-rest-api/
 * Default endpoint: https://localhost:27124
 */
export class ObsidianMemorySource implements MemorySource {
  name = "Obsidian Vault";
  private config: ObsidianConfig;

  constructor(config: ObsidianConfig) {
    this.config = config;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: "application/json",
    };
  }

  private url(path: string): string {
    return `${this.config.apiUrl}${path}`;
  }

  async available(): Promise<boolean> {
    try {
      const resp = await fetch(this.url("/"), {
        headers: this.headers,
        // Obsidian Local REST API uses self-signed cert
        // @ts-ignore — Bun supports this
        tls: { rejectUnauthorized: false },
        signal: AbortSignal.timeout(5000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async search(
    query: string,
    options?: { limit?: number; tags?: string[] },
  ): Promise<MemorySearchResult[]> {
    try {
      const qs = new URLSearchParams({ query, contextLength: "200" });
      const resp = await fetch(this.url(`/search/simple/?${qs}`), {
        method: "POST",
        headers: this.headers,
        // @ts-ignore
        tls: { rejectUnauthorized: false },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return [];

      const results = (await resp.json()) as Array<{
        filename: string;
        score: number;
        matches: Array<{
          match: { start: number; end: number };
          context: string;
        }>;
      }>;

      const limit = options?.limit ?? 10;
      return results.slice(0, limit).map((r) => ({
        entry: {
          path: r.filename,
          title:
            r.filename.replace(/\.md$/, "").split("/").pop() ?? r.filename,
          content: "", // search results don't include full content
        },
        score: r.score,
        snippet: r.matches?.[0]?.context ?? "",
      }));
    } catch (err) {
      console.warn(
        `[obsidian-memory] search failed:`,
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  }

  async read(path: string): Promise<MemoryEntry | null> {
    try {
      const resp = await fetch(
        this.url(`/vault/${encodeURIComponent(path)}`),
        {
          headers: { ...this.headers, Accept: "text/markdown" },
          // @ts-ignore
          tls: { rejectUnauthorized: false },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!resp.ok) return null;

      const content = await resp.text();
      return {
        path,
        title: path.replace(/\.md$/, "").split("/").pop() ?? path,
        content,
      };
    } catch {
      return null;
    }
  }

  async write(
    path: string,
    content: string,
    options?: { title?: string; tags?: string[] },
  ): Promise<void> {
    let finalContent = content;
    if (options?.tags?.length) {
      const frontmatter = `---\ntags: [${options.tags.join(", ")}]\n---\n\n`;
      finalContent = frontmatter + content;
    }

    const resp = await fetch(this.url(`/vault/${encodeURIComponent(path)}`), {
      method: "PUT",
      headers: { ...this.headers, "Content-Type": "text/markdown" },
      body: finalContent,
      // @ts-ignore
      tls: { rejectUnauthorized: false },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error");
      throw new Error(`Obsidian write failed (${resp.status}): ${errText}`);
    }
  }
}
