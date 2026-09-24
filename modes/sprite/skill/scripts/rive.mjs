/**
 * rive.mjs — a zero-dependency `.riv` writer for raster frame animations.
 *
 * What it writes is the object graph Rive's own "frame-by-frame" recipe
 * describes, and nothing else: one artboard holding one Solo, one Image per
 * frame inside that Solo (each backed by an embedded ImageAsset), one
 * LinearAnimation per motion that keys `Solo.activeComponentId` with hold
 * interpolation — so exactly one frame is visible at a time — and a state
 * machine that routes (`riveStateMachine`): one number input `motion` naming
 * the loop the character should be in, one trigger per one-shot, and states
 * that change only where the pictures meet — at a loop's cycle end or a
 * transition clip's last frame — going through the hub pose when no clip
 * joins two loops directly.
 *
 * The frames stay RASTER. Nothing here vectorises anything: the file plays in
 * every Rive runtime, but a `.riv` is a runtime format and cannot be reopened
 * in the Rive editor.
 *
 * Every type key and property key below comes from rive-runtime's generated
 * headers (`include/rive/generated/**_base.hpp`, commit 27e2adac, 2026-09-23),
 * as the research prototype that was validated in `@rive-app/canvas` 2.43.1
 * used them. A wrong key is not an error in any runtime — the property is
 * skipped without a word — which is why the tests read the file back with a
 * decoder whose table was copied from those headers separately.
 *
 * Pure: bytes in, bytes out. Reading frames, the atlas and project.json is
 * `sprite-sheet.mjs rive`'s job, and what the frames cost to open — which
 * frames a loop keeps, how far they shrink — is `rive-plan.mjs`'s.
 */

/** Type keys (`typeKey` in the runtime headers). */
const TYPE = {
  Artboard: 1,
  Backboard: 23,
  KeyedObject: 25,
  KeyedProperty: 26,
  LinearAnimation: 31,
  KeyFrameId: 50,
  StateMachine: 53,
  StateMachineNumber: 56,
  StateMachineLayer: 57,
  StateMachineTrigger: 58,
  AnimationState: 61,
  AnyState: 62,
  EntryState: 63,
  ExitState: 64,
  StateTransition: 65,
  TransitionTriggerCondition: 68,
  TransitionNumberCondition: 70,
  Image: 100,
  ImageAsset: 105,
  FileAssetContents: 106,
  Solo: 147,
};

/**
 * Property keys, each with how its value is written: u = LEB128 varuint
 * (uints and ids), f = float32 LE, s = length-prefixed UTF-8, y = length-
 * prefixed bytes, b = one byte.
 */
const PROP = {
  componentName: [4, "s"], // Component.name
  parentId: [5, "u"], // Component.parentId
  width: [7, "f"], // LayoutComponent.width
  height: [8, "f"], // LayoutComponent.height
  x: [13, "f"], // Node.x
  y: [14, "f"], // Node.y
  objectId: [51, "u"], // KeyedObject.objectId
  propertyKey: [53, "u"], // KeyedProperty.propertyKey
  animationName: [55, "s"], // Animation.name (LinearAnimation, StateMachine)
  fps: [56, "u"], // LinearAnimation.fps
  duration: [57, "u"], // LinearAnimation.duration, in frames
  loopValue: [59, "u"], // LinearAnimation.loopValue: 0 oneShot, 1 loop
  frame: [67, "u"], // KeyFrame.frame
  interpolationType: [68, "u"], // InterpolatingKeyFrame.interpolationType: 0 hold
  idValue: [122, "u"], // KeyFrameId.value
  machineComponentName: [138, "s"], // StateMachineComponent.name (inputs, layers)
  numberValue: [140, "f"], // StateMachineNumber.value (CoreDouble, read as float32)
  animationId: [149, "u"], // AnimationState.animationId
  stateToId: [151, "u"], // StateTransition.stateToId
  transitionFlags: [152, "u"], // StateTransition.flags
  inputId: [155, "u"], // TransitionInputCondition.inputId
  opValue: [156, "u"], // TransitionValueCondition.opValue: TransitionConditionOp
  conditionValue: [157, "f"], // TransitionNumberCondition.value (CoreDouble, read as float32)
  exitTime: [160, "u"], // StateTransition.exitTime
  clip: [196, "b"], // LayoutComponent.clip
  assetName: [203, "s"], // Asset.name
  fileAssetId: [204, "u"], // FileAsset.assetId
  imageAssetId: [206, "u"], // Image.assetId — an index into the file's assets
  assetHeight: [207, "f"], // DrawableAsset.height
  assetWidth: [208, "f"], // DrawableAsset.width
  bytes: [212, "y"], // FileAssetContents.bytes
  defaultStateMachineId: [236, "u"], // Artboard.defaultStateMachineId
  activeComponentId: [296, "u"], // Solo.activeComponentId
  originX: [380, "f"], // Image.originX, a fraction of the image width
  originY: [381, "f"], // Image.originY
};

