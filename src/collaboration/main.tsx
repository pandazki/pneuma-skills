import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import * as ReactI18next from "react-i18next";
import i18n from "i18next";
import "../index.css";
import { CollaborationEntry } from "./Entry.js";
import { readCredentials } from "./client-state.js";
import "./collaboration.css";

void i18n.use(ReactI18next.initReactI18next).init({ lng: "en", fallbackLng: "en", initAsync: false, resources: { en: { translation: {} } }, interpolation: { escapeValue: false } });
const deniedStore = Object.assign(() => { throw new Error("Private Session state is unavailable in shared viewers"); }, {
  getState: () => Object.freeze({}),
  setState: () => { throw new Error("Shared viewers cannot mutate private Session state"); },
  subscribe: () => () => {},
});
Object.assign(window, {
  __PNEUMA_REACT__: React,
  __PNEUMA_REACT_DOM__: { ...ReactDOM, createRoot, hydrateRoot },
  __PNEUMA_JSX_RUNTIME__: JsxRuntime,
  __PNEUMA_STORE__: deniedStore,
  __PNEUMA_I18N__: { i18next: i18n, reactI18next: ReactI18next },
});

const credentials = readCredentials(location.href, sessionStorage);
history.replaceState(null, "", credentials.cleanUrl);
const root = document.getElementById("root");
if (!root) throw new Error("Collaboration root element is missing.");
createRoot(root).render(<CollaborationEntry initial={credentials}/>);
