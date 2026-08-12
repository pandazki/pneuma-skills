/**
 * T6 — `<viewer-context>`: what the agent is told when the user points at
 * the board and says "this bit".
 *
 * Bar (T6-review「闭环真的闭上了吗」):
 *  - the block must carry a machine handle the agent can feed straight back
 *    into `navigate-to` / `capture` / `<viewer-locator>` AND a readable
 *    summary — an index alone does not tell the agent which sentence the
 *    user meant;
 *  - it must say whether the board has written that step yet, so the agent
 *    knows when the user is pointing at something not yet reached;
 *  - it must survive the board changing under a stale selection: the agent
 *    appends while the user's click is still pinned in the composer, so an
 *    address that no longer resolves has to degrade honestly instead of
 *    silently naming a different step;
 *  - the wrapper has to be exactly what `src/ws.ts` post-processes
 *    (`<viewer-context ` prefix + a `file="…"` attribute), otherwise the
 *    content-set prefixing silently does nothing;
 *  - lecture vocabulary only (T6-review word purity).
 */

import { describe, expect, test } from "bun:test";

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { buildTimeline } from "../engine/timeline.js";
import { toAddress } from "../viewer/address.js";
import {
  buildCommandNotification,
  buildViewerContext,
  type BoardMoment,
} from "../viewer/context.js";
import { BANNED_WORDS } from "./vocabulary.js";

const SOURCE = `# Why this cycle is different

The opening paragraph sits before any section.

## Supply

Data-centre revenue tripled to ==87.4B==.

- Demand: three times
- Supply: constrained
`;

const files: ViewerFileContent[] = [
  { path: "board.md", content: SOURCE },
  { path: "theme.css", content: ":root{}" },
];

const lecture = parseLecture(SOURCE);
const timeline = buildTimeline(lecture, { durations: DEFAULT_DURATIONS });

const moment = (t: number, over: Partial<BoardMoment> = {}): BoardMoment => ({
  t,
  duration: timeline.duration,
  follow: "live",
  playing: true,
  schedule: timeline.schedule,
  ...over,
});

/** The step the tests point at: the first paragraph of section 1. */
const proseRef = { section: 1, step: 0 };
const proseAddress = toAddress(proseRef);

const pointing = {
  type: "narration",
  content: "Data-centre revenue tripled to 87.4B.",
  file: "board.md",
  address: proseAddress,
};

describe("the wrapper src/ws.ts post-processes", () => {
  test("starts with the exact prefix the content-set injection matches", () => {
    const out = buildViewerContext(pointing, files, moment(5));
    expect(out.startsWith("<viewer-context ")).toBe(true);
    expect(out).toContain('mode="bansho"');
    expect(out).toContain('file="board.md"');
    expect(out.trimEnd().endsWith("</viewer-context>")).toBe(true);
  });

  test("a workspace with no board says nothing at all", () => {
    expect(buildViewerContext(pointing, [], moment(5))).toBe("");
    expect(
      buildViewerContext(pointing, [{ path: "theme.css", content: "" }], moment(5)),
    ).toBe("");
  });

  test("a board nested in a content set is still found", () => {
    const nested: ViewerFileContent[] = [
      { path: "tech-zh/board.md", content: SOURCE },
    ];
    expect(buildViewerContext(null, nested, moment(5))).toContain("bansho");
  });
});

