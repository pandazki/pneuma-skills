/**
 * The decidable half of the Rive preview.
 *
 * The runtime (`@rive-app/canvas`) hands back inputs as objects with a numeric
 * `type`, state changes as an event whose `data` is a list of state names, and
 * failures as an `Error`, an event, or a bare string depending on where they
 * happened. Everything that interprets those shapes lives here, in plain
 * functions the tests can call without a canvas or a WASM module, so the
 * component is left with wiring and nothing to decide.
 */

/**
 * `StateMachineInputType` in the runtime: the core type keys of the three
 * input objects (StateMachineNumber 56, StateMachineTrigger 58,
 * StateMachineBool 59). Restated rather than imported so this module — and
 * the tests — never load the runtime.
 */
export const RIVE_INPUT_TYPE = { number: 56, trigger: 58, boolean: 59 } as const;

/**
 * The state machine the preview plays: the one `sprite-sheet.mjs rive` writes
 * — named the way the Rive editor names a file's first machine — and
 * otherwise the file's first. Named up front so the runtime instances it
 * directly; left unnamed, the runtime would play the first *timeline* instead.
 */
export const RIVE_PREFERRED_MACHINE = "State Machine 1";

export function riveMachineToPlay(names: readonly string[]): string | null {
  if (names.includes(RIVE_PREFERRED_MACHINE)) return RIVE_PREFERRED_MACHINE;
  return names[0] ?? null;
}

/** What the runtime's `stateMachineInputs()` returns, as far as this reads it. */
export interface RiveInputLike {
  name: string;
  type: number;
  value?: unknown;
}

/**
 * What the registered `.riv` says drives it — `register-export` copies it off
 * the `rive` report onto the file's provenance edge: the number input that
 * names the loop to be in and what each value means, and the one-shots'
 * triggers.
 */
export interface RiveMachineRecord {
  name: string;
  hub: string | null;
  number: { name: string; default: number; values: Array<{ value: number; motion: string }> } | null;
  triggers: Array<{ name: string; motion: string }>;
}

/** One control the panel draws for a state machine input. */
export type RiveControl =
  /** One loop: sets the number input to its value. */
  | { kind: "motion"; name: string; value: number; motion: string; active: boolean }
  | { kind: "trigger"; name: string; motion?: string }
  | { kind: "boolean"; name: string; value: boolean }
  | { kind: "number"; name: string; value: number };

/**
 * The controls for a state machine's inputs, in the file's order.
 *
 * With the file's record, a sprite `.riv` reads as what it is: one button per
 * loop, each setting `motion` to that loop's value (the one it holds now is
 * marked), and one button per one-shot, firing its trigger. Anything the
 * record does not describe — an older file, a file from elsewhere — is read
 * as the file declares it: a boolean becomes a toggle and a number a stepper.
 * An input of a kind the panel cannot drive, or with no name to show, is left
 * out rather than drawn as a control that does nothing.
 */
export function riveControls(
  inputs: readonly RiveInputLike[],
  machine: RiveMachineRecord | null = null,
): RiveControl[] {
  const controls: RiveControl[] = [];
  for (const input of inputs) {
    if (typeof input?.name !== "string" || input.name === "") continue;
    switch (input.type) {
      case RIVE_INPUT_TYPE.trigger: {
        const motion = machine?.triggers.find((t) => t.name === input.name)?.motion;
        controls.push(motion ? { kind: "trigger", name: input.name, motion } : { kind: "trigger", name: input.name });
        break;
      }
      case RIVE_INPUT_TYPE.boolean:
        controls.push({ kind: "boolean", name: input.name, value: input.value === true });
        break;
      case RIVE_INPUT_TYPE.number: {
        const value = typeof input.value === "number" && Number.isFinite(input.value) ? input.value : 0;
        if (machine?.number && machine.number.name === input.name && machine.number.values.length > 0) {
          for (const entry of machine.number.values) {
            controls.push({ kind: "motion", name: input.name, value: entry.value, motion: entry.motion, active: entry.value === value });
          }
        } else {
          controls.push({ kind: "number", name: input.name, value });
        }
        break;
      }
      default:
        break;
    }
  }
  return controls;
}

/** How many states the preview keeps on screen — enough to show a route
 *  through the hub (idle → idle-to-coffee → coffee) and where it came from. */
export const RIVE_TRAIL_LENGTH = 4;

/**
 * The route as the states go by: the last few state names, newest last. A
 * repeat of the current state (a loop re-reported) adds nothing; no name
 * leaves it as it is.
 */
export function riveTrail(trail: readonly string[], name: string | null, max = RIVE_TRAIL_LENGTH): string[] {
  if (!name || trail[trail.length - 1] === name) return [...trail];
  return [...trail, name].slice(-max);
}

/**
 * The state the machine is in now, from an `onStateChange` event's `data`:
 * the runtime reports the states entered during one advance, in order, so the
 * last name is the current one.
 */
export function riveStateName(data: unknown): string | null {
  if (typeof data === "string") return data || null;
  if (!Array.isArray(data)) return null;
  for (let i = data.length - 1; i >= 0; i--) {
    const name = data[i];
    if (typeof name === "string" && name !== "") return name;
  }
  return null;
}

/** Where a preview failed: loading the runtime (the WASM), opening the file,
 *  or finding a state machine in it. */
export type RiveFailureStage = "runtime" | "file" | "state-machine";

export interface RiveFailure {
  stage: RiveFailureStage;
  /** What the runtime said, verbatim — "" when it said nothing. */
  detail: string;
}

/**
 * A failure the panel can print. The stage picks the sentence (strings.ts);
 * the detail is the runtime's own words, which are the only clue to a broken
 * file or a WASM the server did not serve.
 */
export function riveFailure(stage: RiveFailureStage, error: unknown): RiveFailure {
  return { stage, detail: failureText(error) };
}

function failureText(error: unknown): string {
  if (error === null || error === undefined) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.data === "string") return record.data;
    if (record.data instanceof Error) return record.data.message;
    if (typeof record.message === "string") return record.message;
  }
  return String(error);
}
