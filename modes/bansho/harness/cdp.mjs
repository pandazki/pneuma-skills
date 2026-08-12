/**
 * A minimal, ISOLATED CDP driver for the bansho harness.
 *
 * Why it exists: the `chrome-devtools` CLI drives ONE shared daemon, and
 * restarting it steals whatever page another agent is mid-run on. This
 * script talks CDP to a Chrome the caller launched with its own
 * `--remote-debugging-port` and `--user-data-dir`, so two harness runs can
 * never see each other.
 *
 * Usage:
 *   bun modes/bansho/harness/cdp.mjs <port> nav <url>
 *   bun modes/bansho/harness/cdp.mjs <port> eval '<js expression>'
 *   bun modes/bansho/harness/cdp.mjs <port> evalFile <path.js>
 *   bun modes/bansho/harness/cdp.mjs <port> shot <out.png>
 *   bun modes/bansho/harness/cdp.mjs <port> viewport <w> <h>
 */

const [port, cmd, ...rest] = process.argv.slice(2);
if (!port || !cmd) {
  console.error("usage: cdp.mjs <port> <nav|eval|evalFile|shot|viewport> ...");
  process.exit(2);
}

const listTargets = async () => {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return await res.json();
};

const pageTarget = async () => {
  const targets = await listTargets();
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

const connect = async () => {
  const target = await pageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });
  return new Session(ws);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  const s = await connect();
  try {
    if (cmd === "nav") {
      await s.send("Page.enable");
      await s.send("Page.navigate", { url: rest[0] });
      await sleep(Number(rest[1] ?? 4000));
      console.log("ok");
      return;
    }
    if (cmd === "viewport") {
      await s.send("Emulation.setDeviceMetricsOverride", {
        width: Number(rest[0]),
        height: Number(rest[1]),
        deviceScaleFactor: 1,
        mobile: false,
      });
      console.log("ok");
      return;
    }
    if (cmd === "media") {
      await s.send("Emulation.setEmulatedMedia", {
        features: [{ name: rest[0], value: rest[1] }],
      });
      console.log("ok");
      return;
    }
    if (cmd === "click") {
      const [x, y] = rest.map(Number);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await s.send("Input.dispatchMouseEvent", {
          type,
          x,
          y,
          button: "left",
          buttons: type === "mousePressed" ? 1 : 0,
          clickCount: 1,
        });
      }
      console.log("ok");
      return;
    }
    if (cmd === "wheel") {
      const [x, y, dy, times] = rest.map(Number);
      for (let i = 0; i < (times || 1); i++) {
        await s.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x,
          y,
          deltaX: 0,
          deltaY: dy,
        });
        await sleep(40);
      }
      console.log("ok");
      return;
    }
    if (cmd === "drag") {
      const [x0, y0, x1, y1] = rest.map(Number);
      await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", buttons: 1, clickCount: 1 });
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        await s.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: x0 + ((x1 - x0) * i) / steps,
          y: y0 + ((y1 - y0) * i) / steps,
          button: "left",
          buttons: 1,
        });
      }
      await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", buttons: 0, clickCount: 1 });
      console.log("ok");
      return;
    }
    if (cmd === "shot") {
      const [x, y, w, h, scale] = rest.slice(1).map(Number);
      const r = await s.send("Page.captureScreenshot", {
        format: "png",
        ...(Number.isFinite(w) && w > 0
          ? { clip: { x, y, width: w, height: h, scale: scale || 1 } }
          : {}),
      });
      await Bun.write(rest[0], Buffer.from(r.data, "base64"));
      console.log(rest[0]);
      return;
    }
    const expr =
      cmd === "evalFile" ? await Bun.file(rest[0]).text() : rest.join(" ");
    const r = await s.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      console.error(JSON.stringify(r.exceptionDetails, null, 2));
      process.exit(1);
    }
    const value = r.result?.value;
    console.log(typeof value === "string" ? value : JSON.stringify(value));
  } finally {
    s.ws.close();
  }
};

run().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
