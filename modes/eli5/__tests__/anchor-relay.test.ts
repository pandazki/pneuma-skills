/**
 * The anchor round-trip's timing — the half a browser test cannot pin.
 *
 * The defect this suite exists for was measured live: every rung switch
 * mounts a fresh `sandbox="allow-scripts"` iframe, which has an opaque
 * origin, so a page linking a web font re-pays that fetch on every switch
 * (1.0-2.7 s). With the budget measured FROM THE REQUEST, the most ordinary
 * agent flow — write a page, `navigate-to` it with an anchor — reported a
 * false "no element matched anchor" while the anchor was sitting right
 * there in the document that had not finished loading yet.
 *
 * So the assertions below are about WHEN the clock starts, not about
 * scrolling. Timers are injected: spending 2 s of wall clock to observe a
 * 2 s budget would make the suite slow AND blind to the exact moment the
 * budget is armed, which is the only thing that was wrong.
 */

import { describe, expect, test } from "bun:test";

import {
  ANCHOR_TIMEOUT_MS,
  AnchorRelay,
  anchorRequestForPane,
  type AnchorTimers,
} from "../viewer/anchor-relay.js";

/** A hand-cranked clock: nothing runs until the test says how much time passed. */
class FakeTimers implements AnchorTimers {
  private nextId = 1;
  private jobs = new Map<number, { fn: () => void; at: number }>();
  now = 0;

  set = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.jobs.set(id, { fn, at: this.now + ms });
    return id;
  };

  clear = (handle: unknown): void => {
    this.jobs.delete(handle as number);
  };

  /** Delays of every armed timer, relative to now. */
  get armed(): number[] {
    return [...this.jobs.values()].map((j) => j.at - this.now).sort((a, b) => a - b);
  }

  advance(ms: number): void {
    this.now += ms;
    for (const [id, job] of [...this.jobs]) {
      if (job.at <= this.now) {
        this.jobs.delete(id);
        job.fn();
      }
    }
  }
}

interface Harness {
  relay: AnchorRelay;
  timers: FakeTimers;
  posted: Array<{ seq: number; anchor: string }>;
  reported: Array<{ seq: number; found: boolean }>;
}

function harness(): Harness {
  const timers = new FakeTimers();
  const posted: Array<{ seq: number; anchor: string }> = [];
  const reported: Array<{ seq: number; found: boolean }> = [];
  const relay = new AnchorRelay(
    {
      post: (seq, anchor) => posted.push({ seq, anchor }),
      report: (seq, found) => reported.push({ seq, found }),
    },
    timers,
  );
  return { relay, timers, posted, reported };
}

/** The srcdoc of a page — identity is all the relay reads. */
const PAGE = "<!DOCTYPE html><p>a page</p>";
const OTHER_PAGE = "<!DOCTYPE html><p>another page</p>";

/** A pane showing a document that has not fired `load` yet. */
function loading(h: Harness, page: string = PAGE): void {
  h.relay.setDocument(page);
}

describe("the clock starts at load, not at the request", () => {
  test("a request that arrives mid-load is held — and the budget is not running", () => {
    const h = harness();
    loading(h);
    h.relay.request({ seq: 1, anchor: "h2" });

    expect(h.posted).toEqual([]);
    // The whole fix in one assertion: nothing is armed while the document
    // is on the wire, so no amount of network time can spend the budget.
    expect(h.timers.armed).toEqual([]);

    h.timers.advance(30_000);
    expect(h.reported).toEqual([]);
  });

  test("on load it is dispatched once, with the FULL budget ahead of it", () => {
    const h = harness();
    loading(h);
    h.relay.request({ seq: 1, anchor: "h2" });
    h.timers.advance(2_700); // the measured worst-case font fetch

    h.relay.documentLoaded();
    expect(h.posted).toEqual([{ seq: 1, anchor: "h2" }]);
    expect(h.timers.armed).toEqual([ANCHOR_TIMEOUT_MS]);

    // Not a millisecond of it was eaten by the load.
    h.timers.advance(ANCHOR_TIMEOUT_MS - 1);
    expect(h.reported).toEqual([]);
    h.timers.advance(1);
    expect(h.reported).toEqual([{ seq: 1, found: false }]);
  });

  test("a request into an already-loaded document behaves exactly as before", () => {
    const h = harness();
    loading(h);
    h.relay.documentLoaded();

    h.relay.request({ seq: 7, anchor: "#impact" });
    expect(h.posted).toEqual([{ seq: 7, anchor: "#impact" }]);
    expect(h.timers.armed).toEqual([ANCHOR_TIMEOUT_MS]);
  });

  test("the budget is 2 s — a search bound, not a network one", () => {
    // Pinned because the number's meaning changed even though the number
    // did not: it now measures `querySelector` + `scrollIntoView`.
    expect(ANCHOR_TIMEOUT_MS).toBe(2000);
  });

  test("a second `load` for the same document does not re-ask", () => {
    const h = harness();
    loading(h);
    h.relay.request({ seq: 1, anchor: "h2" });
    h.relay.documentLoaded();
    h.relay.documentLoaded();
    expect(h.posted).toHaveLength(1);
  });
});

