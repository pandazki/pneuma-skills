/**
 * T11 [5] — the `bun run dev bansho` boot smoke: the one test that proves
 * the mode actually COMES UP through the real CLI entry, not merely that
 * its pure layers compose. Everything content-level (parse → canonical →
 * playable) is covered in `e2e.test.ts`; this file only owns the boot.
 *
 * What it exercises: `bin/pneuma.ts bansho --dev` end to end — manifest
 * load, session mint, Hono server, watcher, seed catalogue route, and the
 * Vite dev server (the `[pneuma] ready` line prints only after Vite is
 * up, so awaiting it proves the dev boot; a follow-up fetch of the mode's
 * frontend entry THROUGH Vite proves the module actually transforms).
 *
 * Kept hermetic and skippable:
 *  - `--viewing` (no agent spawn, no skill install) + `--no-prompt`
 *    (defaults for init params) — no agent CLI is ever launched, but the
 *    entry validates the backend binary before anything else, so the test
 *    registers as SKIP when no backend binary exists on the machine (the
 *    same discipline as backends/__tests__/lifecycle-harness.ts).
 *  - HOME points at a scratch dir — nothing touches the real ~/.pneuma.
 *  - The workspace lives under os.tmpdir(), which the CLI treats as a
 *    temporary workspace (no running-registry entry).
 *  - No network: Vite serves from local node_modules; TTS is never
 *    invoked (voice-over is opt-in and no key is configured).
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAllBackendModules } from "../../../backends/index.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/** Any installed backend will do — viewing mode never launches it. */
const availableBackend = getAllBackendModules().find(
  (m) => m.checkRequirements().ok,
)?.type;

/** Ports away from the 17996/17007 dev defaults, randomized per run so a
 *  concurrently running dev server (or a previous crashed run in
 *  TIME_WAIT) cannot collide. The server increments on collision anyway —
 *  the actual port is parsed from its own boot line. */
const basePort = 21000 + Math.floor(Math.random() * 5000);

// A STAGE-BEARING board, not a plain one: the workspace the smoke boots
// against uses `@board`, both camera verbs and `@erase`, so the session
// under test is the C1–C3 shape (multi-board fold, camera schedule,
// eraser wiring), not only the pre-stage linear strip.
const BOARD = `@board 2

# 冒烟板

一块最小的板,证明从 CLI 到浏览器入口整条链路能启动。

- 服务器: 起了
- 看板: 在播

@focus "服务器"

@overview

@erase

擦净之后还能接着写,舞台链路也在这块板上走了一遍。
`;

