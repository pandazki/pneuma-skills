import type { ResourceLanguage } from "i18next";

/** Each JSON filename is its i18next namespace. */
export function namespaces(files: ResourceLanguage): ResourceLanguage {
  return Object.fromEntries(Object.entries(files).map(([path, value]) => [
    path.slice(path.lastIndexOf("/") + 1, -".json".length), value,
  ]));
}
