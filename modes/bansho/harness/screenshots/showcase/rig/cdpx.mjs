/**
 * Extra CDP verbs the bansho harness driver does not carry:
 *   clearMetrics                  — Emulation.clearDeviceMetricsOverride
 *   bounds <w> <h>                — Browser.setWindowBounds on the page's window
 *   key <text>                    — Input.dispatchKeyEvent (rawKeyDown+char+keyUp)
 * Same isolation contract as cdp.mjs: caller-owned port, own user-data-dir.
 */
const [port, cmd, ...rest] = process.argv.slice(2);

const pageTarget = async () => {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  if (!page) throw new Error("no page target");
  return page;
};

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

const target = await pageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener("open", r, { once: true });
  ws.addEventListener("error", j, { once: true });
});
const s = new Session(ws);

try {
  if (cmd === "clearMetrics") {
    await s.send("Emulation.clearDeviceMetricsOverride");
    console.log("cleared");
  } else if (cmd === "bounds") {
    const { windowId } = await s.send("Browser.getWindowForTarget", { targetId: target.id });
    await s.send("Browser.setWindowBounds", {
      windowId,
      bounds: { width: Number(rest[0]), height: Number(rest[1]), windowState: "normal" },
    });
    console.log("ok");
  } else if (cmd === "front") {
    await s.send("Page.bringToFront");
    console.log("ok");
  } else if (cmd === "key") {
    const text = rest.join(" ");
    for (const type of ["rawKeyDown", "char", "keyUp"]) {
      await s.send("Input.dispatchKeyEvent", { type, text, key: text });
    }
    console.log("ok");
  } else {
    console.error("unknown cmd");
    process.exit(2);
  }
} finally {
  ws.close();
}