describe("the verdict", () => {
  test("an answer settles the request and disarms the clock", () => {
    const h = harness();
    loading(h);
    h.relay.documentLoaded();
    h.relay.request({ seq: 1, anchor: "h2" });

    h.relay.reply(1, true);
    expect(h.reported).toEqual([{ seq: 1, found: true }]);
    expect(h.timers.armed).toEqual([]);

    // And nothing settles twice — the timer that was cancelled cannot fire.
    h.timers.advance(60_000);
    expect(h.reported).toHaveLength(1);
  });

  test("an answer for another request is ignored", () => {
    const h = harness();
    loading(h);
    h.relay.documentLoaded();
    h.relay.request({ seq: 4, anchor: "h2" });

    h.relay.reply(3, true);
    expect(h.reported).toEqual([]);
  });

  test("a page that never answers misses after the budget, exactly once", () => {
    const h = harness();
    loading(h);
    h.relay.documentLoaded();
    h.relay.request({ seq: 1, anchor: "h2" });

    h.timers.advance(ANCHOR_TIMEOUT_MS);
    expect(h.reported).toEqual([{ seq: 1, found: false }]);
    h.relay.reply(1, true); // too late — the caller already heard
    expect(h.reported).toHaveLength(1);
  });
});

describe("a request nobody can ask", () => {
  test("with no document at all, a grace period runs and then it misses", () => {
    // The page file may still be in flight from the file watcher, so the
    // request is not refused on the spot — but it cannot hang either.
    const h = harness();
    h.relay.setDocument(null);
    h.relay.request({ seq: 1, anchor: "h2" });

    expect(h.timers.armed).toEqual([ANCHOR_TIMEOUT_MS]);
    h.timers.advance(ANCHOR_TIMEOUT_MS);
    expect(h.posted).toEqual([]);
    expect(h.reported).toEqual([{ seq: 1, found: false }]);
  });

  test("a document that arrives during the grace period gets asked, with a fresh budget", () => {
    const h = harness();
    h.relay.setDocument(null);
    h.relay.request({ seq: 1, anchor: "h2" });
    h.timers.advance(ANCHOR_TIMEOUT_MS - 1);

    h.relay.setDocument(PAGE);
    expect(h.timers.armed).toEqual([]); // loading — no clock
    h.relay.documentLoaded();
    expect(h.posted).toEqual([{ seq: 1, anchor: "h2" }]);
    expect(h.timers.armed).toEqual([ANCHOR_TIMEOUT_MS]);
  });

  test("a re-render while waiting does not restart the grace period", () => {
    const h = harness();
    h.relay.setDocument(null);
    h.relay.request({ seq: 1, anchor: "h2" });
    h.timers.advance(1_500);
    h.relay.request({ seq: 1, anchor: "h2" }); // same ask, delivered again
    h.relay.setDocument(null);

    expect(h.timers.armed).toEqual([ANCHOR_TIMEOUT_MS - 1_500]);
  });
});

