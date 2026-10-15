import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollaborationTunnelStartupError, startCollaborationTunnel, type CollaborationTunnelHandle } from "../internet-tunnel.js";
import { createInternetAccessController } from "../internet-access.js";

const directories: string[] = [];
const handles: CollaborationTunnelHandle[] = [];
const children: ReturnType<typeof Bun.spawn>[] = [];
const tunnelId = "11111111-2222-3333-4444-555555555555";

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const child of children.splice(0)) { if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error("Condition did not become true.");
    await Bun.sleep(20);
  }
}

async function fake(behavior: string): Promise<{ binaryPath: string; directory: string; reportPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "pneuma-tunnel-test-"));
  directories.push(directory);
  const binaryPath = join(directory, "cloudflared");
  const reportPath = join(directory, "report.json");
  await writeFile(binaryPath, `#!${process.execPath}\n
import {readFile,writeFile,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
const args=Bun.argv.slice(2);
const configPath=args[args.indexOf('--config')+1];
const pidPath=args[args.indexOf('--pidfile')+1];
const config=await readFile(configPath,'utf8');
const credentialsPath=config.match(/^credentials-file: (.+)$/m);
const reportPath=${JSON.stringify(reportPath)};
await writeFile(reportPath,JSON.stringify({args,config,pid:process.pid,directory:dirname(configPath),configMode:(await stat(configPath)).mode & 511,directoryMode:(await stat(dirname(configPath))).mode & 511,credentialMode:credentialsPath ? (await stat(JSON.parse(credentialsPath[1]))).mode & 511 : null,environment:process.env}));
${behavior}
`, { mode: 0o700 });
  await chmod(binaryPath, 0o700);
  return { binaryPath, directory, reportPath };
}

const ready = `console.error('https://unit-test.trycloudflare.com'); await writeFile(pidPath,String(process.pid)); setInterval(()=>{},1000);`;
const options = { targetUrl: "http://127.0.0.1:18999", startupTimeoutMs: 3000, stopTimeoutMs: 100 };

