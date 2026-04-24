/**
 * Log viewer window — live tail of the desktop log stream.
 *
 * Kept deliberately simple: a single BrowserWindow with inline HTML, bound
 * to the renderer through the existing pneumaDesktop preload. The viewer
 * pulls the last N entries via IPC at startup and subscribes to an append
 * stream for live updates.
 */
import { BrowserWindow, shell } from "electron";
import path from "node:path";
import { getCurrentLogFile, getLogDir, subscribe, tail, type LogEntry } from "./logger.js";

let logWindow: BrowserWindow | null = null;
let unsubscribe: (() => void) | null = null;

export function showLogWindow(): BrowserWindow {
  if (logWindow && !logWindow.isDestroyed()) {
    if (logWindow.isMinimized()) logWindow.restore();
    logWindow.focus();
    return logWindow;
  }

  logWindow = new BrowserWindow({
    width: 1000,
    height: 640,
    minWidth: 600,
    minHeight: 300,
    title: "Pneuma Skills — Logs",
    backgroundColor: "#09090b",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  logWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderLogViewerHtml())}`);

  // Stream new entries in real-time.
  unsubscribe = subscribe((entry: LogEntry) => {
    if (!logWindow || logWindow.isDestroyed()) return;
    logWindow.webContents.send("log:append", entry);
  });

  logWindow.on("closed", () => {
    unsubscribe?.();
    unsubscribe = null;
    logWindow = null;
  });

  return logWindow;
}

export function getLogWindow(): BrowserWindow | null {
  if (logWindow && !logWindow.isDestroyed()) return logWindow;
  return null;
}

export function revealLogFile(): void {
  const file = getCurrentLogFile();
  if (file) {
    shell.showItemInFolder(file);
  } else {
    const dir = getLogDir();
    if (dir) shell.openPath(dir);
  }
}

export function getTail(n = 2000): LogEntry[] {
  return tail(n);
}

// ── Inline HTML ──────────────────────────────────────────────────────────────

function renderLogViewerHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pneuma Skills — Logs</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #09090b;
    --surface: #18181b;
    --border: rgba(255, 255, 255, 0.08);
    --fg: #e4e4e7;
    --muted: #71717a;
    --primary: #f97316;
    --ok: #4ade80;
    --warn: #fbbf24;
    --err: #f87171;
  }
  html, body {
    height: 100%;
    background: var(--bg);
    color: var(--fg);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    font-size: 12px;
    overflow: hidden;
  }
  body { display: flex; flex-direction: column; }
  header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    -webkit-app-region: drag;
  }
  header > * { -webkit-app-region: no-drag; }
  .title {
    font-weight: 600;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 12px;
    color: var(--fg);
    letter-spacing: -0.01em;
    margin-right: 8px;
  }
  input[type="search"], select, button {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 5px 10px;
    border-radius: 6px;
    font-family: inherit;
    font-size: 11px;
    outline: none;
    transition: border-color 0.15s, background 0.15s;
  }
  input[type="search"] { min-width: 200px; }
  input[type="search"]:focus, select:focus {
    border-color: var(--primary);
  }
  button {
    cursor: pointer;
    user-select: none;
  }
  button:hover { background: rgba(255, 255, 255, 0.08); }
  button.active {
    background: rgba(249, 115, 22, 0.15);
    border-color: var(--primary);
    color: var(--primary);
  }
  .spacer { flex: 1; }
  main {
    flex: 1;
    overflow-y: scroll;
    padding: 4px 0;
    background: var(--bg);
  }
  .row {
    padding: 1px 12px;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    display: flex;
    gap: 8px;
    border-left: 2px solid transparent;
  }
  .row:hover { background: rgba(255, 255, 255, 0.02); }
  .row.error { border-left-color: var(--err); }
  .row.warn { border-left-color: var(--warn); }
  .row .ts { color: var(--muted); flex: 0 0 80px; }
  .row .lvl { flex: 0 0 48px; text-align: center; font-weight: 600; }
  .row .lvl.info { color: var(--muted); }
  .row .lvl.warn { color: var(--warn); }
  .row .lvl.error { color: var(--err); }
  .row .lvl.debug { color: #60a5fa; }
  .row .src { flex: 0 0 160px; color: #a78bfa; }
  .row .msg { flex: 1; }
  footer {
    flex: 0 0 auto;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    display: flex;
    justify-content: space-between;
    font-size: 11px;
  }
  .count { color: var(--fg); font-weight: 600; }
  .paused-badge {
    background: rgba(251, 191, 36, 0.15);
    color: var(--warn);
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 600;
    display: none;
  }
  .paused-badge.on { display: inline-block; }
</style>
</head>
<body>
  <header>
    <span class="title">Pneuma Logs</span>
    <input type="search" id="search" placeholder="filter…" />
    <select id="level">
      <option value="all">all levels</option>
      <option value="debug">debug+</option>
      <option value="info">info+</option>
      <option value="warn">warn+</option>
      <option value="error">error only</option>
    </select>
    <button id="pause">Pause</button>
    <button id="clear">Clear</button>
    <button id="reveal">Reveal file</button>
    <div class="spacer"></div>
    <span class="paused-badge" id="paused">paused</span>
  </header>
  <main id="rows"></main>
  <footer>
    <span>log: <span id="file" class="count">—</span></span>
    <span><span id="shown" class="count">0</span> / <span id="total" class="count">0</span> entries</span>
  </footer>
  <script>
    const rowsEl = document.getElementById("rows");
    const searchEl = document.getElementById("search");
    const levelEl = document.getElementById("level");
    const pauseBtn = document.getElementById("pause");
    const clearBtn = document.getElementById("clear");
    const revealBtn = document.getElementById("reveal");
    const pausedBadge = document.getElementById("paused");
    const fileEl = document.getElementById("file");
    const shownEl = document.getElementById("shown");
    const totalEl = document.getElementById("total");

    /** @type {Array<{ts:number,level:string,source:string,msg:string}>} */
    let entries = [];
    let paused = false;
    let filterText = "";
    let filterLevel = "all";
    const levelRank = { debug: 0, info: 1, warn: 2, error: 3 };

    function fmtTs(ts) {
      const d = new Date(ts);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      const ms = String(d.getMilliseconds()).padStart(3, "0");
      return hh + ":" + mm + ":" + ss + "." + ms;
    }

    function matches(entry) {
      if (filterLevel !== "all" && levelRank[entry.level] < levelRank[filterLevel]) return false;
      if (filterText) {
        const needle = filterText.toLowerCase();
        if (!entry.msg.toLowerCase().includes(needle) && !entry.source.toLowerCase().includes(needle)) return false;
      }
      return true;
    }

    function escapeHtml(s) {
      return s.replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
    }

    function renderRow(entry) {
      const row = document.createElement("div");
      row.className = "row " + entry.level;
      row.innerHTML =
        '<span class="ts">' + fmtTs(entry.ts) + '</span>' +
        '<span class="lvl ' + entry.level + '">' + entry.level + '</span>' +
        '<span class="src">' + escapeHtml(entry.source) + '</span>' +
        '<span class="msg">' + escapeHtml(entry.msg) + '</span>';
      return row;
    }

    function rerender() {
      rowsEl.innerHTML = "";
      const frag = document.createDocumentFragment();
      let shown = 0;
      for (const e of entries) {
        if (!matches(e)) continue;
        frag.appendChild(renderRow(e));
        shown++;
      }
      rowsEl.appendChild(frag);
      shownEl.textContent = shown;
      totalEl.textContent = entries.length;
      rowsEl.scrollTop = rowsEl.scrollHeight;
    }

    function appendLive(entry) {
      entries.push(entry);
      if (entries.length > 20000) entries.splice(0, 1000);
      if (paused) { totalEl.textContent = entries.length; return; }
      if (!matches(entry)) { totalEl.textContent = entries.length; return; }
      const nearBottom =
        rowsEl.scrollHeight - rowsEl.scrollTop - rowsEl.clientHeight < 80;
      rowsEl.appendChild(renderRow(entry));
      shownEl.textContent = Number(shownEl.textContent) + 1;
      totalEl.textContent = entries.length;
      if (nearBottom) rowsEl.scrollTop = rowsEl.scrollHeight;
    }

    async function boot() {
      const initial = await window.pneumaLogs.tail(2000);
      entries = initial;
      rerender();
      const file = await window.pneumaLogs.currentFile();
      if (file) fileEl.textContent = file;
      window.pneumaLogs.onAppend(appendLive);
    }

    searchEl.addEventListener("input", () => { filterText = searchEl.value; rerender(); });
    levelEl.addEventListener("change", () => { filterLevel = levelEl.value; rerender(); });
    pauseBtn.addEventListener("click", () => {
      paused = !paused;
      pauseBtn.classList.toggle("active", paused);
      pauseBtn.textContent = paused ? "Resume" : "Pause";
      pausedBadge.classList.toggle("on", paused);
      if (!paused) rerender();
    });
    clearBtn.addEventListener("click", () => { entries = []; rerender(); });
    revealBtn.addEventListener("click", () => window.pneumaLogs.reveal());

    boot().catch((e) => {
      rowsEl.innerHTML = '<div class="row error" style="padding:24px">failed to load logs: ' + String(e) + '</div>';
    });
  </script>
</body>
</html>`;
}
