/**
 * Clipcraft mode → pneuma server HTTP client.
 *
 * Currently exposes one function: writeProjectFile. Persistence is the only
 * direction that goes through an explicit API call — reads come via the
 * viewer's `files` prop from the existing chokidar → WS broadcast pipeline.
 *
 * The endpoint is the pneuma-generic `POST /api/files`, not a clipcraft-
 * specific route. Reusing the generic endpoint keeps the blast radius small
 * and means clipcraft doesn't need its own server-side code.
 */

/**
 * Write the ProjectFile content to the workspace's `project.json`.
 *
 * The returned promise resolves on a 2xx response, rejects on anything else
 * (including network failures). Callers are responsible for:
 *   - updating their in-memory "last applied content" ref BEFORE calling
 *     this function, so loop protection is active while the write is in
 *     flight and when the chokidar echo arrives
 *   - surfacing errors to the user (this module only logs to the console)
 */
export async function writeProjectFile(content: string): Promise<void> {
  const res = await fetch("/api/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "project.json", content }),
  });
  if (!res.ok) {
    let errorDetail = "";
    try {
      const body = await res.json();
      errorDetail =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : JSON.stringify(body);
    } catch {
      // non-JSON error body — ignore
    }
    throw new Error(
      `writeProjectFile failed: ${res.status}${errorDetail ? ` ${errorDetail}` : ""}`,
    );
  }
}
