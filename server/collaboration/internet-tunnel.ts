import { constants } from "node:fs";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { CollaborationTunnelProvider } from "../../core/types/collaboration-access.js";
import type { TunnelRunnerConfig, TunnelRunnerMessage } from "./internet-tunnel-runner.js";

export type { CollaborationTunnelProvider } from "../../core/types/collaboration-access.js";

export interface CollaborationTunnelCleanup {
  /** Resolves only after child termination and private-file cleanup are confirmed. */
  stop(): Promise<void>;
}

/** A failed startup can still own a process whose release needs confirmation. */
export class CollaborationTunnelStartupError extends Error {
  readonly cleanup: CollaborationTunnelCleanup;

  constructor(message: string, cleanup: CollaborationTunnelCleanup) {
    super(message);
    this.name = "CollaborationTunnelStartupError";
    this.cleanup = cleanup;
  }
}

export interface CollaborationTunnelHandle extends CollaborationTunnelCleanup {
  origin: string;
  /** The owned cloudflared child, rather than its EOF watchdog. */
  pid: number;
}

export interface StartCollaborationTunnelOptions {
  /** The collaboration-only listener. Never pass a private Session port. */
  targetUrl: string;
  provider?: CollaborationTunnelProvider;
  signal?: AbortSignal;
  /** Called once for an unexpected exit after readiness, after cleanup. */
  onExit?: (error: Error) => void;
  binaryPath?: string;
  packageRoot?: string;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
}

function targetOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Tunnel target must be a loopback HTTP origin with an explicit collaboration port."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
    || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Tunnel target must be a loopback HTTP origin with an explicit collaboration port.");
  }
  return url.origin;
}

function namedOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Named tunnel publicOrigin must be a public HTTPS origin."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/"
    || url.search || url.hash || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname)
    || url.hostname.endsWith(".localhost")) {
    throw new Error("Named tunnel publicOrigin must be a public HTTPS origin.");
  }
  return url.origin;
}

function duration(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > 120_000) throw new Error("Tunnel timeout must be between 1 and 120000 milliseconds.");
  return value;
}

async function executable(path: string): Promise<boolean> {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}

/** Detect an executable without launching it or reading provider configuration. */
export async function findCloudflaredExecutable(packageRoot: string): Promise<string | null> {
  const name = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const candidates = [
    join(packageRoot, "vendor", "cloudflared", `${process.platform}-${process.arch}`, name),
    // Desktop resources sit beside the bundled Pneuma package and Bun runtime.
    join(dirname(packageRoot), "cloudflared", name),
    Bun.which(name),
    ...(process.platform === "darwin" ? ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"] : []),
  ];
  for (const path of candidates) if (path && await executable(path)) return resolve(path);
  return null;
}

/** Resolve once; no installation, shell execution, update, or global config mutation. */
async function resolveCloudflared(options: StartCollaborationTunnelOptions, packageRoot: string): Promise<string> {
  if (options.binaryPath !== undefined) {
    if (!isAbsolute(options.binaryPath) || !await executable(options.binaryPath)) throw new Error("Configured cloudflared binary is not an executable absolute path.");
    return options.binaryPath;
  }
  const binary = await findCloudflaredExecutable(packageRoot);
  if (binary) return binary;
  throw new Error("cloudflared is required for Internet access. Install it from https://developers.cloudflare.com/tunnel/downloads/ and retry, or configure an executable binary path.");
}

/** Avoid ambient Tunnel settings, tokens, proxies, and the user's global configs. */
function isolatedEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR", "SystemRoot", "SYSTEMROOT", "WINDIR", "TMPDIR", "TMP", "TEMP", "HOME", "USERPROFILE", "XDG_CONFIG_HOME"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key]!;
  }
  return env;
}

async function privateFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { mode: 0o600, flag: "wx" });
}

