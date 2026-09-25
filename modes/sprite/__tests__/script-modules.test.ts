/**
 * The two zero-dependency modules `sprite-sheet.mjs` imports for its exports,
 * pinned as modules: `rive.mjs` (the `.riv` writer) and `zip.mjs` (the
 * store-only zip the PNG sequence ships in).
 *
 * No ffmpeg here — both modules are pure bytes in, bytes out — so this file
 * runs everywhere the routine suite does. The CLI halves (`export`, `rive`)
 * are pinned end to end in `sprite-sheet.test.ts`.
 *
 * The `.riv` is read back with `fixtures/exports/decode-riv.mjs`, whose key
 * table was copied out of rive-runtime's headers independently of the
 * writer's: a property written under the wrong key is skipped by every
 * runtime without a word, so a round trip through the writer's own table
 * would prove nothing.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeRiv, type RiveObject } from "./fixtures/exports/decode-riv.mjs";
import { readZip } from "./fixtures/exports/read-zip.mjs";
import {
  RIVE_MOTION_INPUT,
  RIVE_STATE_MACHINE,
  riveDefaultMotion,
  riveHub,
  riveStateMachine,
  riveTimeline,
  riveTrimmedPosition,
  riveTrimRect,
  riveTriggerName,
  writeRiv,
} from "../skill/scripts/rive.mjs";
import {
  RIVE_DECODE_LIMIT_BYTES,
  RIVE_DECODE_WARN_BYTES,
  RIVE_LOOP_FPS,
  RIVE_LOOP_MAX_SIZE,
  riveDecodeWarning,
  riveDefaultFilter,
  riveDefaultImages,
  rivePlan,
  riveSampleFrames,
  riveScaleFactor,
} from "../skill/scripts/rive-plan.mjs";
import { crc32, zipStore } from "../skill/scripts/zip.mjs";

/** Stand-in image bytes: the writer embeds them verbatim and never decodes. */
const fakeImage = (tag: string) => Buffer.from(`image:${tag}`);

function frames(id: string, count: number, size: { width: number; height: number }, pivot: { x: number; y: number }) {
  return Array.from({ length: count }, (_, i) => ({
    bytes: fakeImage(`${id}-${i}`),
    width: size.width,
    height: size.height,
    pivot,
    ext: "png" as const,
  }));
}

/** The objects of one type, in file order. */
const ofType = (objects: RiveObject[], type: string) => objects.filter((o) => o.type === type);

interface ReadExit { to: string; when: number | null; flags?: number; exitTime?: number }

/**
 * The state machine read back as a graph: which state goes where, on which
 * number value (null = unconditional) or trigger. States are named by the
 * animation they play. Rebuilt from decoded objects alone, so it checks the
 * encoder against `riveStateMachine` without trusting either one's order.
 */
function readMachine(riv: { objects: RiveObject[] }) {
  const animations = ofType(riv.objects, "LinearAnimation").map((a) => String(a.props.name));
  const inputs = riv.objects
    .filter((o) => o.type === "StateMachineNumber" || o.type === "StateMachineTrigger")
    .map((o) => ({ name: String(o.props.name), type: o.type }));
  const layer = riv.objects.slice(riv.objects.findIndex((o) => o.type === "StateMachineLayer") + 1);
  type State = { kind: string; motion?: string; transitions: Array<{ to: number; flags?: number; exitTime?: number; conditions: RiveObject[] }> };
  const states: State[] = [];
  for (const object of layer) {
    if (["AnyState", "ExitState", "EntryState", "AnimationState"].includes(object.type)) {
      states.push({
        kind: object.type,
        motion: object.type === "AnimationState" ? animations[Number(object.props.animationId)] : undefined,
        transitions: [],
      });
    } else if (object.type === "StateTransition") {
      states.at(-1)!.transitions.push({
        to: Number(object.props.stateToId),
        flags: object.props.flags as number | undefined,
        exitTime: object.props.exitTime as number | undefined,
        conditions: [],
      });
    } else {
      states.at(-1)!.transitions.at(-1)!.conditions.push(object);
    }
  }
  const nameOf = (i: number) => states[i].motion ?? states[i].kind;
  const any = states.find((s) => s.kind === "AnyState")!.transitions.map((t) => {
    expect(t.conditions.map((c) => c.type)).toEqual(["TransitionTriggerCondition"]);
    return { to: nameOf(t.to), trigger: inputs[Number(t.conditions[0].props.inputId)].name };
  });
  const entry = nameOf(states.find((s) => s.kind === "EntryState")!.transitions[0].to);
  const animationStates = states.filter((s) => s.kind === "AnimationState").map((s) => ({
    motion: s.motion!,
    exits: s.transitions.map((t): ReadExit => {
      let when: number | null = null;
      for (const c of t.conditions) {
        expect(c.type).toBe("TransitionNumberCondition");
        expect(inputs[Number(c.props.inputId)]).toEqual({ name: "motion", type: "StateMachineNumber" });
        expect(c.props.opValue).toBe(0); // TransitionConditionOp::equal
        when = Number(c.props.value);
      }
      return { to: nameOf(t.to), when, flags: t.flags, exitTime: t.exitTime };
    }),
  }));
  return { any, entry, states: animationStates };
}

