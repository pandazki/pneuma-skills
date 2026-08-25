/**
 * The anchor round-trip, kept out of React.
 *
 * One pane, one document, one question at a time: "scroll to this anchor —
 * did you find it?" The pane can only ask a document that has finished
 * loading, and it must always answer the caller exactly once, so the whole
 * thing is a small state machine with a timer. Keeping it here (rather than
 * spread across effects in `PagePane`) is what makes the timing testable
 * without a browser — the same reason `player-logic.ts` exists.
 *
 * The rule the machine is built around: THE CLOCK STARTS AT `load`, NOT AT
 * THE REQUEST. Every rung switch mounts a fresh sandboxed iframe, and a
 * `sandbox="allow-scripts"` document has an opaque origin — nothing it
 * fetches is shared with any other frame, so a page that links a web font
 * re-pays that fetch on every switch (measured 1.0-2.7 s). Charging that
 * network time to the anchor budget is what made the most ordinary agent
 * flow — write a page, `navigate-to` it with an anchor — report a FALSE
 * "no element matched", on a page where re-issuing the same request
 * immediately succeeded.
 *
 * So a request that arrives mid-load is HELD and dispatched on `load` with
 * the full budget. The only states that run a clock are the two where the
 * pane knows what it is dealing with:
 *
 *   - a loaded document — the budget for the in-document search;
 *   - no document at all — a grace period for one to appear (the page file
 *     may still be in flight from the file watcher), after which the honest
 *     answer is that nothing matched.
 *
 * The state in between — a document that is loading — deliberately runs no
 * clock. It cannot hang: an unanswered viewer action is bounded upstream by
 * `server/ws-bridge-viewer.ts` (60 s), and a request no pane can hold is
 * settled by the parent the moment its rung leaves the screen.
 *
 * Note what this machine deliberately does NOT have: a teardown hook. It is
 * driven purely by its inputs, and every one of them is idempotent — the
 * same document, the same sequence, a second `load` all change nothing. That
 * is what makes it safe under React's effect model, where an effect can be
 * torn down and set up again without the component going anywhere:
 * development's StrictMode double-mount does exactly that, and an earlier
 * cut of this file — which answered its outstanding request on teardown —
 * reported a miss for every navigation the second pass was about to ask
 * properly. Measured, not theorised. The parent settles each sequence at
 * most once, so the worst a discarded relay can do is fire one already-armed
 * timer into a verdict nobody is waiting for.
 */

/**
 * How long a pane waits for an answer once it knows what it is asking.
 *
 * It bounds the IN-DOCUMENT SEARCH on a document that has already loaded —
 * `getElementById` plus `querySelector` plus a `scrollIntoView`, which is
 * sub-millisecond work — so 2 s is enormous headroom for the thing being
 * measured, and it is emphatically NOT a network budget: the document load
 * happens before this clock starts (see the header). The bound exists so a
 * page whose script never answers (a document that failed to parse, an
 * iframe torn down mid-flight) cannot hold an agent's action open. Same
 * discipline as the native bridge's 10 s, one order down: this is a local
 * `postMessage`, not an IPC hop.
 */
export const ANCHOR_TIMEOUT_MS = 2000;

/** What the relay needs from its pane. Both calls are fire-and-forget. */
export interface AnchorRelayHost {
  /** Ask the loaded document to scroll. */
  post(seq: number, anchor: string): void;
  /** Settle one request. Called exactly once per sequence number. */
  report(seq: number, found: boolean): void;
}

/**
 * Timer seam. Defaults to the platform's; a test passes a fake so the
 * budget can be asserted without spending it.
 */
export interface AnchorTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const systemTimers: AnchorTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** One request as the pane receives it — the anchor plus its sequence. */
export interface AnchorAsk {
  seq: number;
  anchor: string;
}

/**
 * An ask plus the rung it was issued for, which is how the parent routes it.
 *
 * `target` is a `rungKey`, or null for an address that named no rung at all
 * ("wherever the reader is"). The relay never reads it: only the parent
 * knows the ladder, so only the parent can say which pane a request belongs
 * to — see `anchorRequestForPane`.
 */
export interface AnchorRequest extends AnchorAsk {
  target: string | null;
}