/** The property a motion's timeline keys: which Solo child is visible. */
const SOLO_ACTIVE_COMPONENT = PROP.activeComponentId[0];
/** InterpolatingKeyFrame.interpolationType: a frame is held, never blended. */
const HOLD = 0;
/** StateTransitionFlags: EnableExitTime (1 << 2) | ExitTimeIsPercentage (1 << 3).
 *  At 100 % a looping animation leaves at the end of the cycle it is in — the
 *  runtime adds the whole cycles already played to the exit time — and a
 *  one-shot at its last frame. */
const EXIT_TIME_PERCENT = (1 << 2) | (1 << 3);
/** TransitionConditionOp::equal (`animation/transition_condition_op.hpp`). */
const OP_EQUAL = 0;
/** Timeline rate for a motion whose own rate is not an integer — the field is
 *  an unsigned integer. At 60 a key lands within 8 ms of where it belongs. */
const FALLBACK_TIMELINE_FPS = 60;

/** The state machine every exported character carries. Rive's own default
 *  name, so a runtime example that names it works unchanged. */
export const RIVE_STATE_MACHINE = "State Machine 1";
const RIVE_LAYER = "Layer 1";

/** The number input that names the loop a character should be in. */
export const RIVE_MOTION_INPUT = "motion";

/** The trigger that plays one one-shot. */
export function riveTriggerName(motionId) {
  return `play_${motionId}`;
}

const isIdleId = (id) => /(^|[-_])idle($|[-_\d])/i.test(String(id));
const isTransition = (m) => m.kind === "transition";
const isLoop = (m) => !!m.loop && !isTransition(m);

/**
 * The motion the state machine rests in when no loop can: the motion called
 * idle (`idle`, `idle-2`, `lantern_idle`) — a looping one first, then any —
 * otherwise the first looping motion, otherwise the first motion. An idle
 * that plays once still rests the machine: it plays, holds its last frame and
 * waits for a trigger, which is what a character called idle is for.
 * Transitions are never the resting state, whatever they are called.
 */
export function riveDefaultMotion(motions) {
  const own = (m) => !isTransition(m);
  const loopingIdle = motions.findIndex((m) => isLoop(m) && isIdleId(m.id));
  if (loopingIdle !== -1) return loopingIdle;
  const idle = motions.findIndex((m) => own(m) && isIdleId(m.id));
  if (idle !== -1) return idle;
  const looping = motions.findIndex(isLoop);
  if (looping !== -1) return looping;
  const first = motions.findIndex(own);
  return first !== -1 ? first : 0;
}

/**
 * The hub: the loop every route passes through when no clip joins two loops
 * directly. The looping idle, otherwise the first loop; `hubId` names another
 * loop. -1 when nothing in the file loops.
 */
export function riveHub(motions, hubId) {
  if (hubId !== undefined && hubId !== null) {
    const i = motions.findIndex((m) => m.id === hubId);
    if (i === -1) throw new Error(`riv: hub '${hubId}' is not in the file`);
    if (!isLoop(motions[i])) {
      throw new Error(`riv: hub '${hubId}' does not loop — the hub is a loop every route passes through`);
    }
    return i;
  }
  const loopingIdle = motions.findIndex((m) => isLoop(m) && isIdleId(m.id));
  return loopingIdle !== -1 ? loopingIdle : motions.findIndex(isLoop);
}

