#!/usr/bin/env node
/**
 * image-to-3d.mjs — turn cut-out images into GLB models through fal's
 * queue, one resumable job file at a time.
 *
 * The job-file design ported here — `check` / `submit` / `collect` over a
 * single JSON plan that survives every interruption — comes from
 * `achimala/dream-loop` (MIT), `scripts/fal-batch.mjs`. See NOTICE.md.
 * Its transport is re-expressed through this repository's one fal client,
 * `_shared/scripts/fal-queue.mjs`: `loadFalKey` for the credential,
 * `falMediaUrl` for the payload, `toQueueUrl` for the endpoint,
 * `neverReached` for the one failure that is safe to retry, and
 * `downloadFalFile` for the artifact.
 *
 * Why a job file at all. A submission is paid and fal has no idempotency
 * key, so "did this job already leave?" cannot be answered by trying
 * again — it has to be answered by something on disk. This script writes
 * `state: "submitting"` and saves BEFORE the POST, keeps whatever the
 * queue hands back verbatim, and refuses to resubmit anything that has a
 * `request_id`, is `submitting`, or is `submission-uncertain`. A job that
 * left and lost its answer is reported, never repeated.
 *
 * The three commands:
 *
 *   check    offline, no key. Validates the plan and reports a per-job
 *            state. Never touches the file.
 *   submit   posts every ready job; skips images that have not landed yet,
 *            so it can be re-run as cut-outs appear.
 *   collect  one status / result / download pass. Re-run it; errors are
 *            staged (`result-error`, `download-error`) so a failed
 *            download never means "generate the model again".
 *
 * One deliberate difference from upstream: which submit failures are
 * retryable is decided by fal-queue's `neverReached`, not by a local code
 * list. That list is narrower — a connect timeout
 * (`UND_ERR_CONNECT_TIMEOUT`) now records `submission-uncertain` rather
 * than `not-submitted`. The cost is a manual reconcile on a failure that
 * probably created no job; the alternative cost is a second paid job.
 * One authority for "did the request reach fal" is worth the trade.
 *
 * Node 22+, no dependencies.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// Installed sessions keep shared scripts beside this CLI (the manifest lists
// `fal-queue.mjs` in `skill.sharedScripts`); a source checkout resolves the
// same module from `modes/_shared/scripts/`. Exported so a test can pin
// which copy it is exercising.
const installedShared = new URL("./fal-queue.mjs", import.meta.url);
export const FAL_QUEUE_URL = existsSync(installedShared)
  ? installedShared.href
  : new URL("../../../_shared/scripts/fal-queue.mjs", import.meta.url).href;

const { downloadFalFile, falMediaUrl, loadFalKey, neverReached, toQueueUrl } = await import(FAL_QUEUE_URL);

/** The only host this script will ever call for queue operations. */
const QUEUE_HOST = "queue.fal.run";

/** The two image-to-3D recipes this mode uses, and their exclusive inputs. */
const H3_ENDPOINT = "tripo3d/h3.1/image-to-3d";
const TRELLIS_ENDPOINT = "fal-ai/trellis";
const H3_ONLY_FIELDS = ["face_limit", "texture", "pbr"];
const TRELLIS_ONLY_FIELDS = ["mesh_simplify", "texture_size"];
const TRELLIS_TEXTURE_SIZES = [512, 1024, 2048];

/** Answers that mean fal refused the request itself — fix it and resubmit. */
const REJECTED_STATUSES = new Set([400, 401, 403, 404, 405, 422]);

/** Ceiling on one queue call. The download has its own idle clock. */
const REQUEST_TIMEOUT_MS = 60_000;

/** Messages that carry no payload and are safe to keep verbatim. */
const SAFE_MESSAGE = /^fal\.ai HTTP \d+$|^model download HTTP \d+$/;

const COMMANDS = ["check", "submit", "collect"];

const JOB_FILE_EXAMPLE = {
  jobs: [
    {
      id: "arch",
      endpoint: H3_ENDPOINT,
      image: "arch.png",
      output: "../scene/models/arch.glb",
      input: { texture: true, pbr: true, face_limit: 200000 },
    },
    {
      id: "rubble",
      endpoint: TRELLIS_ENDPOINT,
      image: "rubble.png",
      output: "../scene/models/rubble.glb",
      input: { mesh_simplify: 0.95, texture_size: 1024 },
    },
  ],
};

