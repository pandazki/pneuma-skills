import { connect } from "node:net";

/** How long a loopback connect may take before the port counts as free. */
const LOOPBACK_PROBE_MS = 500;

/**
 * Bind a server to the first free port from `start`, trying `attempts`
 * consecutive ports.
 *
 * A port is taken when the bind fails with EADDRINUSE, or when something
 * already answers on it at the loopback addresses. The second check exists
 * because the CLI prints `localhost:<port>` URLs and servers bind the
 * wildcard address: macOS lets a wildcard bind share a port with another
 * process's `127.0.0.1` (or `::1`) listener, and `localhost` then reaches
 * that other process (2026-09-24: a `python -m http.server` on
 * 127.0.0.1:18791 shadowed the session server bound to 18791).
 *
 * Any other bind error is thrown at once. When every port is taken this
 * throws an EADDRINUSE error naming the range, so a caller can never report
 * a server that did not bind.
 */
export async function bindFirstFreePort<T>(
  start: number,
  attempts: number,
  bind: (port: number) => T,
): Promise<{ server: T; port: number }> {
  for (let port = start; port < start + attempts; port++) {
    const next = port + 1 < start + attempts ? `, trying ${port + 1}...` : "";
    if (await answersOnLoopback(port)) {
      console.log(`[server] Port ${port} is in use on the loopback address${next}`);
      continue;
    }
    try {
      return { server: bind(port), port };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EADDRINUSE") throw err;
      console.log(`[server] Port ${port} is in use${next}`);
    }
  }
  const last = start + attempts - 1;
  throw Object.assign(new Error(`No free port: ${start}–${last} are all in use (${attempts} attempts)`), {
    code: "EADDRINUSE",
  });
}

/** Does a TCP connect to `port` succeed at 127.0.0.1 or ::1? */
async function answersOnLoopback(port: number): Promise<boolean> {
  const answers = await Promise.all(["127.0.0.1", "::1"].map((host) => connects(host, port)));
  return answers.some(Boolean);
}

function connects(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (answered: boolean) => {
      socket.destroy();
      resolve(answered);
    };
    // Refused (nobody listening), unreachable (no IPv6 loopback) or silent:
    // not in use as far as `localhost` is concerned; the bind decides.
    socket.setTimeout(LOOPBACK_PROBE_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