async function namedCredentials(provider: Extract<CollaborationTunnelProvider, { kind: "named" }>): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(provider.tunnelId)
    || !isAbsolute(provider.credentialsFile)) throw new Error("Named tunnel requires a tunnel UUID and an absolute credentials file path.");
  try {
    const file = Bun.file(provider.credentialsFile);
    if (file.size > 65_536) throw new Error("oversized");
    const credentials = JSON.parse(await file.text()) as Record<string, unknown>;
    if (typeof credentials.AccountTag !== "string" || !credentials.AccountTag
      || typeof credentials.TunnelSecret !== "string" || !credentials.TunnelSecret
      || typeof credentials.TunnelID !== "string" || credentials.TunnelID.toLowerCase() !== provider.tunnelId.toLowerCase()) throw new Error("invalid");
    // Copy only cloudflared's credential fields; do not pass secrets in argv or env.
    return JSON.stringify({ AccountTag: credentials.AccountTag, TunnelSecret: credentials.TunnelSecret, TunnelID: credentials.TunnelID });
  } catch { throw new Error("Named tunnel credentials could not be read or do not match its UUID. Check the locally-managed tunnel credentials file."); }
}

/**
 * Exposes one collaboration listener through an owned cloudflared process.
 * A small child watchdog owns the provider and observes EOF on our stdin pipe,
 * including when the authority is killed without running its cleanup handlers.
 */
