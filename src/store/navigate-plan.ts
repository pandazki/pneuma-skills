/**
 * What a `<viewer-locator>` click (or a `capture`-driven navigation) should
 * do with its address, decided as a pure value before anything is set.
 *
 * WHY THIS IS A FUNCTION AND NOT INLINE STORE CODE: the store's job here is
 * genuinely a decision — switch a content set, hand the rest to the viewer,
 * or refuse — and the refuse branch used to be missing, silently. A card
 * naming a board that is NOT in the workspace skipped the switch and then
 * dispatched the rest of the address ANYWAY, so the click landed on
 * whichever board happened to be open and looked, from the outside, like a
 * successful navigation to somewhere else entirely. That is the failure a
 * pure function makes testable: four named outcomes, no `set()` in sight.
 *
 * `contentSet` is the ONE framework-level coordinate in a ViewerAddress
 * (`core/types/viewer-contract.ts`). Every other key is mode-defined and
 * opaque — this module must never read one, and never guesses which board a
 * mode meant.
 */

import type { ViewerAddress } from "../../core/types/viewer-contract.js";

/** A content set as the store knows it — only its key matters here. */
export interface ContentSetLike {
  prefix: string;
}

export type NavigatePlan =
  /** Hand `address` to the viewer, after switching to `switchTo` if set.
   *  `delayed` mirrors the switch: a viewer that is being handed a new set
   *  needs it mounted before the address means anything. */
  | { kind: "dispatch"; address: ViewerAddress; switchTo?: string; delayed: boolean }
  /** The address named a board and nothing inside it — switch, then stop. */
  | { kind: "switch"; switchTo: string }
  /** The address named the board already on screen and nothing inside it.
   *  Arriving where you already are is not a failure — and dispatching an
   *  empty address would make the viewer resolve nothing and report one. */
  | { kind: "noop" }
  /** The address named a board this workspace does not have. Refuse: a
   *  wrong board is worse than no move, because it looks like a move. */
  | { kind: "refuse"; code: "unknownContentSet"; contentSet: string };

/** Content-set keys are directories; the seed catalogue writes them with a
 *  trailing slash (`tech-zh/`) and that is the shape an agent copies, so
 *  both sides are trimmed before they are compared. Mirrors the leniency
 *  each mode already applies at its own agent-input boundary. */
const trim = (key: string): string => key.replace(/^\/+|\/+$/g, "");

export function planNavigate(
  address: ViewerAddress,
  activeContentSet: string | null,
  contentSets: readonly ContentSetLike[],
): NavigatePlan {
  const named = typeof address.contentSet === "string" ? trim(address.contentSet) : "";

  if (named) {
    // The workspace's own spelling wins over the address's: the switch and
    // the file-prefix strip below must both use the key the store holds.
    const known = contentSets.find((cs) => trim(cs.prefix) === named);
    if (!known) {
      // A workspace with NO sets has nothing to check the name against —
      // its content sits at the root. Refusing there would break every
      // address an agent writes out of habit, so the name is dropped and
      // the rest is handed over, exactly as it was before this refusal
      // existed. The refusal is for a workspace that HAS boards and does
      // not have this one.
      if (contentSets.length === 0) {
        const { contentSet: _named, ...bare } = address;
        return Object.keys(bare).length === 0
          ? { kind: "noop" }
          : { kind: "dispatch", address: bare, delayed: false };
      }
      return { kind: "refuse", code: "unknownContentSet", contentSet: named };
    }
    const needsSwitch = trim(activeContentSet ?? "") !== named;
    const { contentSet: _contentSet, ...rest } = address;
    const file = rest.file;
    if (typeof file === "string" && file.startsWith(`${known.prefix}/`)) {
      rest.file = file.slice(known.prefix.length + 1);
    }
    if (Object.keys(rest).length === 0) {
      return needsSwitch
        ? { kind: "switch", switchTo: known.prefix }
        : { kind: "noop" };
    }
    return {
      kind: "dispatch",
      address: rest,
      ...(needsSwitch ? { switchTo: known.prefix } : {}),
      delayed: needsSwitch,
    };
  }

  // No `contentSet` key: a file path may still carry one as its prefix —
  // the shape a mode whose address vocabulary is file-based produces.
  const file = typeof address.file === "string" ? address.file : null;
  if (file) {
    const matched = contentSets.find((cs) => file.startsWith(`${cs.prefix}/`));
    if (matched) {
      const needsSwitch = matched.prefix !== activeContentSet;
      return {
        kind: "dispatch",
        address: { ...address, file: file.slice(matched.prefix.length + 1) },
        ...(needsSwitch ? { switchTo: matched.prefix } : {}),
        delayed: needsSwitch,
      };
    }
  }

  return { kind: "dispatch", address, delayed: false };
}
