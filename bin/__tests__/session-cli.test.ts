import { describe, test, expect } from "bun:test";
import {
  parseSessionRefineArgs,
  validateSessionRefinePayload,
  runSessionRefineCommand,
  type SessionCliIo,
} from "../session-cli.js";

describe("parseSessionRefineArgs", () => {
  test("captures --json payload", () => {
    expect(parseSessionRefineArgs(["--json", '{"displayName":"x"}'])).toEqual({
      json: '{"displayName":"x"}',
    });
  });

  test("captures --stdin flag", () => {
    expect(parseSessionRefineArgs(["--stdin"])).toEqual({ stdin: true });
  });

  test("captures --help and short -h", () => {
    expect(parseSessionRefineArgs(["--help"])).toEqual({ help: true });
    expect(parseSessionRefineArgs(["-h"])).toEqual({ help: true });
  });

  test("unknown flags are ignored without throwing", () => {
    expect(parseSessionRefineArgs(["--unknown", "value"])).toEqual({});
  });
});

describe("validateSessionRefinePayload", () => {
  test("accepts displayName-only", () => {
    expect(validateSessionRefinePayload({ displayName: "Hero section iteration" })).toEqual({
      displayName: "Hero section iteration",
    });
  });

  test("accepts description-only", () => {
    expect(
      validateSessionRefinePayload({
        description: "Tightening the hero copy and image rhythm.",
      }),
    ).toEqual({ description: "Tightening the hero copy and image rhythm." });
  });

  test("accepts both fields and trims whitespace", () => {
    expect(
      validateSessionRefinePayload({
        displayName: "  Hero ",
        description: "  One sentence summary.  ",
      }),
    ).toEqual({
      displayName: "Hero",
      description: "One sentence summary.",
    });
  });

  test("rejects empty payload (must include at least one field)", () => {
    expect(() => validateSessionRefinePayload({})).toThrow(/at least one/);
  });

  test("treats whitespace-only strings as absent", () => {
    expect(() =>
      validateSessionRefinePayload({ displayName: "   ", description: "" }),
    ).toThrow(/at least one/);
  });

  test("rejects non-object payloads", () => {
    expect(() => validateSessionRefinePayload(null)).toThrow(/JSON object/);
    expect(() => validateSessionRefinePayload([])).toThrow(/JSON object/);
    expect(() => validateSessionRefinePayload("hi")).toThrow(/JSON object/);
  });

  test("rejects non-string field types", () => {
    expect(() => validateSessionRefinePayload({ displayName: 42 })).toThrow(/must be a string/);
  });

  test("enforces displayName ≤40 chars", () => {
    expect(() => validateSessionRefinePayload({ displayName: "a".repeat(41) })).toThrow(/≤40/);
  });

  test("enforces description ≤280 chars", () => {
    expect(() =>
      validateSessionRefinePayload({ description: "a".repeat(281) }),
    ).toThrow(/≤280/);
  });
});

function makeIo(): {
  io: SessionCliIo;
  stdout: string[];
  stderr: string[];
  fetches: { url: string; body: string }[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetches: { url: string; body: string }[] = [];
  let nextResponse: { status: number; body: unknown } = { status: 200, body: { ok: true } };
  return {
    io: {
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
      readStdin: async () => "",
      fetch: async (url, init) => {
        fetches.push({ url, body: init.body });
        return {
          status: nextResponse.status,
          json: async () => nextResponse.body,
          text: async () => JSON.stringify(nextResponse.body),
        };
      },
    },
    stdout,
    stderr,
    fetches,
  };
}

describe("runSessionRefineCommand", () => {
  test("posts to /api/session/refine and returns 0 on 2xx", async () => {
    const { io, stdout, fetches } = makeIo();
    const code = await runSessionRefineCommand(
      ["--json", '{"displayName":"X","description":"Y"}'],
      { PNEUMA_SERVER_URL: "http://localhost:17007/", PNEUMA_SESSION_ID: "sess-1" },
      io,
    );
    expect(code).toBe(0);
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe("http://localhost:17007/api/session/refine");
    expect(JSON.parse(fetches[0].body)).toEqual({ displayName: "X", description: "Y" });
    // Assert on the payload echo rather than an English word — the success
    // message is localized (the active locale may not be English under test),
    // but the refined title is interpolated into it in every locale.
    expect(stdout.join("\n")).toContain("X");
  });

  test("exits 2 when neither --json nor --stdin supplied", async () => {
    const { io, stderr } = makeIo();
    const code = await runSessionRefineCommand(
      [],
      { PNEUMA_SERVER_URL: "http://x", PNEUMA_SESSION_ID: "s" },
      io,
    );
    expect(code).toBe(2);
    expect(stderr.join("\n")).toMatch(/--json|--stdin/);
  });

  test("exits 2 when PNEUMA_SESSION_ID is missing", async () => {
    const { io, stderr } = makeIo();
    const code = await runSessionRefineCommand(
      ["--json", '{"displayName":"x"}'],
      { PNEUMA_SERVER_URL: "http://x" },
      io,
    );
    expect(code).toBe(2);
    expect(stderr.join("\n")).toMatch(/PNEUMA_SESSION_ID/);
  });

  test("exits 2 when validation fails (payload-level)", async () => {
    const { io, stderr, fetches } = makeIo();
    const code = await runSessionRefineCommand(
      ["--json", "{}"],
      { PNEUMA_SERVER_URL: "http://x", PNEUMA_SESSION_ID: "s" },
      io,
    );
    expect(code).toBe(2);
    expect(fetches).toHaveLength(0); // never POSTs invalid payload
    expect(stderr.join("\n")).toMatch(/at least one/);
  });
});
