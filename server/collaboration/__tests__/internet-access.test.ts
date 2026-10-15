import { afterEach, expect, test } from "bun:test";
import { createInternetAccessController, type CollaborationTunnelHandle, type CollaborationTunnelStarter } from "../internet-access.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => {}); });
const settle = () => Bun.sleep(1);
function setup(start?: CollaborationTunnelStarter) {
  let at = 0, participants = 0, stops = 0, ingressOpen = false, lease = 60_000;
  let before = () => false;
  let exit = (_error: Error) => {};
  const host = {
    startPublicIngress(hooks: { beforeActivity(): boolean }) { ingressOpen = true; before = hooks.beforeActivity; return "http://127.0.0.1:12345"; },
    async stopPublicIngress() { ingressOpen = false; },
    setPublicOrigin(_origin: string) {},
    publicConnections() { return at <= lease ? participants : 0; },
    publicLeaseDeadline() { return lease; },
  };
  const controller = createInternetAccessController({ host, now: () => at, pollMs: 60_000,
    startTunnel: start ?? (async (options) => { exit = options.onExit; return { origin: "https://public.test", pid: 123, async stop() { stops++; } }; }) });
  cleanups.push(() => controller.close());
  return { controller, get stops() { return stops; }, get ingressOpen() { return ingressOpen; },
    activity: () => before(), advance(ms: number) { at += ms; }, setParticipants(count: number, expiry = at + 60_000) { participants = count; lease = expiry; }, providerExit: (error: Error) => exit(error) };
}

test("zero authenticated public participants expire despite HTTP readiness and owner/LAN activity", async () => {
  const fixture = setup();
  expect((await fixture.controller.change({ enabled: true })).status).toBe("active");
  expect(fixture.controller.read().idleDeadline).toBe(600_000);
  fixture.advance(599_999); expect(fixture.activity()).toBe(true);
  fixture.advance(1); expect(fixture.activity()).toBe(false);
  await settle();
  expect(fixture.controller.read().status).toBe("idleexpired"); expect(fixture.stops).toBe(1); expect(fixture.ingressOpen).toBe(false);
  fixture.advance(1_000_000); fixture.controller.check(); await settle(); expect(fixture.stops).toBe(1);
});
test("public leases hold access; last disconnect starts a fresh idle window; sleep cannot revive expired leases", async () => {
  const fixture = setup(); await fixture.controller.change({ enabled: true });
  fixture.setParticipants(1, 2_000_000); fixture.controller.check();
  fixture.advance(800_000); expect(fixture.activity()).toBe(true); expect(fixture.controller.read().idleDeadline).toBe(null);
  fixture.setParticipants(0); fixture.controller.check(); expect(fixture.controller.read().idleDeadline).toBe(1_400_000);
  fixture.setParticipants(1, 900_000); fixture.controller.check();
  fixture.advance(1_000_000); expect(fixture.activity()).toBe(false); await settle(); expect(fixture.stops).toBe(1);
});
test("disable during a late uncancellable provider start stops its returned child once", async () => {
  let resolve!: (value: CollaborationTunnelHandle) => void, stopped = 0;
  const fixture = setup(async () => new Promise((done) => { resolve = done; }));
  const enabling = fixture.controller.change({ enabled: true }); await settle();
  const disabling = fixture.controller.change({ enabled: false }); expect(fixture.activity()).toBe(false);
  resolve({ origin: "https://late.test", pid: 1, async stop() { stopped++; } });
  await Promise.all([enabling, disabling]); expect(stopped).toBe(1); expect(fixture.controller.read().status).toBe("off");
});
test("provider failure closes ingress and is observable, while explicit shutdown confirms child exit", async () => {
  const fixture = setup(); await fixture.controller.change({ enabled: true });
  fixture.providerExit(new Error("Tunnel exited")); await settle();
  expect(fixture.controller.read().status).toBe("failed"); expect(fixture.controller.read().error).toContain("Tunnel exited"); expect(fixture.stops).toBe(1);
  await fixture.controller.change({ enabled: true }); await fixture.controller.close(); expect(fixture.stops).toBe(2);
});
test("uncertain cleanup remains failed and forbids starting a replacement provider", async () => {
  const fixture = setup(async () => ({ origin: "https://public.test", pid: 1, async stop() { throw new Error("Exit unconfirmed"); } }));
  await fixture.controller.change({ enabled: true });
  await expect(fixture.controller.change({ enabled: false })).rejects.toThrow("Exit unconfirmed");
  expect(fixture.controller.read().status).toBe("failed");
  await expect(fixture.controller.change({ enabled: true })).rejects.toThrow("cleanup is unconfirmed");
});
test("startup cancellation and provider setup errors leave public ingress unavailable", async () => {
  const fixture = setup(async ({ signal }) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }); }));
  const enabling = fixture.controller.change({ enabled: true }); await settle();
  await Promise.all([enabling, fixture.controller.change({ enabled: false })]); expect(fixture.controller.read().status).toBe("off"); expect(fixture.ingressOpen).toBe(false);
  const failed = setup(async () => { throw new Error("Missing binary"); });
  await expect(failed.controller.change({ enabled: true })).rejects.toThrow("Missing binary"); expect(failed.controller.read().status).toBe("failed"); expect(failed.ingressOpen).toBe(false);
});


