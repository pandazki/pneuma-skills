import { describe, expect, test } from "bun:test";
import {
  parseHandoffArgs,
  runHandoffCommand,
  validateHandoffPayload,
  type HandoffCliEnv,
  type HandoffCliIo,
} from "../handoff-cli.js";

/**
 * Build a stub `HandoffCliIo` that captures stdout / stderr lines and lets
 * the test drive `fetch` + `readStdin` deterministically.
 */
function makeIo(opts: {
  stdin?: string;
  fetchImpl?: HandoffCliIo["fetch"];
} = {}): {
  io: HandoffCliIo;
  stdout: string[];
  stderr: string[];
  fetchCalls: Array<{ url: string; body: string }>;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetchCalls: Array<{ url: string; body: string }> = [];
  const io: HandoffCliIo = {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    readStdin: async () => opts.stdin ?? "",
    fetch:
      opts.fetchImpl ??
      (async (url, init) => {
        fetchCalls.push({ url, body: init.body });
        return {
          status: 200,
          json: async () => ({ handoff_id: "hf-test", status: "proposed" }),
          text: async () => "",
        };
      }),
  };
  return { io, stdout, stderr, fetchCalls };
}

const ENV: HandoffCliEnv = {
  PNEUMA_SERVER_URL: "http://localhost:17007",
  PNEUMA_SESSION_ID: "src-session",
};

describe("parseHandoffArgs", () => {
  test("parses --json with following value", () => {
    expect(parseHandoffArgs(["--json", "{\"a\":1}"])).toEqual({ json: "{\"a\":1}" });
  });

  test("parses --stdin flag", () => {
    expect(parseHandoffArgs(["--stdin"])).toEqual({ stdin: true });
  });

  test("parses --help / -h", () => {
    expect(parseHandoffArgs(["--help"])).toEqual({ help: true });
    expect(parseHandoffArgs(["-h"])).toEqual({ help: true });
  });

  test("ignores unknown args", () => {
    expect(parseHandoffArgs(["--foo", "bar"])).toEqual({});
  });
});

describe("validateHandoffPayload", () => {
  test("returns the typed input when valid", () => {
    const input = validateHandoffPayload(
      {
        target_mode: "webcraft",
        intent: "build a site",
        suggested_files: ["a", "b"],
      },
      "src-1",
    );
    expect(input.target_mode).toBe("webcraft");
    expect(input.intent).toBe("build a site");
    expect(input.suggested_files).toEqual(["a", "b"]);
    expect(input.source_session_id).toBe("src-1");
  });

  test("rejects missing target_mode", () => {
    expect(() => validateHandoffPayload({ intent: "x" }, "s")).toThrow(/target_mode/);
  });

  test("rejects missing intent", () => {
    expect(() => validateHandoffPayload({ target_mode: "webcraft" }, "s")).toThrow(/intent/);
  });

  test("rejects empty target_mode", () => {
    expect(() =>
      validateHandoffPayload({ target_mode: "  ", intent: "x" }, "s"),
    ).toThrow(/target_mode/);
  });

  test("rejects non-string-array suggested_files", () => {
    expect(() =>
      validateHandoffPayload(
        { target_mode: "webcraft", intent: "x", suggested_files: ["a", 1] },
        "s",
      ),
    ).toThrow(/suggested_files/);
  });

  test("accepts target_session 'auto'", () => {
    const input = validateHandoffPayload(
      { target_mode: "webcraft", intent: "x", target_session: "auto" },
      "s",
    );
    expect(input.target_session).toBe("auto");
  });

  test("rejects scalar payload", () => {
    expect(() => validateHandoffPayload(42, "s")).toThrow(/JSON object/);
  });
});

describe("runHandoffCommand", () => {
  test("posts payload from --json to /api/handoffs/emit", async () => {
    const { io, stdout, stderr, fetchCalls } = makeIo();
    const code = await runHandoffCommand(
      ["--json", JSON.stringify({ target_mode: "webcraft", intent: "build site" })],
      ENV,
      io,
    );
    expect(code).toBe(0);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("http://localhost:17007/api/handoffs/emit");
    const body = JSON.parse(fetchCalls[0].body);
    expect(body.target_mode).toBe("webcraft");
    expect(body.intent).toBe("build site");
    expect(body.source_session_id).toBe("src-session");
    expect(stdout[0]).toContain("submitted");
    expect(stderr).toEqual([]);
  });

  test("reads payload from stdin when --stdin", async () => {
    const stdinPayload = JSON.stringify({ target_mode: "slide", intent: "deck" });
    const { io, stdout, fetchCalls } = makeIo({ stdin: stdinPayload });
    const code = await runHandoffCommand(["--stdin"], ENV, io);
    expect(code).toBe(0);
    expect(fetchCalls).toHaveLength(1);
    expect(JSON.parse(fetchCalls[0].body).target_mode).toBe("slide");
    expect(stdout[0]).toContain("submitted");
  });

  test("exits 2 when neither --json nor --stdin", async () => {
    const { io, stderr } = makeIo();
    const code = await runHandoffCommand([], ENV, io);
    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("--json");
  });

  test("exits 2 with empty payload", async () => {
    const { io, stderr } = makeIo({ stdin: "" });
    const code = await runHandoffCommand(["--stdin"], ENV, io);
    expect(code).toBe(2);
    expect(stderr.some((s) => s.includes("empty"))).toBe(true);
  });

  test("exits 2 on invalid JSON", async () => {
    const { io, stderr } = makeIo();
    const code = await runHandoffCommand(["--json", "{not json"], ENV, io);
    expect(code).toBe(2);
    expect(stderr.some((s) => s.includes("invalid JSON"))).toBe(true);
  });

  test("exits 2 when env vars missing", async () => {
    const { io, stderr } = makeIo();
    const code = await runHandoffCommand(
      ["--json", "{}"],
      { PNEUMA_SERVER_URL: ENV.PNEUMA_SERVER_URL },
      io,
    );
    expect(code).toBe(2);
    expect(stderr.some((s) => s.includes("PNEUMA_SESSION_ID"))).toBe(true);
  });

  test("exits 1 + surfaces server error on 4xx", async () => {
    const { io, stderr } = makeIo({
      fetchImpl: async () => ({
        status: 400,
        json: async () => ({ error: "target_mode missing" }),
        text: async () => "",
      }),
    });
    const code = await runHandoffCommand(
      ["--json", JSON.stringify({ target_mode: "webcraft", intent: "x" })],
      ENV,
      io,
    );
    expect(code).toBe(1);
    expect(stderr.join("\n")).toContain("target_mode missing");
  });

  test("exits 1 on network error", async () => {
    const { io, stderr } = makeIo({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const code = await runHandoffCommand(
      ["--json", JSON.stringify({ target_mode: "webcraft", intent: "x" })],
      ENV,
      io,
    );
    expect(code).toBe(1);
    expect(stderr.some((s) => s.includes("ECONNREFUSED"))).toBe(true);
  });

  test("--help prints usage and exits 0", async () => {
    const { io, stdout } = makeIo();
    const code = await runHandoffCommand(["--help"], ENV, io);
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("Usage: pneuma handoff");
  });
});
