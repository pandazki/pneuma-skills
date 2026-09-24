/**
 * The character's `.riv`, playing inside the Export tab.
 *
 * The user asked to try the file here rather than download it into another
 * tool, so this runs the OFFICIAL web runtime (`@rive-app/canvas`) — the same
 * one their app would use — on the same `/content` bytes the download link
 * serves, and draws the state machine's own inputs as controls. What it shows
 * is what the file does, not a re-creation of it: a trigger that does nothing
 * here does nothing in their app either.
 *
 * With the registered file's record (`RiveMachineRecord`) the controls read
 * the way the file is meant to be driven: one button per loop, setting the
 * number input `motion` to that loop's value, and one per one-shot, firing
 * its trigger. The last few states are shown in order, so a user can watch a
 * route through the hub — idle → idle-to-coffee → coffee — and see that a
 * loop finishes its cycle before it leaves.
 *
 * Every decision about the runtime's shapes lives in `rive-preview.ts`; this
 * component wires the runtime to a canvas and to the panel. Three lifecycle
 * rules it keeps:
 *
 * - `cleanup()` on close, on unmount and whenever the file changes. The
 *   runtime holds WASM memory the garbage collector never sees, and a preview
 *   left running after its panel closed keeps drawing into a detached canvas.
 * - A new registration is a new `src` (its url carries the asset's
 *   `createdAt`), so a regenerated `.riv` replaces the one on screen.
 * - A failure is always on screen — which step failed and the runtime's own
 *   words — never a blank canvas.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  BoltIcon,
  CloseIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
} from "./icons.js";
import {
  riveControls,
  riveFailure,
  riveMachineToPlay,
  riveStateName,
  riveTrail,
  RIVE_PREFERRED_MACHINE,
  type RiveControl,
  type RiveFailure,
  type RiveMachineRecord,
} from "./rive-preview.js";
import { loadRiveRuntime } from "./rive-runtime.js";
import type { SpriteStrings } from "./strings.js";

type RiveInstance = InstanceType<Awaited<ReturnType<typeof loadRiveRuntime>>["Rive"]>;

const CHECKER_STYLE = {
  backgroundImage:
    "linear-gradient(45deg, rgba(128,128,128,0.16) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.16) 75%), linear-gradient(45deg, rgba(128,128,128,0.16) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.16) 75%)",
  backgroundSize: "14px 14px",
  backgroundPosition: "0 0, 7px 7px",
};

export interface RivePreviewProps {
  /** The `.riv`'s `/content` url, cache-busted like its download link. */
  src: string;
  /** What the registered file says drives it; null for a file without one. */
  machine: RiveMachineRecord | null;
  /** Each motion's name on the stage, for the buttons. */
  labels: ReadonlyMap<string, string>;
  t: SpriteStrings;
  onClose: () => void;
}

