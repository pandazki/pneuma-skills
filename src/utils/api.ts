/** Base URL for API requests — routes to the Hono backend in dev, same-origin in production. */
export function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}
