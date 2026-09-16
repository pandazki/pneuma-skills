/**
 * lucid-bridge.js — the scene's senses.
 *
 * The loop only works if the live frame is READ, never guessed: the judge
 * scores a real screenshot and the exit rules read a real fps number. This
 * file is what makes both possible from inside the scene's iframe. It is
 * copied into `<project>/scene/` by `lucid.mjs init` (and refreshed by
 * `lucid.mjs bridge --refresh`) and loaded by the scene page BEFORE its
 * module script:
 *
 *     <script src="./lucid-bridge.js"></script>
 *     <script type="module" src="./main.js"></script>
 *
 * Deliberately a plain ES2020 script with no imports and no build step: it
 * has to run before any module graph resolves, on any sub-path, with nothing
 * vendored but three.js itself.
 *
 * ── Scene → bridge, on `window.lucid` ───────────────────────────────────────
 *   window.lucid.register({ renderer, scene, camera })
 *       The three.js objects. The bridge reads renderer.domElement and
 *       renderer.info, WRAPS renderer.render (the original stays bound and is
 *       called first), which is what turns fps into a measurement of real
 *       frames, and installs renderer.debug.onShaderError so a shader that
 *       fails to compile reaches errors[] (a handler already there is kept and
 *       still called). Nothing else on the renderer is touched.
 *   window.lucid.setLoading(true | false)
 *       Default false. Set it true while assets load; `ready` stays false
 *       until it goes back.
 *   window.lucid.report("message")
 *       Push a non-fatal problem into errors[].
 *   window.lucid.note(name, data) -> boolean
 *       The DIAGNOSTICS channel, separate from errors[]: a successful
 *       in-scene check has somewhere to put its result without pretending to
 *       be a failure. `notes` is an object keyed by `name` (last write wins),
 *       at most 20 keys, each value stored as its JSON round-trip and
 *       truncated to 2048 characters of JSON (a truncated value degrades to a
 *       marked string). Beyond the cap a new NAME is refused, `note` returns
 *       false, and notes["+dropped"] counts the refusals. Every accepted
 *       write also posts { type: "pneuma:lucid:note", name } to the parent.
 *
 * ── What fps means here ─────────────────────────────────────────────────────
 * Two clocks, both reported, `fpsSource` says which one `fps` is:
 *   - REGISTERED (fpsSource "render"): fps / frameMs / framesRendered count
 *     DISPLAYED frames — at most one per animation frame, however many render
 *     passes the scene needs to produce it. `ready` needs 10 of them. This is
 *     the number the loop's exit rules are entitled to.
 *   - NOT REGISTERED (fpsSource "raf"): there is no render to count, so those
 *     three describe the bridge's own requestAnimationFrame sampler — page
 *     cadence, not proof that the scene drew anything.
 * `rafFps` is always the rAF sampler, so a scene that schedules 60 rAF
 * callbacks but renders 12 frames reads as fps 12 / rafFps 60 instead of
 * looking healthy.
 *
 * ONE FRAME PER ANIMATION FRAME, not one per renderer.render call: a scene
 * that draws a reflection (or a shadow, or a post pass) into a render target
 * before drawing the visible frame calls render twice for one picture, and
 * counting both would report a 30 fps scene as 60 — enough to pass the exit
 * rules' fps bar on a scene the user sees stuttering (measured 2026-09-16 on
 * the ember-abbey seed: fps 60.48 against rafFps 30). The rAF sampler stamps
 * each animation frame with a token; the first render under a new token is
 * the frame, the rest are PASSES. `passesPerFrame` reports render calls per
 * counted frame (2 for that seed) so the extra work stays visible instead of
 * being hidden or double-counted.
 *
 * ── What lands in errors[], and where it came from ──────────────────────────
 * Four channels, counted separately in `errorSources` so a black material can
 * be told apart from a script that threw:
 *   window              window.onerror — a script threw.
 *   unhandledrejection  a promise nobody caught (a failed fetch, a loader).
 *   console             EVERY console.error call, plus the console.warn lines
 *                       that mention "THREE." (recorded with a `warn: `
 *                       prefix), each summarized to ONE line of at most 240
 *                       characters.
 *   shader              renderer.debug.onShaderError, installed on register,
 *                       recorded as `shader: <first line of the info log>`.
 * `window.lucid.report` joins the same list but belongs to no channel, so the
 * counts stay a statement about what the PAGE did.
 *
 * The console channel exists because A FAILED SHADER IS NOT AN ERROR EVENT:
 * three.js prints "THREE.WebGLProgram: Shader Error …" through console.error
 * and returns, so window.onerror never fires. Measured in the second blind
 * trial (2026-09-17): errors[] stayed empty while a material rendered black,
 * the viewer said "no errors", and the builder had to write its own
 * diagnostic to see what the bridge should have handed it. console.warn is
 * filtered to "THREE." because a scene's own chatter is not a failure, while
 * three.js's texture and material warnings are the next thing that turns a
 * frame wrong. The ORIGINAL console method is always called with the original
 * arguments — the page's logging is unchanged, and a bridge that throws while
 * summarizing still logs.
 *
 * The shader hook has a cost worth knowing: three.js calls onShaderError
 * INSTEAD of printing its own report, so installing one takes that message
 * out of the page console. The bridge puts the driver's three info logs back
 * with the console.error it captured BEFORE wrapping — devtools keeps a
 * diagnostic, and one failure still files exactly one errors[] entry. A scene
 * that installed its own handler had already replaced three's report, so in
 * that case the bridge stays quiet and just calls it.
 *
 * Dedupe and the 20-entry cap cover every channel, and a channel counts each
 * DISTINCT message once — including the ones the cap suppressed, so a scene
 * shouting 40 different lines reads as 40 in `errorSources` and 19 plus a
 * remainder in `errors`.
 *
 * ── Parent → bridge, by postMessage ─────────────────────────────────────────
 * The bridge answers only messages whose `data.type` is a string starting
 * with "pneuma:lucid:", and replies with event.source.postMessage(reply, "*").
 *
 *   { type: "pneuma:lucid:capture", id }
 *     → { type: "pneuma:lucid:capture:result", id, ok: true,
 *         dataUrl: "data:image/png;base64,…", width, height, registered }
 *     → { type: "pneuma:lucid:capture:result", id, ok: false, error, registered }
 *   { type: "pneuma:lucid:state", id }
 *     → { type: "pneuma:lucid:state:result", id, state: { … } }
 *   anything else under the prefix
 *     → { type: "pneuma:lucid:unsupported", id, requestType, bridgeVersion }
 *
 * ── Bridge → parent, unsolicited (only when window.parent !== window) ───────
 *   { type: "pneuma:lucid:hello", bridgeVersion: 1 }   on load
 *   { type: "pneuma:lucid:ready" }                     the first time ready flips true
 *   { type: "pneuma:lucid:error", message }            on each new distinct error
 *   { type: "pneuma:lucid:note", name }                on each accepted note
 *                                                      (the value is in state.notes)
 *
 * WHY `registered` is reported on a capture: with a registered renderer the
 * bridge draws a frame and reads the canvas IN THE SAME TASK, which is the
 * only way to get pixels out of a WebGL context that was not created with
 * `preserveDrawingBuffer`. Without one it can only grab the first <canvas> on
 * the page after one animation frame, and that image may be black. The flag
 * is how the caller can tell the difference instead of shipping a black
 * screenshot to the judge.
 */