export function RivePreview({ src, machine: record, labels, t, onClose }: RivePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const riveRef = useRef<RiveInstance | null>(null);
  const machineRef = useRef<string | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [failure, setFailure] = useState<RiveFailure | null>(null);
  const [controls, setControls] = useState<RiveControl[]>([]);
  const [trail, setTrail] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // The panel builds its record afresh on every render, and the stage beside
  // it renders on every frame. The file is loaded once per `src`, so the load
  // never depends on the record's identity — only its content, read from a
  // ref, and re-applied to the controls when that content changes.
  const recordRef = useRef(record);
  recordRef.current = record;
  const recordKey = JSON.stringify(record);

  /** Re-read the machine's inputs — after load, and after a value changes. */
  const readControls = useCallback(() => {
    const rive = riveRef.current;
    const machine = machineRef.current;
    if (!rive || !machine) return;
    const inputs = rive.stateMachineInputs(machine) ?? [];
    setControls(
      riveControls(
        inputs.map((input) => ({ name: input.name, type: input.type, value: input.value })),
        recordRef.current,
      ),
    );
  }, []);

  useEffect(() => {
    readControls();
  }, [recordKey, readControls]);

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    setStatus("loading");
    setFailure(null);
    setControls([]);
    setTrail([]);
    setPlaying(false);

    const fail = (next: RiveFailure) => {
      if (cancelled) return;
      setFailure(next);
      setStatus("failed");
    };

    (async () => {
      let runtime: Awaited<ReturnType<typeof loadRiveRuntime>>;
      try {
        runtime = await loadRiveRuntime();
      } catch (error) {
        fail(riveFailure("runtime", error));
        return;
      }
      // The bytes are fetched here rather than by the runtime so an HTTP
      // failure is reported as one, instead of as a file that "may be corrupt".
      let buffer: ArrayBuffer;
      try {
        const response = await fetch(src, { signal: abort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        buffer = await response.arrayBuffer();
      } catch (error) {
        if (!cancelled) fail(riveFailure("file", error));
        return;
      }
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;

      const rive: RiveInstance = new runtime.Rive({
        buffer,
        canvas,
        autoplay: true,
        // Named up front so the runtime instances the machine itself; with no
        // name it would play the file's first timeline instead.
        stateMachines: RIVE_PREFERRED_MACHINE,
        // A sprite `.riv` embeds every frame; nothing is to be fetched from
        // Rive's asset CDN, and nothing should be.
        enableRiveAssetCDN: false,
        layout: new runtime.Layout({ fit: runtime.Fit.Contain, alignment: runtime.Alignment.Center }),
        onLoad: () => {
          if (cancelled) return;
          rive.resizeDrawingSurfaceToCanvas();
          const machine = riveMachineToPlay(rive.stateMachineNames);
          if (!machine) {
            fail(riveFailure("state-machine", ""));
            return;
          }
          machineRef.current = machine;
          // The preferred machine was instanced up front; a file without it
          // has nothing running yet, and its own first machine is started by
          // name now that the file says which exist.
          if (machine !== RIVE_PREFERRED_MACHINE) rive.play(machine);
          setPlaying(true);
          readControls();
          setStatus("ready");
        },
        onLoadError: (event) => fail(riveFailure("file", event)),
        onStateChange: (event) => {
          if (cancelled) return;
          // Every state entered during one advance, in order: a route
          // through a zero-length step still shows.
          const names = Array.isArray(event.data) ? event.data : [event.data];
          setTrail((current) => names.reduce<string[]>((acc, name) => riveTrail(acc, riveStateName(name)), current));
        },
        onPlay: () => {
          if (!cancelled) setPlaying(true);
        },
        onPause: () => {
          if (!cancelled) setPlaying(false);
        },
      });
      riveRef.current = rive;
    })();

    return () => {
      cancelled = true;
      abort.abort();
      riveRef.current?.cleanup();
      riveRef.current = null;
      machineRef.current = null;
    };
  }, [src, attempt, readControls]);

  // The canvas follows the panel's width; the drawing surface has to follow
  // the canvas, or the character is drawn at the size it first loaded at.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => riveRef.current?.resizeDrawingSurfaceToCanvas());
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const togglePlay = () => {
    const rive = riveRef.current;
    if (!rive) return;
    if (playing) rive.pause();
    else rive.play();
  };

  const inputOf = (name: string) =>
    machineRef.current
      ? riveRef.current?.stateMachineInputs(machineRef.current)?.find((input) => input.name === name)
      : undefined;

  const fire = (name: string) => {
    inputOf(name)?.fire();
    // A trigger fired on a paused machine would wait for the next advance.
    if (!playing) riveRef.current?.play();
  };

  const setValue = (name: string, value: boolean | number) => {
    const input = inputOf(name);
    if (!input) return;
    input.value = value;
    // Like a trigger: a paused machine would only act on it at the next advance.
    if (!playing) riveRef.current?.play();
    readControls();
  };

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-cc-border bg-cc-bg/40">
      <div ref={boxRef} className="relative h-52 w-full" style={CHECKER_STYLE}>
        <canvas ref={canvasRef} className="block h-full w-full" />
        {status === "loading" ? (
          <p className="absolute inset-0 flex items-center justify-center text-[11px] text-cc-muted">
            {t.riveLoading}
          </p>
        ) : null}
        {status === "failed" && failure ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-cc-bg/85 p-3 text-center">
            <p className="text-[11px] text-cc-fg">{t.riveError[failure.stage]}</p>
            {failure.detail ? (
              <p className="max-h-16 overflow-y-auto break-all font-mono text-[10px] leading-relaxed text-cc-muted">
                {failure.detail}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-1 rounded border border-cc-border px-2 py-1 text-[11px] text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-primary focus-visible:ring-2 focus-visible:ring-cc-primary/60"
            >
              {t.riveRetry}
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-cc-border px-2 py-1.5">
        <button
          type="button"
          onClick={togglePlay}
          disabled={status !== "ready"}
          title={playing ? t.pause : t.play}
          aria-label={playing ? t.pause : t.play}
          className="rounded p-1 text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary/60 disabled:opacity-30"
        >
          {playing ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
        </button>
        {/* The state the machine is in now is the one that matters: when the
            trail is too long for the bar, the states before it give way. */}
        <span
          className="flex min-w-0 items-baseline gap-1 font-mono text-[10px] text-cc-muted"
          title={trail.join(" → ")}
          data-rive-state={trail.at(-1) ?? ""}
        >
          <span className="shrink-0 font-sans">{t.riveStateLabel}</span>
          {trail.length > 1 ? <span className="min-w-0 truncate">{`${trail.slice(0, -1).join(" → ")} →`}</span> : null}
          <span className="shrink-0 text-cc-fg">{trail.at(-1) ?? "—"}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          title={t.riveClose}
          aria-label={t.riveClose}
          className="ml-auto rounded p-1 text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary/60"
        >
          <CloseIcon size={12} />
        </button>
      </div>

      {status === "ready" ? (
        <div className="flex flex-col gap-2 border-t border-cc-border px-2 py-2">
          {controls.length === 0 ? (
            <>
              <p className="text-[10px] uppercase tracking-wide text-cc-muted">{t.riveInputs}</p>
              <p className="text-[11px] text-cc-muted">{t.riveNoInputs}</p>
            </>
          ) : (
            controlGroups(controls, t).map((group) => (
              <div key={group.key}>
                <p className="pb-1.5 text-[10px] uppercase tracking-wide text-cc-muted">{group.heading}</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.controls.map((control) => (
                    <ControlView
                      key={control.kind === "motion" ? `${control.name}=${control.value}` : control.name}
                      control={control}
                      labels={labels}
                      t={t}
                      onFire={fire}
                      onValue={setValue}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The controls in up to three groups, in this order: the loops (one number
 *  input's buttons), the one-shots, then anything else the file declares. */
function controlGroups(controls: RiveControl[], t: SpriteStrings) {
  const loops = controls.filter((c) => c.kind === "motion");
  const shots = controls.filter((c) => c.kind === "trigger" && c.motion);
  const rest = controls.filter((c) => c.kind !== "motion" && !shots.includes(c));
  return [
    loops.length ? { key: "loops", heading: t.riveLoopsHeading(loops[0].name), controls: loops } : null,
    shots.length ? { key: "shots", heading: t.riveOneShotsHeading, controls: shots } : null,
    rest.length ? { key: "rest", heading: t.riveInputs, controls: rest } : null,
  ].filter((group): group is { key: string; heading: string; controls: RiveControl[] } => group !== null);
}

function ControlView({
  control,
  labels,
  t,
  onFire,
  onValue,
}: {
  control: RiveControl;
  labels: ReadonlyMap<string, string>;
  t: SpriteStrings;
  onFire: (name: string) => void;
  onValue: (name: string, value: boolean | number) => void;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60";
  if (control.kind === "motion") {
    const label = labels.get(control.motion) ?? control.motion;
    return (
      <button
        type="button"
        onClick={() => onValue(control.name, control.value)}
        aria-pressed={control.active}
        title={t.riveSetMotion(control.name, control.value, label)}
        className={`${base} ${
          control.active
            ? "border-cc-primary/60 bg-cc-primary/15 text-cc-primary"
            : "border-cc-border text-cc-fg hover:border-cc-primary/50 hover:bg-cc-primary/10 hover:text-cc-primary"
        }`}
      >
        <span className="tabular-nums text-cc-muted">{control.value}</span>
        <span className="font-sans">{label}</span>
      </button>
    );
  }
  if (control.kind === "trigger") {
    const label = control.motion ? (labels.get(control.motion) ?? control.name) : control.name;
    return (
      <button
        type="button"
        onClick={() => onFire(control.name)}
        title={t.riveFire(control.name)}
        className={`${base} border-cc-border text-cc-fg hover:border-cc-primary/50 hover:bg-cc-primary/10 hover:text-cc-primary active:bg-cc-primary/20`}
      >
        <BoltIcon size={11} />
        {control.motion ? <span className="font-sans">{label}</span> : label}
      </button>
    );
  }
  if (control.kind === "boolean") {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={control.value}
        onClick={() => onValue(control.name, !control.value)}
        className={`${base} ${
          control.value
            ? "border-cc-primary/60 bg-cc-primary/15 text-cc-primary"
            : "border-cc-border text-cc-muted hover:text-cc-fg"
        }`}
      >
        {control.name}
        <span className="text-[10px]">{control.value ? t.riveOn : t.riveOff}</span>
      </button>
    );
  }
  return (
    <span className={`${base} border-cc-border text-cc-fg`}>
      {control.name}
      <button
        type="button"
        onClick={() => onValue(control.name, control.value - 1)}
        title={t.riveDecrease}
        aria-label={t.riveDecrease}
        className="rounded p-0.5 text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      >
        <MinusIcon size={10} />
      </button>
      <span className="tabular-nums">{control.value}</span>
      <button
        type="button"
        onClick={() => onValue(control.name, control.value + 1)}
        title={t.riveIncrease}
        aria-label={t.riveIncrease}
        className="rounded p-0.5 text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      >
        <PlusIcon size={10} />
      </button>
    </span>
  );
}
