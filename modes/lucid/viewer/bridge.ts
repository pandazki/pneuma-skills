/**
 * The PARENT side of the scene bridge.
 *
 * The live frame is read through the scene, never guessed. `scene/index.html`
 * includes `lucid-bridge.js` (the script copies it in on `init`), which
 * answers two requests from this window and volunteers three announcements:
 *
 *   parent → scene   { type: "pneuma:lucid:capture", id }
 *                 ←  { type: "pneuma:lucid:capture:result", id, ok,
 *                      dataUrl?, width?, height?, registered?, error? }
 *   parent → scene   { type: "pneuma:lucid:state", id }
 *                 ←  { type: "pneuma:lucid:state:result", id, state }
 *   any unknown pneuma:lucid:* request
 *                 ←  { type: "pneuma:lucid:unsupported", id, requestType,
 *                      bridgeVersion }
 *   scene  → parent  { type: "pneuma:lucid:hello", bridgeVersion }
 *                    { type: "pneuma:lucid:ready" }
 *                    { type: "pneuma:lucid:error", message }
 *                    { type: "pneuma:lucid:note", name }
 *
 * A `note` announces that the scene recorded a named diagnostic; the VALUE
 * lives in the state reply's `notes` object. It is a separate channel from
 * `error` on purpose — a scene reporting a passing self-check through
 * `errors[]` makes the status strip warn about good news.
 *
 * Two invariants this file exists to hold:
 *
 *  1. **A request that is not answered resolves, it does not hang.** Every
 *     request carries its own id and its own 3 s timer; a scene that threw
 *     during module evaluation never calls back, and `capture` would
 *     otherwise leave the agent waiting on a promise forever. A timeout
 *     resolves `null` — "the scene did not answer" — which is a different
 *     fact from "the scene answered that it cannot".
 *  2. **A reload invalidates every request in flight.** The answer would
 *     describe the page that is being torn down. `abort()` settles them all
 *     as `null` before the new document loads.
 *
 * Everything here is pure message plumbing: no DOM, no React. The component
 * owns the window listener, the `event.source === iframe.contentWindow`
 * check, and the "no hello within 3 s means there is no bridge" verdict.
 */

/** How long a request waits before it is reported as unanswered. */
export const BRIDGE_TIMEOUT_MS = 3000;

/** How often `capture` re-asks whether the scene has become ready. */
export const CAPTURE_READY_POLL_MS = 250;

/**
 * How long `capture` waits for a ready scene before shooting anyway.
 *
 * Measured in the blind trial (2026-09-16): right after a reload the bridge
 * reports `registered: false` for a few hundred milliseconds while the
 * scene's module graph is still evaluating, and a capture taken in that
 * window is a picture of nothing that the judge then scores. Four seconds
 * covers a normal module-evaluation-plus-first-frames start without making a
 * genuinely broken scene cost the agent a whole minute.
 */
export const CAPTURE_READY_TIMEOUT_MS = 4000;

/** Prefix every message on this channel shares. */
export const LUCID_MESSAGE_PREFIX = "pneuma:lucid:";

export interface SceneViewport {
  width: number;
  height: number;
  pixelRatio: number;
}

