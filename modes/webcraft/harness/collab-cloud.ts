/** Webcraft cloud prototype: local files and host window, cloud discussion. */
import { chmod, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { startCloudCollaborationConnector } from "../../../server/collaboration/cloud-connector.js";
import { collaborationFixture } from "./collab-fixture.js";

interface CloudConfig {
  cloudOrigin: string;
  project: { id: string; name: string };
  owner: { id: string; name: string; token: string };
  publisherToken: string;
  room: { id: string; title: string; mode: string; ownerId: string; page: string; enabled: boolean };
  root: string;
}

const { values } = parseArgs({ args: Bun.argv.slice(2), strict: true, options: {
  cloud: { type: "string" }, project: { type: "string" }, workspace: { type: "string" },
  page: { type: "string", default: "index.html" }, port: { type: "string", default: "17998" },
  "bootstrap-secret-file": { type: "string" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log(`Webcraft cloud collaboration prototype

  bun run dev:collab:cloud --cloud https://your-worker.workers.dev --project /path/to/demo

Options:
  --cloud                  Deployed collaboration Worker origin
  --project                Local prototype state directory (required)
  --workspace              Explicit static public site directory (default: a demo page)
  --page                   HTML page within the site (default: index.html)
  --port                   Loopback host window port (default: 17998)
  --bootstrap-secret-file  Initialize a new cloud project using a secret file

Only the declared site is published. Agent history and private session routes
are absent. Open the local host link, then Share to invite remote reviewers.
The publisher must stay running to publish new file versions.
`);
  process.exit(0);
}
if (!values.project) throw new Error("--project is required to preserve publisher credentials across restarts");
const projectRoot = resolve(values.project);
const stateDir = join(projectRoot, ".pneuma", "collaboration-cloud");
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const path = join(stateDir, "config.json");
const lockPath = join(stateDir, "publisher.lock");
async function takeLock() {
  try {
    const previous = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number };
    let alive = false;
    try { process.kill(previous.pid, 0); alive = true; } catch { /* Stale publisher lock. */ }
    if (alive) throw new Error(`This project already has a running publisher (PID ${previous.pid})`);
    await unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const handle = await open(lockPath, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify({ pid: process.pid })); }
  finally { await handle.close(); }
}
await takeLock();

let config: CloudConfig;
if (await Bun.file(path).exists()) {
  config = await Bun.file(path).json();
  if (!config.cloudOrigin || !config.owner?.token || !config.publisherToken || !config.room?.id || !config.root) throw new Error("Invalid cloud publisher configuration");
  if (values.cloud && new URL(values.cloud).origin !== config.cloudOrigin) throw new Error("This project already uses another cloud origin. Use a separate --project directory");
  if (values.workspace && resolve(values.workspace) !== config.root) throw new Error("This project already publishes a different site. Use a separate --project directory");
} else {
  if (!values.cloud || !values["bootstrap-secret-file"]) throw new Error("A new cloud project needs --cloud and --bootstrap-secret-file");
  const root = resolve(values.workspace ?? join(projectRoot, "website"));
  if (!values.workspace) {
    await mkdir(root, { recursive: true });
    await Bun.write(join(root, "index.html"), collaborationFixture());
  }
  const credential = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  config = {
    cloudOrigin: new URL(values.cloud).origin,
    project: { id: "pneuma-cloud-prototype", name: "Fieldwork / Cloud collaboration" },
    owner: { id: "host", name: "Host", token: credential() }, publisherToken: credential(),
    room: { id: "website", title: "Fieldwork website", mode: "webcraft", ownerId: "host", page: values.page!, enabled: true }, root,
  };
  await Bun.write(path, JSON.stringify(config, null, 2));
  await chmod(path, 0o600);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be an integer from 0 to 65535");
let connector: Awaited<ReturnType<typeof startCloudCollaborationConnector>> | undefined;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await connector?.close();
  await unlink(lockPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") console.error("Could not remove publisher lock", error.message); });
}
try {
  const repoRoot = resolve(import.meta.dir, "../../..");
  await import("../../../cloud/collaboration/build.js");
  if (values["bootstrap-secret-file"]) {
    const secret = (await Bun.file(resolve(values["bootstrap-secret-file"])).text()).trim();
    if (!secret) throw new Error("Bootstrap secret file is empty");
    const viewer = await Bun.file(join(repoRoot, "cloud/collaboration/dist/viewer-manifest.json")).json() as { frameScriptUrl: string };
    const response = await fetch(`${config.cloudOrigin}/internal/bootstrap`, {
      method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ project: config.project, owner: config.owner, publisherToken: config.publisherToken, room: config.room, frameScriptUrl: viewer.frameScriptUrl }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || `Cloud project initialization failed (${response.status})`);
    }
  }
  connector = await startCloudCollaborationConnector({
    cloudOrigin: config.cloudOrigin, root: config.root, page: config.room.page, roomId: config.room.id,
    ownerId: config.owner.id, ownerToken: config.owner.token, publisherToken: config.publisherToken,
    frontendDir: join(repoRoot, "cloud/collaboration/dist"), port,
    onStatus: (message) => console.log(`[collaboration] ${message}`),
  });
  const localUrl = `http://localhost:${connector.port}/#token=${config.owner.token}&room=${config.room.id}`;
  const accessPath = join(stateDir, "access.json");
  await Bun.write(accessPath, JSON.stringify({ localUrl, cloudOrigin: config.cloudOrigin, page: join(config.root, config.room.page) }, null, 2));
  await chmod(accessPath, 0o600);
  console.log(`\nCloud collaboration is ready.\nHost window: ${localUrl}\nShared page: ${join(config.root, config.room.page)}\nAccess details: ${accessPath}\n\nUse Share in the host window to invite remote reviewers. Stop with Ctrl+C.\n`);
} catch (error) {
  await stop();
  throw error;
}
process.on("SIGINT", () => { void stop().then(() => process.exit(0)); });
process.on("SIGTERM", () => { void stop().then(() => process.exit(0)); });
