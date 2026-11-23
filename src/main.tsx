import "./index.css";
import i18n, { initialLocaleReady, syncLocaleFromServer } from "./i18n/index.js";
import { readEntryParams } from "./launcher-route.js";
import { getApiBase } from "./utils/api.js";

const root = document.getElementById("root")!;
const route = readEntryParams(location.search);

async function loadView() {
  if (route.opensLauncher) {
    const { default: Launcher } = await import("./components/Launcher.js");
    return <Launcher />;
  }
  if (route.isEmptyShell && route.projectParam) {
    const { EmptyShell } = await import("./components/EmptyShell.js");
    return <EmptyShell projectRoot={route.projectParam} />;
  }
  const { default: App } = await import("./App.js");
  return <App isChatWindow={route.isChatWindow} />;
}

// Preserve the launcher's first paint until its real view is ready. Project
// and Session pages start with an empty root and need their own loading text.
if (!route.opensLauncher) root.textContent = i18n.t("common:loading");

// The browser language is already loading. Start the preference read, host
// singletons, and selected view together, then mount with the host ABI ready.
void syncLocaleFromServer(getApiBase());
void Promise.all([import("./renderer.js"), loadView(), initialLocaleReady]).then(
  ([{ renderView }, view]) => renderView(root, route, view),
  error => {
    root.setAttribute("role", "alert");
    root.textContent = String(error);
  },
);
