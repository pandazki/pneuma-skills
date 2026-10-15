import { readFile, rm } from "node:fs/promises";

/** Private protocol between the authority and its EOF watchdog. No provider logs. */
export interface TunnelRunnerConfig {
  binary: string;
  args: string[];
  directory: string;
  pidPath: string;
  origin?: string;
  startupTimeoutMs: number;
  stopTimeoutMs: number;
}

export type TunnelRunnerMessage =
  | { event: "ready"; origin: string; pid: number }
  | { event: "closed"; reason: "stopped" | "exit" | "timeout" | "spawn-error"; terminated: boolean; exitCode?: number };

function emit(message: TunnelRunnerMessage): void { process.stdout.write(`${JSON.stringify(message)}\n`); }

async function finishesWithin(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

async function run(config: TunnelRunnerConfig): Promise<void> {
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let stopping = false;
  let reason: Extract<TunnelRunnerMessage, { event: "closed" }>["reason"] = "spawn-error";
  let terminated = true;
  const requestStop = () => { stopping = true; };
  process.on("SIGTERM", requestStop);
  process.on("SIGINT", requestStop);
  // This descriptor has exactly one writer: the owning authority. The OS
  // closes it after that process dies, even when no signal handler runs.
  void (async () => {
    const reader = Bun.stdin.stream().getReader();
    try { while (!(await reader.read()).done) { /* No command payloads. */ } }
    catch { /* A failed liveness pipe also releases the child. */ }
    finally { requestStop(); }
  })();
  try {
    if (stopping) { reason = "stopped"; return; }
    child = Bun.spawn([config.binary, ...config.args], { cwd: config.directory, env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    let origin = config.origin;
    // Consume bounded chunks only to extract a Quick Tunnel origin. Never
    // persist or forward raw logs, which may contain provider credentials.
    const readOrigin = async (stream: ReadableStream<Uint8Array>) => {
      let tail = "";
      const decoder = new TextDecoder();
      const reader = stream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          tail = (tail + decoder.decode(value, { stream: true })).slice(-8_192);
          const found = tail.match(/https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.trycloudflare\.com\b/i);
          if (!origin && found) origin = found[0].toLowerCase();
        }
      } catch { requestStop(); }
    };
    const outputs = Promise.all([readOrigin(child.stdout as ReadableStream<Uint8Array>), readOrigin(child.stderr as ReadableStream<Uint8Array>)]);
    const deadline = Date.now() + config.startupTimeoutMs;
    let ready = false;
    while (!stopping && child.exitCode === null) {
      if (!ready) {
        if (Date.now() >= deadline) { reason = "timeout"; break; }
        let connected = false;
        try { connected = (await readFile(config.pidPath, "utf8")).trim() === String(child.pid); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        // cloudflared writes --pidfile only after the first registered edge
        // connection. A printed origin alone is insufficient readiness.
        if (origin && connected && child.exitCode === null && !stopping) {
          ready = true;
          emit({ event: "ready", origin, pid: child.pid });
        }
      }
      await Bun.sleep(25);
    }
    if (stopping) reason = "stopped";
    else if (child.exitCode !== null) reason = "exit";
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      if (!await finishesWithin(child.exited, config.stopTimeoutMs)) {
        child.kill("SIGKILL");
        terminated = await finishesWithin(child.exited, config.stopTimeoutMs);
      }
    }
    if (terminated) await outputs;
  } catch {
    // Every exception is observable but deliberately excludes provider output
    // and original credential paths. A spawned child still needs termination.
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
      terminated = await finishesWithin(child.exited, config.stopTimeoutMs);
    }
  } finally {
    process.removeListener("SIGTERM", requestStop);
    process.removeListener("SIGINT", requestStop);
    await rm(config.directory, { recursive: true, force: true });
    emit({ event: "closed", reason, terminated, ...(child?.exitCode === null || child?.exitCode === undefined ? {} : { exitCode: child.exitCode }) });
  }
}

if (import.meta.main) {
  try {
    const config = JSON.parse(await readFile(Bun.argv[2]!, "utf8")) as TunnelRunnerConfig;
    await run(config);
    process.exit(0);
  } catch {
    // Parent reports supervisor failure without exposing this private config.
    process.exit(1);
  }
}
