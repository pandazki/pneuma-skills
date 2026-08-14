/**
 * Test double for the conductor's `AudioElementLike` — Bun has no media
 * engine, so the element's observable surface is emulated: `play()` sets
 * `paused` synchronously and settles ASYNCHRONOUSLY (a microtask), exactly
 * like the real promise — a conductor that mishandles the rejection path
 * would pass against a synchronous fake and log unhandled rejections in
 * the browser. Shared by the conductor unit tests and the narration-host
 * flow test (the incremental-host.ts precedent for cross-file helpers).
 */

type FakePlayMode = "resolve" | "block" | "abort";

function named(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

export class FakeAudioElement {
  src = "";
  playbackRate = 1;
  preload = "";
  paused = true;
  /**
   * The listener's mute. A plain field on purpose — the real element mutes
   * at the OUTPUT stage, so the flag must have no effect whatsoever on
   * `advance`, `paused` or `currentTime` here either. A fake that made
   * muting stop the clock would hide the bug the seam test hunts.
   */
  muted = false;
  /**
   * Defaults to HAVE_ENOUGH_DATA: almost every test wants an element that
   * can be positioned, and the interesting case — a conductor asked to
   * seek something that knows nothing yet — is opted into by setting it
   * to 0. Real elements pass through 0 on every `src` change, which is why
   * the conductors must never assume otherwise.
   */
  readyState = 4;

  /** Every `currentTime` assignment the conductor made (alignment audit). */
  seeks: number[] = [];
  playCalls = 0;
  pauseCalls = 0;
  rateSets = 0;
  /** Teardown audit: dropping the reference is not releasing the resource. */
  srcRemovals = 0;
  loadCalls = 0;
  /** How the next play() settles — the autoplay/abort dial. */
  playMode: FakePlayMode = "resolve";

  private time = 0;
  private listeners = new Map<string, Set<() => void>>();

  get currentTime(): number {
    return this.time;
  }
  set currentTime(value: number) {
    this.time = value;
    this.seeks.push(value);
  }

  play(): Promise<void> {
    this.playCalls++;
    if (this.playMode === "block") {
      return Promise.reject(named("NotAllowedError"));
    }
    if (this.playMode === "abort") {
      return Promise.reject(named("AbortError"));
    }
    // Per spec `paused` flips synchronously; playback settles async.
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls++;
    this.paused = true;
  }

  removeAttribute(name: string): void {
    if (name !== "src") return;
    this.srcRemovals++;
    this.src = "";
  }

  /**
   * The media load algorithm: abandons the resource and takes the element
   * back to knowing nothing. Modelled faithfully because that is what
   * makes it a release rather than a pause — a fake that left `readyState`
   * at 4 would let a conductor "reinstall" an element that never actually
   * let go.
   */
  load(): void {
    this.loadCalls++;
    this.readyState = 0;
    this.time = 0;
    this.paused = true;
  }

  addEventListener(type: string, listener: () => void): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  /** The media engine advancing: playbackRate × wall-clock, when sounding. */
  advance(dt: number): void {
    if (!this.paused) this.time += dt * this.playbackRate;
  }
  /**
   * The media engine's clock placed directly — a test standing the
   * element somewhere without that counting as a SEEK. (The track
   * conductor's central guarantee is "no seek under a voice", audited
   * through `seeks`, so moving the playhead to set up a case must not
   * write to it.)
   */
  moveTo(seconds: number): void {
    this.time = seconds;
  }

  /** The clip running out: pauses and fires `ended`, like the real thing. */
  end(): void {
    this.paused = true;
    this.emit("ended");
  }
}

/** Minimal gesture surface (the conductor's autoplay re-arm target). */
export class FakeGestureTarget {
  listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  armed(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

/** Let queued promise reactions (play() settlements) run. */
export const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));