/** Exactly what `pneuma:lucid:state:result` carries. */
export interface SceneState {
  /** Integer protocol version (`1` today); null when the scene omitted it. */
  bridgeVersion: number | null;
  registered: boolean;
  ready: boolean;
  loading: boolean;
  fps: number | null;
  /**
   * The bridge's own `requestAnimationFrame` cadence, which is NOT proof that
   * the scene drew anything — it is scheduling, reported separately so a
   * number that only means "the tab is animating something" cannot be read as
   * a render rate. `fpsSource` names what produced `fps`.
   */
  rafFps: number | null;
  fpsSource: string | null;
  frameMs: number | null;
  framesRendered: number | null;
  /**
   * `renderer.render` calls per DISPLAYED frame, averaged: 1 for a
   * single-pass scene, 2 for one that draws a reflection into a target
   * first. Null while nothing is registered — there is no render to divide.
   *
   * It exists because `fps` counts displayed frames, not render calls: a
   * scene drawing two passes per animation frame would otherwise report 60
   * fps to a user watching 30. This is the number that says where the extra
   * work went instead of hiding it.
   */
  passesPerFrame: number | null;
  /**
   * Which channel each distinct error came from — `window` (a script threw),
   * `unhandledrejection`, `console` (every console.error plus `THREE.`
   * warnings) and `shader` (renderer.debug.onShaderError). A failed shader
   * is not an error event: three.js only prints it, so without the console
   * and shader channels a black material reads as "no errors".
   */
  errorSources: { window: number; unhandledrejection: number; console: number; shader: number } | null;
  drawCalls: number | null;
  triangles: number | null;
  textures: number | null;
  geometries: number | null;
  /**
   * The bridge caps this at 20 distinct entries and appends a
   * `"+N more distinct errors (suppressed)"` line, so the array is a sample
   * with a stated remainder rather than the whole history — display it,
   * never count it as "the number of things wrong".
   */
  errors: string[];
  /**
   * The scene's named diagnostics — a self-check's result, a measured frame
   * count, whatever the scene chose to record. Structured, and deliberately
   * NOT `errors[]`: the blind trial had to smuggle a passing integration
   * check through the error channel to get it back out of the iframe, which
   * made the status strip warn about a success.
   */
  notes: Record<string, unknown>;
  viewport: SceneViewport | null;
}

/** What the scene said about itself just before a frame was captured. */
export interface SceneReadiness {
  ready: boolean;
  registered: boolean;
  /** How long `capture` spent waiting for that answer. */
  waitedMs: number;
}

/**
 * Where the pixels `capture` handed back came from.
 *
 * `live` is a frame drawn by the scene through the bridge. `round` and
 * `target` are recorded PNGs returned verbatim because that still was on the
 * stage — real images, but pictures of an earlier round or of the dream, not
 * evidence about the scene as it is now.
 */
export type CaptureSource = "live" | "round" | "target";

/**
 * The provenance of the last frame this viewer handed to `capture`, as
 * `get-scene-state` reports it under `lastCapture`.
 *
 * Two facts, and the agent needs both before it spends a verdict:
 *
 *  - `source` — WHAT came back. A `round` or `target` still is not a new
 *    capture, and a judge scoring the target against itself is a wasted
 *    round. The skill navigates to `view: "live"` before a judged capture;
 *    this field is how the agent confirms that it worked.
 *  - `ready` — whether that frame may be judged. False for every still (a
 *    still is not the current scene) and false for a live frame shot before
 *    the scene said it was ready, which may show a half-built scene.
 *
 * `registered` and `waitedMs` describe the live shot. A still never asked the
 * bridge anything, so they are null rather than a fabricated `false`/`0` that
 * would read as "the scene lost its renderer".
 */
export interface CaptureRecord {
  /** ISO timestamp of the moment the frame was requested. */
  at: string;
  source: CaptureSource;
  /** Which round's recorded PNG came back; only for `source: "round"`. */
  round?: number;
  ready: boolean;
  registered: boolean | null;
  waitedMs: number | null;
}

export type InboundMessage =
  | { kind: "hello"; bridgeVersion: number | null }
  | { kind: "ready" }
  | { kind: "error"; message: string }
  /** A named diagnostic was recorded; its value is in the next state reply. */
  | { kind: "note"; name: string }
  | {
      kind: "capture:result";
      id: string;
      ok: boolean;
      dataUrl: string | null;
      width: number | null;
      height: number | null;
      registered: boolean | null;
      error: string | null;
    }
  | { kind: "state:result"; id: string; state: SceneState }
  /** The bridge answered that it does not know this request type. A named
   *  refusal, not silence — an unanswered request looks like a hung scene. */
  | {
      kind: "unsupported";
      id: string;
      requestType: string;
      bridgeVersion: number | null;
    };

