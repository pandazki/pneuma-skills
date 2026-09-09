/**
 * fal.ai queue runner — the one asynchronous submission path for every
 * fal-backed shared script.
 *
 * A synchronous `POST https://fal.run/<app>` holds the socket open for the
 * whole inference. That is fine for a one-second image and wrong for a
 * video: any hiccup between here and the GPU costs the whole render, a
 * caller that dies leaks a paid job that keeps running, and nothing can be
 * observed while it runs. `https://queue.fal.run/<app>` answers immediately
 * with a `request_id` plus the URLs for its status, its result and its
 * cancellation — so this module submits, polls, downloads the result, and
 * (this is the part a synchronous call cannot do) PUTs `cancel_url` the
 * moment the caller's `AbortSignal` fires.
 *
 * Everything a test needs is injectable: `fetchImpl`, `retryDelaysMs` and
 * `sleep`. Nothing else in here reaches for a global.
 *
 *   import { runFalJob } from "./fal-queue.mjs";
 *   const { data, apiMs, inferenceSeconds, requestId, attempts } =
 *     await runFalJob({ url, body, key, signal });
 *
 * Failure modes, all reported and distinguishable:
 *   - a transient submit gets three attempts with a 6s then 15s back-off,
 *     each announced through `onRetry` — but only when the failure proves
 *     no job was created (an HTTP 408/425/429/5xx answer, or a connection
 *     that never opened). fal has no idempotency key, so a request that
 *     left and lost its answer (a timeout, a reset) is NOT sent again: it
 *     may already be a paid job, and the error says so. A 4xx is the
 *     request's own fault and is thrown at once;
 *   - a transient status poll is retried in place, three consecutive
 *     failures at most — then the job is cancelled remotely and the
 *     failure thrown;
 *   - `FAILED` throws with the upstream message; `deadlineMs` cancels the
 *     job remotely and throws with the label; an aborted signal rejects
 *     with a real AbortError (`name` === "AbortError") *after* the remote
 *     cancel has been sent. Nothing that this module gives up on keeps
 *     running upstream.
 *
 * Alongside the runner live the three things every fal-backed script needs
 * around it and must not each invent: the key (`loadFalKey`), the way a
 * local file becomes a payload (`falMediaUrl`), and the way a finished
 * job's artifact comes back (`downloadFalFile`).
 *
 * Node 22+, no dependencies.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Worth another attempt: gateway hiccups, throttling, request timeouts. */
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Error codes that prove the request never reached fal (Node's undici and
 * Bun spellings): the socket was refused, the name did not resolve, the
 * network is unreachable. Anything else that a `fetch` throws — a
 * timeout, a reset, a broken pipe — happened after the request may have
 * left, and a job may exist for it.
 */
const NEVER_REACHED_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ConnectionRefused",
  "FailedToOpenSocket",
  "DNSError",
]);

/** Whether a thrown submit proves the request never became a job. */
export function neverReached(error) {
  let e = error;
  for (let depth = 0; e && depth < 5; depth++) {
    if (NEVER_REACHED_CODES.has(e.code)) return true;
    const nested = Array.isArray(e.errors) ? e.errors : [];
    if (nested.some((inner) => NEVER_REACHED_CODES.has(inner?.code))) return true;
    e = e.cause;
  }
  return false;
}

/** Back-off between submit attempts — three attempts, two waits. */
const SUBMIT_RETRY_DELAYS_MS = [6000, 15000];

/** Consecutive transient poll failures ridden out before giving up. */
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

/** Ceiling on any single HTTP call, so a hung socket cannot outlive it. */
const REQUEST_TIMEOUT_MS = 30_000;

/** How long the best-effort remote cancel may take before we reject anyway. */
const CANCEL_TIMEOUT_MS = 5_000;

/**
 * The queue endpoint for a synchronous fal URL:
 * `https://fal.run/<app>` → `https://queue.fal.run/<app>`.
 *
 * Only fal's synchronous host is rewritten. A URL already naming the queue
 * host — or any other host, such as a local test double — is returned as
 * it came, so this is idempotent and safe to apply more than once. The
 * trailing slash goes because request URLs are derived from this one.
 */
export function toQueueUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`fal endpoint is not a valid URL: ${url}`);
  }
  if (parsed.hostname === "fal.run") parsed.hostname = "queue.fal.run";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