describe("rive.mjs", () => {
  const spec = {
    artboard: { name: "Mini", width: 80, height: 90 },
    anchor: { x: 40, y: 82 },
    motions: [
      { id: "bounce", fps: 8, loop: true, frames: frames("bounce", 4, { width: 64, height: 64 }, { x: 32, y: 56 }) },
      { id: "hop", fps: 10, loop: false, frames: frames("hop", 3, { width: 48, height: 72 }, { x: 24, y: 64 }) },
    ],
  };

  test("the header is a v7 runtime file with an empty table of contents", () => {
    const { bytes } = writeRiv(spec);
    const riv = decodeRiv(bytes);
    expect(riv.fingerprint).toBe("RIVE");
    expect(riv.major).toBe(7);
    expect(riv.toc).toEqual([]);
    expect(riv.objects[0].type).toBe("Backboard");
  });

  test("every frame is one embedded image asset, in motion order, byte for byte", () => {
    const riv = decodeRiv(writeRiv(spec).bytes);
    const assets = ofType(riv.objects, "ImageAsset");
    const contents = ofType(riv.objects, "FileAssetContents");
    expect(assets).toHaveLength(7);
    expect(contents).toHaveLength(7);
    expect(assets.map((a) => a.props.name)).toEqual([
      "bounce_00.png", "bounce_01.png", "bounce_02.png", "bounce_03.png",
      "hop_00.png", "hop_01.png", "hop_02.png",
    ]);
    expect(assets[4].props).toMatchObject({ assetId: 5, width: 48, height: 72 });
    // Each contents object follows its own asset, carrying exactly its bytes.
    const order = riv.objects.map((o) => o.type);
    expect(order[order.indexOf("ImageAsset") + 1]).toBe("FileAssetContents");
    expect((contents[5].props.bytes as Buffer).toString()).toBe("image:hop-1");
  });

  test("one artboard, one Solo, one Image per frame with its pivot on the shared anchor", () => {
    const riv = decodeRiv(writeRiv(spec).bytes);
    const [artboard] = ofType(riv.objects, "Artboard");
    expect(artboard.props).toMatchObject({ name: "Mini", width: 80, height: 90, clip: 1, defaultStateMachineId: 0 });
    const solos = ofType(riv.objects, "Solo");
    expect(solos).toHaveLength(1);
    // Component index 0 is the artboard, 1 the Solo, 2.. the images.
    expect(solos[0].props).toMatchObject({ parentId: 0, activeComponentId: 2 });

    const images = ofType(riv.objects, "Image");
    expect(images).toHaveLength(7);
    for (const image of images) {
      expect(image.props).toMatchObject({ parentId: 1, x: 40, y: 82 });
    }
    // The origin is the pivot as a fraction of the frame, so every frame's
    // pivot pixel lands on (40, 82) whatever its size.
    expect(images[0].props).toMatchObject({ name: "bounce_00", assetId: 0, originX: 0.5, originY: 0.875 });
    expect(images[4].props.name).toBe("hop_00");
    expect(images[4].props.assetId).toBe(4);
    expect(images[4].props.originX).toBeCloseTo(0.5, 6);
    expect(images[4].props.originY).toBeCloseTo(64 / 72, 6);
  });

  test("each motion is a timeline that holds one Solo child per frame", () => {
    const riv = decodeRiv(writeRiv(spec).bytes);
    const animations = ofType(riv.objects, "LinearAnimation");
    expect(animations.map((a) => a.props)).toEqual([
      { name: "bounce", fps: 8, duration: 4, loopValue: 1 },
      { name: "hop", fps: 10, duration: 3, loopValue: 0 },
    ]);
    // Keyed on the Solo (component 1), property 296 = Solo.activeComponentId.
    for (const keyed of ofType(riv.objects, "KeyedObject")) expect(keyed.props).toEqual({ objectId: 1 });
    for (const property of ofType(riv.objects, "KeyedProperty")) expect(property.props).toEqual({ propertyKey: 296 });

    const keys = ofType(riv.objects, "KeyFrameId").map((k) => k.props);
    expect(keys).toHaveLength(7);
    // Hold interpolation (0): a frame is shown, never blended into the next.
    expect(keys.slice(0, 4)).toEqual([
      { frame: 0, interpolationType: 0, value: 2 },
      { frame: 1, interpolationType: 0, value: 3 },
      { frame: 2, interpolationType: 0, value: 4 },
      { frame: 3, interpolationType: 0, value: 5 },
    ]);
    expect(keys.slice(4).map((k) => k.value)).toEqual([6, 7, 8]);
  });

  test("the state machine: a number input for the loops, a trigger per one-shot, a one-shot returns on exit time", () => {
    const written = writeRiv(spec);
    const riv = decodeRiv(written.bytes);
    const [machine] = ofType(riv.objects, "StateMachine");
    expect(machine.props).toEqual({ name: RIVE_STATE_MACHINE });
    // A loop is a state the character is IN, so the loops answer to one
    // number; a one-shot is an event, so it keeps a trigger.
    expect(ofType(riv.objects, "StateMachineNumber").map((n) => n.props)).toEqual([{ name: "motion", value: 0 }]);
    expect(ofType(riv.objects, "StateMachineTrigger").map((t) => t.props.name)).toEqual(["play_hop"]);
    expect(ofType(riv.objects, "StateMachineLayer")).toHaveLength(1);

    // The layer's children in order: Any(0), Exit(1), Entry(2), then one
    // AnimationState per motion (3, 4). A transition belongs to the state
    // before it; a condition to the transition before it.
    const layer = riv.objects.slice(riv.objects.findIndex((o) => o.type === "StateMachineLayer") + 1);
    expect(layer.map((o) => o.type)).toEqual([
      "AnyState",
      "StateTransition", "TransitionTriggerCondition",
      "ExitState",
      "EntryState", "StateTransition",
      "AnimationState",
      "AnimationState", "StateTransition",
    ]);
    // Any --play_hop (input 1, after the number)--> hop.
    expect(layer[1].props).toEqual({ stateToId: 4 });
    expect(layer[2].props).toEqual({ inputId: 1 });
    // Entry -> the hub (bounce, the only loop).
    expect(layer[5].props).toEqual({ stateToId: 3 });
    expect(layer[6].props).toEqual({ animationId: 0 });
    expect(layer[7].props).toEqual({ animationId: 1 });
    // hop plays once, then 100 % exit time back to bounce:
    // EnableExitTime (4) | ExitTimeIsPercentage (8).
    expect(layer[8].props).toEqual({ stateToId: 3, flags: 12, exitTime: 100 });

    expect(written.stateMachine).toMatchObject({
      name: RIVE_STATE_MACHINE,
      hub: "bounce",
      defaultMotion: "bounce",
      inputs: [
        { name: "motion", type: "number", default: 0, values: [{ value: 0, motion: "bounce" }] },
        { name: "play_hop", type: "trigger", motion: "hop" },
      ],
    });
  });

  test("the default state is idle when there is one, else the first loop, else the first motion", () => {
    expect(riveDefaultMotion([
      { id: "wave", loop: true }, { id: "idle", loop: true }, { id: "attack", loop: false },
    ])).toBe(1);
    // An idle is the resting state whether or not it loops…
    expect(riveDefaultMotion([
      { id: "idle", loop: false }, { id: "walk", loop: true },
    ])).toBe(0);
    // …but a looping idle beats one that plays once.
    expect(riveDefaultMotion([
      { id: "idle", loop: false }, { id: "sword_idle", loop: true },
    ])).toBe(1);
    expect(riveDefaultMotion([
      { id: "attack", loop: false }, { id: "walk", loop: true },
    ])).toBe(1);
    expect(riveDefaultMotion([{ id: "attack", loop: false }, { id: "jump", loop: false }])).toBe(0);
  });

  test("with no loop at all, a one-shot holds its last frame instead of replaying another", () => {
    const oneShots = {
      ...spec,
      motions: [
        { ...spec.motions[1], id: "attack" },
        { ...spec.motions[1], id: "jump" },
      ],
    };
    const written = writeRiv(oneShots);
    expect(written.stateMachine.defaultMotion).toBe("attack");
    const riv = decodeRiv(written.bytes);
    // No exit-time transitions: returning to a one-shot default would replay
    // it after every other motion.
    const exits = ofType(riv.objects, "StateTransition").filter((t) => t.props.flags !== undefined);
    expect(exits).toEqual([]);
  });

  test("a rate the timeline cannot hold is re-keyed at 60 fps, same duration", () => {
    // LinearAnimation.fps is an unsigned integer; a from-video motion's rate
    // is often not. Keys land at round(i * 60 / fps).
    expect(riveTimeline(8, 4)).toEqual({ fps: 8, duration: 4, keys: [0, 1, 2, 3] });
    expect(riveTimeline(7.5, 4)).toEqual({ fps: 60, duration: 32, keys: [0, 8, 16, 24] });
    expect(riveTimeline(11.6, 3)).toEqual({ fps: 60, duration: 16, keys: [0, 5, 10] });
    const riv = decodeRiv(writeRiv({ ...spec, motions: [{ ...spec.motions[0], fps: 7.5 }] }).bytes);
    expect(ofType(riv.objects, "LinearAnimation")[0].props).toMatchObject({ fps: 60, duration: 32 });
    expect(ofType(riv.objects, "KeyFrameId").map((k) => k.props.frame)).toEqual([0, 8, 16, 24]);
  });

  test("webp frames are named as webp", () => {
    const webp = {
      ...spec,
      motions: [{ ...spec.motions[0], frames: spec.motions[0].frames.map((f) => ({ ...f, ext: "webp" as const })) }],
    };
    const riv = decodeRiv(writeRiv(webp).bytes);
    expect(ofType(riv.objects, "ImageAsset")[0].props.name).toBe("bounce_00.webp");
  });

  test("the decode estimate warns past 128 MB, and says what it costs", () => {
    // Every embedded image is decoded when the file loads, so the estimate is
    // the sum of w * h * 4 — a 400-frame 512x596 loop as cut is 466 MB.
    expect(RIVE_DECODE_WARN_BYTES).toBe(128 * 1024 * 1024);
    expect(RIVE_DECODE_LIMIT_BYTES).toBe(768 * 1024 * 1024);
    expect(riveDecodeWarning(7_600_000)).toBeNull();
    expect(riveDecodeWarning(RIVE_DECODE_WARN_BYTES)).toBeNull();
    const warning = riveDecodeWarning(512 * 1024 * 1024);
    expect(warning).toMatch(/512 MB/);
    expect(warning).toMatch(/over 128 MB/);
    expect(warning).toMatch(/decodes every frame/);
  });

  test("a loop named idle rests the machine; the others are reached by setting motion, at a cycle end", () => {
    // The tanka shape: every motion a UI loop, none of them a one-shot. The
    // machine rests in idle; a loop leaves only on 100 % exit time — which on
    // a looping animation is the end of the cycle it is in — when motion
    // names another loop.
    const loops = {
      ...spec,
      motions: ["wave", "idle", "typing"].map((id) => ({ ...spec.motions[0], id, loop: true })),
    };
    const written = writeRiv(loops);
    expect(written.stateMachine.defaultMotion).toBe("idle");
    expect(written.stateMachine.inputs).toEqual([{
      name: "motion", type: "number", default: 1,
      values: [{ value: 0, motion: "wave" }, { value: 1, motion: "idle" }, { value: 2, motion: "typing" }],
    }]);
    const riv = decodeRiv(written.bytes);
    expect(ofType(riv.objects, "StateMachineTrigger")).toEqual([]);
    expect(riv.objects.filter((o) => o.type === "LinearAnimation").map((o) => o.props.loopValue)).toEqual([1, 1, 1]);
    const machine = readMachine(riv);
    expect(machine.entry).toBe("idle");
    expect(machine.states.find((s) => s.motion === "wave")!.exits).toEqual([
      { to: "idle", when: 1, flags: 12, exitTime: 100 },
      { to: "typing", when: 2, flags: 12, exitTime: 100 },
    ]);
    for (const state of machine.states) {
      expect(state.exits.every((e) => e.flags === 12 && e.exitTime === 100)).toBe(true);
    }
  });

  test("trigger names are the motion id behind play_", () => {
    expect(riveTriggerName("attack")).toBe("play_attack");
  });

  test("nothing to write is refused, not an empty file", () => {
    expect(() => writeRiv({ ...spec, motions: [] })).toThrow(/no motion/);
    expect(() => writeRiv({ ...spec, motions: [{ ...spec.motions[0], frames: [] }] })).toThrow(/bounce/);
  });
});

