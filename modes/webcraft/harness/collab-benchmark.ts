/** Repeatable loopback measurements; this does not claim physical LAN/WAN or paint latency. */
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startCollaborationHost } from "../../../server/collaboration/host.js";
import { startFileWatcher } from "../../../server/file-watcher.js";
import type { CollaborationRole, CollaborationServerMessage } from "../../../core/types/collaboration.js";
import { collaborationFixture } from "./collab-fixture.js";

type Envelope = { message: CollaborationServerMessage; at: number };
async function connect(url: string, token: string) {
  const socket = new WebSocket(`${url.replace("http", "ws")}/ws?token=${encodeURIComponent(token)}`);
  const history: Envelope[] = [];
  const listeners = new Set<() => void>();
  socket.addEventListener("message", (event) => {
    history.push({ message: JSON.parse(event.data as string), at: performance.now() });
    for (const listener of listeners) listener();
  });
  const wait = (predicate: (message: CollaborationServerMessage) => boolean, after = 0): Promise<Envelope> => new Promise((resolve, reject) => {
    const check = () => {
      const found = history.find((entry) => entry.at >= after && predicate(entry.message));
      if (!found) return;
      clearTimeout(timeout); listeners.delete(check); resolve(found);
    };
    const timeout = setTimeout(() => { listeners.delete(check); reject(new Error("Benchmark update timed out")); }, 5000);
    listeners.add(check); check();
  });
  await wait((message) => message.type === "welcome");
  socket.send(JSON.stringify({ type: "join", roomId: "website" }));
  await wait((message) => message.type === "room");
  return { socket, wait, history };
}

function summary(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 100) / 100;
  return { samples: sorted.length, p50Ms: round(sorted[Math.floor(sorted.length * .5)]!), p95Ms: round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)]!), maxMs: round(sorted.at(-1)!) };
}

const scratch = await mkdtemp(join(tmpdir(), "pneuma-collab-benchmark-"));
const root = join(scratch, "site");
const baselineRoot = join(scratch, "baseline");
const frontendDir = join(scratch, "frontend");
for (const directory of [root, baselineRoot, frontendDir]) await mkdir(directory, { recursive: true });
const html = collaborationFixture();
await Bun.write(join(root, "index.html"), html);
await Bun.write(join(baselineRoot, "index.html"), html);
await Bun.write(join(frontendDir, "index.html"), "<!doctype html><title>Benchmark</title>");
const members = (["admin", "writer", "reader"] as CollaborationRole[]).map((role) => ({ id: role, name: role, role, token: crypto.randomUUID() }));
let baselineCallback: (() => void) | null = null;
let baseline: ReturnType<typeof startFileWatcher> | undefined;
let host: Awaited<ReturnType<typeof startCollaborationHost>> | undefined;
const clients: Awaited<ReturnType<typeof connect>>[] = [];
try {
  host = await startCollaborationHost({
    project: { id: "benchmark", name: "Benchmark" }, members,
    rooms: [{ id: "website", title: "Website", mode: "webcraft", ownerId: "admin", root, page: "index.html", enabled: true }],
    stateDir: join(scratch, "state"), frontendDir, frameScript: "", hostname: "127.0.0.1", port: 0,
  });
  baseline = startFileWatcher(baselineRoot, { watchPatterns: ["**/*.html"], ignorePatterns: [] }, () => { baselineCallback?.(); });
  await baseline.ready;
  for (const member of members) clients.push(await connect(host.url, member.token));
  const [sender, , observer] = clients;
  const source = await fetch(`${host.url}/api/rooms/website/content`, { headers: { Authorization: `Bearer ${members[0]!.token}` } }).then((r) => r.json()) as { revision: number };
  let revision = source.revision;
  const relay: number[] = [];
  for (let i = 0; i < 90; i++) {
    const sentAt = performance.now();
    const message = {
      type: "presence", sentAt, cursor: { x: 100 + i, y: 100 }, followingId: null,
      view: { page: "index.html", revision, scrollX: 0, scrollY: i * 5, width: 1200, height: 800, documentWidth: 1200, documentHeight: 2000 },
    };
    sender!.socket.send(JSON.stringify(message));
    const received = await observer!.wait((update) => update.type === "presence" && update.sentAt === sentAt, sentAt);
    relay.push(received.at - sentAt);
    await Bun.sleep(34);
  }

  const direct: number[] = [];
  for (let i = 0; i < 8; i++) {
    const started = performance.now();
    const received = observer!.wait((update) => update.type === "content" && update.room.revision > revision, started);
    const response = await fetch(`${host.url}/api/rooms/website/content`, {
      method: "PUT", headers: { Authorization: `Bearer ${members[0]!.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ opId: crypto.randomUUID(), baseRevision: revision, html: `${html}\n<!-- direct ${i} -->` }),
    });
    if (!response.ok) throw new Error(`Source write failed: ${await response.text()}`);
    const event = await received;
    if (event.message.type === "content") revision = event.message.room.revision;
    direct.push(event.at - started);
  }

  const watched: number[] = [];
  for (let i = 0; i < 8; i++) {
    const started = performance.now();
    const received = observer!.wait((update) => update.type === "content" && update.room.revision > revision, started);
    await Bun.write(join(root, "index.html"), `${html}\n<!-- native ${i} -->`);
    const event = await received;
    if (event.message.type === "content") revision = event.message.room.revision;
    watched.push(event.at - started);
  }

  const oldWatcher: number[] = [];
  for (let i = 0; i < 8; i++) {
    const started = performance.now();
    const received = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Baseline watcher timed out")), 5000);
      baselineCallback = () => { clearTimeout(timeout); baselineCallback = null; resolve(performance.now()); };
    });
    await Bun.write(join(baselineRoot, "index.html"), `${html}\n<!-- baseline ${i} -->`);
    oldWatcher.push(await received - started);
  }
  const report = {
    measuredAt: new Date().toISOString(), runtime: `Bun ${Bun.version}`, platform: `${process.platform}/${process.arch}`,
    scope: "Loopback, 3 WebSocket clients, 1 publisher at approximately 30 Hz, single self-contained HTML page; no browser paint or physical LAN/WAN measurement.",
    pageBytes: Buffer.byteLength(html),
    presenceRelay: summary(relay), sourceSaveToPeerEvent: summary(direct),
    externalFileToPeerEvent: summary(watched), currentSessionWatcherBaseline: summary(oldWatcher),
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const client of clients) client.socket.close();
  await baseline?.close();
  await host?.close();
  await rm(scratch, { recursive: true, force: true });
}