/**
 * The routed state machine, as a graph — what `writeRiv` encodes and the
 * report explains.
 *
 * `motions`: [{ id, loop, kind?, from?, to? }] in file order. A transition
 * (`kind: "transition"`) is a clip from loop `from`'s frame 0 to loop `to`'s.
 *
 * - `motion` (a number) names the loop to be in: loop i of the file, in file
 *   order, is value i. It starts on the hub.
 * - Each one-shot keeps a trigger, fired from any state.
 * - Every exit waits for the end of what is playing: a loop's cycle, a
 *   clip's last frame. Nothing changes state mid-cycle.
 * - From loop C toward loop T: C→T's clip if there is one; otherwise, when C
 *   is not the hub, C→hub's clip; otherwise the hub→T clip, or T. A clip's
 *   end branches on `motion` the same way from the loop it ends on, so a
 *   character never settles into the hub for a cycle it has no reason to
 *   play.
 * - A one-shot ends by cutting to the loop `motion` names, else the hub.
 *
 * Returns `{ hub, entry, number, triggers, any, states: [{ motion, exits:
 * [{ to, when }] }], routes, cuts }`. `when` is the `motion` value an exit
 * needs, null for none. `routes` spells out every loop-to-loop route as
 * `{ transition }` and `{ cut: { from, to } }` steps; `cuts` lists every edge
 * in the file whose two sides do not share a pose — the last frame of `from`
 * against the first of `to`; `from: null` is a one-shot fired from anywhere.
 */
export function riveStateMachine(motions, options = {}) {
  const byId = new Map();
  for (const m of motions) {
    if (byId.has(m.id)) throw new Error(`riv: motion '${m.id}' appears twice`);
    byId.set(m.id, m);
  }
  const loops = motions.filter(isLoop).map((m) => m.id);
  const value = new Map(loops.map((id, v) => [id, v]));
  const hubIndex = riveHub(motions, options.hub);
  const hub = hubIndex === -1 ? null : motions[hubIndex].id;

  const clips = new Map();
  const pair = (a, b) => `${a}\u0000${b}`;
  for (const m of motions.filter(isTransition)) {
    for (const end of [m.from, m.to]) {
      if (!value.has(end)) {
        throw new Error(`riv: transition '${m.id}' joins '${end}', which is not a loop in this file`);
      }
    }
    if (m.from === m.to) throw new Error(`riv: transition '${m.id}' starts and ends on '${m.from}'`);
    const taken = clips.get(pair(m.from, m.to));
    if (taken) throw new Error(`riv: transition '${m.id}' joins the same loops as '${taken}'`);
    clips.set(pair(m.from, m.to), m.id);
  }
  const clip = (a, b) => clips.get(pair(a, b));
  /** The next state from loop pose `c` toward loop `t` (c ≠ t). */
  const route = (c, t) => clip(c, t) ?? (c !== hub ? clip(c, hub) : undefined) ?? clip(hub, t) ?? t;

  const states = motions.map((m) => {
    let exits = [];
    if (isLoop(m)) {
      exits = loops.filter((t) => t !== m.id).map((t) => ({ to: route(m.id, t), when: value.get(t) }));
    } else if (isTransition(m)) {
      exits = [
        ...loops.filter((t) => t !== m.to).map((t) => ({ to: route(m.to, t), when: value.get(t) })),
        { to: m.to, when: null },
      ];
    } else if (hub !== null) {
      exits = [
        ...loops.filter((t) => t !== hub).map((t) => ({ to: t, when: value.get(t) })),
        { to: hub, when: null },
      ];
    }
    return { motion: m.id, exits };
  });
  const exitsOf = new Map(states.map((s) => [s.motion, s.exits]));

  // The pose a state ends on and the one it starts from, as a loop id; null
  // for a one-shot, whose poses are its own.
  const endPose = (id) => {
    const m = byId.get(id);
    return isLoop(m) ? id : isTransition(m) ? m.to : null;
  };
  const startPose = (id) => {
    const m = byId.get(id);
    return isLoop(m) ? id : isTransition(m) ? m.from : null;
  };
  const isCut = (from, to) => from === null || endPose(from) === null || endPose(from) !== startPose(to);

  const routes = [];
  for (const c of loops) {
    for (const t of loops) {
      if (c === t) continue;
      const steps = [];
      let at = c;
      for (let hop = 0; at !== t; hop++) {
        if (hop > motions.length) throw new Error(`riv: no route from '${c}' to '${t}'`);
        const exit = exitsOf.get(at).find((e) => e.when === null || e.when === value.get(t));
        if (isCut(at, exit.to)) steps.push({ cut: { from: at, to: exit.to } });
        if (isTransition(byId.get(exit.to))) steps.push({ transition: exit.to });
        at = exit.to;
      }
      routes.push({ from: c, to: t, steps });
    }
  }

  const triggers = motions
    .filter((m) => !m.loop && !isTransition(m))
    .map((m) => ({ name: riveTriggerName(m.id), motion: m.id }));
  const any = triggers.map((t) => ({ to: t.motion, trigger: t.name }));

  const cuts = [];
  const seen = new Set();
  const addCut = (from, to) => {
    const key = pair(from ?? "", to);
    if (seen.has(key)) return;
    seen.add(key);
    cuts.push({ from, to });
  };
  for (const t of any) addCut(null, t.to);
  for (const state of states) {
    for (const exit of state.exits) if (isCut(state.motion, exit.to)) addCut(state.motion, exit.to);
  }

  const entry = hub ?? motions[riveDefaultMotion(motions)].id;
  return {
    hub,
    entry,
    number: hub === null ? null : {
      name: RIVE_MOTION_INPUT,
      default: value.get(hub),
      values: loops.map((id) => ({ value: value.get(id), motion: id })),
    },
    triggers,
    any,
    states,
    routes,
    cuts,
  };
}

