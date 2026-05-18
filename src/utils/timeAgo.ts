import i18n from "../i18n/index.js";

/**
 * Format a timestamp as a relative time string (e.g., "2 hours ago", "just now").
 * Localized via the `time` namespace.
 */
export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return i18n.t("time:just_now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return i18n.t("time:minutes_ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t("time:hours_ago", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return i18n.t("time:days_ago", { count: days });
  return i18n.t("time:months_ago", { count: Math.floor(days / 30) });
}

/**
 * Format a duration (from startedAt to now) as a human-readable string.
 * Used for running processes/sessions.
 */
export function runningDuration(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return i18n.t("time:seconds_short", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return i18n.t("time:minutes_short", { count: minutes });
  const hours = Math.floor(minutes / 60);
  return i18n.t("time:hours_minutes_short", { hours, minutes: minutes % 60 });
}