describe("pointing at a step — the closure the mode exists for", () => {
  test("carries the address back verbatim so the agent can re-point at it", () => {
    const out = buildViewerContext(pointing, files, moment(5));
    expect(out).toContain(`Address: ${JSON.stringify(proseAddress)}`);
  });

  test("carries a readable summary, not just an index", () => {
    const out = buildViewerContext(pointing, files, moment(5));
    expect(out).toContain("Data-centre revenue tripled");
    expect(out).toContain("narration");
  });

  test("names the section the user is in, by its title", () => {
    const out = buildViewerContext(pointing, files, moment(5));
    expect(out).toContain("Supply");
  });

  test("says the board has not reached the step yet", () => {
    const out = buildViewerContext(pointing, files, moment(0));
    expect(out).toContain("not written yet");
  });

  test("says the step is being written right now", () => {
    const window = timeline.schedule.filter(
      (e) => e.step.section === 1 && e.step.step === 0,
    );
    const mid = (window[0]!.start + window[window.length - 1]!.end) / 2;
    const out = buildViewerContext(pointing, files, moment(mid));
    expect(out).toContain("being written right now");
  });

  test("says the step is already written", () => {
    const out = buildViewerContext(pointing, files, moment(timeline.duration));
    expect(out).toContain("already written");
  });

  test("reports the playhead and whether the user is on the live board", () => {
    const live = buildViewerContext(pointing, files, moment(12.2));
    expect(live).toContain("12.2s");
    expect(live).toContain("live");
    const detached = buildViewerContext(
      pointing,
      files,
      moment(12.2, { follow: "detached", playing: false }),
    );
    expect(detached).not.toContain("following the live board");
    expect(detached).toContain("paused");
  });
});

describe("the board changed under the selection", () => {
  test("an address that no longer exists degrades honestly", () => {
    const stale = { ...pointing, address: { section: 7, step: 3 } };
    const out = buildViewerContext(stale, files, moment(5));
    expect(out).toContain("no longer");
    // The click-time words are still the best anchor the agent has.
    expect(out).toContain("Data-centre revenue tripled");
    // And it must NOT claim to have found some other step instead.
    expect(out).not.toContain("Address: {");
  });

  test("a selection with no address at all still says what was pointed at", () => {
    const out = buildViewerContext(
      { type: "narration", content: "some words", file: "board.md" },
      files,
      moment(5),
    );
    expect(out).toContain("some words");
  });
});

describe("no selection — the user is just watching", () => {
  test("still reports where the board is", () => {
    const out = buildViewerContext(null, files, moment(7.5));
    expect(out).toContain("7.5s");
    expect(out).not.toContain("Address:");
  });

  test("describes the board itself so the agent knows what is up there", () => {
    const out = buildViewerContext(null, files, moment(0));
    expect(out).toContain("Why this cycle is different");
  });

  test("before the board is mounted there is no playhead to report", () => {
    const out = buildViewerContext(null, files, null);
    expect(out).toContain("Why this cycle is different");
    expect(out).not.toContain("Playhead");
  });
});

describe("a command press — the same situation, carried by itself", () => {
  const command = {
    id: "retell-this",
    label: "Say this part again",
    description: "Rewrite that stretch of board.md more carefully.",
  };

  test("a command notification actually reaches the agent", () => {
    const n = buildCommandNotification(command, pointing, files, moment(5));
    // "info" is log-only in the protocol — it would swallow the request.
    expect(n.severity).toBe("warning");
    expect(n.summary).toBe("Say this part again");
  });

  test("carries which step, because a system message has no context prefix", () => {
    const n = buildCommandNotification(command, pointing, files, moment(5));
    expect(n.message).toContain("Say this part again");
    expect(n.message).toContain(`Address: ${JSON.stringify(proseAddress)}`);
    expect(n.message).toContain("Data-centre revenue tripled");
    expect(n.message).toContain("Rewrite that stretch");
  });

  test("works with nothing selected — the playhead is the context then", () => {
    const n = buildCommandNotification(command, null, files, moment(9));
    expect(n.message).toContain("9.0s");
    expect(n.message).toContain("Say this part again");
  });

  test("an empty workspace still delivers the request", () => {
    const n = buildCommandNotification(command, null, [], null);
    expect(n.message).toContain("Say this part again");
    expect(n.severity).toBe("warning");
  });
});

describe("word purity (T6-review)", () => {
  test("nothing the mode writes uses rendering vocabulary", () => {
    const outputs = [
      buildViewerContext(pointing, files, moment(0)),
      buildViewerContext(pointing, files, moment(timeline.duration)),
      buildViewerContext(null, files, moment(3)),
      buildViewerContext(
        { ...pointing, address: { section: 7, step: 3 } },
        files,
        moment(3),
      ),
    ];
    for (const out of outputs) {
      const lower = out.toLowerCase();
      for (const banned of BANNED_WORDS) {
        expect(lower).not.toContain(banned);
      }
    }
  });
});