test("the zero-client idle window starts when provider readiness completes", async () => {
  let resolve!: (handle: CollaborationTunnelHandle) => void;
  const fixture = setup(async () => new Promise((done) => { resolve = done; }));
  const enabling = fixture.controller.change({ enabled: true }); await settle();
  fixture.advance(500_000); expect(fixture.controller.read().idleDeadline).toBe(null);
  resolve({ origin: "https://ready.test", pid: 1, async stop() {} }); await enabling;
  expect(fixture.controller.read().idleDeadline).toBe(1_100_000);
});


test("an explicitly chosen named provider persists even when setup fails, without changing to quick", async () => {
  const chosen: unknown[] = [];
  const controller = createInternetAccessController({
    host: { startPublicIngress() { return "http://127.0.0.1:1234"; }, async stopPublicIngress() {}, setPublicOrigin() {}, publicConnections() { return 0; } },
    async onProviderChosen(provider) { chosen.push(provider); },
    async startTunnel() { throw new Error("Named credentials are unavailable"); },
  });
  cleanups.push(() => controller.close());
  const provider = { kind: "named" as const, tunnelId: "b28e6772-20c8-4463-8b7f-2adf40908e24", credentialsFile: "/private/tunnel.json", publicOrigin: "https://project.example.test" };
  await expect(controller.change({ enabled: true, provider })).rejects.toThrow("Named credentials");
  expect(chosen).toEqual([provider]); expect(controller.read().provider).toEqual(provider); expect(controller.read().status).toBe("failed");
});

test("concurrent enable cannot replace cleanup retained by a failing queued disable", async () => {
  let starts = 0, stopCalls = 0, confirmed = false;
  let rejectStop: ((error: Error) => void) | undefined;
  const controller = createInternetAccessController({
    host: { startPublicIngress() { return "http://127.0.0.1:1234"; }, async stopPublicIngress() {}, setPublicOrigin() {}, publicConnections() { return 0; } },
    async startTunnel() {
      const instance = ++starts;
      return { origin: "https://public.test", pid: instance, async stop() {
        if (instance !== 1 || confirmed) return;
        stopCalls++;
        if (stopCalls === 1) await new Promise<never>((_, reject) => { rejectStop = reject; });
        else throw new Error("Old provider release unconfirmed");
      } };
    },
  });
  cleanups.push(async () => { confirmed = true; rejectStop?.(new Error("Test cleanup")); await controller.close(); });
  await controller.change({ enabled: true });
  const disabling = controller.change({ enabled: false }).catch((error: unknown) => error);
  while (!rejectStop) await Bun.sleep(1);
  expect(controller.read().status).toBe("stopping");
  const enabling = controller.change({ enabled: true }).catch((error: unknown) => error);
  rejectStop(new Error("Old provider release unconfirmed"));
  expect(String(await disabling)).toContain("Old provider release unconfirmed");
  expect(String(await enabling)).toContain("cleanup is unconfirmed");
  expect(controller.read().status).toBe("failed");
  expect(starts).toBe(1);
  await expect(controller.change({ enabled: false })).rejects.toThrow("Old provider release unconfirmed");
  expect(controller.read().status).toBe("failed");
  confirmed = true;
  expect((await controller.change({ enabled: false })).status).toBe("off");
  expect((await controller.change({ enabled: true })).status).toBe("active");
  expect(starts).toBe(2);
});