/**
 * Connected motions: the hub, transition clips and a machine that routes.
 *
 * A frame id cannot be blended, so continuity lives in the pictures — a
 * transition clip starts on one loop's frame 0 and ends on another's — and
 * the machine's job is to only ever change state where the pictures meet: at
 * a loop's cycle end or a transition's last frame. Where no clip exists it
 * cuts, and every cut is named so the report can measure it.
 */
describe("trimming a frame without changing the drawing", () => {
  /** A width × height RGBA frame, transparent but for `set` (x, y, alpha). */
  const frame = (width: number, height: number, set: Array<[number, number, number]>) => {
    const rgba = new Uint8Array(width * height * 4);
    for (const [x, y, a] of set) rgba.set([200, 100, 50, a], (y * width + x) * 4);
    return rgba;
  };

  test("the crop is every pixel with alpha above 0, and a one-pixel ring of transparent ones", () => {
    // Alpha 1 counts: no threshold, so no faint edge pixel is ever lost.
    expect(riveTrimRect(frame(10, 8, [[3, 2, 255], [6, 5, 1]]), 10, 8)).toEqual({ x: 2, y: 1, width: 6, height: 6 });
  });

  test("at the frame's edge the ring is clamped: the crop never reaches past the frame", () => {
    expect(riveTrimRect(frame(10, 8, [[0, 0, 9], [9, 7, 9]]), 10, 8)).toEqual({ x: 0, y: 0, width: 10, height: 8 });
    expect(riveTrimRect(frame(10, 8, [[9, 3, 9]]), 10, 8)).toEqual({ x: 8, y: 2, width: 2, height: 3 });
  });

  test("a frame with nothing visible has nothing to crop", () => {
    expect(riveTrimRect(frame(10, 8, []), 10, 8)).toBeNull();
  });

  test("a crop is drawn where its pixels were: the untrimmed corner plus whole pixels, in float32", () => {
    const f = Math.fround;
    for (const [anchor, pivot, size, offset] of [[168, 115.62, 230, 17], [37, 12.3456, 64, 3], [313, 288.06, 293, 40], [20, 7, 32, 0]]) {
      const edge = f(f(anchor) - f(size * f(pivot / size)));
      const placed = riveTrimmedPosition(anchor, pivot, size, offset);
      expect(placed.position - edge).toBe(offset);
      expect(placed.exact).toBe(true);
    }
    // Where the sum crosses into a coarser power of two it may not be a
    // float32: then the nearest one, off by a float32 rounding.
    const coarse = riveTrimmedPosition(0, -1.0000001, 1, 1);
    expect(Math.abs(coarse.position - (Math.fround(0 - Math.fround(1 * Math.fround(-1.0000001))) + 1))).toBeLessThan(1e-6);
  });

  test("the writer draws a trimmed frame with origin 0 at that spot, and an untrimmed one as before", () => {
    const bytes = Buffer.from("x");
    const { bytes: riv, inexactPlacements } = writeRiv({
      artboard: { name: "T", width: 64, height: 64 },
      anchor: { x: 32, y: 60 },
      motions: [{
        id: "m", fps: 8, loop: true,
        frames: [
          { bytes, width: 10, height: 20, pivot: { x: 16, y: 58 }, trim: { x: 11, y: 30, width: 32, height: 60 } },
          { bytes, width: 32, height: 60, pivot: { x: 16, y: 58 } },
          { shared: { motion: "m", index: 0 } },
        ],
      }],
    });
    expect(inexactPlacements).toBe(0);
    const images = decodeRiv(riv).objects.filter((o) => o.type === "Image").map((o) => o.props);
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ x: 32 - 16 + 11, y: 60 - 58 + 30, originX: 0, originY: 0 });
    expect(images[1]).toMatchObject({ x: 32, y: 60 });
    expect(images[1].originX as number).toBeCloseTo(0.5, 6);
  });
});