/**
 * The request this pane may answer, or null when it belongs to no pane on
 * screen.
 *
 * Both halves matter. Handing a request to the pane standing on the rung it
 * named is what makes the answer mean something; withholding it from every
 * other pane is what stops a rung switch mid-load from scrolling a page
 * nobody addressed and reporting the hit as a success. A request that lands
 * nowhere is not lost — the caller settles it as a miss for the rung it
 * asked about.
 */
export function anchorRequestForPane(
  request: AnchorRequest | null,
  paneKey: string,
): AnchorRequest | null {
  if (!request) return null;
  if (request.target === null || request.target === paneKey) return request;
  return null;
}

type Clock = "none" | "grace" | "search";

export class AnchorRelay {
  private pending: AnchorAsk | null = null;
  /** Whether `pending` has been posted into a document. */
  private posted = false;
  /** The document on screen, by identity — null when a placeholder is up. */
  private document: string | null = null;
  /** Whether THAT document has fired `load`. */
  private loaded = false;
  private clock: Clock = "none";
  private handle: unknown = null;

  constructor(
    private readonly host: AnchorRelayHost,
    private readonly timers: AnchorTimers = systemTimers,
    private readonly timeoutMs: number = ANCHOR_TIMEOUT_MS,
  ) {}

  /**
   * The pane's current request, or null when it holds none.
   *
   * A new sequence supersedes an older one, and losing the request
   * altogether (the parent decided this pane is no longer its target) ends
   * it — either way the outstanding ask is settled rather than left for a
   * promise nobody can resolve. Re-delivering the SAME sequence is a no-op,
   * so a re-render cannot re-ask a question already asked.
   */
  request(ask: AnchorAsk | null): void {
    if (ask && this.pending && ask.seq === this.pending.seq) return;
    this.settleOutstanding(false);
    this.pending = ask ? { seq: ask.seq, anchor: ask.anchor } : null;
    this.posted = false;
    this.advance();
  }

  /**
   * The document the pane is showing, by identity — the srcdoc string, or
   * null while the agent has not written the page.
   *
   * Identity, not a boolean, so that re-running the effect that reports it
   * changes nothing: a different string is a different document (reset, wait
   * for its `load`), the same string is the same document (the `load` this
   * relay already saw still counts).
   *
   * A request that was already posted follows the document rather than dying
   * with it: the frame it was posted to no longer exists (the pane's
   * `e.source` filter drops anything the old window says), so it is re-armed
   * and re-asked of the new document with a full budget. That is the case
   * where an agent writes the page and navigates into it in the same breath.
   */
  setDocument(document: string | null): void {
    if (document === this.document) return;
    this.document = document;
    this.loaded = false;
    this.posted = false;
    this.advance();
  }

  /** The document finished loading. Idempotent — a stray second `load` re-asks nothing. */
  documentLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.advance();
  }

  /** The document answered. A verdict for anything else is not ours. */
  reply(seq: number, found: boolean): void {
    if (!this.pending || this.pending.seq !== seq) return;
    const settled = this.pending;
    this.pending = null;
    this.posted = false;
    this.stopClock();
    this.host.report(settled.seq, found);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Move to whatever the current state permits. */
  private advance(): void {
    if (!this.pending) {
      this.stopClock();
      return;
    }
    if (this.posted) return; // its search clock is already running

    if (this.document !== null && this.loaded) {
      const ask = this.pending;
      this.posted = true;
      this.startClock("search");
      this.host.post(ask.seq, ask.anchor);
      return;
    }
    if (this.document !== null) {
      // Loading. This is the wait the budget must NOT be charged for.
      this.stopClock();
      return;
    }
    // No document to ask. Give one a chance to arrive, then answer honestly.
    if (this.clock !== "grace") this.startClock("grace");
  }

  private startClock(kind: Clock): void {
    this.stopClock();
    this.clock = kind;
    this.handle = this.timers.set(() => {
      this.handle = null;
      this.clock = "none";
      this.settleOutstanding(false);
    }, this.timeoutMs);
  }

  private stopClock(): void {
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
    this.clock = "none";
  }

  private settleOutstanding(found: boolean): void {
    this.stopClock();
    const ask = this.pending;
    this.pending = null;
    this.posted = false;
    if (ask) this.host.report(ask.seq, found);
  }
}
