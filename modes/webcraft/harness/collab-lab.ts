/**
 * Opt-in Webcraft collaboration experiment. This starts an isolated public
 * host and never opens an existing private Agent session or its HTTP routes.
 */
import { mkdir, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir, networkInterfaces } from "node:os";
import { parseArgs } from "node:util";
import { startCollaborationHost } from "../../../server/collaboration/host.js";
import { buildCollaborationFrameScript } from "../viewer/collaboration-frame.js";
import { collaborationFixture } from "./collab-fixture.js";
import type { CollaborationRole } from "../../../core/types/collaboration.js";
import { buildCollaborationAssets } from "../../../snapshot/collaboration-build.js";

interface LabMember { id: string; name: string; role: CollaborationRole; token: string }
interface LabConfig {
  project: { id: string; name: string };
  members: LabMember[];
  rooms: { id: string; title: string; mode: string; ownerId: string; root: string; page: string; enabled: boolean }[];
}

const { values } = parseArgs({
  args: Bun.argv.slice(2), strict: true,
  options: {
    project: { type: "string" }, workspace: { type: "string" }, page: { type: "string", default: "index.html" },
    port: { type: "string", default: "17997" }, hostname: { type: "string", default: "0.0.0.0" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  console.log(`Webcraft collaboration experiment

  bun run dev:collab
  bun run dev:collab --project /tmp/my-collaboration
  bun run dev:collab --project /tmp/my-collaboration --workspace /path/to/site --page index.html

Options:
  --project    Experiment state directory (default: a new directory under the system temp directory)
  --workspace  Explicit PUBLIC site directory to share; never pass an Agent session directory
  --page       Single HTML page within that site (default: index.html)
  --port       HTTP/WebSocket port (default: 17997)
  --hostname   Bind address (default: 0.0.0.0 for LAN testing)

Creates separate administrator, writer and strict reader links. The administrator
can make an expiring anonymous viewer link. No Agent is launched. Editing the
shared HTML file with an editor or an Agent updates all joined viewers.
`);
  process.exit(0);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be an integer between 0 and 65535");
const projectRoot = resolve(values.project ?? join(tmpdir(), `pneuma-collab-${Date.now()}`));
const stateDir = join(projectRoot, ".pneuma", "collaboration-lab");
await mkdir(stateDir, { recursive: true });
const configPath = join(stateDir, "lab.json");
let config: LabConfig;
if (await Bun.file(configPath).exists()) {
  config = await Bun.file(configPath).json();
  if (!config.project?.id || !Array.isArray(config.members) || !Array.isArray(config.rooms)) throw new Error(`Invalid experiment configuration: ${configPath}`);
  if (values.workspace && resolve(values.workspace) !== config.rooms[0]?.root) {
    throw new Error("This experiment already has a different site directory. Use a new --project directory.");
  }
} else {
  const root = resolve(values.workspace ?? join(projectRoot, "website"));
  if (!values.workspace) {
    await mkdir(root, { recursive: true });
    await Bun.write(join(root, "index.html"), collaborationFixture());
  }
  if (!await Bun.file(join(root, values.page!)).exists()) throw new Error(`Page not found: ${join(root, values.page!)}`);
  const member = (id: string, name: string, role: CollaborationRole): LabMember => ({
    id, name, role, token: crypto.randomUUID() + crypto.randomUUID(),
  });
  config = {
    project: { id: crypto.randomUUID(), name: "Fieldwork / Project collaboration" },
    members: [member("host", "Host", "admin"), member("collaborator", "Alex", "writer"), member("observer", "Sam", "reader")],
    rooms: [{ id: "website", title: "Fieldwork website", mode: "webcraft", ownerId: "host", root, page: values.page!, enabled: false }],
  };
  await Bun.write(configPath, JSON.stringify(config, null, 2));
  await chmod(configPath, 0o600);
}

const repoRoot = resolve(import.meta.dir, "../../..");
const frontendDir = join(stateDir, "frontend");
await buildCollaborationAssets({ projectRoot: repoRoot, directory: frontendDir });

const host = await startCollaborationHost({
  ...config, stateDir, frontendDir, frameScript: buildCollaborationFrameScript(),
  port, hostname: values.hostname,
});
const localBase = `http://localhost:${host.port}`;
const links = config.members.map((member) => ({
  role: member.role, name: member.name,
  url: `${localBase}/#token=${encodeURIComponent(member.token)}&room=website`,
}));
const addresses = Object.values(networkInterfaces()).flat().filter((address) => address && address.family === "IPv4" && !address.internal).map((address) => `http://${address!.address}:${host.port}`);
const accessPath = join(stateDir, "access.json");
await Bun.write(accessPath, JSON.stringify({ projectRoot, stateDir, port: host.port, links, lan: addresses }, null, 2));
await chmod(accessPath, 0o600);
console.log(`\nWebcraft collaboration experiment is ready.\nProject: ${projectRoot}\nShared page: ${join(config.rooms[0]!.root, config.rooms[0]!.page)}\n`);
for (const link of links) console.log(`${link.role}: ${link.url}`);
if (addresses.length) console.log(`\nLAN: replace ${localBase} in a member link with ${addresses.join(" or ")}`);
console.log(`\nOpen the administrator link and enable collaboration. Open the other links in separate tabs or devices.\nAccess links: ${accessPath}\nStop: Ctrl+C\n`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await host.close();
  process.exit(0);
}
process.on("SIGINT", () => { void stop(); });
process.on("SIGTERM", () => { void stop(); });