/**
 * Where a motion's frames sit on its timeline.
 *
 * `LinearAnimation.fps` is an unsigned integer, so a motion at an integer rate
 * keys frame i at timeline frame i. A rate like 7.5 or 11.6 (a clip sampled at
 * its own speed) is re-keyed on a 60 fps timeline at round(i · 60 / fps), and
 * the duration becomes round(n · 60 / fps): the same seconds, the same frames.
 */
export function riveTimeline(fps, frameCount) {
  if (Number.isInteger(fps) && fps > 0) {
    return { fps, duration: frameCount, keys: Array.from({ length: frameCount }, (_, i) => i) };
  }
  const scale = FALLBACK_TIMELINE_FPS / fps;
  return {
    fps: FALLBACK_TIMELINE_FPS,
    duration: Math.max(1, Math.round(frameCount * scale)),
    keys: Array.from({ length: frameCount }, (_, i) => Math.round(i * scale)),
  };
}

/** The byte stream of one `.riv`, written object by object. */
class RivWriter {
  constructor() {
    this.chunks = [];
  }

  byte(value) {
    this.chunks.push(Uint8Array.of(value));
  }

  varuint(value) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`riv: ${value} is not an unsigned integer`);
    const out = [];
    let n = value;
    do {
      let b = n & 0x7f;
      n = Math.floor(n / 128);
      if (n) b |= 0x80;
      out.push(b);
    } while (n);
    this.chunks.push(Uint8Array.from(out));
  }

  float(value) {
    const b = Buffer.alloc(4);
    b.writeFloatLE(value);
    this.chunks.push(b);
  }

  blob(value) {
    const b = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
    this.varuint(b.length);
    this.chunks.push(b);
  }

  /** One object: its type key, each `(key, value)` pair, then a 0. */
  object(type, props = {}) {
    this.varuint(TYPE[type]);
    for (const [name, value] of Object.entries(props)) {
      if (value === undefined) continue;
      const [key, kind] = PROP[name];
      this.varuint(key);
      if (kind === "u") this.varuint(value);
      else if (kind === "f") this.float(value);
      else if (kind === "s" || kind === "y") this.blob(value);
      else this.byte(value ? 1 : 0);
    }
    this.varuint(0);
  }

  bytes() {
    return Buffer.concat(this.chunks);
  }
}