describe("a request that outlives its target", () => {
  test("losing the request settles it — the parent handed this pane's turn to another", () => {
    // The leak this prevents: a rung switch mounts a NEW document, and a
    // request still in hand would be scrolled into a page it never named —
    // reporting success for an anchor found somewhere else entirely. The
    // parent withholds it (see `anchorRequestForPane`); the pane answers
    // for the rung that was asked about.
    const h = harness();
    loading(h);
    h.relay.request({ seq: 1, anchor: "h2" });
    h.relay.request(null);
    expect(h.posted).toEqual([]);
    expect(h.reported).toEqual([{ seq: 1, found: false }]);
    expect(h.timers.armed).toEqual([]);
  });

  test("a newer request supersedes an older one, and the older one is answered", () => {
    const h = harness();
    loading(h);
    h.relay.request({ seq: 1, anchor: "h2" });
    h.relay.request({ seq: 2, anchor: "#later" });

    expect(h.reported).toEqual([{ seq: 1, found: false }]);
    h.relay.documentLoaded();
    expect(h.posted).toEqual([{ seq: 2, anchor: "#later" }]);
  });

  test("a document swapped under a dispatched request re-asks the new one", () => {
    // The agent writes the page and navigates into it in the same breath:
    // the file event lands after the request, replacing the document the
    // question was posted to. The old frame can no longer answer (the
    // pane's `e.source` filter drops it), so the question follows.
    const h = harness();
    loading(h);
    h.relay.documentLoaded();
    h.relay.request({ seq: 1, anchor: "h2" });
    expect(h.posted).toHaveLength(1);

    h.relay.setDocument(OTHER_PAGE);
    expect(h.timers.armed).toEqual([]);
    h.relay.documentLoaded();
    expect(h.posted).toEqual([
      { seq: 1, anchor: "h2" },
      { seq: 1, anchor: "h2" },
    ]);
    expect(h.timers.armed).toEqual([ANCHOR_TIMEOUT_MS]);
    expect(h.reported).toEqual([]);
  });
});

describe("every input is idempotent — React may replay them all", () => {
  // Measured, in a real dev session: an earlier cut of this relay settled
  // its outstanding request when the pane's effects were torn down, and
  // StrictMode's development double-mount tears every effect down and sets
  // it up again WITHOUT the component going anywhere. Result: every
  // navigation with an anchor reported a false miss ~30 ms after it was
  // issued, before its document had even started loading. So the relay is
  // driven purely by inputs, and replaying them changes nothing.
  test("the same document, the same request, replayed, ask exactly once", () => {
    const h = harness();
    h.relay.setDocument(PAGE);
    h.relay.request({ seq: 1, anchor: "h2" });

    // React tears the effects down and runs them again, in order.
    h.relay.setDocument(PAGE);
    h.relay.request({ seq: 1, anchor: "h2" });

    expect(h.reported).toEqual([]);
    h.relay.documentLoaded();
    expect(h.posted).toEqual([{ seq: 1, anchor: "h2" }]);

    // And a replay AFTER the load still does not re-ask.
    h.relay.setDocument(PAGE);
    h.relay.request({ seq: 1, anchor: "h2" });
    expect(h.posted).toHaveLength(1);
    expect(h.timers.armed).toEqual([ANCHOR_TIMEOUT_MS]);
  });

  test("a replayed document does not un-remember its load", () => {
    const h = harness();
    h.relay.setDocument(PAGE);
    h.relay.documentLoaded();
    h.relay.setDocument(PAGE); // effect re-run, same page

    h.relay.request({ seq: 1, anchor: "h2" });
    expect(h.posted).toEqual([{ seq: 1, anchor: "h2" }]);
  });
});

describe("routing a request to the pane that may answer it", () => {
  const request = { seq: 1, anchor: "h2", target: "how-llms-work::engineer" };

  test("the pane standing on the rung the address named gets it", () => {
    expect(anchorRequestForPane(request, "how-llms-work::engineer")).toBe(request);
  });

  test("every other pane is withheld — including the same rung in another topic", () => {
    expect(anchorRequestForPane(request, "how-llms-work::pm")).toBeNull();
    expect(anchorRequestForPane(request, "database-index::engineer")).toBeNull();
  });

  test("an address that named no rung is answered wherever the reader is", () => {
    const anywhere = { seq: 2, anchor: "h2", target: null };
    expect(anchorRequestForPane(anywhere, "database-index::age-5")).toBe(anywhere);
  });

  test("no request, no pane", () => {
    expect(anchorRequestForPane(null, "database-index::age-5")).toBeNull();
  });
});
