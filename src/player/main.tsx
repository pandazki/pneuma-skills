// src/player/main.tsx — entry for the hosted read-only player build.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { initialLocaleReady } from "../i18n/index.js";
import PlayerApp from "./PlayerApp.js";

void initialLocaleReady.then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PlayerApp />
    </StrictMode>,
  );
});
