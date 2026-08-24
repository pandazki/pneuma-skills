/**
 * The hosted writer adapter, reached through `run_leaf.ts` with a probe that
 * names only the hosted route. The two CLI adapters borrow an
 * already-authenticated process; this one holds a bearer token itself, so the
 * tests below are as much about where the key is NOT as about what the
 * adapter returns. The key never touches argv or any file: it is built into a
 * `fetch` header in memory. Every spawn gets its own HOME, TMPDIR, and
 * PNEUMA_SESSION_DIR under a temp root, and the "route" is a local HTTP
 * server, so no test ever reaches the network or a real key file.
 */

import { describe, expect, it } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptsDir = join(import.meta.dir, "..", "skill", "scripts");
const routerPath = join(scriptsDir, "run_leaf.ts");

/** An invented token. It is the string every leak assertion looks for. */
const KEY = "sk-or-v1-testonly-0123456789abcdef";
const PROMPT = "<!-- wordtaste:composed v1 -->\nWrite the section now, in Chinese.\n";

function answer(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

interface HostedServer {
  url: string;
  requests: Array<{ auth: string | null; body: string }>;
  respondWith(body: string, status?: number): void;
  stop(): void;
}

function startHosted(): HostedServer {
  const requests: Array<{ auth: string | null; body: string }> = [];
  let responseBody = answer("成稿在这里。");
  let responseStatus = 200;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push({ auth: request.headers.get("authorization"), body: await request.text() });
      return new Response(responseBody, { status: responseStatus });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/api/v1/chat/completions`,
    requests,
    respondWith(body: string, status = 200) {
      responseBody = body;
      responseStatus = status;
    },
    stop: () => server.stop(true),
  };
}

interface Harness {
  root: string;
  sessionDir: string;
  logsDir: string;
  prompt: string;
  env: Record<string, string>;
}

function makeHarness(prefix: string, hosted: HostedServer): Harness {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const sessionDir = join(root, "session");
  const scratch = join(root, "tmp");
  mkdirSync(join(sessionDir, ".pneuma"), { recursive: true });
  mkdirSync(scratch, { recursive: true });
  writeFileSync(
    join(sessionDir, ".pneuma", "cross-family.json"),
    '{"claude":false,"codex":false,"openrouter":true}\n',
  );
  const prompt = join(root, "prompt.md");
  writeFileSync(prompt, PROMPT);
  return {
    root,
    sessionDir,
    logsDir: join(sessionDir, ".pneuma", "leaf-logs"),
    prompt,
    env: {
      // No CLI of any family is reachable, and neither is a real key store.
      // TMPDIR points inside the harness so every scratch file is scanned.
      PATH: "/usr/bin:/bin",
      HOME: root,
      TMPDIR: scratch,
      LANG: "en_US.UTF-8",
      PNEUMA_SESSION_DIR: sessionDir,
      WORDTASTE_OPENROUTER_URL: hosted.url,
    },
  };
}

async function dispatch(
  harness: Harness,
  extraEnv: Record<string, string> = {},
  args: string[] = [harness.prompt],
  script: string = routerPath,
) {
  const proc = Bun.spawn([process.execPath, script, "writer", ...args], {
    cwd: harness.root,
    env: { ...harness.env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

async function withHarness(
  prefix: string,
  fn: (harness: Harness, hosted: HostedServer) => Promise<void>,
): Promise<void> {
  const hosted = startHosted();
  const harness = makeHarness(prefix, hosted);
  try {
    await fn(harness, hosted);
  } finally {
    hosted.stop();
    rmSync(harness.root, { recursive: true, force: true });
  }
}

/** Every regular file under a directory, recursively. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** The private log the router names for a writer dispatch, if one survived. */
function privateLogs(harness: Harness): string[] {
  if (!existsSync(harness.logsDir)) return [];
  return filesUnder(harness.logsDir).filter((path) => path.includes("writer-"));
}

describe("the hosted route — the key never becomes an argument or a file", () => {
  it("sends the token as an in-memory request header, and nowhere else", async () => {
    await withHarness("wordtaste-openrouter-key-", async (harness, hosted) => {
      const result = await dispatch(harness, { OPENROUTER_API_KEY: KEY });
      expect(result.status).toBe(0);

      // The one place the key may appear is the Authorization header the
      // route itself received.
      expect(hosted.requests[0]?.auth).toBe(`Bearer ${KEY}`);
      expect(hosted.requests[0]?.body).not.toContain(KEY);

      // Nothing the user or a log can see carries it.
      expect(result.stdout).not.toContain(KEY);
      expect(result.stderr).not.toContain(KEY);
      // The bash era staged the token through a 0600 header file; `fetch`
      // removes even that. No file under the harness — session, HOME, or
      // TMPDIR — ever held it.
      for (const file of filesUnder(harness.root)) {
        expect([file, readFileSync(file, "latin1").includes(KEY)]).toEqual([file, false]);
      }
    });
  }, 20_000);
});

describe("the hosted route — request shape", () => {
  it("uses the stated default model and the whole prompt file", async () => {
    await withHarness("wordtaste-openrouter-default-", async (harness, hosted) => {
      expect((await dispatch(harness, { OPENROUTER_API_KEY: KEY })).status).toBe(0);
      const body = JSON.parse(hosted.requests[0]!.body) as Record<string, unknown>;
      expect(body.model).toBe("anthropic/claude-sonnet-5");
      expect(body.max_tokens).toBe(30000);
      // No `system.en.md` beside the prompt: the legacy single-message shape,
      // byte for byte.
      expect(body.messages).toEqual([{ role: "user", content: PROMPT }]);
    });
  }, 20_000);

  /**
   * The hosted route is the one channel with a real system role. When the
   * composer's `system.en.md` sits beside the prompt, the charter is the
   * system message and the task message stays the user message — both byte
   * for byte, neither concatenated into the other.
   */
  it("sends the sibling charter as the system message, first", async () => {
    await withHarness("wordtaste-openrouter-system-", async (harness, hosted) => {
      const system = "You are a writer of long-form Chinese knowledge essays.\n";
      writeFileSync(join(harness.root, "system.en.md"), system);
      expect((await dispatch(harness, { OPENROUTER_API_KEY: KEY })).status).toBe(0);
      const body = JSON.parse(hosted.requests[0]!.body) as Record<string, unknown>;
      expect(body.messages).toEqual([
        { role: "system", content: system },
        { role: "user", content: PROMPT },
      ]);
    });
  }, 20_000);

  it("ignores the sibling charter for a prompt that is not composed", async () => {
    await withHarness("wordtaste-openrouter-plain-", async (harness, hosted) => {
      writeFileSync(join(harness.root, "system.en.md"), "a stray charter\n");
      // A plain prompt, primer off so it dispatches unchanged from its path.
      writeFileSync(harness.prompt, "plain prompt, no marker\n");
      expect(
        (await dispatch(harness, { OPENROUTER_API_KEY: KEY, WORDTASTE_PRIMER: "0" })).status,
      ).toBe(0);
      const body = JSON.parse(hosted.requests[0]!.body) as Record<string, unknown>;
      expect(body.messages).toEqual([
        { role: "user", content: "plain prompt, no marker\n" },
      ]);
    });
  }, 20_000);

  it("takes the model from WORDTASTE_WRITER_MODEL when one is named", async () => {
    await withHarness("wordtaste-openrouter-model-", async (harness, hosted) => {
      expect(
        (await dispatch(harness, {
          OPENROUTER_API_KEY: KEY,
          WORDTASTE_WRITER_MODEL: "moonshotai/kimi-k2-thinking",
        })).status,
      ).toBe(0);
      const body = JSON.parse(hosted.requests[0]!.body) as Record<string, unknown>;
      expect(body.model).toBe("moonshotai/kimi-k2-thinking");
    });
  }, 20_000);

  it("asks for low reasoning effort only off the Anthropic routes", async () => {
    await withHarness("wordtaste-openrouter-reasoning-", async (harness, hosted) => {
      // Anthropic routes reject the field outright.
      expect((await dispatch(harness, { OPENROUTER_API_KEY: KEY })).status).toBe(0);
      const anthropic = JSON.parse(hosted.requests[0]!.body) as Record<string, unknown>;
      expect(anthropic.reasoning).toBeUndefined();

      // A reasoning model without it spends the whole budget thinking.
      expect(
        (await dispatch(harness, {
          OPENROUTER_API_KEY: KEY,
          WORDTASTE_WRITER_MODEL: "qwen/qwen3-max",
        })).status,
      ).toBe(0);
      const reasoning = JSON.parse(hosted.requests[1]!.body) as Record<string, unknown>;
      expect(reasoning.reasoning).toEqual({ effort: "low" });
    });
  }, 20_000);

  it("returns the answer text and nothing else", async () => {
    await withHarness("wordtaste-openrouter-stdout-", async (harness, hosted) => {
      hosted.respondWith(answer("第一张台子只做粗活。"));
      const result = await dispatch(harness, { OPENROUTER_API_KEY: KEY });
      expect(result).toEqual({
        status: 0,
        stdout: "第一张台子只做粗活。\n",
        stderr: "",
      });
      // A successful call leaves no private log behind.
      expect(privateLogs(harness)).toEqual([]);
    });
  }, 20_000);
});

describe("the hosted route — failure is loud, specific, and quiet about detail", () => {
  it("exits 3 without calling out when no key is reachable", async () => {
    await withHarness("wordtaste-openrouter-nokey-", async (harness, hosted) => {
      const result = await dispatch(harness);
      expect(result.status).toBe(3);
      expect(result.stdout).toBe("");
      expect(result.stderr.split("\n").filter(Boolean)).toHaveLength(1);
      expect(result.stderr).toContain("unavailable");
      // A missing key is not a request.
      expect(hosted.requests).toHaveLength(0);
    });
  }, 20_000);

  it("exits 4 on a non-200, keeping the raw response in the private log", async () => {
    await withHarness("wordtaste-openrouter-403-", async (harness) => {
      const detail = '{"error":{"message":"no access to this model"}}';
      const result = await dispatch(harness, { OPENROUTER_API_KEY: KEY }, [harness.prompt]);
      expect(result.status).toBe(0);
      // Re-run against a refusing route.
      const refusing = startHosted();
      refusing.respondWith(detail, 403);
      try {
        const refused = await dispatch(harness, {
          OPENROUTER_API_KEY: KEY,
          WORDTASTE_OPENROUTER_URL: refusing.url,
        });
        expect(refused.status).toBe(4);
        expect(refused.stdout).toBe("");
        expect(refused.stderr.split("\n").filter(Boolean)).toHaveLength(1);
        // The diagnosis is neutral: no provider name, no model name, no body.
        expect(refused.stderr).not.toContain("no access to this model");
        expect(refused.stderr).not.toMatch(/openrouter|anthropic/i);
        const logs = privateLogs(harness);
        expect(logs.length).toBe(1);
        expect(readFileSync(logs[0]!, "utf8")).toContain("no access to this model");
      } finally {
        refusing.stop();
      }
    });
  }, 20_000);

  it("exits 4 when the answer comes back empty", async () => {
    await withHarness("wordtaste-openrouter-empty-", async (harness, hosted) => {
      for (
        const response of [
          answer(""),
          JSON.stringify({ choices: [{ message: { content: null } }] }),
          JSON.stringify({ choices: [] }),
          "not json at all",
        ]
      ) {
        hosted.respondWith(response);
        const result = await dispatch(harness, { OPENROUTER_API_KEY: KEY });
        expect([response, result.status]).toEqual([response, 4]);
        expect(result.stdout).toBe("");
      }
    });
  }, 20_000);

  it("propagates a transport failure instead of returning empty prose", async () => {
    await withHarness("wordtaste-openrouter-transport-", async (harness) => {
      // A stopped server: the connection is refused, never answered.
      const gone = startHosted();
      const goneUrl = gone.url;
      gone.stop();
      const result = await dispatch(harness, {
        OPENROUTER_API_KEY: KEY,
        WORDTASTE_OPENROUTER_URL: goneUrl,
      });
      expect(result.status).toBeGreaterThan(3);
      expect(result.stdout).toBe("");
      expect(result.stderr.split("\n").filter(Boolean)).toHaveLength(1);
    });
  }, 20_000);

  it("refuses a missing, empty, or absent prompt file with a usage error", async () => {
    await withHarness("wordtaste-openrouter-usage-", async (harness) => {
      const none = await dispatch(harness, { OPENROUTER_API_KEY: KEY }, []);
      expect(none.status).toBe(2);

      // Priming off: an unreadable plain prompt must reach the adapter's own
      // validation, not the primer.
      const primerOff = { OPENROUTER_API_KEY: KEY, WORDTASTE_PRIMER: "0" };
      const missing = await dispatch(harness, primerOff, [
        join(harness.root, "nope.md"),
      ]);
      expect(missing.status).toBe(2);

      const emptyFile = join(harness.root, "empty.md");
      writeFileSync(emptyFile, "");
      const empty = await dispatch(harness, primerOff, [emptyFile]);
      expect(empty.status).toBe(2);
      expect(empty.stderr.split("\n").filter(Boolean)).toHaveLength(1);
    });
  }, 20_000);
});

describe("the hosted route — where the key comes from", () => {
  it("reads the session .env the mode's envMapping writes", async () => {
    await withHarness("wordtaste-openrouter-sessionenv-", async (harness, hosted) => {
      writeFileSync(
        join(harness.sessionDir, ".env"),
        `# a comment\nFAL_KEY=unrelated\nOPENROUTER_API_KEY="${KEY}"\n`,
      );
      const result = await dispatch(harness);
      expect(result.status).toBe(0);
      expect(hosted.requests[0]?.auth).toBe(`Bearer ${KEY}`);
    });
  }, 20_000);

  it("reads the skill-root .env the installer generates", async () => {
    await withHarness("wordtaste-openrouter-skillenv-", async (harness, hosted) => {
      // A stand-in for an installed skill: the whole scripts/ tree plus the
      // generated .env one level up.
      const skill = join(harness.root, "skill");
      mkdirSync(join(skill, "references"), { recursive: true });
      cpSync(scriptsDir, join(skill, "scripts"), { recursive: true });
      writeFileSync(join(skill, ".env"), `OPENROUTER_API_KEY=${KEY}\n`);
      expect(statSync(join(skill, ".env")).isFile()).toBe(true);

      const result = await dispatch(
        harness,
        {},
        [harness.prompt],
        join(skill, "scripts", "run_leaf.ts"),
      );
      expect(result.status).toBe(0);
      expect(hosted.requests[0]?.auth).toBe(`Bearer ${KEY}`);
    });
  }, 20_000);

  it("lets the environment win over a stale file", async () => {
    await withHarness("wordtaste-openrouter-envwins-", async (harness, hosted) => {
      writeFileSync(
        join(harness.sessionDir, ".env"),
        "OPENROUTER_API_KEY=sk-or-v1-stale-file-value\n",
      );
      expect((await dispatch(harness, { OPENROUTER_API_KEY: KEY })).status).toBe(0);
      expect(hosted.requests[0]?.auth).toBe(`Bearer ${KEY}`);
      expect(hosted.requests[0]?.auth).not.toContain("stale-file-value");
    });
  }, 20_000);
});
