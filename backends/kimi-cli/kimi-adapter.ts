/**
 * KimiAdapter — owns stdout/stdin/stderr of a spawned `kimi --print` process.
 *
 * Responsibilities:
 *   1. Buffer + parse stdout NDJSON, translate via `kimiToPneumaMessages`,
 *      fire `onMessage` for each emitted Pneuma message.
 *   2. Watch stderr for `kimi -r <uuid>` and fire `onSessionId` on first match
 *      and on every subsequent change. (Kimi prints the resume hint at end of
 *      each step; we keep the latest.)
 *   3. Accept Pneuma-side user messages via `sendUserMessage(content)`, encode
 *      as `{role:"user",content}` NDJSON, write to stdin without closing it.
 *   4. On `disconnect()` or stdout-close, fire `onDisconnect`.
 *
 * No browser/bridge knowledge here — the bridge wires these callbacks itself.
 */

import type { Readable, Writable } from "node:stream";
import {
  kimiToPneumaMessages,
  parseKimiLine,
  pneumaUserToKimi,
  type PneumaMessage,
} from "./protocol.js";

export interface KimiAdapterOptions {
  sessionId: string;
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  killProcess: () => Promise<void>;
}

const SESSION_ID_RE = /kimi -r ([0-9a-f-]{36})/;

export class KimiAdapter {
  readonly sessionId: string;
  private stdin: Writable;
  private killProcess: () => Promise<void>;

  private messageHandlers: ((msg: PneumaMessage) => void)[] = [];
  private sessionIdHandlers: ((kimiSessionId: string) => void)[] = [];
  private disconnectHandlers: (() => void)[] = [];

  private stdoutBuf = "";
  private stderrBuf = "";
  private lastEmittedSessionId: string | undefined;
  private disconnected = false;

  constructor(opts: KimiAdapterOptions) {
    this.sessionId = opts.sessionId;
    this.stdin = opts.stdin;
    this.killProcess = opts.killProcess;

    opts.stdout.on("data", (chunk: Buffer | string) => this.onStdout(chunk.toString("utf-8")));
    opts.stdout.on("close", () => this.fireDisconnect());
    opts.stderr.on("data", (chunk: Buffer | string) => this.onStderr(chunk.toString("utf-8")));
  }

  onMessage(cb: (msg: PneumaMessage) => void): void {
    this.messageHandlers.push(cb);
  }
  onSessionId(cb: (kimiSessionId: string) => void): void {
    this.sessionIdHandlers.push(cb);
  }
  onDisconnect(cb: () => void): void {
    this.disconnectHandlers.push(cb);
  }

  sendUserMessage(content: string): void {
    if (this.disconnected) return;
    const line = JSON.stringify(pneumaUserToKimi(content)) + "\n";
    this.stdin.write(line);
  }

  /**
   * Seed the session id without waiting for the stderr regex. Used when the
   * launcher pre-allocates the kimi session UUID and passes it via `-r` —
   * kimi only emits the "kimi -r <id>" resume hint on exit, so for live
   * multi-turn sessions we'd never know the id otherwise. Fires the same
   * `onSessionId` callback chain the regex would.
   */
  seedSessionId(kimiSessionId: string): void {
    if (kimiSessionId === this.lastEmittedSessionId) return;
    this.lastEmittedSessionId = kimiSessionId;
    for (const handler of this.sessionIdHandlers) {
      try { handler(kimiSessionId); } catch (err) {
        console.error(`[kimi-adapter ${this.sessionId}] sessionId handler error:`, err);
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.disconnected) return;
    this.disconnected = true;
    try { this.stdin.end(); } catch {}
    await this.killProcess();
    this.fireDisconnect();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    let idx: number;
    while ((idx = this.stdoutBuf.indexOf("\n")) !== -1) {
      const line = this.stdoutBuf.slice(0, idx);
      this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    const kimi = parseKimiLine(line);
    if (!kimi) return;
    for (const pneuma of kimiToPneumaMessages(kimi)) {
      for (const handler of this.messageHandlers) {
        try { handler(pneuma); } catch (err) {
          console.error(`[kimi-adapter ${this.sessionId}] message handler error:`, err);
        }
      }
    }
  }

  private onStderr(chunk: string): void {
    this.stderrBuf += chunk;
    // We don't gate on newlines for stderr — kimi may print the resume hint
    // without trailing newline before exit. Just scan the whole accumulated
    // buffer on each chunk.
    const match = this.stderrBuf.match(SESSION_ID_RE);
    if (match && match[1] !== this.lastEmittedSessionId) {
      this.lastEmittedSessionId = match[1];
      for (const handler of this.sessionIdHandlers) {
        try { handler(match[1]); } catch (err) {
          console.error(`[kimi-adapter ${this.sessionId}] sessionId handler error:`, err);
        }
      }
      // Forward stderr verbatim to console for diagnostics.
    }
    if (chunk) {
      process.stderr.write(`[kimi ${this.sessionId}] ${chunk}`);
    }
  }

  private fireDisconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const handler of this.disconnectHandlers) {
      try { handler(); } catch {}
    }
  }
}
