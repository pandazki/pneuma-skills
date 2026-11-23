import type { Hono } from "hono";
import { checkBackendAvailability, getBackendDescriptors, getDefaultBackendType } from "../backends/index.js";
import { getBackendPrefs } from "../core/backend-prefs.js";
import type { BackendOptions } from "../core/types/agent-backend.js";

/** Both private server types host ProjectPanel and its agent picker. */
export function registerBackendAvailabilityRoute(app: Hono) {
  app.get("/api/backends", async (c) => {
    const prefs = getBackendPrefs();
    const defaultBackendType = getDefaultBackendType();
    const type = c.req.query("type");
    const scope = c.req.query("scope");
    const preferred = c.req.query("preferred");
    if (preferred !== undefined && scope !== "enabled") return c.json({ error: "Invalid backend preference" }, 400);
    let choices = getBackendDescriptors().map((descriptor) => ({
      ...descriptor, disabled: prefs[descriptor.type]?.disabled === true,
    }));

    if (type !== undefined) {
      choices = choices.filter((choice) => choice.type === (type === "default" ? defaultBackendType : type));
      if (!choices.length || scope !== undefined) return c.json({ error: "Invalid backend selection" }, 400);
    } else if (scope === "enabled") {
      choices = choices.filter((choice) => !choice.disabled);
    } else if (scope !== undefined) {
      return c.json({ error: "Invalid backend scope" }, 400);
    }

    const check = async (choice: typeof choices[number]) => {
      const { available, reason } = await checkBackendAvailability(choice.type);
      return { ...choice, available, reason };
    };
    let backends: BackendOptions["backends"];
    if (scope === "enabled") {
      // Leave the other buttons selectable without starting their runtimes.
      // A fresh picker tries its default first and stops at the first usable CLI.
      backends = [...choices];
      const pick = choices.find(choice => choice.type === preferred);
      const ordered = pick ? [pick] : [...choices].sort((a, b) =>
        Number(b.type === defaultBackendType) - Number(a.type === defaultBackendType));
      for (const candidate of ordered) {
        const checked = await check(candidate);
        backends[choices.indexOf(candidate)] = checked;
        if (checked.available) break;
      }
    } else {
      backends = await Promise.all(choices.map(check));
    }
    c.header("Cache-Control", "no-store");
    return c.json({ backends, defaultBackendType } satisfies BackendOptions);
  });
}
