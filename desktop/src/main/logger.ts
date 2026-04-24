/**
 * Centralized logger for the desktop app.
 *
 * Collects logs from three sources into one place:
 *   1. Desktop main process (via patched console.{log,warn,error,info})
 *   2. Bun launcher stdout/stderr (bun-process.ts forwards through console)
 *   3. Renderer processes (via IPC "log:write" from preload-patched console)
 *
 * Writes JSONL to `<userData>/logs/pneuma-<YYYY-MM-DD>.log` and keeps the
 * last N entries in an in-memory ring buffer for the log-viewer window.
 *
 * All logs also pass through to the original console so terminal/devtools
 * output stays intact during development.
 */
import { app } from "electron";
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: number;       // epoch ms
  level: LogLevel;
  source: string;   // "main" | "renderer:<id>" | "launcher:stdout" | "launcher:stderr"
  msg: string;
}

const RING_CAPACITY = 5000;
const RETAIN_DAYS = 7;

const ring: LogEntry[] = [];
let seq = 0;
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

let stream: WriteStream | null = null;
let currentDate: string | null = null;
let logDir: string | null = null;
let originalConsole: {
  log: typeof console.log;
  warn: typeof console.warn;
  error: typeof console.error;
  info: typeof console.info;
} | null = null;

function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rotateIfNeeded() {
  const today = todayString();
  if (today === currentDate && stream) return;
  if (stream) {
    try { stream.end(); } catch {}
  }
  currentDate = today;
  if (!logDir) return;
  const file = join(logDir, `pneuma-${today}.log`);
  stream = createWriteStream(file, { flags: "a" });
  stream.on("error", (err) => {
    // Fall back to console if disk writes fail; never crash the app.
    originalConsole?.error?.("[logger] write stream error:", err);
    stream = null;
  });
}

function pruneOldLogs() {
  if (!logDir) return;
  try {
    const now = Date.now();
    const cutoff = now - RETAIN_DAYS * 24 * 60 * 60 * 1000;
    for (const name of readdirSync(logDir)) {
      if (!name.startsWith("pneuma-") || !name.endsWith(".log")) continue;
      const full = join(logDir, name);
      try {
        const mtime = statSync(full).mtimeMs;
        if (mtime < cutoff) unlinkSync(full);
      } catch {}
    }
  } catch {}
}

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === "string") return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(" ");
}

export function logEntry(level: LogLevel, source: string, msg: string): void {
  rotateIfNeeded();
  const entry: LogEntry = { ts: Date.now(), level, source, msg };
  ring.push(entry);
  if (ring.length > RING_CAPACITY) ring.splice(0, ring.length - RING_CAPACITY);
  if (stream) {
    try { stream.write(JSON.stringify(entry) + "\n"); } catch {}
  }
  emitter.emit("entry", entry);
  seq++;
}

export function log(level: LogLevel, ...args: unknown[]): void {
  logEntry(level, "main", fmt(args));
}

export function subscribe(cb: (entry: LogEntry) => void): () => void {
  emitter.on("entry", cb);
  return () => emitter.off("entry", cb);
}

export function tail(n = 500): LogEntry[] {
  return ring.slice(-n);
}

export function getLogDir(): string | null {
  return logDir;
}

export function getCurrentLogFile(): string | null {
  if (!logDir || !currentDate) return null;
  return join(logDir, `pneuma-${currentDate}.log`);
}

/**
 * Write to the original (unpatched) stdout/stderr so callers that also call
 * `logEntry` with a custom source don't double-log through patched console.
 * Use this when you want both terminal visibility and a tagged ring entry.
 */
export function writeToTerminal(level: LogLevel, text: string): void {
  if (!originalConsole) return;
  if (level === "warn") originalConsole.warn(text);
  else if (level === "error") originalConsole.error(text);
  else originalConsole.log(text);
}

/**
 * Initialize the logger. Must be called before any console.log in the main
 * process that we want captured. Safe to call once on startup.
 */
export function initLogger(): void {
  if (originalConsole) return; // idempotent

  logDir = join(app.getPath("userData"), "logs");
  mkdirSync(logDir, { recursive: true });
  rotateIfNeeded();
  pruneOldLogs();

  // Patch console — preserve original behavior AND sink to file.
  originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };
  console.log = (...args: unknown[]) => {
    originalConsole!.log(...args);
    logEntry("info", "main", fmt(args));
  };
  console.info = (...args: unknown[]) => {
    originalConsole!.info(...args);
    logEntry("info", "main", fmt(args));
  };
  console.warn = (...args: unknown[]) => {
    originalConsole!.warn(...args);
    logEntry("warn", "main", fmt(args));
  };
  console.error = (...args: unknown[]) => {
    originalConsole!.error(...args);
    logEntry("error", "main", fmt(args));
  };

  // Capture uncaught main-process errors too. Use the "monitor" variant —
  // attaching a plain `uncaughtException` listener would suppress Node's
  // default crash behavior and leave the app running with corrupt state.
  process.on("uncaughtExceptionMonitor", (err) => {
    logEntry("error", "main", `uncaughtException: ${err.stack || err.message}`);
  });
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
    logEntry("error", "main", `unhandledRejection: ${msg}`);
  });

  logEntry("info", "main", `logger initialized → ${getCurrentLogFile()}`);
}
