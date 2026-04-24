import * as React from "react";
import { StrictMode } from "react";
import * as ReactDOM from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import "./index.css";
import App from "./App.js";
import { useStore } from "./store.js";

// Expose React for external mode viewer bundles (loaded via importmap in production).
// The /vendor/react-dom.js shim reads __PNEUMA_REACT_DOM__ and re-exports named
// symbols from it — if this isn't set, any published mode bundle that imports
// from "react-dom" fails at module-eval time with a destructure-undefined error.
//
// __PNEUMA_STORE__ is also exposed so the mode's /vendor/pneuma-store.js shim
// can re-export a reference to the host's Zustand instance. Without this the
// bundler inlines our store into every mode and cross-boundary state
// (activeContentSet, activeFile, selection) silently stops flowing.
(window as any).__PNEUMA_REACT__ = React;
(window as any).__PNEUMA_REACT_DOM__ = { ...ReactDOM, createRoot, hydrateRoot };
(window as any).__PNEUMA_JSX_RUNTIME__ = JsxRuntime;
(window as any).__PNEUMA_STORE__ = useStore;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
