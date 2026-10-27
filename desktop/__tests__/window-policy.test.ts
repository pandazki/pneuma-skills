import { describe, expect, test } from "bun:test";
import { parseAppWindowRequest, parseExternalPopupUrl } from "../src/main/window-policy.js";

const shell = "http://localhost:5173/?project=demo";

describe("app window IPC boundary", () => {
  test("accepts sessions, projects, and background borrow roots", () => {
    for (const url of [
      "http://localhost:3001/?session=abc",
      "https://127.0.0.1:3002/?project=demo",
      "http://[::1]:3003/?mode=webcraft&background=true",
    ]) {
      expect(parseAppWindowRequest({ kind: "session", url }, shell)).toEqual({ kind: "session", url });
    }
  });

  test("exports may use a backend port different from the frontend", () => {
    const request = { kind: "export", url: "http://localhost:3001/export/pdf?path=deck" };
    expect(parseAppWindowRequest(request, shell)).toEqual(request);
  });

  test("content and export pages cannot request app ownership", () => {
    for (const sender of [
      "http://localhost:3001/content/index.html",
      "http://localhost:3001/export/pdf",
      "https://example.com/",
      "http://localhost.evil:3001/",
      "file:///index.html",
    ]) {
      expect(() => parseAppWindowRequest({ kind: "session", url: shell }, sender)).toThrow();
    }
  });

  test("refuses malformed requests and destinations outside the declared route", () => {
    for (const request of [
      null, {}, { kind: "chat", url: shell }, { kind: "session", url: 3001 },
      { kind: "session", url: "http://localhost:3001/content/page.html" },
      { kind: "session", url: "http://localhost:3001/export/pdf" },
      { kind: "export", url: shell },
      { kind: "export", url: "http://localhost:3001/exported/pdf" },
      { kind: "export", url: "https://example.com/export/pdf" },
      { kind: "session", url: "http://localhost.evil:3001/" },
      { kind: "session", url: "http://localhost@evil:3001/" },
      { kind: "session", url: "http://user:password@localhost:3001/" },
      { kind: "session", url: "file:///" },
      { kind: "session", url: "javascript:alert(1)" },
      { kind: "session", url: "/?session=abc" },
    ]) {
      expect(() => parseAppWindowRequest(request, shell)).toThrow();
    }
  });
});

describe("ordinary browser popups", () => {
  test("local roots and content remain browser destinations", () => {
    for (const url of [
      "http://localhost:3001/?background=1&mode=webcraft",
      "http://127.0.0.1:3002/content/page.html",
      "http://localhost:3001/export/pdf",
      "https://example.com/path?q=1#section",
      "mailto:hello@example.com", "tel:+15551234567",
    ]) {
      expect(parseExternalPopupUrl(url)).toBe(url);
    }
  });

  test("refuses unsupported and blank-first destinations", () => {
    for (const url of ["about:blank", "javascript:alert(1)", "file:///tmp/page.html", "data:text/html,hello", "pneuma://handoff", "invalid"]) {
      expect(() => parseExternalPopupUrl(url)).toThrow();
    }
  });
});