export type CaptureReply = Extract<InboundMessage, { kind: "capture:result" }>;
export type StateReply = Extract<InboundMessage, { kind: "state:result" }>;
export type UnsupportedReply = Extract<InboundMessage, { kind: "unsupported" }>;

export type BridgeRequestKind = "capture" | "state";

// ── Parsing ────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * The scene's notes, made safe to hand on.
 *
 * They cross two boundaries with different rules: `postMessage` (structured
 * clone, which carries cycles happily) and the action result's JSON encoding
 * (which throws on one). A single cyclic note would otherwise take down the
 * whole `get-scene-state` reply, so it is named rather than dropped — the
 * agent asked for that key and deserves to learn what happened to it.
 */
function parseNotes(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const notes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    try {
      JSON.stringify(value);
      notes[key] = value;
    } catch {
      notes[key] = "[note value could not be serialized]";
    }
  }
  return notes;
}

/** Defensive: the scene is user-editable code and may post anything. */
/** The bridge's per-channel error counts; null when the bridge predates them. */
function errorSourcesOf(raw: unknown): SceneState["errorSources"] {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    window: count(r.window),
    unhandledrejection: count(r.unhandledrejection),
    console: count(r.console),
    shader: count(r.shader),
  };
}

export function parseSceneState(raw: unknown): SceneState {
  const r = isRecord(raw) ? raw : {};
  const viewportRaw = isRecord(r.viewport) ? r.viewport : null;
  return {
    bridgeVersion: num(r.bridgeVersion),
    registered: bool(r.registered, false),
    ready: bool(r.ready, false),
    loading: bool(r.loading, false),
    fps: num(r.fps),
    rafFps: num(r.rafFps),
    fpsSource: typeof r.fpsSource === "string" ? r.fpsSource : null,
    frameMs: num(r.frameMs),
    framesRendered: num(r.framesRendered),
    passesPerFrame: num(r.passesPerFrame),
    errorSources: errorSourcesOf(r.errorSources),
    drawCalls: num(r.drawCalls),
    triangles: num(r.triangles),
    textures: num(r.textures),
    geometries: num(r.geometries),
    errors: Array.isArray(r.errors)
      ? r.errors.filter((e): e is string => typeof e === "string")
      : [],
    // An array or a string here is a scene that misunderstood the channel,
    // not a set of notes.
    notes: parseNotes(r.notes),
    viewport: viewportRaw
      ? {
          width: num(viewportRaw.width) ?? 0,
          height: num(viewportRaw.height) ?? 0,
          pixelRatio: num(viewportRaw.pixelRatio) ?? 1,
        }
      : null,
  };
}

/**
 * Read one `message` event payload. Returns null for anything that is not
 * this protocol — the page shares its window with webcraft's selection
 * script, Vite's HMR client and whatever the scene itself posts.
 */
export function parseInbound(data: unknown): InboundMessage | null {
  if (!isRecord(data)) return null;
  const type = data.type;
  if (typeof type !== "string" || !type.startsWith(LUCID_MESSAGE_PREFIX)) return null;
  switch (type.slice(LUCID_MESSAGE_PREFIX.length)) {
    case "hello":
      return { kind: "hello", bridgeVersion: num(data.bridgeVersion) };
    case "ready":
      return { kind: "ready" };
    case "error":
      return {
        kind: "error",
        message: typeof data.message === "string" ? data.message : "unknown scene error",
      };
    case "note":
      // A note with no name cannot be looked up in `notes`, so there is
      // nothing to announce — the same reason a reply with no id is not a
      // reply.
      return typeof data.name === "string" && data.name ? { kind: "note", name: data.name } : null;
    case "capture:result": {
      if (typeof data.id !== "string") return null;
      return {
        kind: "capture:result",
        id: data.id,
        ok: bool(data.ok, false),
        dataUrl: typeof data.dataUrl === "string" ? data.dataUrl : null,
        width: num(data.width),
        height: num(data.height),
        registered: typeof data.registered === "boolean" ? data.registered : null,
        error: typeof data.error === "string" ? data.error : null,
      };
    }
    case "state:result": {
      if (typeof data.id !== "string") return null;
      return { kind: "state:result", id: data.id, state: parseSceneState(data.state) };
    }
    case "unsupported": {
      if (typeof data.id !== "string") return null;
      return {
        kind: "unsupported",
        id: data.id,
        requestType: typeof data.requestType === "string" ? data.requestType : "",
        bridgeVersion: num(data.bridgeVersion),
      };
    }
    default:
      return null;
  }
}

