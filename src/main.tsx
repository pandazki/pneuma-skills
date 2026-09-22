import * as React from "react";
import { StrictMode } from "react";
import * as ReactDOM from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import * as ReactI18next from "react-i18next";
import "./index.css";
import i18n, { syncLocaleFromServer } from "./i18n/index.js";
import { getApiBase } from "./utils/api.js";
import App from "./App.js";
import { useStore } from "./store.js";

// Fire-and-forget: apply user-saved locale once the server responds.
// Initial render uses navigator-detected locale, which avoids blank-frame
// blocking on slow API. The first locale change after mount re-renders.
void syncLocaleFromServer(getApiBase());

// Expose React for external mode viewer bundles (loaded via importmap in production).
// The /vendor/react-dom.js shim reads __PNEUMA_REACT_DOM__ and re-exports named
// symbols from it — if this isn't set, any published mode bundle that imports
// from "react-dom" fails at module-eval time with a destructure-undefined error.
//
// __PNEUMA_STORE__ is also exposed so the mode's /vendor/pneuma-store.js shim
// can re-export a reference to the host's Zustand instance. Without this the
// bundler inlines our store into every mode and cross-boundary state
// (activeContentSet, activeFile, selection) silently stops flowing.
//
// __PNEUMA_I18N__ carries the host's *initialised* i18next instance plus the
// react-i18next namespace that `initReactI18next` already bound to it. A mode
// bundle with its own inlined copy of react-i18next would have no instance
// behind it, so every `t(...)` would render its raw key.
//
// The set of globals here is the host ABI declared in
// `snapshot/mode-build.ts` (HOST_ABI_VENDOR_URLS / HOST_ABI_VENDOR_SHIMS);
// the shims that read them are served by the session server.
(window as any).__PNEUMA_REACT__ = React;
(window as any).__PNEUMA_REACT_DOM__ = { ...ReactDOM, createRoot, hydrateRoot };
(window as any).__PNEUMA_JSX_RUNTIME__ = JsxRuntime;
(window as any).__PNEUMA_STORE__ = useStore;
(window as any).__PNEUMA_I18N__ = { i18next: i18n, reactI18next: ReactI18next };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