(function (root) {
  "use strict";

  var BRIDGE_VERSION = 1;
  /** Rolling window of frame timestamps used for fps / frameMs. */
  var FRAME_WINDOW = 120;
  /** Displayed frames the bridge must have seen before it calls the scene ready. */
  var READY_FRAMES = 10;
  /** Hard cap on errors[]; the last slot becomes a suppression counter. */
  var MAX_ERRORS = 20;
  /** Characters one captured console line may hold, the ellipsis included. */
  var MAX_CONSOLE_CHARS = 240;
  /** Characters of JSON one non-string console argument contributes. */
  var MAX_ARG_CHARS = 120;
  /** Hard cap on notes: 19 named notes plus the "+dropped" counter. */
  var MAX_NOTES = 20;
  /** Characters of JSON one note value may hold before it is truncated. */
  var MAX_NOTE_CHARS = 2048;
  /** The reserved notes key that counts refused names. */
  var DROPPED_NOTE = "+dropped";
  var PREFIX = "pneuma:lucid:";

  var registered = null; // { renderer, scene, camera }
  var loading = false;
  /** Displayed frames: at most one counted per animation frame. */
  var renderFrames = 0;
  var renderTimes = [];
  /** Every renderer.render call the wrapper saw, extra passes included. */
  var renderCalls = 0;
  /** Bumped once per animation frame by the rAF sampler below. */
  var frameToken = 0;
  /** The token of the last COUNTED frame; -1 before the first one. */
  var countedToken = -1;
  /** The bridge's own rAF sampler: page cadence, not proof of a render. */
  var rafFrames = 0;
  var rafTimes = [];
  var errors = [];
  var seenErrors = {};
  var suppressedErrors = 0;
  /** Distinct errors per channel; see "What lands in errors[]" in the header. */
  var errorSources = { window: 0, unhandledrejection: 0, console: 0, shader: 0 };
  /** console.error as the page had it, before the bridge wrapped it. */
  var consoleErrorRaw = null;
  var notes = {};
  var noteCount = 0;
  var droppedNotes = 0;
  var readyAnnounced = false;

  // ── small helpers ────────────────────────────────────────────────────────

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function nowMs() {
    return root.performance && root.performance.now ? root.performance.now() : Date.now();
  }

  function describeError(error) {
    if (!error) return "unknown error";
    if (typeof error === "string") return error;
    if (error.message) return String(error.message);
    return String(error);
  }

  function raf(callback) {
    if (root.requestAnimationFrame) return root.requestAnimationFrame(callback);
    if (root.setTimeout) {
      return root.setTimeout(function () {
        callback(nowMs());
      }, 16);
    }
    callback(nowMs());
    return 0;
  }

  function toParent(message) {
    if (!root.parent || root.parent === root || !root.parent.postMessage) return;
    try {
      root.parent.postMessage(message, "*");
    } catch (error) {
      /* a parent that refuses messages is not this scene's problem */
    }
  }

  // ── frame statistics (pure) ──────────────────────────────────────────────

  /**
   * fps and frameMs from a list of frame timestamps in milliseconds.
   * fps is measured across the whole window (intervals / elapsed) while
   * frameMs is the MEDIAN interval: one 400ms hitch should show up as a
   * lower fps, not as a frame time nothing in the scene ever took.
   */
  function frameStats(times) {
    if (!times || times.length < 2) return { fps: null, frameMs: null };
    var span = times[times.length - 1] - times[0];
    var deltas = [];
    for (var i = 1; i < times.length; i += 1) deltas.push(times[i] - times[i - 1]);
    deltas.sort(function (a, b) {
      return a - b;
    });
    var mid = Math.floor(deltas.length / 2);
    var median = deltas.length % 2 === 1 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2;
    return {
      fps: span > 0 ? round2(((times.length - 1) * 1000) / span) : null,
      frameMs: round2(median),
    };
  }

  /** Ready means the scene DREW: a registered renderer, nothing loading, and
   *  ten displayed frames (extra passes inside one frame do not add up to
   *  readiness any more than they do to fps). rAF cadence cannot stand in. */
  function isReady() {
    return Boolean(registered) && !loading && renderFrames >= READY_FRAMES;
  }

  function announceReady() {
    if (readyAnnounced || !isReady()) return;
    readyAnnounced = true;
    toParent({ type: PREFIX + "ready" });
  }

  function push(times, timestamp) {
    times.push(typeof timestamp === "number" ? timestamp : nowMs());
    if (times.length > FRAME_WINDOW) times.splice(0, times.length - FRAME_WINDOW);
  }

  /** One turn of the bridge's rAF sampler, and the start of a new frame. */
  function noteFrame(timestamp) {
    frameToken += 1;
    rafFrames += 1;
    push(rafTimes, timestamp);
    announceReady();
  }

  /**
   * One renderer.render call, timed after it returned.
   *
   * It counts as a displayed FRAME only if no render has been counted under
   * the current animation-frame token yet; anything after that in the same
   * frame is an extra PASS (a reflection, a shadow map, a post chain) drawing
   * part of the same picture. Counting passes as frames is how a 30 fps scene
   * reports 60. A render with no sampler turn behind it — the first one, or
   * one from a scene whose rAF loop is not running — still counts once, so a
   * quiet scene reads as slow rather than as never having drawn.
   */
  function noteRender() {
    renderCalls += 1;
    if (countedToken === frameToken) return;
    countedToken = frameToken;
    renderFrames += 1;
    push(renderTimes);
    announceReady();
  }

  /**
   * Replace renderer.render with a counting wrapper over the ORIGINAL bound
   * method. Idempotent: registering the same renderer twice must not make one
   * frame count as two.
   */
  function wrapRender(renderer) {
    if (!renderer || typeof renderer.render !== "function") {
      pushError("window.lucid.register: renderer.render is not a function — fps stays unmeasured");
      return false;
    }
    if (renderer.render.__lucidWrapped) return true;
    var original = renderer.render.bind(renderer);
    var wrapped = function () {
      var result = original.apply(null, arguments);
      noteRender();
      return result;
    };
    wrapped.__lucidWrapped = true;
    try {
      renderer.render = wrapped;
    } catch (error) {
      // A renderer that refuses the assignment (frozen, proxied) leaves the
      // count at zero. Say so: `ready` and `fps` stay unmeasured rather than
      // falling back to rAF cadence and calling scheduling "rendering".
      pushError(
        "window.lucid.register: renderer.render could not be wrapped (" +
          describeError(error) +
          ") — fps and ready stay unmeasured",
      );
      return false;
    }
    return true;
  }

  /**
   * Record one problem. `source` names the channel it arrived on (a key of
   * errorSources) and is counted for every DISTINCT message, whether or not
   * the cap had room for it — the counter is about what the page did, the
   * list is a bounded sample of it. Omit it for the scene's own `report`.
   */
  function pushError(message, source) {
    var text = describeError(message).slice(0, 400);
    if (seenErrors[text]) return;
    seenErrors[text] = true;
    if (source && Object.prototype.hasOwnProperty.call(errorSources, source)) {
      errorSources[source] += 1;
    }
    if (errors.length < MAX_ERRORS - 1) errors.push(text);
    else suppressedErrors += 1;
    toParent({ type: PREFIX + "error", message: text });
  }

  function errorList() {
    if (suppressedErrors === 0) return errors.slice();
    return errors.concat(["+" + suppressedErrors + " more distinct errors (suppressed)"]);
  }

  // ── the console channel: three.js reports a broken shader by logging ─────

  /** Collapse to one line and clamp, ellipsis included in the budget. */
  function oneLine(text, limit) {
    var line = String(text).replace(/\s+/g, " ").trim();
    return line.length > limit ? line.slice(0, limit - 1) + "…" : line;
  }

  /** One console argument as a short piece of text. An object says its
   *  `message` if it has one (that is where an Error keeps the answer, and
   *  JSON.stringify of an Error is "{}"), otherwise a clamped JSON round-trip. */
  function describeArg(value) {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return String(value);
    if (typeof value === "function") return "[function " + (value.name || "anonymous") + "]";
    if (typeof value !== "object") return String(value);
    if (value.message) return String(value.message);
    var text;
    try {
      text = JSON.stringify(value);
    } catch (error) {
      text = null;
    }
    return typeof text === "string" ? oneLine(text, MAX_ARG_CHARS) : String(value);
  }

  /** A whole console call as the single line errors[] will carry. */
  function consoleLine(args) {
    var parts = [];
    for (var i = 0; i < args.length; i += 1) parts.push(describeArg(args[i]));
    return oneLine(parts.join(" "), MAX_CONSOLE_CHARS);
  }

  /**
   * Wrap one console method so its output also reaches errors[].
   *
   * The capture runs first and inside a try, so the page's own logging
   * happens even if summarizing throws; the original is then called with the
   * untouched arguments. `keep` filters which lines are worth recording and
   * `prefix` marks them in the list. Idempotent, and a console that refuses
   * the assignment simply stays unwrapped.
   */
  function wrapConsole(method, prefix, keep) {
    var target = root.console;
    if (!target || typeof target[method] !== "function") return null;
    var original = target[method];
    if (original.__lucidWrapped) return null;
    var wrapped = function () {
      try {
        var line = consoleLine(arguments);
        if (line && (!keep || keep(line))) pushError(prefix + line, "console");
      } catch (error) {
        /* a diagnostic must never take down the log it is reading */
      }
      return original.apply(target, arguments);
    };
    wrapped.__lucidWrapped = true;
    try {
      target[method] = wrapped;
    } catch (error) {
      /* a frozen console stays unwrapped; everything else still works */
    }
    // The method as the page had it: the shader hook logs through this one.
    return original;
  }

  // ── the shader channel: a failed link never throws ───────────────────────

  /** The first non-blank line of a GL info log. */
  function firstLine(text) {
    if (typeof text !== "string") return "";
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i].trim();
      if (line) return line;
    }
    return "";
  }

  /** The three GL info logs behind a failed program. A GL call that throws
   *  (a lost context, a mocked gl) contributes nothing rather than killing
   *  the diagnostic. */
  function shaderLogs(gl, program, vertexShader, fragmentShader) {
    function read(method, target) {
      if (!gl || typeof gl[method] !== "function" || !target) return "";
      try {
        var text = gl[method](target);
        return typeof text === "string" ? text : "";
      } catch (error) {
        return "";
      }
    }
    return {
      program: read("getProgramInfoLog", program),
      vertex: read("getShaderInfoLog", vertexShader),
      fragment: read("getShaderInfoLog", fragmentShader),
    };
  }

  /**
   * What to say about a failed program. The link error lives in the PROGRAM
   * info log, but some drivers leave that empty and keep the compile error on
   * the shader itself, so the shader logs are read as a fallback rather than
   * reporting an empty diagnosis.
   */
  function shaderErrorLine(logs) {
    var line = firstLine(logs.program) || firstLine(logs.fragment) || firstLine(logs.vertex);
    return line ? oneLine(line, MAX_CONSOLE_CHARS) : "program link failed with no info log";
  }

  /**
   * Put the driver's logs back in the page console.
   *
   * WebGLProgram calls `onShaderError` INSTEAD of its own console.error
   * report (three.js r1xx, `onFirstUse`), so installing the hook would
   * otherwise take the most useful message in the whole engine away from
   * devtools and from anything reading the page's console. This goes through
   * console.error AS IT WAS BEFORE THE BRIDGE WRAPPED IT, so restoring the
   * page's message does not also file a second errors[] entry for one
   * failure. Only used when the bridge is the reason the report is gone: a
   * scene with its own handler had already replaced it.
   */
  function relogShaderError(logs) {
    if (!consoleErrorRaw) return;
    try {
      consoleErrorRaw.call(
        root.console,
        "THREE.WebGLProgram: Shader Error — a program failed to link. three.js's own report is " +
          "replaced while renderer.debug.onShaderError is installed (lucid-bridge.js installed it), " +
          "so the logs it would have printed are repeated here." +
          "\n\nProgram Info Log: " + (logs.program || "(empty)") +
          "\n\nVertex Shader Info Log: " + (logs.vertex || "(empty)") +
          "\n\nFragment Shader Info Log: " + (logs.fragment || "(empty)"),
      );
    } catch (error) {
      /* a console that refuses the message is not this scene's problem */
    }
  }

  /**
   * Install renderer.debug.onShaderError. three.js calls it INSTEAD of
   * throwing, so without this hook a scene whose material never compiled
   * renders black and reports nothing. Any handler already installed is kept
   * and still called — the scene may be watching too. Idempotent.
   */
  function wrapShaderError(renderer) {
    var debug = renderer && renderer.debug;
    if (!debug) return;
    var previous = typeof debug.onShaderError === "function" ? debug.onShaderError : null;
    if (previous && previous.__lucidWrapped) return;
    var handler = function (gl, program, vertexShader, fragmentShader) {
      try {
        var logs = shaderLogs(gl, program, vertexShader, fragmentShader);
        pushError("shader: " + shaderErrorLine(logs), "shader");
        if (!previous) relogShaderError(logs);
      } catch (error) {
        pushError("shader: a shader failed to compile (its info log could not be read)", "shader");
      }
      if (previous) return previous.apply(this, arguments);
    };
    handler.__lucidWrapped = true;
    try {
      debug.onShaderError = handler;
    } catch (error) {
      pushError(
        "window.lucid.register: renderer.debug.onShaderError could not be installed (" +
          describeError(error) +
          ") — a failed shader would stay invisible",
      );
    }
  }

  // ── notes: diagnostics that are not failures ─────────────────────────────

  /**
   * A note value as it will be stored: its JSON round-trip, so what the state
   * reply carries is structured AND clone-safe. A value that cannot be
   * serialized, or one longer than the cap, degrades to a string that says so
   * — a note is never dropped silently and never carries a function or a
   * cycle into postMessage.
   */
  function normalizeNote(data) {
    var text;
    try {
      text = JSON.stringify(data === undefined ? null : data);
    } catch (error) {
      return "[note not serializable: " + describeError(error) + "]";
    }
    if (typeof text !== "string") return "[note not serializable: JSON.stringify returned undefined]";
    if (text.length > MAX_NOTE_CHARS) {
      return (
        text.slice(0, MAX_NOTE_CHARS) +
        "…[truncated " + text.length + " -> " + MAX_NOTE_CHARS + " chars of JSON]"
      );
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      return text;
    }
  }

  function pushNote(name, data) {
    var key = typeof name === "string" ? name.trim().slice(0, 64) : "";
    if (!key || key === DROPPED_NOTE) {
      pushError('window.lucid.note needs a non-empty name other than "' + DROPPED_NOTE + '"');
      return false;
    }
    var known = Object.prototype.hasOwnProperty.call(notes, key);
    if (!known && noteCount >= MAX_NOTES - 1) {
      droppedNotes += 1;
      return false;
    }
    if (!known) noteCount += 1;
    notes[key] = normalizeNote(data);
    toParent({ type: PREFIX + "note", name: key });
    return true;
  }

  function noteSnapshot() {
    var out = {};
    for (var key in notes) {
      if (Object.prototype.hasOwnProperty.call(notes, key)) out[key] = notes[key];
    }
    if (droppedNotes > 0) {
      out[DROPPED_NOTE] = droppedNotes + " notes refused (at most " + (MAX_NOTES - 1) + " names)";
    }
    return out;
  }

  // ── what the bridge can see ──────────────────────────────────────────────

  function firstCanvas() {
    if (registered) return registered.renderer.domElement;
    if (!root.document || !root.document.querySelector) return null;
    return root.document.querySelector("canvas");
  }

  function viewport() {
    var element = firstCanvas();
    var pixelRatio = root.devicePixelRatio || 1;
    if (!element) return { width: 0, height: 0, pixelRatio: pixelRatio };
    return {
      width: element.clientWidth || element.width || 0,
      height: element.clientHeight || element.height || 0,
      pixelRatio: pixelRatio,
    };
  }

  function readState() {
    var rafStats = frameStats(rafTimes);
    // With a renderer registered, the real frames are the only honest answer;
    // before that there are none to count, so the rAF sampler stands in and
    // fpsSource says so rather than letting cadence pass as rendering.
    var live = registered ? frameStats(renderTimes) : rafStats;
    var info = registered && registered.renderer ? registered.renderer.info : null;
    var render = info && info.render ? info.render : null;
    var memory = info && info.memory ? info.memory : null;
    return {
      bridgeVersion: BRIDGE_VERSION,
      registered: Boolean(registered),
      ready: isReady(),
      loading: loading,
      fps: live.fps,
      fpsSource: registered ? "render" : "raf",
      rafFps: rafStats.fps,
      frameMs: live.frameMs,
      framesRendered: registered ? renderFrames : rafFrames,
      // Render calls per counted frame, averaged over the session: 1 for a
      // single-pass scene, 2 for one that draws a reflection first. Null
      // before the first counted frame, and while nothing is registered there
      // is no render to divide.
      passesPerFrame: registered && renderFrames > 0 ? round2(renderCalls / renderFrames) : null,
      drawCalls: render ? render.calls : null,
      triangles: render ? render.triangles : null,
      textures: memory ? memory.textures : null,
      geometries: memory ? memory.geometries : null,
      errors: errorList(),
      // Which channel produced them: a shader that never compiled reports
      // through `console` / `shader`, never through `window`.
      errorSources: {
        window: errorSources.window,
        unhandledrejection: errorSources.unhandledrejection,
        console: errorSources.console,
        shader: errorSources.shader,
      },
      notes: noteSnapshot(),
      viewport: viewport(),
    };
  }

  // ── requests from the parent ─────────────────────────────────────────────

  function capture(id, reply) {
    var base = { type: PREFIX + "capture:result", id: id };

    if (registered) {
      // Draw and read in ONE task: a WebGL drawing buffer is cleared as soon
      // as control returns to the browser unless preserveDrawingBuffer is on.
      try {
        registered.renderer.render(registered.scene, registered.camera);
        var element = registered.renderer.domElement;
        var dataUrl = element.toDataURL("image/png");
        reply({
          type: base.type,
          id: id,
          ok: true,
          dataUrl: dataUrl,
          width: element.width || 0,
          height: element.height || 0,
          registered: true,
        });
      } catch (error) {
        reply({ type: base.type, id: id, ok: false, error: describeError(error), registered: true });
      }
      return;
    }

    var canvas = firstCanvas();
    if (!canvas || !canvas.toDataURL) {
      reply({
        type: base.type,
        id: id,
        ok: false,
        error: "no renderer registered and no <canvas> to read — call window.lucid.register({ renderer, scene, camera })",
        registered: false,
      });
      return;
    }
    // Unregistered: the best we can do is wait one frame and hope the page
    // just drew. The result may be black; `registered: false` says so.
    raf(function () {
      try {
        reply({
          type: base.type,
          id: id,
          ok: true,
          dataUrl: canvas.toDataURL("image/png"),
          width: canvas.width || 0,
          height: canvas.height || 0,
          registered: false,
        });
      } catch (error) {
        reply({ type: base.type, id: id, ok: false, error: describeError(error), registered: false });
      }
    });
  }

  /**
   * Route one message. Returns false for anything that is not addressed to
   * this bridge, so a page sharing the channel is left alone.
   */
  function handleMessage(data, reply) {
    if (!data || typeof data.type !== "string" || data.type.indexOf(PREFIX) !== 0) return false;
    if (data.type === PREFIX + "capture") {
      capture(data.id, reply);
      return true;
    }
    if (data.type === PREFIX + "state") {
      reply({ type: PREFIX + "state:result", id: data.id, state: readState() });
      return true;
    }
    // Answer rather than ignore: an unanswered request looks like a hung
    // scene, which is a much worse thing to debug than a named refusal.
    reply({
      type: PREFIX + "unsupported",
      id: data.id,
      requestType: data.type,
      bridgeVersion: BRIDGE_VERSION,
    });
    return true;
  }

  // ── the API the scene calls ──────────────────────────────────────────────

  root.lucid = {
    bridgeVersion: BRIDGE_VERSION,
    register: function (parts) {
      if (!parts || !parts.renderer || !parts.scene || !parts.camera) {
        pushError("window.lucid.register needs { renderer, scene, camera }");
        return false;
      }
      registered = { renderer: parts.renderer, scene: parts.scene, camera: parts.camera };
      // Counting starts at the wrapper, so fps describes frames this renderer
      // actually drew — including the one `capture` draws to read the buffer.
      wrapRender(parts.renderer);
      // …and a shader that fails to link after this point is seen, not left
      // for the user to notice as a black material.
      wrapShaderError(parts.renderer);
      announceReady();
      return true;
    },
    setLoading: function (value) {
      loading = Boolean(value);
      announceReady();
    },
    report: function (message) {
      pushError(message);
    },
    note: function (name, data) {
      return pushNote(name, data);
    },
  };

  /**
   * Debug / test surface. The message listener below is a one-liner over
   * these same functions, so a test can drive the protocol exactly as the
   * parent does without fabricating MessageEvents — and a human poking at the
   * scene in devtools can read the state the viewer reads.
   */
  root.__lucidBridge = {
    bridgeVersion: BRIDGE_VERSION,
    handleMessage: handleMessage,
    state: readState,
    /** One turn of the rAF sampler (what `rafFps` measures). */
    noteFrame: noteFrame,
    frameStats: frameStats,
  };

  // ── wiring ───────────────────────────────────────────────────────────────

  if (root.addEventListener) {
    root.addEventListener("message", function (event) {
      handleMessage(event.data, function (reply) {
        if (event.source && event.source.postMessage) event.source.postMessage(reply, "*");
      });
    });
    root.addEventListener("error", function (event) {
      pushError(event && (event.message || (event.error && event.error.message)), "window");
    });
    root.addEventListener("unhandledrejection", function (event) {
      pushError(event && event.reason, "unhandledrejection");
    });
  }

  // From load, not from register: three.js logs a failed shader while the
  // scene is still building itself, and that log is the only notice given.
  consoleErrorRaw = wrapConsole("error", "", null);
  wrapConsole("warn", "warn: ", function (line) {
    return line.indexOf("THREE.") !== -1;
  });

  // The rAF sampler runs from load, not from register: a scene that never
  // registers still reports the page's cadence (as `rafFps`, and as `fps`
  // only while `fpsSource` is "raf"). It is never proof that anything drew.
  raf(function tick(timestamp) {
    noteFrame(timestamp);
    raf(tick);
  });

  toParent({ type: PREFIX + "hello", bridgeVersion: BRIDGE_VERSION });
})(typeof window !== "undefined" ? window : globalThis);
