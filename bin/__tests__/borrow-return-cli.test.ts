import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseBorrowReturnArgs,
  validateBorrowReturn,
  runBorrowReturnCommand,
  type BorrowReturnCliEnv,
  type BorrowReturnCliIo,
} from "../borrow-return-cli.js";
import { isBorrowResult } from "../../core/types/borrow.js";

// ── IO stub + temp Bdir ───────────────────────────────────────────────────────

let bdir: string;

beforeEach(() => {
  bdir = mkdtempSync(join(tmpdir(), "pneuma-borrow-return-"));
});
afterEach(() => {
  rmSync(bdir, { recursive: true, force: true });
});

function makeIo(
  opts: {
    stdin?: string;
    fetchImpl?: BorrowReturnCliIo["fetch"];
  } = {},
): {
  io: BorrowReturnCliIo;
  stdout: string[];
  stderr: string[];
  fetchCalls: Array<{ url: string; body: string }>;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetchCalls: Array<{ url: string; body: string }> = [];
  const io: BorrowReturnCliIo = {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    readStdin: async () => opts.stdin ?? "",
    fetch:
      opts.fetchImpl ??
      (async (url, init) => {
        fetchCalls.push({ url, body: init.body });
        return {
          status: 200,
          json: async () => ({ state: "completed" }),
          text: async () => "",
        };
      }),
  };
  return { io, stdout, stderr, fetchCalls };
}

function env(): BorrowReturnCliEnv {
  return { PNEUMA_SESSION_DIR: bdir };
}

const VALID_PAYLOAD = {
  borrow_id: "borrow-9",
  mode: "wordtaste",
  status: "completed",
  produced: [{ path: "/abs/polished.md", kind: "markdown", role: "polished-copy" }],
  change_notes: "Tightened the hero headline; preserved the user's voice.",
  return_via: {
    borrow_id: "borrow-9",
    host_server_url: "http://localhost:17007",
  },
};

// ── parseBorrowReturnArgs ──────────────────────────────────────────────────────

describe("parseBorrowReturnArgs", () => {
  test("parses --json", () => {
    expect(parseBorrowReturnArgs(["--json", '{"a":1}'])).toEqual({ json: '{"a":1}' });
  });
  test("parses --stdin", () => {
    expect(parseBorrowReturnArgs(["--stdin"])).toEqual({ stdin: true });
  });
  test("parses --help / -h", () => {
    expect(parseBorrowReturnArgs(["--help"])).toEqual({ help: true });
    expect(parseBorrowReturnArgs(["-h"])).toEqual({ help: true });
  });
});

// ── validateBorrowReturn ───────────────────────────────────────────────────────

describe("validateBorrowReturn", () => {
  test("splits a payload into a BorrowResult + return_via, stamping produced_at when absent", () => {
    const { result, returnVia } = validateBorrowReturn(VALID_PAYLOAD);
    expect(isBorrowResult(result)).toBe(true);
    // produced_at is stamped by the CLI when the agent omits it.
    expect(typeof result.produced_at).toBe("number");
    // return_via must NOT bleed into the on-disk BorrowResult.
    expect("return_via" in (result as unknown as Record<string, unknown>)).toBe(false);
    expect(returnVia.host_server_url).toBe("http://localhost:17007");
    expect(returnVia.borrow_id).toBe("borrow-9");
  });

  test("preserves an explicit produced_at", () => {
    const { result } = validateBorrowReturn({ ...VALID_PAYLOAD, produced_at: 123 });
    expect(result.produced_at).toBe(123);
  });

  test("rejects a missing return_via", () => {
    const { return_via, ...rest } = VALID_PAYLOAD;
    expect(() => validateBorrowReturn(rest)).toThrow(/return_via/);
  });

  test("rejects a return_via missing host_server_url", () => {
    expect(() =>
      validateBorrowReturn({ ...VALID_PAYLOAD, return_via: { borrow_id: "b" } }),
    ).toThrow(/host_server_url/);
  });

  test("rejects a payload that fails isBorrowResult (bad status)", () => {
    expect(() =>
      validateBorrowReturn({ ...VALID_PAYLOAD, status: "done" }),
    ).toThrow();
  });

  test("rejects a payload with a non-string produced[].path", () => {
    expect(() =>
      validateBorrowReturn({ ...VALID_PAYLOAD, produced: [{ path: 5 }] }),
    ).toThrow();
  });

  test("accepts a failed status with empty produced", () => {
    const { result } = validateBorrowReturn({
      ...VALID_PAYLOAD,
      status: "failed",
      produced: [],
    });
    expect(result.status).toBe("failed");
    expect(result.produced).toEqual([]);
  });
});

// ── runBorrowReturnCommand ─────────────────────────────────────────────────────