/**
 * A capture reply as the framework's `captureViewport` contract wants it:
 * base64 without the `data:` prefix, plus the media type the scene produced.
 * Null when the scene declined, or when what came back is not a data URL.
 */
export function captureViewportPayload(
  reply: CaptureReply | UnsupportedReply | null,
): { data: string; media_type: string } | null {
  if (!reply || reply.kind !== "capture:result" || !reply.ok || !reply.dataUrl) return null;
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(reply.dataUrl);
  if (!match || !match[2]) return null; // only base64 payloads round-trip
  const data = match[3];
  if (!data) return null;
  return { data, media_type: match[1] || "image/png" };
}

// ── Waiting for a frame worth judging ──────────────────────────────────────

/**
 * Poll the scene until it reports `registered && ready`, or give up.
 *
 * The rule this holds: A SCREENSHOT IS ONLY EVIDENCE IF THE SCENE WAS READY
 * WHEN IT WAS TAKEN. Right after a reload the bridge answers `registered:
 * false` for a few hundred milliseconds and `capture` used to shoot straight
 * through that window, handing the judge a frame of a scene that had not
 * finished starting.
 *
 * It gives up rather than refusing, because a real frame of a broken scene is
 * still worth more to the agent than the framework's fallback (a black
 * rasterization of a WebGL canvas, or no picture at all). The caller records
 * what it learned here so the agent can tell the two apart.
 *
 * `now` and `sleep` are injected so the loop is testable without wall time.
 */
export async function waitForSceneReady(options: {
  requestState: () => Promise<StateReply | UnsupportedReply | null>;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  timeoutMs?: number;
}): Promise<SceneReadiness> {
  const now = options.now ?? (() => Date.now());
  const pollMs = options.pollMs ?? CAPTURE_READY_POLL_MS;
  const timeoutMs = options.timeoutMs ?? CAPTURE_READY_TIMEOUT_MS;
  const started = now();
  let registered = false;
  let ready = false;

  for (;;) {
    const reply = await options.requestState();
    const state = reply && reply.kind === "state:result" ? reply.state : null;
    registered = state?.registered ?? false;
    ready = state?.ready ?? false;
    if (registered && ready) break;
    // A bridge that answers "I do not know this request" will never report
    // readiness; polling it again only delays the screenshot. Silence (null)
    // has already cost a full request timeout, so the deadline below ends it.
    if (reply?.kind === "unsupported") break;
    if (now() - started + pollMs >= timeoutMs) break;
    await options.sleep(pollMs);
  }

  return { ready, registered, waitedMs: Math.max(0, Math.round(now() - started)) };
}

/**
 * What to file about the frame that was just taken.
 *
 * The capture reply's own `registered` outranks the poll's: it describes the
 * instant the pixels were read, and a scene that lost its renderer in between
 * hands back the first `<canvas>` on the page, which may be black. A frame
 * that was not drawn by a registered renderer is not ready to be judged,
 * whatever the last state poll said.
 */
export function captureRecord(
  at: string,
  readiness: SceneReadiness,
  reply: CaptureReply | UnsupportedReply | null,
): CaptureRecord {
  const registered =
    reply && reply.kind === "capture:result" && typeof reply.registered === "boolean"
      ? reply.registered
      : readiness.registered;
  return {
    at,
    source: "live",
    ready: readiness.ready && registered,
    registered,
    waitedMs: readiness.waitedMs,
  };
}

