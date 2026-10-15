import en from "../i18n/locales/en/collaboration-setup.json";
import type { CollaborationSetupStatus } from "../../core/types/collaboration-setup.js";
export type { CollaborationSetupStatus } from "../../core/types/collaboration-setup.js";

export type CollaborationSetupPath = "lan" | "temporary" | "named";

export function readSetupStatus(value: unknown): CollaborationSetupStatus {
  const status = value as Partial<CollaborationSetupStatus> | null;
  if (!status || typeof status.platform !== "string" || !status.platform || typeof status.appVersion !== "string" || !status.appVersion
    || typeof status.guidePath !== "string" || !/^(?:\/|[A-Za-z]:[\\/])/.test(status.guidePath)
    || typeof status.cloudflared?.installed !== "boolean") throw new Error("Invalid collaboration setup status");
  return { platform: status.platform, appVersion: status.appVersion, guidePath: status.guidePath, cloudflared: { installed: status.cloudflared.installed } };
}

/** Accept a hostname or HTTPS origin, never credentials, routes, or invitation links. */
export function setupHostname(value: string): string | null {
  if (!value.trim()) return "";
  const raw = value.trim();
  if (/\s/.test(raw) || raw.replace(/^https:\/\//i, "").replace(/\/$/, "").includes(":")) return null;
  try {
    const url = new URL(value.includes("://") ? value.trim() : `https://${value.trim()}`);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash
      || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname) || url.hostname.endsWith(".localhost") || !url.hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
    return url.hostname;
  } catch { return null; }
}

export type SetupRequestStrings = Pick<typeof en, "request" | "request_paths" | "request_hostname" | "request_missing">;

export function createSetupRequest(status: CollaborationSetupStatus, path: CollaborationSetupPath, guideUrl: string, hostname = "", strings: SetupRequestStrings = en): string {
  const values: Record<string, string> = {
    scenario: strings.request_paths[path],
    hostnameClause: path === "named" && hostname ? strings.request_hostname.replace("{{hostname}}", hostname) : "",
    appVersion: status.appVersion,
    platform: status.platform,
    guidePath: JSON.stringify(status.guidePath),
    guideUrl: JSON.stringify(guideUrl),
    missing: strings.request_missing[path],
  };
  return strings.request.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}