export async function startCollaborationTunnel(options: StartCollaborationTunnelOptions): Promise<CollaborationTunnelHandle> {
  options.signal?.throwIfAborted();
  const target = targetOrigin(options.targetUrl);
  const provider = options.provider ?? { kind: "quick" };
  if (provider.kind !== "quick" && provider.kind !== "named") throw new Error("Unsupported collaboration tunnel provider.");
  const origin = provider.kind === "named" ? namedOrigin(provider.publicOrigin) : undefined;
  const credentials = provider.kind === "named" ? await namedCredentials(provider) : undefined;
  const startupTimeoutMs = duration(options.startupTimeoutMs, 45_000);
  const stopTimeoutMs = duration(options.stopTimeoutMs, 2_000);
  const packageRoot = options.packageRoot ?? resolve(import.meta.dir, "../..");
  const binary = await resolveCloudflared(options, packageRoot);
  options.signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), "pneuma-collaboration-tunnel-"));
  await chmod(directory, 0o700);
  const configPath = join(directory, "config.yml");
  const pidPath = join(directory, "connected.pid");
  const runnerPath = join(directory, "runner.json");
  let runner: ReturnType<typeof Bun.spawn>;
  try {
    if (provider.kind === "named") {
      const credentialsPath = join(directory, "credentials.json");
      await privateFile(credentialsPath, credentials!);
      await privateFile(configPath, `tunnel: ${JSON.stringify(provider.tunnelId)}\ncredentials-file: ${JSON.stringify(credentialsPath)}\ningress:\n  - hostname: ${JSON.stringify(new URL(origin!).hostname)}\n    service: ${JSON.stringify(target)}\n  - service: http_status:404\n`);
    } else {
      await privateFile(configPath, "{}\n");
    }
    // Quick Tunnels otherwise force QUIC. HTTP/2 also carries WebSockets and
    // works on networks that restrict UDP: synthetic HTTPS/WSS verification
    // succeeded over HTTP/2 after QUIC edge-dial timeouts on 2026-10-14.
    const args = ["tunnel", "--config", configPath, "--origincert", join(directory, "unused-origin-cert.pem"), "--no-autoupdate", "--protocol", "http2", "--metrics", "127.0.0.1:0", "--pidfile", pidPath, "--loglevel", "info"];
    if (provider.kind === "quick") args.push("--url", target);
    else args.push("run", provider.tunnelId);
    await privateFile(runnerPath, JSON.stringify({ binary, args, directory, pidPath, origin, startupTimeoutMs, stopTimeoutMs } satisfies TunnelRunnerConfig));
    options.signal?.throwIfAborted();
    runner = Bun.spawn([process.execPath, join(packageRoot, "server/collaboration/internet-tunnel-runner.ts"), runnerPath], {
      cwd: directory, env: isolatedEnvironment(), stdin: "pipe", stdout: "pipe", stderr: "ignore",
    });
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }

  let intentional = false;
  let ready = false;
  let closed: Extract<TunnelRunnerMessage, { event: "closed" }> | undefined;
  let resolveReady!: (value: CollaborationTunnelHandle) => void;
  let rejectReady!: (error: unknown) => void;
  const readiness = new Promise<CollaborationTunnelHandle>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    intentional = true;
    if (runner.stdin && typeof runner.stdin !== "number") runner.stdin.end();
    const attempt = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          completion,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Tunnel shutdown timed out; provider termination could not be confirmed. Internet access may still be active.")), stopTimeoutMs * 2 + 1_000);
          }),
        ]);
        if (!closed?.terminated) throw new Error("Tunnel supervisor could not confirm provider termination. Internet access may still be active.");
      } finally { clearTimeout(timer); }
    })();
    stopping = attempt;
    // A timeout does not prove that cleanup will never finish. Let a later
    // explicit disable inspect the same completion instead of caching failure.
    void attempt.catch(() => { if (stopping === attempt) stopping = undefined; });
    return attempt;
  };
  const rejectStartup = (error: unknown, cleanupUnconfirmed = !closed?.terminated) => {
    rejectReady(cleanupUnconfirmed
      ? new CollaborationTunnelStartupError(error instanceof Error ? error.message : "Tunnel startup failed before provider release was confirmed.", { stop })
      : error);
  };
  const aborted = () => { void stop().catch((error: unknown) => { if (!ready) rejectStartup(error, true); }); };
  options.signal?.addEventListener("abort", aborted, { once: true });
  // The runner enforces provider startup timeout. This outer deadline also
  // covers a watchdog that fails to initialize or never emits its protocol.
  const startupTimer = setTimeout(() => {
    void stop().then(() => rejectStartup(new Error("Tunnel startup timed out before a Cloudflare connection was established. Check Internet connectivity and retry.")), (error: unknown) => rejectStartup(error, true));
  }, startupTimeoutMs + 1_000);
  const completion = (async () => {
    let protocolError = false;
    try {
      let pending = "";
      const decoder = new TextDecoder();
      const reader = (runner.stdout as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        if (pending.length > 16_384) { protocolError = true; if (runner.stdin && typeof runner.stdin !== "number") runner.stdin.end(); break; }
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          let message: TunnelRunnerMessage;
          try { message = JSON.parse(line) as TunnelRunnerMessage; } catch { protocolError = true; continue; }
          if (message.event === "closed") closed = message;
          else if (message.event === "ready" && !ready && !intentional) {
            ready = true;
            clearTimeout(startupTimer);
            resolveReady({ origin: message.origin, pid: message.pid, stop });
          }
        }
      }
    } catch { protocolError = true; }
    const code = await runner.exited;
    clearTimeout(startupTimer);
    options.signal?.removeEventListener("abort", aborted);
    // The watchdog owns normal cleanup. If it failed, remove our local files,
    // but explicitly report that child termination was not confirmed.
    await rm(directory, { recursive: true, force: true });
    const error = !closed?.terminated || protocolError || code !== 0
      ? new Error("Tunnel supervisor failed; provider termination could not be confirmed. Internet access may still be active.")
      : new Error(closed.reason === "timeout" ? "Tunnel startup timed out before a Cloudflare connection was established. Check Internet connectivity and retry."
        : closed.reason === "spawn-error" ? "cloudflared could not start. Check its executable installation and retry."
          : `cloudflared exited${closed.exitCode === undefined ? "" : ` with code ${closed.exitCode}`} before the tunnel was stopped. Check connectivity or named tunnel configuration and retry.`);
    if (!ready) rejectStartup(options.signal?.aborted ? options.signal.reason : error);
    else if (!intentional) {
      try { options.onExit?.(error); } catch { console.error("Collaboration tunnel exit callback failed."); }
    }
  })();
  // Handle a completion failure even if the caller has not yet asked to stop.
  void completion.catch(() => {
    clearTimeout(startupTimer);
    options.signal?.removeEventListener("abort", aborted);
    const error = new Error("Tunnel cleanup failed. Provider release could not be confirmed.");
    if (!ready) rejectStartup(error, true);
    else if (!intentional) {
      try { options.onExit?.(error); } catch { console.error("Collaboration tunnel exit callback failed."); }
    }
  });
  if (options.signal?.aborted) aborted();
  return readiness;
}
