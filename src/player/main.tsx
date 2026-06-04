// src/player/main.tsx — entry for the hosted read-only player build.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "../i18n/index.js"; // initialize i18next (ReplayPlayer / ChatPanel use it)
import PlayerApp from "./PlayerApp.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlayerApp />
  </StrictMode>,
);
