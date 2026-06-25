import { describe, expect, test } from "bun:test";
import {
  parseBorrowArgs,
  validateBorrowDispatch,
  runBorrowCommand,
  type BorrowCliEnv,
  type BorrowCliIo,
} from "../borrow-cli.js";
import { isBorrowResult } from "../../core/types/borrow.js";

// ── IO stub ──────────────────────────────────────────────────────────────────

function makeIo(
  opts: {
    stdin?: string;
    fetchImpl?: BorrowCliIo["fetch"];
  } = {},
): {
  io: BorrowCliIo;
  stdout: string[];
  stderr: string[];
  fetchCalls: Array<{ url: string; body: string }>;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetchCalls: Array<{ url: string; body: string }> = [];
  const io: BorrowCliIo = {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    readStdin: async () => opts.stdin ?? "",
    fetch:
      opts.fetchImpl ??
      (async (url, init) => {
        fetchCalls.push({ url, body: init.body });
        return {
          status: 200,
          json: async () => ({ borrow_id: "borrow-test", state: "running" }),
          text: async () => "",
        };
      }),
  };
  return { io, stdout, stderr, fetchCalls };
}

const ENV: BorrowCliEnv = {
  PNEUMA_SERVER_URL: "http://localhost:17007",
  PNEUMA_SESSION_ID: "host-A",
};

// ── parseBorrowArgs ───────────────────────────────────────────────────────────

describe("parseBorrowArgs", () => {
  test("parses --mode and --json", () => {
    expect(parseBorrowArgs(["--mode", "wordtaste", "--json", '{"brief":"x"}'])).toEqual({
      mode: "wordtaste",
      json: '{"brief":"x"}',
    });
  });

  test("parses --stdin flag", () => {
    expect(parseBorrowArgs(["--mode", "draw", "--stdin"])).toEqual({
      mode: "draw",
      stdin: true,
    });
  });

  test("parses --help / -h", () => {
    expect(parseBorrowArgs(["--help"])).toEqual({ help: true });
    expect(parseBorrowArgs(["-h"])).toEqual({ help: true });
  });

  test("ignores unknown args", () => {
    expect(parseBorrowArgs(["--foo", "bar"])).toEqual({});
  });
});

// ── validateBorrowDispatch ────────────────────────────────────────────────────

describe("validateBorrowDispatch", () => {
  test("builds a payload from --mode + brief, merging the mode flag", () => {
    const payload = validateBorrowDispatch(
      { brief: "polish this copy" },
      "wordtaste",
    );
    expect(payload.mode).toBe("wordtaste");
    expect(payload.brief).toBe("polish this copy");
  });

  test("accepts optional string-array + scalar fields", () => {
    const payload = validateBorrowDispatch(
      {
        brief: "redo the logo",
        inputs: ["/abs/a.svg", "/abs/b.svg"],
        expects: "an SVG logo",
        scope: "in-place",
        in_place_targets: ["/abs/logo.svg"],
        summary: "context",
        language: "zh-CN",
      },
      "illustrate",
    );
    expect(payload.inputs).toEqual(["/abs/a.svg", "/abs/b.svg"]);
    expect(payload.expects).toBe("an SVG logo");
    expect(payload.scope).toBe("in-place");
    expect(payload.in_place_targets).toEqual(["/abs/logo.svg"]);
    expect(payload.summary).toBe("context");
    expect(payload.language).toBe("zh-CN");
  });

  test("mode in payload is overridden by the --mode flag (flag is authoritative)", () => {
    const payload = validateBorrowDispatch({ mode: "ignored", brief: "x" }, "draw");
    expect(payload.mode).toBe("draw");
  });

  test("rejects missing --mode flag", () => {
    expect(() => validateBorrowDispatch({ brief: "x" }, undefined)).toThrow(/mode/);
  });

  test("rejects empty --mode flag", () => {
    expect(() => validateBorrowDispatch({ brief: "x" }, "   ")).toThrow(/mode/);
  });

  test("rejects missing brief", () => {
    expect(() => validateBorrowDispatch({}, "draw")).toThrow(/brief/);
  });

  test("rejects empty brief", () => {
    expect(() => validateBorrowDispatch({ brief: "   " }, "draw")).toThrow(/brief/);
  });

  test("rejects non-string-array inputs", () => {
    expect(() => validateBorrowDispatch({ brief: "x", inputs: [1, 2] }, "draw")).toThrow(/inputs/);
  });

  test("rejects an invalid scope value", () => {
    expect(() => validateBorrowDispatch({ brief: "x", scope: "wat" }, "draw")).toThrow(/scope/);
  });

  test("omits in_place_targets / inputs when absent (no empty arrays)", () => {
    const payload = validateBorrowDispatch({ brief: "x" }, "draw");
    expect("inputs" in payload).toBe(false);
    expect("in_place_targets" in payload).toBe(false);
    expect("scope" in payload).toBe(false);
  });
});

// ── runBorrowCommand ──────────────────────────────────────────────────────────

