import * as React from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import "./index.css";
import App from "./App.js";

// Expose React for external mode viewer bundles (loaded via importmap in production)
(window as any).__PNEUMA_REACT__ = React;
(window as any).__PNEUMA_JSX_RUNTIME__ = JsxRuntime;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
