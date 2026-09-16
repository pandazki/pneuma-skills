/**
 * Capturing a STILL that is already on disk.
 *
 * When the stage shows a recorded round or the locked target, `capture` must
 * still answer — and the right answer is the file's own bytes, not a
 * rasterized screenshot of an `<img>` letterboxed into the viewer pane. The
 * recorded capture is what the judge scored; re-photographing it through the
 * DOM would hand the agent a rescaled, re-encoded copy of a picture it could
 * have had exactly.
 *
 * It also closes a hole the generic fallbacks cannot: the live scene iframe
 * stays mounted underneath these layers (so the bridge keeps measuring), and
 * `captureViewer`'s DOM fallback refuses to run while an iframe is present.
 * Without this, "capture the target" fails in the browser with a message
 * about the desktop app — for a PNG sitting in the workspace.
 *
 * `/content/*` is served with `Access-Control-Allow-Origin: *`, so this works
 * in dev (viewer on the Vite port, content on the API port) as well as in
 * production, where they are the same origin.
 */

/** Base64 for arbitrary bytes, chunked so a 4 MB PNG cannot blow the stack. */
export function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * The bytes of the still at `url`, as the `captureViewport` contract wants
 * them. Null for a missing file, a non-image response, or a network error —
 * a null is not a failure, it just lets the framework try its own strategies.
 */
export async function fetchStillPayload(
  url: string | null,
  fetchImpl?: FetchLike,
): Promise<{ data: string; media_type: string } | null> {
  if (!url) return null;
  const doFetch = fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!doFetch) return null;
  try {
    const response = await doFetch(url);
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    // The content route answers a missing file with an HTML 404 page in some
    // configurations; shipping that as `image/png` would hand the agent a
    // "screenshot" it cannot decode.
    if (!type.startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) return null;
    return { data: base64FromBytes(bytes), media_type: type.split(";")[0] };
  } catch {
    return null;
  }
}
