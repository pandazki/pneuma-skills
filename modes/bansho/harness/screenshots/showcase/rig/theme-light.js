(() => {
  // Browser-local theme override. `~/.pneuma/settings.json` is shared with
  // the user's other live sessions, so the UI toggle (which POSTs) is off
  // limits: patch the GET this page makes instead.
  if (!window.__themePatched) {
    window.__themePatched = true;
    const orig = window.fetch.bind(window);
    window.__forcedTheme = null;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : (input?.url ?? "");
      if (window.__forcedTheme && url.includes("/api/user-theme") && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve(new Response(JSON.stringify({ theme: window.__forcedTheme }), { headers: { "Content-Type": "application/json" } }));
      }
      return orig(input, init);
    };
  }
  window.__forcedTheme = "light";
  window.dispatchEvent(new CustomEvent("pneuma:theme-changed", { detail: { theme: "light" } }));
  return "forced " + window.__forcedTheme;
})()