const HELP = `Usage: node image-to-3d.mjs check|submit|collect <jobs.json> [--concurrency 4]

  check    Offline. No API key, no network, no writes. Validates the plan
           and reports each job's state.
  submit   Posts every ready job to the fal queue and records its
           request_id. Images that have not landed yet are skipped, so run
           it again as cut-outs appear.
  collect  One status / result / download pass over the submitted jobs.
           Re-run it after doing other work.

Paths inside the job file are relative to the job file itself. The file is
always left resumable: a job that has reached fal is never sent twice, and
a failed download never regenerates an accepted model.

Recipes (checked against the model schemas on 2026-09-09):

  Architecture, characters, hero props
    endpoint  ${H3_ENDPOINT}
    input     {"texture": true, "pbr": true, "face_limit": 200000}

  Small props and set dressing
    endpoint  ${TRELLIS_ENDPOINT}            <- no /image-to-3d suffix
    input     {"mesh_simplify": 0.95, "texture_size": 1024}
              texture_size is 512, 1024 or 2048; mesh_simplify is above 0
              and at most 1.

The two models take different inputs. Do not copy one model's input
wholesale to the other. Never put image_url in input — this script builds
it from the local image.

Job file:
${JSON.stringify(JOB_FILE_EXAMPLE, null, 2)}`;

/**
 * Structural validation, run before any paid call. `inputChecks` is off for
 * `collect`: a job that fal already accepted must stay collectable through
 * its returned URLs even when its inputs turn out to have been wrong.
 */
function validatePlan(data, { inputChecks = true } = {}) {
  if (!data || typeof data !== "object") throw new Error("The job file must be a JSON object.");
  if (!Array.isArray(data.jobs) || !data.jobs.length) throw new Error("jobs must be a nonempty array.");
  const ids = new Set();
  for (const job of data.jobs) {
    if (!job || typeof job !== "object") throw new Error("Each job must be an object.");
    if (!job.id || typeof job.id !== "string" || ids.has(job.id)) throw new Error("Each job needs a unique id.");
    ids.add(job.id);
    if (typeof job.endpoint !== "string" || !/^[\w.-]+\/[\w./-]+$/.test(job.endpoint) || job.endpoint.includes("..")) {
      throw new Error(`Invalid endpoint: ${job.id}`);
    }
    if (typeof job.image !== "string" || !job.image || typeof job.output !== "string" || !job.output) {
      throw new Error(`Missing image/output: ${job.id}`);
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(job.image)) {
      throw new Error(`${job.id}: image must be a path relative to the job file, not a URL.`);
    }
    if (!inputChecks || job.request_id) continue;

    if (job.endpoint === `${TRELLIS_ENDPOINT}/image-to-3d`) {
      throw new Error(`${job.id}: single-image Trellis uses ${TRELLIS_ENDPOINT} (no /image-to-3d suffix).`);
    }
    const input = job.input ?? {};
    if (typeof input !== "object" || Array.isArray(input)) throw new Error(`${job.id}: input must be an object.`);
    if ("image_url" in input) throw new Error(`${job.id}: use the local image field; the helper supplies image_url.`);
    if (job.endpoint === TRELLIS_ENDPOINT) {
      for (const field of H3_ONLY_FIELDS) {
        if (field in input) throw new Error(`${job.id}: ${field} is an H3.1 option, not a Trellis option.`);
      }
      if ("texture_size" in input && !TRELLIS_TEXTURE_SIZES.includes(input.texture_size)) {
        throw new Error(`${job.id}: Trellis texture_size must be 512, 1024, or 2048.`);
      }
      if (
        "mesh_simplify" in input &&
        !(typeof input.mesh_simplify === "number" && input.mesh_simplify > 0 && input.mesh_simplify <= 1)
      ) {
        throw new Error(`${job.id}: mesh_simplify must be a number above 0 and at most 1.`);
      }
    }
    if (job.endpoint === H3_ENDPOINT) {
      for (const field of TRELLIS_ONLY_FIELDS) {
        if (field in input) throw new Error(`${job.id}: ${field} is a Trellis option, not an H3.1 option.`);
      }
      if ("face_limit" in input && !(Number.isInteger(input.face_limit) && input.face_limit > 0)) {
        throw new Error(`${job.id}: face_limit must be a positive integer.`);
      }
    }
  }
}

