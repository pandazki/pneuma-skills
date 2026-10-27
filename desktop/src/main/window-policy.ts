import type { AppWindowRequest } from "../../../core/types/desktop-window.js";

function parseLoopbackUrl(value: string): URL {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username || url.password
  ) {
    throw new Error("App windows require an HTTP(S) loopback URL");
  }
  return url;
}

export function parseAppWindowRequest(raw: unknown, senderUrl: string): AppWindowRequest {
  if (parseLoopbackUrl(senderUrl).pathname !== "/") {
    throw new Error("Only the app shell can open app windows");
  }
  if (
    typeof raw !== "object" || raw === null ||
    !("kind" in raw) || !("url" in raw) || typeof raw.url !== "string" ||
    (raw.kind !== "session" && raw.kind !== "export")
  ) {
    throw new Error("Invalid app window request");
  }
  const url = parseLoopbackUrl(raw.url);
  if (raw.kind === "session" ? url.pathname !== "/" : !url.pathname.startsWith("/export/")) {
    throw new Error("App window URL does not match its requested kind");
  }
  return { kind: raw.kind, url: url.href };
}

export function parseExternalPopupUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) {
    throw new Error(`Unsupported popup URL scheme: ${url.protocol}`);
  }
  return url.href;
}