describe("[5] bun run dev bansho — boot smoke", () => {
  if (!availableBackend) {
    test.skip("dev boot — no agent backend binary available on this machine", () => {});
    return;
  }

  test(
    "the dev entry boots: API server answers, the mode is bansho with its four seeds, and the full dev boot (incl. Vite) completes",
    async () => {
      const home = mkdtempSync(join(tmpdir(), "bansho-smoke-home-"));
      const workspace = mkdtempSync(join(tmpdir(), "bansho-smoke-ws-"));
      writeFileSync(join(workspace, "board.md"), BOARD);

      const proc = Bun.spawn(
        [
          "bun",
          join(REPO_ROOT, "bin", "pneuma.ts"),
          "bansho",
          "--dev",
          "--workspace",
          workspace,
          "--viewing",
          "--no-prompt",
          "--no-open",
          "--backend",
          availableBackend,
          "--port",
          String(basePort),
        ],
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            HOME: home,
            PNEUMA_VITE_PORT: String(basePort + 1000),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      // Drain both streams continuously — an unread pipe fills its buffer
      // and silently wedges the child mid-boot.
      let output = "";
      const drain = async (stream: ReadableStream<Uint8Array>) => {
        const decoder = new TextDecoder();
        const reader = stream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          output += decoder.decode(value, { stream: true });
        }
      };
      const drains = [drain(proc.stdout), drain(proc.stderr)];

      const waitFor = async (
        pattern: RegExp,
        what: string,
        timeoutMs: number,
      ): Promise<RegExpMatchArray> => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const match = output.match(pattern);
          if (match) return match;
          if (proc.exitCode !== null) {
            throw new Error(
              `pneuma exited (code ${proc.exitCode}) before ${what}.\n--- output ---\n${output}`,
            );
          }
          if (Date.now() > deadline) {
            throw new Error(`timed out waiting for ${what}.\n--- output ---\n${output}`);
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      };

      try {
        // 1. The API server is up (it may have walked past a busy port —
        //    trust its own boot line, not the flag we passed).
        const serverLine = await waitFor(
          /\[server\] Pneuma server running on http:\/\/localhost:(\d+)/,
          "the API server boot line",
          60_000,
        );
        const apiPort = Number(serverLine[1]);
        const api = (path: string) => `http://localhost:${apiPort}${path}`;

        // 2. /api/config — the session really is a bansho viewing session.
        const config = (await (await fetch(api("/api/config"))).json()) as {
          layout: string;
          editing: boolean;
          editingSupported: boolean;
          replayMode: boolean;
        };
        expect(config.layout).toBe("app");
        expect(config.editing).toBe(false); // --viewing
        expect(config.editingSupported).toBe(true);
        expect(config.replayMode).toBe(false);

        // 3. The mode's seed catalogue is served — manifest loaded for real.
        const seeds = (await (await fetch(api("/api/seeds/list"))).json()) as {
          modeName: string;
          seeds: Array<{ id: string }>;
        };
        expect(seeds.modeName).toBe("bansho");
        expect(seeds.seeds.map((s) => s.id).sort()).toEqual([
          "pitch-en",
          "pitch-zh",
          "tech-en",
          "tech-zh",
        ]);

        // 4. A session was minted.
        const session = (await (await fetch(api("/api/session"))).json()) as {
          sessionId: string | null;
          workspace: string;
        };
        expect(session.workspace).toBe(workspace);

        // 5. The FULL dev boot completed — `[pneuma] ready` prints only
        //    after the Vite dev server is up.
        const ready = await waitFor(
          /\[pneuma\] ready (http:\/\/localhost:\d+\S*)/,
          "the ready line (Vite up)",
          90_000,
        );
        const url = new URL(ready[1]!);
        expect(url.searchParams.get("mode")).toBe("bansho");
        expect(url.searchParams.get("layout")).toBe("app");

        // 6. The bundle proof: fetch the mode's frontend entry THROUGH the
        //    Vite dev server (the exact module core/mode-loader.ts
        //    dynamic-imports for a builtin). The ready line only proves
        //    Vite listens; a transform failure in the mode's module graph
        //    would still read green without this request — Vite answers a
        //    broken module with a 500, a healthy one with JavaScript.
        const entry = await fetch(
          new URL("/modes/bansho/pneuma-mode.ts", url.origin),
        );
        expect(entry.status).toBe(200);
        expect(entry.headers.get("content-type") ?? "").toContain("javascript");
        expect(await entry.text()).toContain("manifest");

        // 7. The STAGE module graph transforms too — the ready line and
        //    the entry module prove nothing about the C1–C3 additions
        //    (they are lazy imports in the viewer's graph; a syntax-level
        //    break in any of them would still boot green without these
        //    requests). One per stage seam: the camera/register fold, the
        //    assignment fold, the eraser factory, and the G8-J funnel.
        for (const mod of [
          "/modes/bansho/engine/stage.ts",
          "/modes/bansho/engine/layout.ts",
          "/modes/bansho/engine/factories/eraser.ts",
          "/modes/bansho/viewer/stage-measure.ts",
        ]) {
          const res = await fetch(new URL(mod, url.origin));
          expect(`${mod}:${res.status}`).toBe(`${mod}:200`);
          expect(res.headers.get("content-type") ?? "").toContain("javascript");
        }
      } finally {
        // SIGTERM lets pneuma's own shutdown kill Vite; its internal 4s
        // force-exit fuse guarantees the child cannot wedge. SIGKILL is
        // the last resort only (it would orphan Vite).
        proc.kill("SIGTERM");
        const exited = await Promise.race([
          proc.exited.then(() => true),
          new Promise<false>((r) => setTimeout(() => r(false), 10_000)),
        ]);
        if (!exited) {
          proc.kill("SIGKILL");
          await proc.exited;
        }
        await Promise.allSettled(drains);
        // Only after the child is fully gone (its HOME points here): the
        // scratch dirs would otherwise pile up two per run under tmpdir.
        rmSync(home, { recursive: true, force: true });
        rmSync(workspace, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