describe("the routed state machine", () => {
  const loop = (id: string) => ({ id, loop: true });
  const x = (from: string, to: string, extra: Record<string, unknown> = {}) =>
    ({ id: `${from}-to-${to}`, loop: false, kind: "transition" as const, from, to, ...extra });
  /** wave=0, idle=1, coffee=2; idle is the hub; coffee is joined both ways. */
  const cafe = [
    loop("wave"), loop("idle"), loop("coffee"),
    x("idle", "coffee"), x("coffee", "idle", { reverseOf: "idle-to-coffee" }),
  ];
  const exitsOf = (graph: ReturnType<typeof riveStateMachine>, id: string) =>
    graph.states.find((s) => s.motion === id)!.exits;

  test("the hub is the looping idle, else the first loop; --hub names another loop", () => {
    expect(RIVE_MOTION_INPUT).toBe("motion");
    expect(riveHub(cafe)).toBe(1);
    expect(riveHub([loop("wave"), loop("coffee")])).toBe(0);
    expect(riveHub(cafe, "coffee")).toBe(2);
    // A transition is never the hub, even one whose id starts with idle.
    expect(riveHub([x("idle", "coffee"), loop("coffee"), loop("idle")])).toBe(2);
    expect(() => riveHub(cafe, "idle-to-coffee")).toThrow(/does not loop/);
    expect(() => riveHub(cafe, "nap")).toThrow(/'nap' is not in the file/);
    expect(riveHub([{ id: "attack", loop: false }])).toBe(-1);
  });

  test("a loop leaves at its cycle end through its transition, and cuts only where there is none", () => {
    const graph = riveStateMachine(cafe);
    expect(graph.hub).toBe("idle");
    expect(graph.entry).toBe("idle");
    expect(graph.number).toEqual({
      name: "motion", default: 1,
      values: [{ value: 0, motion: "wave" }, { value: 1, motion: "idle" }, { value: 2, motion: "coffee" }],
    });
    expect(graph.triggers).toEqual([]);
    // In the hub: out to coffee through its clip; to wave by a cut.
    expect(exitsOf(graph, "idle")).toEqual([{ to: "wave", when: 0 }, { to: "idle-to-coffee", when: 2 }]);
    // Out of coffee, every route goes back through the hub first.
    expect(exitsOf(graph, "coffee")).toEqual([{ to: "coffee-to-idle", when: 0 }, { to: "coffee-to-idle", when: 1 }]);
    // From wave (no clip of its own), the cut lands where the hub route would
    // be: the hub, or straight into the hub's clip toward coffee — not into
    // the hub for a whole idle cycle first.
    expect(exitsOf(graph, "wave")).toEqual([{ to: "idle", when: 1 }, { to: "idle-to-coffee", when: 2 }]);
  });

  test("a transition's end branches on motion instead of settling in for a cycle", () => {
    const graph = riveStateMachine(cafe);
    // idle-to-coffee ends on coffee's pose. If motion already names idle or
    // wave again, it goes straight on — back out through coffee-to-idle —
    // and only settles in coffee when motion still names coffee (or nothing).
    expect(exitsOf(graph, "idle-to-coffee")).toEqual([
      { to: "coffee-to-idle", when: 0 },
      { to: "coffee-to-idle", when: 1 },
      { to: "coffee", when: null },
    ]);
    expect(exitsOf(graph, "coffee-to-idle")).toEqual([
      { to: "wave", when: 0 },
      { to: "idle-to-coffee", when: 2 },
      { to: "idle", when: null },
    ]);
  });

  test("every route is spelled out, and every cut in the file is listed", () => {
    const graph = riveStateMachine(cafe);
    const route = (from: string, to: string) => graph.routes.find((r) => r.from === from && r.to === to)!.steps;
    expect(graph.routes).toHaveLength(6);
    expect(route("idle", "coffee")).toEqual([{ transition: "idle-to-coffee" }]);
    expect(route("coffee", "idle")).toEqual([{ transition: "coffee-to-idle" }]);
    expect(route("coffee", "wave")).toEqual([{ transition: "coffee-to-idle" }, { cut: { from: "coffee-to-idle", to: "wave" } }]);
    expect(route("wave", "coffee")).toEqual([{ cut: { from: "wave", to: "idle-to-coffee" } }, { transition: "idle-to-coffee" }]);
    expect(route("idle", "wave")).toEqual([{ cut: { from: "idle", to: "wave" } }]);
    // A clip entered from the loop it starts on, or left for the loop it ends
    // on, is not a cut; every other edge is, including ones no single route
    // above takes.
    expect(graph.cuts).toEqual([
      { from: "wave", to: "idle" },
      { from: "wave", to: "idle-to-coffee" },
      { from: "idle", to: "wave" },
      { from: "coffee-to-idle", to: "wave" },
    ]);
  });

  test("a transition between two loops that are not the hub is used directly", () => {
    const graph = riveStateMachine([...cafe, x("coffee", "wave")]);
    expect(exitsOf(graph, "coffee")).toEqual([{ to: "coffee-to-wave", when: 0 }, { to: "coffee-to-idle", when: 1 }]);
    expect(exitsOf(graph, "idle-to-coffee")[0]).toEqual({ to: "coffee-to-wave", when: 0 });
    expect(graph.routes.find((r) => r.from === "coffee" && r.to === "wave")!.steps)
      .toEqual([{ transition: "coffee-to-wave" }]);
  });

  test("a one-shot fires from any state and returns to the loop motion names", () => {
    const graph = riveStateMachine([...cafe, { id: "hop", loop: false }]);
    expect(graph.triggers).toEqual([{ name: "play_hop", motion: "hop" }]);
    expect(graph.any).toEqual([{ to: "hop", trigger: "play_hop" }]);
    // Where it ends is unknown, so it cuts to the loop motion names; to the
    // hub when motion names none (no separate edge for the hub itself).
    expect(exitsOf(graph, "hop")).toEqual([
      { to: "wave", when: 0 }, { to: "coffee", when: 2 }, { to: "idle", when: null },
    ]);
    expect(graph.cuts).toContainEqual({ from: null, to: "hop" });
    expect(graph.cuts).toContainEqual({ from: "hop", to: "coffee" });
  });

  test("with no loop, one-shots keep their triggers and there is no number", () => {
    const graph = riveStateMachine([{ id: "attack", loop: false }, { id: "jump", loop: false }]);
    expect(graph.hub).toBeNull();
    expect(graph.number).toBeNull();
    expect(graph.entry).toBe("attack");
    expect(graph.triggers.map((t) => t.name)).toEqual(["play_attack", "play_jump"]);
    expect(graph.states.every((s) => s.exits.length === 0)).toBe(true);
  });

  test("a transition must join two loops in the file, once per pair", () => {
    expect(() => riveStateMachine([loop("idle"), x("idle", "coffee")])).toThrow(/idle-to-coffee.*coffee/);
    expect(() => riveStateMachine([loop("idle"), { id: "hop", loop: false }, x("idle", "hop")])).toThrow(/idle-to-hop.*hop/);
    expect(() => riveStateMachine([loop("idle"), loop("coffee"), x("idle", "coffee"), { ...x("idle", "coffee"), id: "again" }]))
      .toThrow(/again.*idle-to-coffee/);
  });

  test("the file: the graph as written, a reverse drawn from its source's images, the waits reported", () => {
    const size = { width: 40, height: 60 };
    const pivot = { x: 20, y: 56 };
    const written = writeRiv({
      artboard: { name: "Cafe", width: 80, height: 90 },
      anchor: { x: 40, y: 82 },
      motions: [
        { id: "wave", fps: 8, loop: true, frames: frames("wave", 4, size, pivot) },
        { id: "idle", fps: 8, loop: true, frames: frames("idle", 8, size, pivot) },
        { id: "coffee", fps: 8, loop: true, frames: frames("coffee", 6, size, pivot) },
        { id: "idle-to-coffee", fps: 8, loop: false, kind: "transition", from: "idle", to: "coffee", frames: frames("in", 5, size, pivot) },
        {
          id: "coffee-to-idle", fps: 8, loop: false, kind: "transition", from: "coffee", to: "idle",
          frames: [4, 3, 2, 1, 0].map((index) => ({ shared: { motion: "idle-to-coffee", index } })),
        },
      ],
    });
    const riv = decodeRiv(written.bytes);
    // 4 + 8 + 6 + 5 images: the reverse embeds none.
    expect(ofType(riv.objects, "ImageAsset")).toHaveLength(23);
    expect(ofType(riv.objects, "Image")).toHaveLength(23);
    const keys = (name: string) => {
      const start = riv.objects.findIndex((o) => o.type === "LinearAnimation" && o.props.name === name);
      const out: number[] = [];
      for (let i = start + 3; i < riv.objects.length && riv.objects[i].type === "KeyFrameId"; i++) {
        out.push(Number(riv.objects[i].props.value));
      }
      return out;
    };
    expect(keys("coffee-to-idle")).toEqual([...keys("idle-to-coffee")].reverse());
    expect(ofType(riv.objects, "LinearAnimation").map((a) => a.props.loopValue)).toEqual([1, 1, 1, 0, 0]);

    // Read back without the writer's help, the machine is the pure graph.
    const graph = riveStateMachine([
      loop("wave"), loop("idle"), loop("coffee"), x("idle", "coffee"), x("coffee", "idle"),
    ]);
    const machine = readMachine(riv);
    expect(machine.entry).toBe(graph.entry);
    expect(machine.any).toEqual(graph.any);
    expect(machine.states.map((s) => ({ motion: s.motion, exits: s.exits.map(({ to, when }) => ({ to, when })) })))
      .toEqual(graph.states);
    // Every exit waits for the end: a loop's cycle, a clip's last frame.
    expect(machine.states.flatMap((s) => s.exits).every((e) => e.flags === 12 && e.exitTime === 100)).toBe(true);
    expect(ofType(riv.objects, "StateMachineNumber").map((n) => n.props)).toEqual([{ name: "motion", value: 1 }]);

    expect(written.stateMachine.routes).toEqual(graph.routes.map((r) => ({
      ...r,
      // Worst case: the whole cycle of the loop being left, then every clip on the way.
      seconds: ({ "wave>idle": 0.5, "wave>coffee": 0.5 + 0.625, "idle>wave": 1, "idle>coffee": 1 + 0.625,
        "coffee>wave": 0.75 + 0.625, "coffee>idle": 0.75 + 0.625 } as Record<string, number>)[`${r.from}>${r.to}`],
    })));
    expect(written.stateMachine.cuts).toEqual(graph.cuts);
    expect(written.stateMachine.waits).toEqual([
      { motion: "wave", seconds: 0.5 }, { motion: "idle", seconds: 1 }, { motion: "coffee", seconds: 0.75 },
    ]);
  });

  test("a shared frame must point at an embedded one", () => {
    const one = frames("a", 2, { width: 10, height: 10 }, { x: 5, y: 9 });
    const base = { artboard: { name: "A", width: 10, height: 10 }, anchor: { x: 5, y: 9 } };
    expect(() => writeRiv({
      ...base,
      motions: [
        { id: "a", fps: 8, loop: true, frames: one },
        { id: "b", fps: 8, loop: true, frames: [{ shared: { motion: "a", index: 7 } }] },
      ],
    })).toThrow(/'b' frame 0.*'a' frame 7/);
  });
});