/**
 * The image's real type, read from its first bytes. The extension is a
 * claim; this is the evidence, and it is what keeps an empty or truncated
 * file out of a paid request.
 */
function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("Input must be a nonempty PNG, JPEG, or WebP.");
}

/**
 * One image as the request body wants it. `falMediaUrl` owns the data URI
 * and the size ceiling; the magic-byte check owns the truth about the
 * file's type, and the two have to agree — a `.png` holding a JPEG would
 * otherwise be announced to fal as something it is not.
 */
function imagePayload(file, label) {
  const actual = imageMime(readFileSync(file));
  const uri = falMediaUrl(file, { label });
  const declared = uri.slice("data:".length, uri.indexOf(";"));
  if (declared !== actual) {
    throw new Error(`${label}: the file is ${actual} but its name declares ${declared}; rename it so the two agree.`);
  }
  return uri;
}

/**
 * Text with everything that could carry a payload removed: the credential,
 * data URIs, URLs, and any long opaque blob. Everything recorded in the job
 * file or printed passes through here, because a 422 about an image arrives
 * with the image in it.
 */
function redact(value, key) {
  let text = String(value);
  // An empty key would split on every character; only a real one is masked.
  if (key) text = text.split(key).join("[redacted]");
  return text
    .replace(/data:[^\s"']+/gi, "[image redacted]")
    .replace(/https?:\/\/[^\s"']+/gi, "[URL redacted]")
    .replace(/[A-Za-z0-9+/_=-]{80,}/g, "[payload redacted]")
    .slice(0, 400);
}

/**
 * The human-readable part of a fal error body: the validation messages and
 * the fields they name, and nothing else. An echoed input is never kept.
 */
function errorDetail(body, key) {
  const clean = (value) => redact(value, key);
  const detail = body?.detail;
  if (Array.isArray(detail)) {
    return detail
      .slice(0, 5)
      .map((item) => {
        const loc = Array.isArray(item?.loc) ? item.loc.map(clean).join(".").slice(0, 160) : "";
        return [loc, clean(item?.msg || item?.type || "Validation failed")].filter(Boolean).join(": ");
      })
      .join("; ");
  }
  for (const value of [detail, body?.message, body?.error]) if (typeof value === "string") return clean(value);
  return undefined;
}

/** The recorded `error`: our own wording verbatim, anything else sanitized. */
function safeMessage(message, key) {
  const text = String(message ?? "");
  if (SAFE_MESSAGE.test(text)) return text;
  return redact(text, key) || "Request failed.";
}

/**
 * The first transport-level code in the cause chain, for diagnosis only —
 * whether a retry is safe is `neverReached`'s call, not this one's.
 * `DOMException.code` is a number, hence the string test.
 */
function connectionCode(error) {
  for (let e = error, depth = 0; e && depth < 5; depth++, e = e.cause) {
    if (typeof e.code === "string") return e.code;
    const nested = Array.isArray(e.errors) ? e.errors : [];
    const inner = nested.find((item) => typeof item?.code === "string");
    if (inner) return inner.code;
  }
  return undefined;
}

/** A complete GLB 2.0: magic, version, and a declared length that matches. */
function assertCompleteGlb(bytes) {
  if (
    bytes.length < 20 ||
    bytes.toString("ascii", 0, 4) !== "glTF" ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  ) {
    throw new Error("Output is not a complete GLB 2.0 file.");
  }
}

function clearError(job) {
  delete job.error;
  delete job.error_detail;
  delete job.error_stage;
  delete job.connection_error;
}

/** The compact row this script reports, in a stable field order. */
function compactRow(job) {
  const { id, state, request_id, bytes, error, error_stage, error_detail, connection_error } = job;
  return { id, state, request_id, bytes, error, error_stage, error_detail, connection_error };
}

function readPlan(absolute) {
  let text;
  try {
    text = readFileSync(absolute, "utf8");
  } catch (error) {
    throw new Error(`Cannot read the job file ${absolute}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`The job file is not valid JSON: ${error.message}`);
  }
}

/**
 * Run one command over one job file.
 *
 * @param {"check"|"submit"|"collect"} command
 * @param {string} filename                Path to the job file.
 * @param {object} [options]
 * @param {number} [options.concurrency]   Independent jobs in flight (default 4).
 * @param {typeof fetch} [options.fetchFn] Injected for tests; nothing else reaches the network.
 * @param {string} [options.key]           fal API key; discovered through `loadFalKey` when omitted.
 * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [options.sleep]
 *        Back-off between download attempts; injected so a test does not spend it.
 * @returns {Promise<Array<object>>} One compact row per job.
 */
export async function runBatch(command, filename, { concurrency = 4, fetchFn = fetch, key, sleep } = {}) {
  if (!COMMANDS.includes(command)) throw new Error("Use check, submit or collect.");
  if (typeof filename !== "string" || !filename) throw new Error("A job file path is required.");
  const absolute = resolve(filename);
  const base = dirname(absolute);

  if (command === "check") {
    const data = readPlan(absolute);
    validatePlan(data);
    return data.jobs.map((job) => {
      const checked = (state, error) => ({ id: job.id, state, request_id: job.request_id, error });
      const file = resolve(base, job.image);
      try {
        if (!job.request_id && (job.status_url || job.response_url || job.cancel_url)) {
          return checked("missing-request-id", "Recover the original request_id before proceeding.");
        }
        if (job.state === "submitting" || job.state === "submission-uncertain") return checked(job.state);
        if (!existsSync(file)) return checked("waiting-for-image");
        // Exactly what `submit` would build, so a file that cannot become a
        // payload is found here rather than one command later.
        imagePayload(file, job.id);
        return checked(job.request_id ? "already-submitted" : "ready");
      } catch (error) {
        return checked("invalid-image", error.message);
      }
    });
  }

  const apiKey = key ?? loadFalKey() ?? process.env.FAL_API_KEY;
  if (!apiKey) throw new Error("Set FAL_KEY or FAL_API_KEY in the environment.");

  // One writer per job file. Two overlapping runs would each hold a stale
  // copy of the plan and the later save would erase the other's request ids.
  const lockPath = `${absolute}.lock`;
  let fd;
  try {
    fd = openSync(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `${lockPath} exists — another run is using this job file. Wait for it to finish; delete the lock only if you are sure no run is active.`,
      );
    }
    throw error;
  }

  try {
    writeSync(fd, `${JSON.stringify({ pid: process.pid, command, at: new Date().toISOString() })}\n`);
    const data = readPlan(absolute);
    validatePlan(data, { inputChecks: command !== "collect" });

    const save = () => {
      writeFileSync(`${absolute}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
      renameSync(`${absolute}.tmp`, absolute);
    };

    /** One queue call. Nothing but `https://queue.fal.run` is ever called here. */
    const request = async (url, payload) => {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== QUEUE_HOST || parsed.username || parsed.password) {
        throw new Error("Unexpected fal queue URL.");
      }
      const response = await fetchFn(url, {
        method: payload ? "POST" : "GET",
        redirect: "error",
        headers: { Authorization: `Key ${apiKey}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const error = new Error(`fal.ai HTTP ${response.status}`);
        error.status = response.status;
        try {
          error.detail = errorDetail(await response.json(), apiKey);
        } catch {
          // An HTML error page or a truncated body carries nothing worth
          // keeping, and everything worth leaking.
        }
        throw error;
      }
      return response.json();
    };

    const work = async (job) => {
      let stage = command;
      try {
        if (command === "submit") {
          // A paid submission is never automatically repeated.
          if (job.request_id || job.state === "submitting" || job.state === "submission-uncertain") return;
          if (job.status_url || job.response_url || job.cancel_url) {
            throw new Error("Existing queue URLs have no request_id. Recover the original record; do not submit it again.");
          }
          const imagePath = resolve(base, job.image);
          if (!existsSync(imagePath)) {
            job.state = "waiting-for-image";
            save();
            return;
          }
          const imageUrl = imagePayload(imagePath, job.id);

          // On disk before the POST: if this process dies mid-request, the
          // next run sees `submitting` and refuses to pay twice.
          job.state = "submitting";
          job.submitted_at = new Date().toISOString();
          clearError(job);
          save();

          const result = await request(toQueueUrl(`https://fal.run/${job.endpoint}`), {
            ...job.input,
            image_url: imageUrl,
          });
          // Whatever came back is kept verbatim, and kept first: an
          // incomplete envelope still identifies a job we must not repeat.
          for (const field of ["request_id", "status_url", "response_url", "cancel_url"]) {
            if (result[field]) job[field] = result[field];
          }
          save();
          if (!result.request_id || !result.status_url || !result.response_url) {
            throw new Error("Submission omitted its request id or queue URLs.");
          }
          job.state = result.status || "IN_QUEUE";
        } else {
          if (!job.request_id || job.state === "downloaded") return;
          if (!job.status_url || !job.response_url) {
            throw new Error("This job has a request id but no queue URLs. Recover the original record before collecting it.");
          }
          stage = "status";
          const status = await request(job.status_url);
          if (typeof status.status !== "string") throw new Error("Status response carried no status.");
          job.state = status.status;
          job.checked_at = new Date().toISOString();
          clearError(job);
          save();
          if (status.status !== "COMPLETED") return;

          stage = "result";
          const result = await request(job.response_url);
          const file = result.model_urls?.glb || result.model_mesh;
          if (!file?.url) throw new Error("Completed result has no model file URL.");
          const target = new URL(file.url);
          if (target.protocol !== "https:" || target.username || target.password) {
            throw new Error("Unexpected model download URL.");
          }

          stage = "download";
          // The artifact host is not fal's queue: it gets no credential.
          // `downloadFalFile` gives a slow CDN an idle clock rather than a
          // wall clock, and retries a failed attempt — a download costs
          // nothing, unlike the generation it is fetching.
          let bytes;
          try {
            bytes = await downloadFalFile(file.url, { fetchImpl: fetchFn, ...(sleep ? { sleep } : {}) });
          } catch (error) {
            const message = String(error?.message ?? error);
            throw new Error(
              /^HTTP \d+$/.test(message) ? `model download ${message}` : `model download failed: ${message}`,
              { cause: error },
            );
          }
          assertCompleteGlb(bytes);
          const output = resolve(base, job.output);
          mkdirSync(dirname(output), { recursive: true });
          const part = `${output}.part`;
          try {
            writeFileSync(part, bytes);
            renameSync(part, output);
          } catch (error) {
            rmSync(part, { force: true });
            throw error;
          }
          Object.assign(job, { state: "downloaded", bytes: bytes.length, downloaded_at: new Date().toISOString() });
        }
      } catch (error) {
        const code = connectionCode(error);
        if (job.state === "submitting") {
          // Only a connection that never opened proves no job exists.
          job.state = neverReached(error)
            ? "not-submitted"
            : REJECTED_STATUSES.has(error.status)
              ? "rejected"
              : "submission-uncertain";
        }
        if (stage === "result" || stage === "download") job.state = `${stage}-error`;
        job.error_stage = stage;
        if (error.detail) job.error_detail = error.detail;
        if (code) job.connection_error = code;
        job.error = safeMessage(error.message, apiKey);
      }
      save();
    };

    const pending = [...data.jobs];
    const workers = Math.max(1, Math.min(Math.floor(Number(concurrency)) || 1, pending.length));
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (pending.length) await work(pending.shift());
      }),
    );
    return data.jobs.map(compactRow);
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fail = (message) => {
    console.error(`${message}\n\n${HELP}`);
    process.exitCode = 1;
  };
  let parsed = null;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: { concurrency: { type: "string" }, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
    });
  } catch (error) {
    fail(error.message);
  }

  if (parsed) {
    const { values, positionals } = parsed;
    const [command, file] = positionals;
    const concurrency = values.concurrency === undefined ? 4 : Number(values.concurrency);

    if (values.help) {
      console.log(HELP);
    } else if (!command || !file) {
      fail(!command ? "A command is required: check, submit or collect." : "A job file path is required.");
    } else if (!Number.isInteger(concurrency) || concurrency < 1) {
      fail("--concurrency must be a positive integer.");
    } else {
      try {
        const rows = await runBatch(command, file, { concurrency });
        console.log(JSON.stringify(rows, null, 2));
        if (rows.some((row) => row.error)) process.exitCode = 1;
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    }
  }
}
