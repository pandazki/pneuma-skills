import { expect, spyOn, test } from "bun:test";
import japaneseCommon from "../locales/ja/common.json";

test("a saved preference wins a race with a cold language bundle on the shared i18next instance", async () => {
  // Vite and the mode compiler's Babel runtime install incompatible stack
  // formatters in the same Bun process. Exercise the real Vite glob transform
  // with its own globals, as the renderer has in production.
  if (!process.env.PNEUMA_TEST_LOCALE_LOADING) {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PNEUMA_TEST_LOCALE_LOADING: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(stdout + stderr);
    return;
  }

  const { createServer } = await import("vite");
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: "delay-japanese-bundle",
      async transform(_, id) {
        if (id.endsWith("/i18n/bundles/ja.ts")) {
          started.resolve();
          await release.promise;
        }
      },
    }],
  });
  Object.defineProperty(navigator, "languages", { value: ["ja-JP"], configurable: true });
  const fetchPreference = spyOn(globalThis, "fetch");
  try {
    const { default: host, currentLocale, initialLocaleReady, syncLocaleFromServer, persistLocale } =
      await vite.ssrLoadModule("/src/i18n/index.ts") as typeof import("../index.js");
    await started.promise;
    let ready = false;
    void initialLocaleReady.then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    host.addResourceBundle("ja", "plugin", { title: "Plugin title" });
    const japanese = host.changeLanguage("ja");
    expect(host.t("common:save")).toBe("Save");

    // An active English fallback must not make the saved English preference
    // look redundant while a previous request is still loading Japanese.
    fetchPreference.mockResolvedValueOnce(Response.json({ locale: "en" }));
    await syncLocaleFromServer();
    await initialLocaleReady;
    expect(currentLocale()).toBe("en");
    release.resolve();
    await japanese;
    expect(currentLocale()).toBe("en");
    expect(host.hasResourceBundle("ja", "launcher")).toBe(true);

    const oldPreference = Promise.withResolvers<Response>();
    fetchPreference.mockReturnValueOnce(oldPreference.promise);
    const refresh = syncLocaleFromServer();
    fetchPreference.mockResolvedValueOnce(Response.json({ ok: true }));
    expect(await persistLocale("ja")).toBe(true);
    expect(fetchPreference).toHaveBeenLastCalledWith("/api/user-locale", expect.objectContaining({
      method: "POST", body: JSON.stringify({ locale: "ja" }),
    }));
    oldPreference.resolve(Response.json({ locale: "de" }));
    await refresh;
    expect(currentLocale()).toBe("ja");
    expect(host.t("common:save")).toBe(japaneseCommon.save);
    expect(host.t("plugin:title")).toBe("Plugin title");
    expect(host.hasResourceBundle("de", "common")).toBe(false);
    host.addResource("en", "plugin", "fallback", "English fallback");
    expect(host.t("plugin:fallback")).toBe("English fallback");
  } finally {
    fetchPreference.mockRestore();
    release.resolve();
    await vite.close();
  }
});
