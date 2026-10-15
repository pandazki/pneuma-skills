import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { openSync, closeSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import type { LocalCollaborationBinding } from "../../core/types/collaboration-workspace.js";
import type { CollaborationMember, CollaborationProjectState } from "../../core/types/collaboration.js";
import { createInternetAccessController } from "./internet-access.js";
import { parseCollaborationTunnelProvider, type CollaborationTunnelProvider, type CollaborationInternetAccessChange } from "../../core/types/collaboration-access.js";
import { acquireCollaborationLease, collaborationStateDir, writePrivateJson } from "./local-state.js";

interface LanServiceConfig {
  project: { id: string; name: string };
  owner: CollaborationMember & { token: string };
  frontendDir: string;
  publicHostname: string;
  port: number;
  internetProvider?: CollaborationTunnelProvider;
}
interface LanServiceBuild { packageRoot: string; coreVersion: string; viewerCatalogHash: string }
interface LanServiceRecord { instanceId?: string; build?: LanServiceBuild; pid: number; projectId: string; origin: string; port: number; controlOrigin: string; controlKey: string }

export function collaborationLanHostname(): string {
  const interfaces = Object.entries(networkInterfaces());
  const physical = interfaces.filter(([name]) => /^(en\d|eth\d|wlan\d|Wi-Fi|Ethernet)/i.test(name));
  const addresses = [...physical, ...interfaces.filter(([name]) => !/^(utun|tun|tap|lo|vmnet|vbox|bridge|docker)/i.test(name))]
    .flatMap(([, entries]) => entries ?? []).filter((entry) => entry.family === "IPv4" && !entry.internal);
  return addresses.find((entry) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address))?.address ?? "127.0.0.1";
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function serviceBuild(packageRoot: string, frontendDir: string): Promise<LanServiceBuild> {
  const metadata = await Bun.file(join(packageRoot, "package.json")).json() as { version: string };
  const catalog = Bun.file(join(frontendDir, "viewer-manifest.json"));
  return { packageRoot: resolve(packageRoot), coreVersion: metadata.version,
    viewerCatalogHash: await catalog.exists() ? new Bun.CryptoHasher("sha256").update(await catalog.bytes()).digest("hex") : "unbuilt" };
}
const sameBuild = (a: LanServiceBuild | undefined, b: LanServiceBuild) => !!a
  && a.packageRoot === b.packageRoot && a.coreVersion === b.coreVersion && a.viewerCatalogHash === b.viewerCatalogHash;

async function retireStaleService(record: LanServiceRecord, projectId: string, memberToken: string, expected: LanServiceBuild): Promise<void> {
  const legacy = "The running LAN authority predates safe package upgrades. End its original collaboration runtime using the application or terminal that started it, or restart this computer, then reopen this Project. Its shared history and invitations will be retained.";
  if (!record.instanceId || !record.build || !/^http:\/\/127\.0\.0\.1:\d+$/.test(record.controlOrigin) || !record.controlKey) throw new Error(legacy);
  const response = await fetch(`${record.controlOrigin}/lifecycle`, { method: "POST",
    headers: { Authorization: `Bearer ${record.controlKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(3000),
    body: JSON.stringify({ projectId, memberToken, instanceId: record.instanceId, expectedBuild: expected }) });
  const result = await response.json() as { error?: string; instanceId?: string; build?: LanServiceBuild; retired?: boolean };
  if (!response.ok) throw new Error(result.error ?? legacy);
  if (result.instanceId !== record.instanceId || !sameBuild(result.build, record.build) || !result.retired) throw new Error("The existing LAN authority could not confirm safe retirement. No replacement was started.");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (!processExists(record.pid)) return; await Bun.sleep(25); }
  throw new Error("The old LAN authority has not confirmed its exit. No replacement was started; retry after it closes.");
}

/** One detached LAN authority per Project, independent of any private Agent Session. */
export async function ensureLanCollaborationService(options: {
  projectRoot: string;
  packageRoot: string;
  project: { id: string; name: string };
  owner: CollaborationMember & { token: string };
  frontendDir: string;
  publicHostname?: string;
  /** Current authorized principal may differ from the immutable bootstrap administrator. */
  connectionToken?: string;
}): Promise<string> {
  const directory = collaborationStateDir(options.projectRoot);
  const recordPath = join(directory, "service.json");
  const configPath = join(directory, "service-config.json");
  const record = await readOptionalJson<LanServiceRecord>(recordPath);
  if (record && record.projectId !== options.project.id) throw new Error("LAN authority state belongs to another project.");
  const expectedBuild = await serviceBuild(options.packageRoot, options.frontendDir);
  if (record && processExists(record.pid)) {
    const response = await fetch(`${record.origin}/projects/${encodeURIComponent(options.project.id)}/api/state`, {
      headers: { Authorization: `Bearer ${options.connectionToken ?? options.owner.token}` }, signal: AbortSignal.timeout(3000),
    });
    const state = await response.json() as CollaborationProjectState;
    if (!response.ok || state.project?.id !== options.project.id) throw new Error("The existing LAN authority did not validate this Project's connection.");
    if (sameBuild(record.build, expectedBuild)) return record.origin;
    await retireStaleService(record, options.project.id, options.connectionToken ?? options.owner.token, expectedBuild);
  }
  const previous = await readOptionalJson<LanServiceConfig>(configPath);
  if (previous && previous.project.id !== options.project.id) throw new Error("LAN authority configuration belongs to another project.");
  const config: LanServiceConfig = previous ? { ...previous, frontendDir: options.frontendDir } : {
    project: options.project, owner: options.owner, frontendDir: options.frontendDir,
    publicHostname: options.publicHostname ?? collaborationLanHostname(), port: 0,
  };
  await writePrivateJson(configPath, config);
  const log = openSync(join(directory, "service.log"), "a", 0o600);
  let child;
  try {
    child = Bun.spawn([process.execPath, join(options.packageRoot, "server/collaboration/lan-service.ts"), "--project", options.projectRoot], {
      cwd: options.packageRoot, stdin: "ignore", stdout: log, stderr: log, detached: true,
    });
    child.unref();
  } finally { closeSync(log); }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const current = await readOptionalJson<LanServiceRecord>(recordPath);
    if (current?.pid === child.pid && current.projectId === options.project.id) return current.origin;
    if (child.exitCode !== null) throw new Error("The LAN collaboration service could not start. See its local service log.");
    await Bun.sleep(50);
  }
  // No second service or alternate authority is started after an uncertain startup.
  throw new Error("The LAN collaboration service has not reported readiness. Retry to inspect its state.");
}

/** Restart only a demonstrably owned authority; attached remote Projects never create one. */
export async function ensureOwnedLanCollaborationService(options: {
  projectRoot: string; packageRoot: string; binding: LocalCollaborationBinding; frontendDir: string;
}): Promise<boolean> {
  const { binding } = options;
  if (binding.authority.kind !== "lan") return false;
  const directory = collaborationStateDir(options.projectRoot);
  const config = await readOptionalJson<LanServiceConfig>(join(directory, "service-config.json"));
  if (!config || config.project.id !== binding.projectId
    || `http://${config.publicHostname}:${config.port}` !== binding.authority.origin) return false;
  if (binding.authority.publicKey) {
    const identity = await readOptionalJson<{ publicKey: string }>(join(directory, "authority", "authority-identity.json"));
    if (!identity || identity.publicKey !== binding.authority.publicKey) throw new Error("This local authority does not match the Project's pinned identity.");
  }
  await ensureLanCollaborationService({ projectRoot: options.projectRoot, packageRoot: options.packageRoot,
    project: config.project, owner: config.owner, frontendDir: options.frontendDir, publicHostname: config.publicHostname, connectionToken: binding.memberToken });
  return true;
}

async function runService(projectRoot: string): Promise<void> {
  const directory = collaborationStateDir(projectRoot);
  const release = acquireCollaborationLease(join(directory, "service-lease.sqlite"), "This Project already has a running LAN authority.");
  const configPath = join(directory, "service-config.json");
  const recordPath = join(directory, "service.json");
  const config = await readOptionalJson<LanServiceConfig>(configPath);
  if (!config) throw new Error("Missing private Project authority configuration.");
  const build = await serviceBuild(resolve(import.meta.dir, "../.."), config.frontendDir);
  const instanceId = crypto.randomUUID();
  const { startCollaborationHost } = await import("./host.js");
  const host = await startCollaborationHost({
    project: config.project, stateDir: join(directory, "authority"), rooms: [], members: [config.owner],
    frontendDir: config.frontendDir, frameScript: "", hostname: "0.0.0.0", port: config.port,
    publicHostname: config.publicHostname,
  });
  const origin = `http://${config.publicHostname}:${host.port}`;
  const { startCollaborationTunnel } = await import("./internet-tunnel.js");
  const internet = createInternetAccessController({ host, provider: config.internetProvider,
    async onProviderChosen(provider) {
      config.internetProvider = provider;
      await writePrivateJson(configPath, { ...config, port: host.port });
    },
    startTunnel: (options) => startCollaborationTunnel(options) });
  const controlKey = crypto.randomUUID() + crypto.randomUUID();
  const controlServer = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 16 * 1024,
    async fetch(request) {
      const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };
      const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
      const path = new URL(request.url).pathname;
      if (!["/internet-access", "/lifecycle"].includes(path) || request.method !== "POST") return json({ error: "Not found" }, 404);
      if (request.headers.get("authorization") !== `Bearer ${controlKey}`) return json({ error: "Private service control credential required" }, 401);
      try {
        const body = await request.json() as { projectId?: string; memberToken?: string; change?: CollaborationInternetAccessChange; instanceId?: string; expectedBuild?: LanServiceBuild };
        if (path === "/lifecycle") {
          if (body.projectId !== config.project.id || typeof body.memberToken !== "string" || !host.canControlLifecycle(body.memberToken)) return json({ error: "Local Project membership required" }, 403);
          if (body.instanceId !== instanceId || !body.expectedBuild) return json({ error: "Authority lifecycle identity changed; retry opening the Project" }, 409);
          if (sameBuild(build, body.expectedBuild)) return json({ instanceId, build, retired: false });
          if (!host.retireIfIdle()) return json({ error: "A package update is waiting for active collaboration participants and publishers. Close the Project's sharing Sessions and participant windows, then reopen it to update safely." }, 409);
          setTimeout(() => { void stop(); }, 25);
          return json({ instanceId, build, retired: true });
        }
        if (body.projectId !== config.project.id || typeof body.memberToken !== "string" || !host.canManageInternetAccess(body.memberToken))
          return json({ error: "Local Project administrator required" }, 403);
        if (body.change) {
          if (body.change.provider) parseCollaborationTunnelProvider(body.change.provider);
          return json(await internet.change(body.change));
        }
        return json(internet.read());
      } catch (error) { return json({ error: error instanceof Error ? error.message : "Public access control failed" }, 400); }
    },
  });
  await writePrivateJson(configPath, { ...config, port: host.port });
  await writePrivateJson(recordPath, { instanceId, build, pid: process.pid, projectId: config.project.id, origin, port: host.port,
    controlOrigin: `http://127.0.0.1:${controlServer.port}`, controlKey } satisfies LanServiceRecord);
  let checkingBuild = false;
  const buildTimer = setInterval(() => {
    if (checkingBuild || stopping) return;
    checkingBuild = true;
    void serviceBuild(build.packageRoot, config.frontendDir).then(async (current) => {
      if (!sameBuild(build, current) && host.retireIfIdle()) await stop();
    }).catch((error) => { console.warn("Could not inspect the installed collaboration build", error); })
      .finally(() => { checkingBuild = false; });
  }, 5000);
  buildTimer.unref();
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(buildTimer);
    try {
      await controlServer.stop(true);
      await internet.close();
      await host.close();
      const record = await readOptionalJson<LanServiceRecord>(recordPath);
      if (record?.pid === process.pid) await unlink(recordPath);
      release();
      process.exit(0);
    } catch (error) {
      console.error("Project public access cleanup could not be confirmed", error);
      // Do not report a clean stop; the provider watchdog owns crash cleanup.
      process.exit(1);
    }
  }
  process.on("SIGTERM", () => { void stop(); });
  process.on("SIGINT", () => { void stop(); });
  console.log(`Project collaboration authority ready at ${origin}/projects/${config.project.id}`);
}

if (import.meta.main) {
  const index = Bun.argv.indexOf("--project");
  if (index < 0 || !Bun.argv[index + 1]) throw new Error("--project is required.");
  await runService(resolve(Bun.argv[index + 1]!));
}