/**
 * What to file about a recorded still that was handed back instead of a frame.
 *
 * Filed for the SAME reason a live frame is: `capture` answering with the
 * round the user left on the rail — or with the target — is invisible in the
 * reply, which is a PNG path either way. Without this record the agent's
 * `lastCapture` still described some earlier live frame, so a target returned
 * as "this round's capture" looked, to the agent, exactly like a good one.
 *
 * `ready: false` because a still is never evidence about the current scene;
 * the readiness of the live scene is not what produced these bytes, so it is
 * not reported.
 */
export function stillCaptureRecord(
  at: string,
  source: Exclude<CaptureSource, "live">,
  round?: number,
): CaptureRecord {
  return {
    at,
    source,
    ...(round === undefined ? {} : { round }),
    ready: false,
    registered: null,
    waitedMs: null,
  };
}

// ── Notes ──────────────────────────────────────────────────────────────────

/** How many distinct note names the viewer remembers per scene load. */
export const MAX_TRACKED_NOTES = 20;

/**
 * Remember that the scene announced a note. Returns the SAME array when there
 * is nothing new, so the component can skip a re-render; names are kept
 * because the values live in the state reply and would go stale here.
 */
export function trackNoteName(names: readonly string[], name: string): string[] {
  if (!name || names.includes(name)) return names as string[];
  return [...names, name].slice(-MAX_TRACKED_NOTES);
}

// ── The channel ────────────────────────────────────────────────────────────

interface Pending {
  kind: BridgeRequestKind;
  settle: (reply: InboundMessage | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Request/response over `postMessage`, with one id per request.
 *
 * `send` is injected so this class never touches a `Window` — the component
 * passes `(message) => iframe.contentWindow?.postMessage(message, "*")`, and
 * a test passes a recorder.
 */
export class SceneBridgeChannel {
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  constructor(
    private readonly send: (message: { type: string; id: string }) => void,
    private readonly timeoutMs: number = BRIDGE_TIMEOUT_MS,
  ) {}

  /** How many requests are waiting — diagnostic, and pinned by the tests. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Ask the scene. Resolves `null` when it does not answer in time, and an
   * `unsupported` reply when it answers that it does not know the request —
   * a bridge that is present but older is a different fact from silence.
   */
  request(kind: "capture"): Promise<CaptureReply | UnsupportedReply | null>;
  request(kind: "state"): Promise<StateReply | UnsupportedReply | null>;
  request(kind: BridgeRequestKind): Promise<InboundMessage | null> {
    const id = `lucid-${kind}-${++this.seq}`;
    return new Promise<InboundMessage | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, this.timeoutMs);
      this.pending.set(id, {
        kind,
        timer,
        settle: (reply) => {
          clearTimeout(timer);
          this.pending.delete(id);
          resolve(reply);
        },
      });
      try {
        this.send({ type: `${LUCID_MESSAGE_PREFIX}${kind}`, id });
      } catch {
        // A torn-down iframe throws on postMessage. Settle now rather than
        // making the caller wait out the timeout for an answer that cannot
        // come.
        const entry = this.pending.get(id);
        entry?.settle(null);
      }
    });
  }

  /**
   * Route one parsed inbound message. Returns true when it answered a
   * request this channel is waiting on — a stale id (a reply from the
   * previous document) is not consumed and must not settle anything.
   */
  accept(message: InboundMessage | null): boolean {
    if (
      !message ||
      (message.kind !== "capture:result" &&
        message.kind !== "state:result" &&
        message.kind !== "unsupported")
    ) {
      return false;
    }
    const entry = this.pending.get(message.id);
    if (!entry) return false;
    // `pneuma:lucid:capture:result` answering a `state` request would be the
    // scene confusing itself; refuse rather than hand a caller the wrong
    // shape. `unsupported` is a valid answer to either.
    const expected = entry.kind === "capture" ? "capture:result" : "state:result";
    if (message.kind !== expected && message.kind !== "unsupported") return false;
    entry.settle(message);
    return true;
  }

  /** Settle everything in flight as unanswered — reload, navigation, unmount. */
  abort(): void {
    for (const entry of [...this.pending.values()]) entry.settle(null);
    this.pending.clear();
  }
}