/** `?logs=0` on the status URL — we poll for state, never for log lines. */
function statusUrlWithoutLogs(statusUrl) {
  const parsed = new URL(statusUrl);
  if (!parsed.searchParams.has("logs")) parsed.searchParams.set("logs", "0");
  return parsed.toString();
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * An abort rejection whose `name` is "AbortError", whatever the caller
 * aborted with — a queue that aborts with its own DOMException keeps it,
 * a caller that aborts with a bare string still gets a real error.
 */
function abortErrorFor(signal, label) {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  const error = new DOMException(`${label} was cancelled`, "AbortError");
  if (reason !== undefined) error.cause = reason;
  return error;
}

function throwIfAborted(signal, label) {
  if (signal?.aborted) throw abortErrorFor(signal, label);
}

/** A timer that loses the race against `signal`, rejecting when it fires. */
export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortErrorFor(signal, "sleep"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortErrorFor(signal, "sleep"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The caller's signal, plus a ceiling, for one HTTP call. */
function requestSignal(signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * POST the job onto the queue, retrying a transient failure.
 * Returns the queue envelope and the number of attempts it took.
 */
async function submitJob(context) {
  const { queueUrl, body, headers, signal, fetchImpl, retryDelaysMs, sleep, onRetry, label, assertDeadline } = context;
  const payload = JSON.stringify(body ?? {});
  const totalAttempts = retryDelaysMs.length + 1;
  let lastFailure = "";
  let attempts = 0;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    throwIfAborted(signal, label);
    assertDeadline();
    attempts = attempt + 1;

    let response = null;
    try {
      response = await fetchImpl(queueUrl, {
        method: "POST",
        headers,
        body: payload,
        signal: requestSignal(signal),
      });
    } catch (error) {
      throwIfAborted(signal, label);
      if (!neverReached(error)) {
        // The request may have been accepted upstream. Sending it again
        // could start a second paid job for the same shot — fal has no
        // idempotency key — so this is reported, never retried.
        throw new Error(
          `fal.ai submit lost its answer (${errorMessage(error)}) — not sent again, because the job may already have been accepted upstream${attempts > 1 ? ` (attempt ${attempts})` : ""}`,
        );
      }
      lastFailure = `request failed: ${errorMessage(error)}`;
    }

    if (response) {
      if (response.ok) {
        let queued;
        try {
          queued = await response.json();
        } catch (error) {
          throw new Error(`fal.ai queue response was not JSON: ${errorMessage(error)}`);
        }
        return { queued, attempts };
      }
      const text = await response.text().catch(() => "");
      lastFailure = `fal.ai returned HTTP ${response.status}: ${text.slice(0, 500)}`;
      // A 4xx is this request's own fault — retrying it just costs time.
      if (!RETRY_STATUSES.has(response.status)) throw new Error(lastFailure);
    }

    if (attempt < retryDelaysMs.length) {
      const delayMs = retryDelaysMs[attempt];
      onRetry?.({ attempt: attempts, attempts: totalAttempts, delayMs, reason: lastFailure });
      await sleep(delayMs, signal);
    }
  }

  throw new Error(`${lastFailure} (after ${attempts} attempts)`);
}

/**
 * Run one fal.ai job through the queue and return its result.
 *
 * @param {object} options
 * @param {string} options.url          Synchronous endpoint, e.g. `https://fal.run/minimax/h3-max/image-to-video`.
 * @param {unknown} options.body        Request body, serialized as JSON.
 * @param {string} options.key          fal API key (`Authorization: Key <key>`).
 * @param {AbortSignal} [options.signal] Aborting cancels the job remotely.
 * @param {number} [options.deadlineMs] Wall clock for the whole job (default 10 min); the job is cancelled remotely when it passes.
 * @param {number} [options.pollMs]     Gap between status polls (default 900 ms).
 * @param {string} [options.label]      Names the job in deadline/cancel messages.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(update: { status: string, queue_position?: number }) => void} [options.onStatus]
 *        Called when — and only when — the queue state changes.
 * @param {(info: { attempt: number, attempts: number, delayMs: number, reason: string }) => void} [options.onRetry]
 *        Called before each submit back-off, so no transient failure is silent.
 * @param {number[]} [options.retryDelaysMs]
 * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [options.sleep]
 * @returns {Promise<{ data: any, apiMs: number, inferenceSeconds?: number, requestId?: string, attempts: number }>}
 */
export async function runFalJob({
  url,
  body,
  key,
  signal,
  deadlineMs = 10 * 60_000,
  pollMs = 900,
  label = "fal job",
  fetchImpl = fetch,
  onStatus,
  onRetry,
  retryDelaysMs = SUBMIT_RETRY_DELAYS_MS,
  sleep = abortableSleep,
}) {
  if (!url) throw new Error("runFalJob needs a url");
  if (!key) throw new Error("runFalJob needs a fal API key");

  const startedAt = Date.now();
  const deadlineAt = startedAt + deadlineMs;
  const assertDeadline = () => {
    if (Date.now() >= deadlineAt) {
      throw new Error(`${label} exceeded ${Math.round(deadlineMs / 1000)}s`);
    }
  };

  throwIfAborted(signal, label);

  const queueUrl = toQueueUrl(url);
  const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };

  const { queued, attempts } = await submitJob({
    queueUrl,
    body,
    headers,
    signal,
    fetchImpl,
    retryDelaysMs,
    sleep,
    onRetry,
    label,
    assertDeadline,
  });

  // The URLs fal hands back are used verbatim; the documented shape is only
  // a fallback for an envelope that omits them, and it needs the id.
  const requestId = typeof queued?.request_id === "string" ? queued.request_id : undefined;
  const requestBase = requestId ? `${queueUrl}/requests/${requestId}` : null;
  const statusUrl = queued?.status_url ?? (requestBase ? `${requestBase}/status` : null);
  const responseUrl = queued?.response_url ?? requestBase;
  const cancelUrl = queued?.cancel_url ?? (requestBase ? `${requestBase}/cancel` : null);
  if (!statusUrl || !responseUrl) {
    throw new Error(
      `fal.ai queue response carried no request_id or usable URLs: ${JSON.stringify(queued ?? null).slice(0, 300)}`,
    );
  }
  const pollUrl = statusUrlWithoutLogs(statusUrl);

  // Best effort, fired the instant the signal aborts — but awaited before we
  // reject, so a caller that exits on AbortError cannot outrun the cancel and
  // leave a paid job running.
  let cancelSent = null;
  const cancelRemote = () => {
    if (cancelSent || !cancelUrl) return;
    cancelSent = fetchImpl(cancelUrl, {
      method: "PUT",
      headers,
      signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
    }).then(
      () => undefined,
      () => undefined,
    );
  };
  signal?.addEventListener("abort", cancelRemote, { once: true });

  let metricsInferenceSeconds;
  let lastAnnounced = "";
  let consecutiveFailures = 0;
  // Once fal has reported COMPLETED or FAILED there is nothing left to
  // cancel; before that, any way out of the loop below leaves a running
  // job unless it is told to stop.
  let terminal = false;

  try {
    for (;;) {
      throwIfAborted(signal, label);
      assertDeadline();

      let payload = null;
      let failure = "";
      try {
        const response = await fetchImpl(pollUrl, { headers, signal: requestSignal(signal) });
        if (response.ok) {
          payload = await response.json();
        } else {
          failure = `fal.ai status HTTP ${response.status}`;
          // Not transient: the request, the key or the id is wrong.
          if (!RETRY_STATUSES.has(response.status)) throw new Error(failure);
        }
      } catch (error) {
        throwIfAborted(signal, label);
        if (!failure) failure = `fal.ai status request failed: ${errorMessage(error)}`;
        else throw error;
      }

      if (payload === null) {
        consecutiveFailures += 1;
        if (consecutiveFailures > MAX_CONSECUTIVE_POLL_FAILURES) {
          throw new Error(`${failure} (${consecutiveFailures} consecutive status failures)`);
        }
        await sleep(Math.min(pollMs, Math.max(0, deadlineAt - Date.now())), signal);
        continue;
      }
      consecutiveFailures = 0;

      const inferenceTime = payload?.metrics?.inference_time;
      if (typeof inferenceTime === "number") metricsInferenceSeconds = inferenceTime;

      const status = payload?.status;
      if (status === "COMPLETED") {
        terminal = true;
        break;
      }
      if (status === "FAILED") {
        terminal = true;
        const detail =
          typeof payload?.error === "string"
            ? payload.error
            : payload?.error
              ? JSON.stringify(payload.error).slice(0, 500)
              : "";
        throw new Error(detail || `${label} failed`);
      }

      // IN_QUEUE / IN_PROGRESS — and anything unknown, which the deadline
      // bounds rather than this loop guessing at it.
      const announced = `${status}:${payload?.queue_position ?? ""}`;
      if (announced !== lastAnnounced) {
        lastAnnounced = announced;
        try {
          onStatus?.({ status, queue_position: payload?.queue_position });
        } catch (error) {
          // An observer must not be able to kill a paid job — but it must
          // not fail quietly either.
          console.error(`WARN: ${label} status observer threw: ${errorMessage(error)}`);
        }
      }

      await sleep(Math.min(pollMs, Math.max(0, deadlineAt - Date.now())), signal);
    }

    const response = await fetchImpl(responseUrl, { headers, signal: requestSignal(signal) });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`fal.ai result HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const data = await response.json();
    const fromData = data?.timings?.inference;
    const inferenceSeconds = typeof fromData === "number" ? fromData : metricsInferenceSeconds;
    return { data, apiMs: Date.now() - startedAt, inferenceSeconds, requestId, attempts };
  } catch (error) {
    if (signal?.aborted) {
      cancelRemote();
      await cancelSent;
      throw abortErrorFor(signal, label);
    }
    // A deadline, a poll that kept failing, a status the key cannot read:
    // the job is still running upstream and would be paid for in full.
    // It is cancelled before the failure is reported.
    if (!terminal) {
      cancelRemote();
      await cancelSent;
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelRemote);
  }
}

// ---------------------------------------------------------------------------
// The three things every fal-backed script needs around the runner.
// ---------------------------------------------------------------------------

/**
 * `FAL_KEY` from the environment first, then from a `.env` discovered the
 * way every sibling shared script discovers one: the skill root (the parent
 * of `scripts/`), then walking up from cwd. Parsed, never sourced — that
 * file lives in a workspace. Returns null when there is no key; the value
 * is never printed and never becomes an argv.
 */
export function loadFalKey(env = process.env) {
  if (env.FAL_KEY) return env.FAL_KEY;

  const candidates = [join(dirname(__dirname), ".env")];
  for (let dir = process.cwd(); ; ) {
    candidates.push(join(dir, ".env"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf-8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1 || line.slice(0, eq).trim() !== "FAL_KEY") continue;
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  }
  return null;
}

/** Extensions fal payloads carry, and how they are spelled as a MIME type. */
const MEDIA_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
};

/** What a single data URI may carry. Bigger inputs have to be hosted. */
export const MAX_DATA_URI_BYTES = 30 * 1024 * 1024;

/** Past this a data URI still works but is slow enough to say so. */
const DATA_URI_NOTE_BYTES = 8 * 1024 * 1024;

/**
 * One media input as fal wants it: an `http(s)` or `data:` URL passes
 * through untouched, a local file is inlined as a base64 data URI. The size
 * is checked from the directory entry — a file too big to inline is refused
 * here rather than timing out inside a paid request.
 *
 * Throws (never exits) so the caller owns how a failure is reported.
 */
export function falMediaUrl(input, { label = "input", maxBytes = MAX_DATA_URI_BYTES, onNote = (m) => console.error(m) } = {}) {
  if (typeof input !== "string" || !input.trim()) throw new Error(`${label}: a path or URL is required`);
  if (/^(https?:|data:)/.test(input)) return input;
  if (!existsSync(input)) throw new Error(`${label}: file not found: ${input}`);
  const { size } = statSync(input);
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (size > maxBytes) {
    throw new Error(`${label}: ${input} is ${mb(size)} — too large to inline as a data URI (limit ${mb(maxBytes)}). Host it and pass a URL.`);
  }
  if (size > DATA_URI_NOTE_BYTES) onNote(`NOTE: ${input} is ${mb(size)} — inlining it makes the request slow; hosting it and passing a URL is faster`);
  const mime = MEDIA_MIME[extname(input).toLowerCase()];
  if (!mime) throw new Error(`${label}: unsupported file extension: ${input}`);
  return `data:${mime};base64,${readFileSync(input).toString("base64")}`;
}

/** Attempts and idle ceiling for one artifact download. */
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_IDLE_MS = 60_000;

/**
 * Download a finished job's artifact into memory.
 *
 * The clock here is an IDLE clock, not a wall clock: fal's CDN has been
 * measured at 6 KB/s for half an hour, and a slow link that keeps
 * delivering must be allowed to finish — only a stream that stops moving
 * for a minute is given up on. A failed attempt is retried with a short
 * back-off; the caller's `signal` aborts immediately and is rethrown as is.
 */
export async function downloadFalFile(url, {
  signal,
  attempts = DOWNLOAD_ATTEMPTS,
  idleMs = DOWNLOAD_IDLE_MS,
  fetchImpl = fetch,
  onNote = (m) => console.error(m),
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const idle = new AbortController();
    let idleTimer = null;
    const touch = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => idle.abort(), idleMs);
    };
    const started = Date.now();
    try {
      touch();
      const response = await fetchImpl(url, {
        signal: signal ? AbortSignal.any([signal, idle.signal]) : idle.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error("response carried no body");
      const chunks = [];
      let received = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        touch();
      }
      const seconds = (Date.now() - started) / 1000;
      if (seconds > 30) {
        onNote(`NOTE: downloaded in ${seconds.toFixed(0)}s (${(received / 1024 / 1024).toFixed(1)} MB, ${(received / 1024 / seconds).toFixed(0)} KB/s)`);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = idle.signal.aborted ? new Error(`no bytes for ${Math.round(idleMs / 1000)}s`) : error;
      if (attempt < attempts) {
        onNote(`WARN: download failed (${errorMessage(lastError)}) — retrying (attempt ${attempt} of ${attempts})`);
        await abortableSleep(3000 * attempt, signal);
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  }
  throw lastError ?? new Error("download failed");
}
