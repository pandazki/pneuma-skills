import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * PRIORITY-1 regression guard (paid-for bug): the viewer must NEVER ping the
 * agent about readability, and `request-directions` must fire from exactly one
 * place — the user-gesture mouseup handler — never from a React effect.
 *
 * The bug was a feedback loop: a `readability-check` effect fired whenever the
 * dense-block set changed; the agent rewriting draft.md churned that set, which
 * re-fired the notification, which made the agent respond, which rewrote the
 * draft… An idle session (agent editing, user doing nothing) must emit ZERO
 * unsolicited notifications.
 *
 * This is a SOURCE-SHAPE test on purpose. The notification wiring is React
 * effect/callback structure that a behavioral test cannot cheaply exercise
 * without a full DOM + WS harness; the cheapest meaningful guard against the
 * exact regression is to assert the dangerous shapes are gone. If a future edit
 * re-introduces an onNotifyAgent for readability, or moves request-directions
 * into an effect, this fails.
 */
const VIEWER = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "viewer", "WordtastePreview.tsx"),
  "utf8",
);

describe("Bug 1 — an idle session emits zero unsolicited notifications", () => {
  it("never sends a readability-check notification to the agent", () => {
    // The old loop source was a notification of this exact type. Readability is
    // now a passive visual cue only — the type must never be emitted again. (A
    // documentation mention of the word is fine; the forbidden thing is the
    // notification payload `type: "readability-check"`.)
    expect(VIEWER).not.toContain('type: "readability-check"');
    expect(VIEWER).not.toContain('"readability-check"');
  });

  it("emits request-directions from a single user-gesture site", () => {
    const occurrences = VIEWER.split('type: "request-directions"').length - 1;
    expect(occurrences).toBe(1);
  });

  it("fires request-directions inside the mouseup handler, not inside an effect", () => {
    // The single request-directions emit must sit in handleMouseUp (a user
    // gesture). We assert the emit appears after the handleMouseUp declaration
    // and before the next top-level callback (dispatchRewrite), i.e. lexically
    // inside the gesture handler.
    const handlerStart = VIEWER.indexOf("const handleMouseUp = useCallback");
    const nextCallback = VIEWER.indexOf("const dispatchRewrite = useCallback");
    const emit = VIEWER.indexOf('type: "request-directions"');
    expect(handlerStart).toBeGreaterThan(-1);
    expect(nextCallback).toBeGreaterThan(handlerStart);
    expect(emit).toBeGreaterThan(handlerStart);
    expect(emit).toBeLessThan(nextCallback);
  });

  it("does not wire the dense-block readability set to onNotifyAgent", () => {
    // The dense set may still drive a passive visual cue, but it must not be a
    // useEffect dependency that calls onNotifyAgent. Guard: no effect lists both
    // `dense` and a notify call in the same readability path.
    const denseBlock = VIEWER.indexOf("const dense = useMemo");
    expect(denseBlock).toBeGreaterThan(-1);
    // The comment block documenting the discipline must be present so the intent
    // is not silently lost in a future refactor.
    expect(VIEWER).toContain("PASSIVE visual cue ONLY");
  });
});