describe("runBorrowReturnCommand", () => {
  test("writes <Bdir>/borrow-result.json AND POSTs the completion to A's server", async () => {
    const { io, fetchCalls } = makeIo();
    const code = await runBorrowReturnCommand(
      ["--json", JSON.stringify(VALID_PAYLOAD)],
      env(),
      io,
    );
    expect(code).toBe(0);

    // 1. Result file written at the contract path, valid + return_via stripped.
    const resultPath = join(bdir, "borrow-result.json");
    expect(existsSync(resultPath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(resultPath, "utf-8")) as Record<string, unknown>;
    expect(isBorrowResult(onDisk)).toBe(true);
    expect("return_via" in onDisk).toBe(false);
    expect(onDisk.borrow_id).toBe("borrow-9");

    // 2. POST to A's server at return_via.host_server_url + /api/borrows/return.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe("http://localhost:17007/api/borrows/return");
    const sent = JSON.parse(fetchCalls[0]!.body) as Record<string, unknown>;
    expect(sent.borrow_id).toBe("borrow-9");
    expect(sent.status).toBe("completed");
    // The signal carries the result path so A can read it without re-deriving.
    expect(sent.result_path).toBe(resultPath);
  });

  test("trims a trailing slash on host_server_url before composing the route", async () => {
    const { io, fetchCalls } = makeIo();
    await runBorrowReturnCommand(
      [
        "--json",
        JSON.stringify({
          ...VALID_PAYLOAD,
          return_via: { borrow_id: "borrow-9", host_server_url: "http://localhost:17007/" },
        }),
      ],
      env(),
      io,
    );
    expect(fetchCalls[0]!.url).toBe("http://localhost:17007/api/borrows/return");
  });

  test("still writes the result file even when the POST to A fails (disk is the durable record)", async () => {
    const { io, stderr } = makeIo({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const code = await runBorrowReturnCommand(
      ["--json", JSON.stringify(VALID_PAYLOAD)],
      env(),
      io,
    );
    // The file write is the durable artifact; a failed poke is non-fatal but
    // surfaced (exit 1) so the agent knows A wasn't reached live.
    expect(existsSync(join(bdir, "borrow-result.json"))).toBe(true);
    expect(code).toBe(1);
    expect(stderr.join("\n").length).toBeGreaterThan(0);
  });

  test("reads payload from stdin when --stdin is given", async () => {
    const { io, fetchCalls } = makeIo({ stdin: JSON.stringify(VALID_PAYLOAD) });
    const code = await runBorrowReturnCommand(["--stdin"], env(), io);
    expect(code).toBe(0);
    expect(fetchCalls).toHaveLength(1);
  });

  test("exit 2 + stderr when PNEUMA_SESSION_DIR is missing", async () => {
    const { io, stderr } = makeIo();
    const code = await runBorrowReturnCommand(
      ["--json", JSON.stringify(VALID_PAYLOAD)],
      {},
      io,
    );
    expect(code).toBe(2);
    expect(stderr.join("\n")).toMatch(/PNEUMA_SESSION_DIR/);
  });

  test("exit 2 + stderr on validation failure (does not write a file)", async () => {
    const { io, stderr } = makeIo();
    const code = await runBorrowReturnCommand(
      ["--json", JSON.stringify({ ...VALID_PAYLOAD, status: "bogus" })],
      env(),
      io,
    );
    expect(code).toBe(2);
    expect(existsSync(join(bdir, "borrow-result.json"))).toBe(false);
    expect(stderr.join("\n").length).toBeGreaterThan(0);
  });

  test("exit 2 on invalid JSON", async () => {
    const { io } = makeIo();
    const code = await runBorrowReturnCommand(["--json", "{nope"], env(), io);
    expect(code).toBe(2);
  });

  test("exit 1 surfaces the server error message on non-2xx", async () => {
    const { io, stderr } = makeIo({
      fetchImpl: async () => ({
        status: 404,
        json: async () => ({ error: "no such borrow" }),
        text: async () => "",
      }),
    });
    const code = await runBorrowReturnCommand(
      ["--json", JSON.stringify(VALID_PAYLOAD)],
      env(),
      io,
    );
    expect(code).toBe(1);
    expect(stderr.join("\n")).toMatch(/no such borrow/);
    // File still written regardless of the poke outcome.
    expect(existsSync(join(bdir, "borrow-result.json"))).toBe(true);
  });

  test("--help prints usage and exits 0 without writing or fetching", async () => {
    const { io, stdout, fetchCalls } = makeIo();
    const code = await runBorrowReturnCommand(["--help"], env(), io);
    expect(code).toBe(0);
    expect(stdout.join("\n").length).toBeGreaterThan(0);
    expect(fetchCalls).toHaveLength(0);
    expect(existsSync(join(bdir, "borrow-result.json"))).toBe(false);
  });
});