describe("owned collaboration tunnel processes", () => {
  test("returns only after the actual edge-connection PID marker, then awaits termination and cleanup", async () => {
    const fixture = await fake(`console.error('https://unit-test.trycloudflare.com'); setTimeout(async()=>{await writeFile(pidPath,String(process.pid));},150); setInterval(()=>{},1000);`);
    let settled = false;
    const starting = startCollaborationTunnel({ ...options, binaryPath: fixture.binaryPath }).then((handle) => { handles.push(handle); settled = true; return handle; });
    await until(async () => Bun.file(fixture.reportPath).exists());
    const report = JSON.parse(await readFile(fixture.reportPath, "utf8"));
    await Bun.sleep(40);
    expect(settled).toBe(false);
    const handle = await starting;
    expect(handle.origin).toBe("https://unit-test.trycloudflare.com");
    expect(handle.pid).toBe(report.pid);
    expect(report.configMode).toBe(0o600);
    expect(report.directoryMode).toBe(0o700);
    expect(report.args).toContain("--no-autoupdate");
    expect(report.args[report.args.indexOf("--protocol") + 1]).toBe("http2");
    expect(report.args[report.args.indexOf("--metrics") + 1]).toBe("127.0.0.1:0");
    expect(report.config).toBe("{}\n");
    await Promise.all([handle.stop(), handle.stop()]);
    expect(alive(handle.pid)).toBe(false);
    expect(await Bun.file(join(report.directory, "runner.json")).exists()).toBe(false);
  });

  test("URL-only provider times out and is cleaned up", async () => {
    const fixture = await fake(`console.error('https://not-connected.trycloudflare.com'); await writeFile(reportPath+'.scenario','url-emitted'); setInterval(()=>{},1000);`);
    // Budget both Bun process boots under full-suite load, then verify the
    // intended provider state before testing the missing-connection deadline.
    const outcome = startCollaborationTunnel({ ...options, binaryPath: fixture.binaryPath, startupTimeoutMs: 2000 })
      .then((handle) => { handles.push(handle); return handle; }, (error: unknown) => error);
    await until(() => Bun.file(`${fixture.reportPath}.scenario`).exists());
    expect(await readFile(`${fixture.reportPath}.scenario`, "utf8")).toBe("url-emitted");
    const report = JSON.parse(await readFile(fixture.reportPath, "utf8"));
    expect(alive(report.pid)).toBe(true);
    expect(await Bun.file(join(report.directory, "connected.pid")).exists()).toBe(false);
    expect(String(await outcome)).toContain("timed out");
    expect(alive(report.pid)).toBe(false);
    expect(await Bun.file(join(report.directory, "config.yml")).exists()).toBe(false);
  });

  test("rejects an early exit without returning provider logs or credentials", async () => {
    const fixture = await fake(`console.error('SECRET_PROVIDER_CREDENTIAL https://unit-test.trycloudflare.com'); process.exit(23);`);
    let error: unknown;
    try { await startCollaborationTunnel({ ...options, binaryPath: fixture.binaryPath }); } catch (caught) { error = caught; }
    expect(String(error)).toContain("code 23");
    expect(String(error)).not.toContain("SECRET_PROVIDER_CREDENTIAL");
  });

  test("abort during startup terminates the provider before rejecting", async () => {
    const fixture = await fake(`setInterval(()=>{},1000);`);
    const controller = new AbortController();
    const starting = startCollaborationTunnel({ ...options, binaryPath: fixture.binaryPath, signal: controller.signal });
    const rejection = starting.catch((error: unknown) => error);
    await until(async () => Bun.file(fixture.reportPath).exists());
    controller.abort(new Error("cancel this tunnel"));
    expect(String(await rejection)).toContain("cancel this tunnel");
    const report = JSON.parse(await readFile(fixture.reportPath, "utf8"));
    expect(alive(report.pid)).toBe(false);
    expect(await Bun.file(join(report.directory, "config.yml")).exists()).toBe(false);
  });

  test("escalates only its own SIGTERM-ignoring child and does not notify intentional stop", async () => {
    const fixture = await fake(`process.on('SIGTERM',()=>{}); ${ready}`);
    const exits: Error[] = [];
    const handle = await startCollaborationTunnel({ ...options, binaryPath: fixture.binaryPath, onExit: (error) => exits.push(error) });
    handles.push(handle);
    await handle.stop();
    expect(alive(handle.pid)).toBe(false);
    expect(exits).toHaveLength(0);
  });

  test("abort after readiness awaits child cleanup without an unexpected-exit notification", async () => {
    const fixture = await fake(ready);
    const controller = new AbortController();
    const exits: Error[] = [];
    const handle = await startCollaborationTunnel({ ...options, binaryPath: fixture.binaryPath, signal: controller.signal, onExit: (error) => exits.push(error) });
    handles.push(handle);
    controller.abort();
    await handle.stop();
    expect(alive(handle.pid)).toBe(false);
    expect(exits).toHaveLength(0);
  });

  test("reports unexpected post-ready exit exactly once after cleanup", async () => {
    const fixture = await fake(`console.error('https://unit-test.trycloudflare.com'); await writeFile(pidPath,String(process.pid)); setTimeout(()=>process.exit(19),150); setInterval(()=>{},1000);`);
    const exits: Error[] = [];
    const handle = await startCollaborationTunnel({ ...options, binaryPath: fixture.binaryPath, onExit: (error) => exits.push(error) });
    handles.push(handle);
    await until(() => exits.length === 1);
    expect(exits[0]!.message).toContain("code 19");
    const report = JSON.parse(await readFile(fixture.reportPath, "utf8"));
    expect(await Bun.file(join(report.directory, "config.yml")).exists()).toBe(false);
    await handle.stop();
    expect(exits).toHaveLength(1);
  });

  test("named tunnel uses a private scoped config and copied credentials without ambient settings", async () => {
    const fixture = await fake(`await writeFile(pidPath,String(process.pid)); setInterval(()=>{},1000);`);
    const credentialsFile = join(fixture.directory, "own-credentials.json");
    const credentials = JSON.stringify({ AccountTag: "account-tag", TunnelSecret: "private-tunnel-secret", TunnelID: tunnelId });
    await writeFile(credentialsFile, credentials);
    const previous = process.env.TUNNEL_TOKEN;
    process.env.TUNNEL_TOKEN = "ambient-tunnel-token";
    let handle: CollaborationTunnelHandle;
    try {
      handle = await startCollaborationTunnel({ ...options, binaryPath: fixture.binaryPath,
        provider: { kind: "named", tunnelId, credentialsFile, publicOrigin: "https://collaboration.example.com" } });
      handles.push(handle);
    } finally { if (previous === undefined) delete process.env.TUNNEL_TOKEN; else process.env.TUNNEL_TOKEN = previous; }
    const report = JSON.parse(await readFile(fixture.reportPath, "utf8"));
    expect(handle!.origin).toBe("https://collaboration.example.com");
    expect(report.args.slice(-2)).toEqual(["run", tunnelId]);
    expect(JSON.stringify(report.args)).not.toContain("private-tunnel-secret");
    expect(JSON.stringify(report.args)).not.toContain(credentialsFile);
    expect(report.config).toContain('service: "http://127.0.0.1:18999"');
    expect(report.config).toContain("http_status:404");
    expect(report.config).not.toContain("private-tunnel-secret");
    expect(report.config).not.toContain(credentialsFile);
    expect(report.credentialMode).toBe(0o600);
    expect(report.environment.TUNNEL_TOKEN).toBeUndefined();
    expect(report.environment.HOME).toBe(process.env.HOME);
    await handle!.stop();
    expect(await readFile(credentialsFile, "utf8")).toBe(credentials);
  });

  test("explicit named credentials failure never falls back to Quick Tunnel", async () => {
    const fixture = await fake(ready);
    await expect(startCollaborationTunnel({ ...options, binaryPath: fixture.binaryPath,
      provider: { kind: "named", tunnelId, credentialsFile: join(fixture.directory, "absent.json"), publicOrigin: "https://collaboration.example.com" } })).rejects.toThrow("credentials");
    expect(await Bun.file(fixture.reportPath).exists()).toBe(false);
  });

  test("wrong PID marker cannot report connection readiness", async () => {
    const fixture = await fake(`console.error('https://unit-test.trycloudflare.com'); await writeFile(pidPath,'99999999'); await writeFile(reportPath+'.scenario','wrong-pid-written'); setInterval(()=>{},1000);`);
    const outcome = startCollaborationTunnel({ ...options, binaryPath: fixture.binaryPath, startupTimeoutMs: 2000 })
      .then((handle) => { handles.push(handle); return handle; }, (error: unknown) => error);
    await until(() => Bun.file(`${fixture.reportPath}.scenario`).exists());
    expect(await readFile(`${fixture.reportPath}.scenario`, "utf8")).toBe("wrong-pid-written");
    const report = JSON.parse(await readFile(fixture.reportPath, "utf8"));
    expect(alive(report.pid)).toBe(true);
    expect(await readFile(join(report.directory, "connected.pid"), "utf8")).toBe("99999999");
    expect(String(report.pid)).not.toBe("99999999");
    expect(String(await outcome)).toContain("timed out");
    expect(alive(report.pid)).toBe(false);
  });

  test("rejects unsafe target origins and invalid binary paths before spawning", async () => {
    for (const targetUrl of ["http://192.168.1.3:1234", "https://127.0.0.1:1234", "http://127.0.0.1", "http://127.0.0.1:1234/api", "http://user:secret@127.0.0.1:1234", "http://127.0.0.1:1234/?a=1"]) {
      await expect(startCollaborationTunnel({ targetUrl })).rejects.toThrow("loopback HTTP origin");
    }
    await expect(startCollaborationTunnel({ ...options, binaryPath: "/does-not-exist/cloudflared" })).rejects.toThrow("executable");
  });

  test("authority SIGKILL closes the watchdog pipe and releases a stubborn provider", async () => {
    const fixture = await fake(`process.on('SIGTERM',()=>{}); ${ready}`);
    const ownerPath = join(fixture.directory, "owner.ts");
    await writeFile(ownerPath, `import {startCollaborationTunnel} from ${JSON.stringify(join(import.meta.dir, "../internet-tunnel.ts"))}; await startCollaborationTunnel(${JSON.stringify({ ...options, binaryPath: fixture.binaryPath })}); console.log('ready'); setInterval(()=>{},1000);`);
    const owner = Bun.spawn([process.execPath, ownerPath], { stdout: "pipe", stderr: "pipe" });
    children.push(owner);
    const reader = owner.stdout.getReader();
    const result = await reader.read();
    expect(new TextDecoder().decode(result.value)).toContain("ready");
    const report = JSON.parse(await readFile(fixture.reportPath, "utf8"));
    owner.kill("SIGKILL");
    await owner.exited;
    await until(() => !alive(report.pid));
    await until(async () => !await Bun.file(join(report.directory, "config.yml")).exists());
  });

  test("a failed supervisor makes termination uncertainty observable", async () => {
    const fixture = await fake(ready);
    const packageRoot = join(fixture.directory, "package");
    await mkdir(join(packageRoot, "server/collaboration"), { recursive: true });
    await writeFile(join(packageRoot, "server/collaboration/internet-tunnel-runner.ts"), "process.exit(7);\n");
    await expect(startCollaborationTunnel({ ...options, binaryPath: fixture.binaryPath, packageRoot })).rejects.toThrow("termination could not be confirmed");
    expect(await Bun.file(fixture.reportPath).exists()).toBe(false);
  });

  test("stop has a deadline when a supervisor becomes unresponsive, and never claims release", async () => {
    const fixture = await fake(ready);
    const packageRoot = join(fixture.directory, "package");
    await mkdir(join(packageRoot, "server/collaboration"), { recursive: true });
    await writeFile(join(packageRoot, "server/collaboration/internet-tunnel-runner.ts"), `console.log(JSON.stringify({event:'ready',origin:'https://unit-test.trycloudflare.com',pid:process.pid}));setInterval(()=>{},1000);`);
    const handle = await startCollaborationTunnel({ ...options, binaryPath: fixture.binaryPath, packageRoot });
    try {
      await expect(handle.stop()).rejects.toThrow("shutdown timed out");
      expect(alive(handle.pid)).toBe(true);
    } finally {
      // This is the test's synthetic supervisor itself, not a provider child.
      process.kill(handle.pid, "SIGKILL");
      await until(() => !alive(handle.pid));
    }
  });

  test("a disable retry can confirm delayed cleanup after the first stop times out", async () => {
    const fixture = await fake(ready);
    const packageRoot = join(fixture.directory, "package");
    await mkdir(join(packageRoot, "server/collaboration"), { recursive: true });
    await writeFile(join(packageRoot, "server/collaboration/internet-tunnel-runner.ts"), `console.log(JSON.stringify({event:'ready',origin:'https://unit-test.trycloudflare.com',pid:process.pid}));setTimeout(()=>{console.log(JSON.stringify({event:'closed',reason:'stopped',terminated:true}));process.exit(0);},1500);`);
    const handle = await startCollaborationTunnel({ ...options, stopTimeoutMs: 50, binaryPath: fixture.binaryPath, packageRoot });
    handles.push(handle);
    await expect(handle.stop()).rejects.toThrow("shutdown timed out");
    await until(() => !alive(handle.pid));
    await handle.stop();
    expect(alive(handle.pid)).toBe(false);
  });

  test("failed startup retains actual supervisor cleanup until a disable retry confirms release", async () => {
    const fixture = await fake(ready);
    const packageRoot = join(fixture.directory, "package");
    const supervisorPidPath = join(fixture.directory, "supervisor.pid");
    const confirmPath = join(fixture.directory, "confirm-cleanup");
    await mkdir(join(packageRoot, "server/collaboration"), { recursive: true });
    await writeFile(join(packageRoot, "server/collaboration/internet-tunnel-runner.ts"), `await Bun.write(${JSON.stringify(supervisorPidPath)},String(process.pid));setInterval(async()=>{if(await Bun.file(${JSON.stringify(confirmPath)}).exists()){console.log(JSON.stringify({event:'closed',reason:'stopped',terminated:true}));process.exit(0);}},25);`);
    let starts = 0;
    let startupError: unknown;
    const controller = createInternetAccessController({
      host: { startPublicIngress() { return options.targetUrl; }, async stopPublicIngress() {}, setPublicOrigin() {}, publicConnections() { return 0; } },
      async startTunnel(input) {
        starts++;
        try { return await startCollaborationTunnel({ ...input, binaryPath: fixture.binaryPath, packageRoot, startupTimeoutMs: 50, stopTimeoutMs: 50 }); }
        catch (error) { startupError = error; throw error; }
      },
    });
    let supervisorPid: number | undefined;
    try {
      await expect(controller.change({ enabled: true })).rejects.toThrow("termination could not be confirmed");
      supervisorPid = Number(await readFile(supervisorPidPath, "utf8"));
      expect(startupError instanceof CollaborationTunnelStartupError).toBe(true);
      expect(controller.read().status).toBe("failed");
      expect(alive(supervisorPid)).toBe(true);
      await expect(controller.change({ enabled: false })).rejects.toThrow("termination could not be confirmed");
      expect(controller.read().status).toBe("failed");
      await expect(controller.change({ enabled: true })).rejects.toThrow("cleanup is unconfirmed");
      expect(starts).toBe(1);
      await writeFile(confirmPath, "confirmed");
      await until(() => !alive(supervisorPid!));
      expect((await controller.change({ enabled: false })).status).toBe("off");
    } finally {
      await writeFile(confirmPath, "confirmed");
      if (supervisorPid !== undefined) await until(() => !alive(supervisorPid!));
      await controller.close();
    }
  }, 10000);
});