describe("zip.mjs", () => {
  test("CRC-32 is the standard one", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  test("entries are stored, not deflated, with their CRC and sizes", () => {
    const files = [
      { name: "bounce/animation.json", data: Buffer.from('{"fps":8}\n') },
      { name: "bounce/00.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    ];
    const zip = zipStore(files);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["bounce/animation.json", "bounce/00.png"]);
    for (const [i, entry] of entries.entries()) {
      expect(entry.method).toBe(0);
      expect(entry.compressed).toBe(files[i].data.length);
      expect(entry.size).toBe(files[i].data.length);
      expect(entry.crc).toBe(crc32(files[i].data));
      expect(Buffer.compare(entry.data, files[i].data)).toBe(0);
    }
  });

  test("the system unzip reads it back", () => {
    const unzip = spawnSync("unzip", ["-v"], { stdio: "ignore" });
    if (unzip.error || unzip.status !== 0) {
      console.warn("(skip) unzip not on PATH — the central directory parse above is the check");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "sprite-zip-"));
    try {
      const path = join(dir, "frames.zip");
      writeFileSync(path, zipStore([
        { name: "hop/animation.json", data: Buffer.from("{}") },
        { name: "hop/000.png", data: Buffer.from("png bytes") },
      ]));
      const listed = spawnSync("unzip", ["-l", path], { encoding: "utf-8" });
      expect(listed.status).toBe(0);
      expect(listed.stdout).toContain("hop/animation.json");
      expect(listed.stdout).toContain("hop/000.png");
      const tested = spawnSync("unzip", ["-t", path], { encoding: "utf-8" });
      expect(tested.status).toBe(0);
      expect(tested.stdout).toMatch(/No errors detected/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a name that could escape the extraction directory is refused", () => {
    expect(() => zipStore([{ name: "../evil.png", data: Buffer.from("x") }])).toThrow(/name/);
    expect(() => zipStore([{ name: "/abs.png", data: Buffer.from("x") }])).toThrow(/name/);
  });
});

/**
 * What a character costs in Rive, decided before a pixel is read.
 *
 * A loop is cut at the clip's own rate and width — tanka's are 60 fps and
 * 512 px, 230-300 frames each — and every Rive runtime decodes every embedded
 * frame when the file opens. So a loop goes in resampled and downscaled, and
 * this plan is the one place that says how: the script follows it, and the
 * viewer quotes it before anyone presses Generate.
 */
describe("rive-plan.mjs", () => {
  describe("a trimmed measurement", () => {
    const loop = { id: "idle", kind: "loop" as const, loop: true, fps: 24, frames: 10, width: 100, height: 200 };
    const full = 10 * 100 * 200 * 4;
    const record = { width: 100, height: 200, fps: 24, frames: 10, filter: "smooth" as const, decodeBytes: 300_000 };

    test("quotes what an export measured while it still describes these frames", () => {
      const plan = rivePlan([{ ...loop, trim: record }], { filter: "smooth" });
      expect(plan.motions[0]).toMatchObject({ trimmed: true, decodeBytes: 300_000, untrimmedDecodeBytes: full });
      expect(plan).toMatchObject({ decodeBytes: 300_000, untrimmedDecodeBytes: full });
    });

    test("and the frames at full size otherwise: no record, other settings, another filter", () => {
      for (const [trim, options] of [
        [undefined, { filter: "smooth" }],
        [record, { filter: "smooth", maxSize: 100 }],
        [record, { filter: "smooth", fps: 12 }],
        [record, { filter: "nearest" }],
        [{ ...record, decodeBytes: full + 4 }, { filter: "smooth" }],
      ] as const) {
        const plan = rivePlan([{ ...loop, ...(trim ? { trim } : {}) }], options);
        expect(plan.motions[0].trimmed).toBe(false);
        expect(plan.decodeBytes).toBe(plan.untrimmedDecodeBytes);
      }
    });

    test("frames shown from an earlier motion's images are free only while that motion is measured and in", () => {
      const wave = { ...loop, id: "wave" };
      const shared = { ...record, shared: { bytes: 100_000, with: ["idle"] } };
      expect(rivePlan([{ ...loop, trim: record }, { ...wave, trim: shared }], { filter: "smooth" }).decodeBytes).toBe(300_000 + 200_000);
      expect(rivePlan([{ ...loop }, { ...wave, trim: shared }], { filter: "smooth" }).decodeBytes).toBe(full + 300_000);
      expect(rivePlan([{ ...wave, trim: shared }], { filter: "smooth" }).decodeBytes).toBe(300_000);
    });

    test("the style is read once for the filter and the images", () => {
      expect(riveDefaultFilter("16-bit pixel art")).toBe("nearest");
      expect(riveDefaultFilter("soft plush 3D")).toBe("smooth");
    });
  });

  test("pixel art is embedded lossless by default; everything else as lossy WebP", () => {
    for (const style of ["16-bit pixel art, crisp outline", "Pixel-style sprites", "8-bit retro", "像素风小人"]) {
      expect(riveDefaultImages(style)).toBe("webp-lossless");
    }
    for (const style of ["Soft fuzzy plush 3D character render", "", "watercolour, pixelated grain"]) {
      expect(riveDefaultImages(style)).toBe("webp");
    }
  });

  /**
   * Frames sampled from one cycle must close the same way the source does:
   * every step — the one from the last kept frame back to frame 0 included —
   * is the stride `count / kept` rounded down or up. A repeated frame at the
   * wrap would be a step of 0; a skipped stretch, a step past the stride.
   */
  const closes = (indices: number[], count: number) => {
    const steps = [...indices.slice(1).map((v, i) => v - indices[i]), count - indices.at(-1)!];
    const stride = count / indices.length;
    return {
      first: indices[0],
      increasing: steps.every((s) => s > 0),
      even: steps.every((s) => s === Math.floor(stride) || s === Math.ceil(stride)),
    };
  };

  test("a loop is sampled evenly across its duration, and still closes", () => {
    // tanka's idle: 244 frames at 60 fps, 4.067 s → round(4.067 × 24) = 98.
    const idle = riveSampleFrames(244, 60, 24, true);
    expect(idle.fps).toBe(24);
    expect(idle.indices).toHaveLength(98);
    expect(idle.indices.slice(0, 4)).toEqual([0, 2, 4, 7]);
    expect(idle.indices.at(-1)).toBe(Math.floor((97 * 244) / 98));
    expect(closes(idle.indices, 244)).toEqual({ first: 0, increasing: true, even: true });
    // Any count against any rate.
    for (const [count, source, fps] of [[281, 60, 24], [12, 12, 6], [230, 60, 10], [7, 24, 10], [303, 60, 7]]) {
      const plan = riveSampleFrames(count, source, fps, true);
      expect({ count, source, fps, length: plan.indices.length })
        .toEqual({ count, source, fps, length: Math.max(1, Math.round((count * fps) / source)) });
      expect({ count, fps, ...closes(plan.indices, count) })
        .toEqual({ count, fps, first: 0, increasing: true, even: true });
    }
  });

  test("a motion too short for the rate still keeps one frame", () => {
    expect(riveSampleFrames(7, 24, 2, true)).toEqual({ fps: 2, indices: [0] });
  });

  test("a one-shot keeps its first and its last frame", () => {
    // It ends on a pose and hands over from there; dropping the last frame
    // would end the attack somewhere else.
    const hop = riveSampleFrames(16, 10, 5, false);
    expect(hop.indices).toEqual([0, 2, 4, 6, 9, 11, 13, 15]);
  });

  test("a rate at or above the motion's own keeps every frame", () => {
    // Asking for more frames than there are would only repeat them — memory
    // for nothing — so the motion keeps its own rate.
    expect(riveSampleFrames(12, 12, 24, true)).toEqual({ fps: 12, indices: Array.from({ length: 12 }, (_, i) => i) });
    expect(riveSampleFrames(16, 8, null, false).fps).toBe(8);
  });

  test("one factor per kind, so a character keeps its size from motion to motion", () => {
    // The largest frame fits the longest edge; everything else shrinks by
    // the same factor, never more, and nothing is ever enlarged.
    expect(riveScaleFactor([{ width: 512, height: 652 }, { width: 512, height: 570 }], 320)).toBeCloseTo(320 / 652, 10);
    expect(riveScaleFactor([{ width: 64, height: 72 }], 320)).toBe(1);
    expect(riveScaleFactor([{ width: 512, height: 652 }], null)).toBe(1);
  });

  test("the plan: loops at 24 fps and 320 px, sprite motions as they are", () => {
    const plan = rivePlan([
      { id: "idle", kind: "loop", loop: true, fps: 60, frames: 244, width: 512, height: 652 },
      { id: "wave", kind: "loop", loop: true, fps: 60, frames: 281, width: 512, height: 570 },
      { id: "attack", kind: "sprite", loop: false, fps: 10, frames: 16, width: 272, height: 262 },
    ]);
    expect(RIVE_LOOP_FPS).toBe(24);
    expect(RIVE_LOOP_MAX_SIZE).toBe(320);
    expect(plan.settings).toEqual({ loop: { fps: 24, maxSize: 320 }, sprite: { fps: null, maxSize: null } });
    const [idle, wave, attack] = plan.motions;
    expect({ fps: idle.fps, frames: idle.frames, width: idle.width, height: idle.height })
      .toEqual({ fps: 24, frames: 98, width: 251, height: 320 });
    // The same factor as idle, not its own: wave stands at the same size.
    expect(wave.scale).toBe(idle.scale);
    expect({ frames: wave.frames, width: wave.width, height: wave.height })
      .toEqual({ frames: 112, width: 251, height: 280 });
    expect(attack).toMatchObject({ fps: 10, frames: 16, width: 272, height: 262, scale: 1 });
    expect(idle.source).toEqual({ frames: 244, fps: 60, width: 512, height: 652 });
    expect(idle.decodeBytes).toBe(98 * 251 * 320 * 4);
    expect(plan.decodeBytes).toBe(idle.decodeBytes + wave.decodeBytes + attack.decodeBytes);
  });

  test("a loop is first brought back to its clip's scale, then every loop shrinks by one factor", () => {
    // Two loops of one character cut from two clips at the same body size:
    // `wave`'s union crop was narrower, so the width cap drew it 2× the
    // clip, `idle` at 1×. Sharing a factor over the frames as they are would
    // draw wave's body twice as tall; over the clip's scale, they match.
    const plan = rivePlan([
      { id: "idle", kind: "loop", loop: true, fps: 24, frames: 10, width: 200, height: 200, clipScale: 1 },
      { id: "wave", kind: "loop", loop: true, fps: 24, frames: 10, width: 400, height: 400, clipScale: 2 },
    ], { maxSize: 100 });
    const [idle, wave] = plan.motions;
    expect({ width: idle.width, height: idle.height, scale: idle.scale, clipScale: idle.clipScale })
      .toEqual({ width: 100, height: 100, scale: 0.5, clipScale: 1 });
    expect({ width: wave.width, height: wave.height, scale: wave.scale, clipScale: wave.clipScale })
      .toEqual({ width: 100, height: 100, scale: 0.25, clipScale: 2 });
    // Output px per clip px is the same number for both: scale × clipScale.
    expect(idle.scale * idle.clipScale!).toBe(wave.scale * wave.clipScale!);
  });

  test("the clip's scale never enlarges a loop past the frames it has", () => {
    // `walk` was drawn at half its clip's scale; bringing it back up would
    // invent pixels. The shared factor stops at the smallest clipScale, so
    // walk keeps its frames and `idle` comes down to walk's clip scale.
    const plan = rivePlan([
      { id: "idle", kind: "loop", loop: true, fps: 24, frames: 10, width: 400, height: 400, clipScale: 2 },
      { id: "walk", kind: "loop", loop: true, fps: 24, frames: 10, width: 100, height: 100, clipScale: 0.5 },
    ], { maxSize: 1000 });
    expect(plan.motions.map((m) => [m.width, m.height, m.scale])).toEqual([[100, 100, 0.25], [100, 100, 1]]);
    expect(riveScaleFactor([{ width: 400, height: 400, clipScale: 2 }, { width: 100, height: 100, clipScale: 0.5 }], 1000))
      .toBe(0.5);
  });

  test("a loop with no known clip scale is taken as it is, next to the ones that have one", () => {
    const plan = rivePlan([
      { id: "idle", kind: "loop", loop: true, fps: 24, frames: 10, width: 200, height: 200 },
      { id: "wave", kind: "loop", loop: true, fps: 24, frames: 10, width: 400, height: 400, clipScale: 2 },
    ], { maxSize: 100 });
    expect(plan.motions.map((m) => [m.width, m.clipScale])).toEqual([[100, null], [100, 2]]);
  });

  test("a transition is planned with the loops it joins: their factor, their rate, both its ends kept", () => {
    const plan = rivePlan([
      { id: "idle", kind: "loop", loop: true, fps: 60, frames: 240, width: 400, height: 400, clipScale: 2 },
      { id: "idle-to-coffee", kind: "transition", loop: false, fps: 24, frames: 96, width: 200, height: 200, clipScale: 1 },
    ], { maxSize: 100 });
    const [idle, transition] = plan.motions;
    expect(transition.kind).toBe("transition");
    // One factor over clip px for loops and transitions alike: both 200 clip
    // px, so both come out 100 px.
    expect([idle.width, transition.width]).toEqual([100, 100]);
    // 24 fps keeps all 96; at 12 it keeps 48, the first and the last among them.
    expect(transition.frames).toBe(96);
    const slower = rivePlan([
      { id: "idle-to-coffee", kind: "transition", loop: false, fps: 24, frames: 96, width: 200, height: 200 },
    ], { fps: 12 });
    expect(slower.motions[0].frames).toBe(48);
    expect(slower.motions[0].indices[0]).toBe(0);
    expect(slower.motions[0].indices.at(-1)).toBe(95);
  });

  test("a reverse whose source is in the file embeds nothing: the source's images, backwards", () => {
    const motions = [
      { id: "idle", kind: "loop" as const, loop: true, fps: 24, frames: 48, width: 200, height: 200 },
      { id: "coffee-to-idle", kind: "transition" as const, loop: false, fps: 24, frames: 30, width: 200, height: 200, reverseOf: "idle-to-coffee" },
      { id: "idle-to-coffee", kind: "transition" as const, loop: false, fps: 24, frames: 30, width: 200, height: 200 },
    ];
    const plan = rivePlan(motions, { fps: 12 });
    const [, reverse, source] = plan.motions;
    expect(reverse.shares).toBe("idle-to-coffee");
    expect(reverse.decodeBytes).toBe(0);
    expect(reverse.frames).toBe(source.frames);
    // Its own frame r is the source's frame 29 − r: the same pictures, backwards.
    expect(reverse.indices).toEqual(source.indices.map((i) => 29 - i).reverse());
    expect({ width: reverse.width, height: reverse.height }).toEqual({ width: source.width, height: source.height });
    expect(plan.decodeBytes).toBe(plan.motions[0].decodeBytes + source.decodeBytes);

    // Without its source in the file it carries its own frames.
    const alone = rivePlan(motions.slice(0, 2), { fps: 12 });
    expect(alone.motions[1].shares).toBeUndefined();
    expect(alone.motions[1].decodeBytes).toBeGreaterThan(0);
  });

  test("--fps and --max-size apply to sprite motions only when given", () => {
    const plan = rivePlan(
      [
        { id: "idle", kind: "loop", loop: true, fps: 60, frames: 244, width: 512, height: 652 },
        { id: "attack", kind: "sprite", loop: false, fps: 10, frames: 16, width: 272, height: 262 },
      ],
      { fps: 5, maxSize: 136 },
    );
    expect(plan.settings).toEqual({ loop: { fps: 5, maxSize: 136 }, sprite: { fps: 5, maxSize: 136 } });
    expect(plan.motions[1]).toMatchObject({ fps: 5, frames: 8, width: 136, height: 131 });
    expect(plan.motions[1].indices).toEqual([0, 2, 4, 6, 9, 11, 13, 15]);
  });
});