describe("runBorrowCommand", () => {
  test("POSTs the payload to A's own server /api/borrows/dispatch", async () => {
    const { io, stdout, fetchCalls } = makeIo();
    const code = await runBorrowCommand(
      ["--mode", "wordtaste", "--json", '{"brief":"polish copy"}'],
      ENV,
      io,
    );
    expect(code).toBe(0);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe("http://localhost:17007/api/borrows/dispatch");
    const sent = JSON.parse(fetchCalls[0]!.body) as Record<string, unknown>;
    expect(sent.mode).toBe("wordtaste");
    expect(sent.brief).toBe("polish copy");
    // The result line is machine-readable JSON the host agent can JSON.parse.
    const printed = JSON.parse(stdout.join("\n")) as Record<string, unknown>;
    expect(printed.borrow_id).toBe("borrow-test");
    expect(printed.state).toBe("running");
  });

  test("stdout is pure JSON — no banner / prose pollution", async () => {
    const { io, stdout } = makeIo();
    await runBorrowCommand(["--mode", "draw", "--json", '{"brief":"x"}'], ENV, io);
    // Every stdout line must be JSON-parseable as a whole (no stray prose).
    expect(() => JSON.parse(stdout.join("\n"))).not.toThrow();
  });

  test("reads payload from stdin when --stdin is given", async () => {
    const { io, fetchCalls } = makeIo({ stdin: '{"brief":"from stdin"}' });
    const code = await runBorrowCommand(["--mode", "draw", "--stdin"], ENV, io);
    expect(code).toBe(0);
    const sent = JSON.parse(fetchCalls[0]!.body) as Record<string, unknown>;
    expect(sent.brief).toBe("from stdin");
  });

  test("exit 2 + stderr when PNEUMA_SERVER_URL is missing", async () => {
    const { io, stderr, fetchCalls } = makeIo();
    const code = await runBorrowCommand(
      ["--mode", "draw", "--json", '{"brief":"x"}'],
      { PNEUMA_SESSION_ID: "host-A" },
      io,
    );
    expect(code).toBe(2);
    expect(stderr.join("\n")).toMatch(/PNEUMA_SERVER_URL/);
    expect(fetchCalls).toHaveLength(0);
  });

  test("exit 2 + stderr when --mode is missing", async () => {
    const { io, stderr, fetchCalls } = makeIo();
    const code = await runBorrowCommand(["--json", '{"brief":"x"}'], ENV, io);
    expect(code).toBe(2);
    expect(stderr.join("\n")).toMatch(/mode/);
    expect(fetchCalls).toHaveLength(0);
  });

  test("exit 2 + stderr on validation failure (missing brief)", async () => {
    const { io, stderr, fetchCalls } = makeIo();
    const code = await runBorrowCommand(["--mode", "draw", "--json", "{}"], ENV, io);
    expect(code).toBe(2);
    expect(stderr.join("\n")).toMatch(/brief/);
    expect(fetchCalls).toHaveLength(0);
  });

  test("exit 2 + stderr on invalid JSON", async () => {
    const { io, stderr } = makeIo();
    const code = await runBorrowCommand(["--mode", "draw", "--json", "{not json"], ENV, io);
    expect(code).toBe(2);
    expect(stderr.join("\n").length).toBeGreaterThan(0);
  });

  test("exit 1 + surfaces the server error message on non-2xx", async () => {
    const { io, stderr } = makeIo({
      fetchImpl: async () => ({
        status: 409,
        json: async () => ({ error: "a borrow is already running for this session" }),
        text: async () => "",
      }),
    });
    const code = await runBorrowCommand(["--mode", "draw", "--json", '{"brief":"x"}'], ENV, io);
    expect(code).toBe(1);
    expect(stderr.join("\n")).toMatch(/already running/);
  });

  test("exit 1 when the fetch itself throws (server unreachable)", async () => {
    const { io, stderr } = makeIo({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const code = await runBorrowCommand(["--mode", "draw", "--json", '{"brief":"x"}'], ENV, io);
    expect(code).toBe(1);
    expect(stderr.join("\n").length).toBeGreaterThan(0);
  });

  test("--help prints usage and exits 0 without fetching", async () => {
    const { io, stdout, fetchCalls } = makeIo();
    const code = await runBorrowCommand(["--help"], ENV, io);
    expect(code).toBe(0);
    expect(stdout.join("\n").length).toBeGreaterThan(0);
    expect(fetchCalls).toHaveLength(0);
  });
});

// Guard sanity: the contract guard the return-leg CLI relies on is importable
// here, confirming the cross-module wiring the borrow feature depends on.
describe("contract wiring", () => {
  test("isBorrowResult is reachable from the bin layer", () => {
    expect(isBorrowResult({
      borrow_id: "b",
      mode: "draw",
      status: "completed",
      produced: [{ path: "/abs/x.png" }],
      change_notes: "did the thing",
      produced_at: Date.now(),
    })).toBe(true);
  });
});