const pad2 = (i) => String(i).padStart(2, "0");

/**
 * Write one character as a `.riv`.
 *
 * `spec`:
 *   artboard: { name, width, height }
 *   anchor:   { x, y } — where every frame's pivot lands on the artboard
 *   hub:      optional id of the loop routes pass through (see `riveHub`)
 *   motions:  [{ id, fps, loop, kind?, from?, to?, frames }]
 *             A frame is `{ bytes, width, height, pivot: {x, y}, ext }` —
 *             `pivot` in the frame's own pixels; the Image origin is that
 *             point as a fraction of the frame, so frames of different sizes
 *             still stand on the same spot — or `{ shared: { motion, index } }`,
 *             another motion's embedded frame shown again: a reverse
 *             transition is its source's images backwards and embeds none.
 *             `kind: "transition"` with `from`/`to` makes a clip the machine
 *             routes through (`riveStateMachine`).
 *
 * Returns the bytes plus what a developer needs to drive them: each motion's
 * timeline, and the state machine's name, hub, inputs, every loop-to-loop
 * route with its worst-case seconds, every cut, and each loop's wait.
 */
export function writeRiv(spec) {
  const { artboard, anchor, motions } = spec;
  if (!motions?.length) throw new Error("riv: no motion to write");
  for (const motion of motions) {
    if (!motion.frames?.length) throw new Error(`riv: motion '${motion.id}' has no frames`);
  }
  const graph = riveStateMachine(motions, { hub: spec.hub });

  const w = new RivWriter();
  // Header: fingerprint, major 7, minor 0, file id 0, and an empty table of
  // contents — every property written here is one every runtime knows, and
  // the ToC only exists so an older runtime can skip newer ones.
  w.chunks.push(Buffer.from("RIVE", "latin1"));
  w.varuint(7);
  w.varuint(0);
  w.varuint(0);
  w.varuint(0);
  w.object("Backboard");

  // Assets first, one per embedded frame, in motion order. An Image names its
  // asset by position in this list. A shared frame embeds nothing.
  const placed = [];
  const embedded = new Map();
  for (const motion of motions) {
    motion.frames.forEach((frame, index) => {
      if (frame.shared) return;
      const assetIndex = placed.length;
      w.object("ImageAsset", {
        assetName: `${motion.id}_${pad2(index)}.${frame.ext ?? "png"}`,
        fileAssetId: assetIndex + 1,
        assetWidth: frame.width,
        assetHeight: frame.height,
      });
      w.object("FileAssetContents", { bytes: frame.bytes });
      const entry = { motion, index, frame, assetIndex };
      placed.push(entry);
      embedded.set(`${motion.id}#${index}`, entry);
    });
  }
  const frameEntry = (motion, frame, index) => {
    if (!frame.shared) return embedded.get(`${motion.id}#${index}`);
    const entry = embedded.get(`${frame.shared.motion}#${frame.shared.index}`);
    if (!entry) {
      throw new Error(
        `riv: motion '${motion.id}' frame ${index} shows '${frame.shared.motion}' frame ${frame.shared.index}, which is not embedded`,
      );
    }
    return entry;
  };
  // Resolve every shared frame before a byte of the artboard is written.
  const shown = motions.map((motion) => motion.frames.map((frame, i) => frameEntry(motion, frame, i)));

  // The artboard's components: 0 is the artboard, 1 the Solo, 2.. the frames.
  w.object("Artboard", {
    componentName: artboard.name,
    width: artboard.width,
    height: artboard.height,
    clip: true,
    defaultStateMachineId: 0,
  });
  const SOLO = 1;
  const FIRST_IMAGE = 2;
  w.object("Solo", { componentName: "frames", parentId: 0, activeComponentId: FIRST_IMAGE });
  placed.forEach((entry, i) => {
    entry.component = FIRST_IMAGE + i;
    w.object("Image", {
      componentName: `${entry.motion.id}_${pad2(entry.index)}`,
      parentId: SOLO,
      x: anchor.x,
      y: anchor.y,
      imageAssetId: entry.assetIndex,
      originX: entry.frame.pivot.x / entry.frame.width,
      originY: entry.frame.pivot.y / entry.frame.height,
    });
  });

  // One timeline per motion, holding one Solo child per frame.
  const animations = motions.map((motion, m) => {
    const timeline = riveTimeline(motion.fps, motion.frames.length);
    w.object("LinearAnimation", {
      animationName: motion.id,
      fps: timeline.fps,
      duration: timeline.duration,
      loopValue: motion.loop ? 1 : 0,
    });
    w.object("KeyedObject", { objectId: SOLO });
    w.object("KeyedProperty", { propertyKey: SOLO_ACTIVE_COMPONENT });
    shown[m].forEach((entry, i) => {
      w.object("KeyFrameId", { frame: timeline.keys[i], interpolationType: HOLD, idValue: entry.component });
    });
    return {
      motion: motion.id,
      fps: timeline.fps,
      duration: timeline.duration,
      loop: !!motion.loop,
      seconds: Math.round((timeline.duration / timeline.fps) * 1000) / 1000,
    };
  });

  // The state machine. Inputs are indexed in declaration order — the number
  // first, then one trigger per one-shot; layer states in declaration order
  // too: Any 0, Exit 1, Entry 2, then one AnimationState per motion from 3.
  // A transition belongs to the state written before it, a condition to the
  // transition before it.
  const stateOf = new Map(motions.map((motion, i) => [motion.id, 3 + i]));
  w.object("StateMachine", { animationName: RIVE_STATE_MACHINE });
  const inputs = [];
  if (graph.number) {
    w.object("StateMachineNumber", { machineComponentName: graph.number.name, numberValue: graph.number.default });
    inputs.push({ name: graph.number.name, type: "number", default: graph.number.default, values: graph.number.values });
  }
  const triggerInput = new Map();
  for (const trigger of graph.triggers) {
    triggerInput.set(trigger.name, inputs.length);
    w.object("StateMachineTrigger", { machineComponentName: trigger.name });
    inputs.push({ name: trigger.name, type: "trigger", motion: trigger.motion });
  }
  w.object("StateMachineLayer", { machineComponentName: RIVE_LAYER });
  w.object("AnyState");
  for (const edge of graph.any) {
    w.object("StateTransition", { stateToId: stateOf.get(edge.to) });
    w.object("TransitionTriggerCondition", { inputId: triggerInput.get(edge.trigger) });
  }
  w.object("ExitState");
  w.object("EntryState");
  w.object("StateTransition", { stateToId: stateOf.get(graph.entry) });
  motions.forEach((motion, i) => {
    w.object("AnimationState", { animationId: i });
    for (const exit of graph.states[i].exits) {
      w.object("StateTransition", {
        stateToId: stateOf.get(exit.to),
        transitionFlags: EXIT_TIME_PERCENT,
        exitTime: 100,
      });
      if (exit.when !== null) {
        w.object("TransitionNumberCondition", { inputId: 0, opValue: OP_EQUAL, conditionValue: exit.when });
      }
    }
  });

  const seconds = new Map(animations.map((a) => [a.motion, a.seconds]));
  const ms = (n) => Math.round(n * 1000) / 1000;
  return {
    bytes: w.bytes(),
    animations,
    stateMachine: {
      name: RIVE_STATE_MACHINE,
      hub: graph.hub,
      defaultMotion: graph.entry,
      inputs,
      // Worst case: the whole cycle of the loop being left, then every clip
      // on the way. A cut takes no time.
      routes: graph.routes.map((r) => ({
        ...r,
        seconds: ms(r.steps.reduce((sum, step) => sum + (step.transition ? seconds.get(step.transition) : 0), seconds.get(r.from))),
      })),
      cuts: graph.cuts,
      waits: graph.number ? graph.number.values.map(({ motion }) => ({ motion, seconds: seconds.get(motion) })) : [],
    },
  };
}
