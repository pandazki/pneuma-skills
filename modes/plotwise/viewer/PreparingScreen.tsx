/**
 * Between the style decision and the first segment: the director is
 * preparing the opening. The confirmed sample keeps playing on the big
 * screen (it is what the course will look like), and the card under it
 * shows the three things that have to happen before the stage opens —
 * style settled, outline grounded, opening shot — each read straight
 * off course.json, with the outline listed as soon as it lands.
 */

import type { CourseSet } from "../domain.js";
import { STYLE_CARDS } from "./styleCatalog.js";
import { Check, CinemaCaption, CinemaCard, CinemaScreen, CinemaShell, Spinner } from "./cinema.js";
import { IN_PRODUCTION, fmtElapsed, productionLabel } from "./waiting.js";

const COPY = {
  step: "第二步 · 准备开场",
  styleStep: "视觉风格",
  planStep: "大纲与证据",
  planActive: "导演在读材料、核实、渲染图",
  planProgress: (grounded: number, beats: number) => `${grounded}/${beats} 拍已接地`,
  scriptStep: "剧本",
  scriptWaiting: "大纲落地后写剧本",
  scriptActive: "导演在写整条主线的分镜",
  scriptDone: (scenes: number, shots: number) => `${scenes} 场 · ${shots} 个镜头`,
  shootStep: "开场拍摄",
  shootWaiting: "剧本落地后开拍",
  shootReady: "剧本已落地,等待开拍",
  shootFailed: "开场没拍成",
  managerDown: "制片进程没有启动,已请导演启动",
  outlineTitle: "课程大纲",
  outlineHint: "大纲落地后会列在这里",
} as const;

type StepState = "done" | "active" | "pending";

function StepDot({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cc-success text-white">
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cc-primary/40 bg-cc-primary/10 text-cc-primary">
        <Spinner className="h-3.5 w-3.5" />
      </span>
    );
  }
  return <span className="h-6 w-6 shrink-0 rounded-full border border-dashed border-cc-border" />;
}

function Step({ state, title, detail }: { state: StepState; title: string; detail: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3" data-plotwise-step={state}>
      <StepDot state={state} />
      <div className="min-w-0">
        <div className={`text-sm font-medium ${state === "pending" ? "text-cc-muted" : "text-cc-fg"}`}>{title}</div>
        <div className="truncate text-xs text-cc-muted">{detail}</div>
      </div>
    </div>
  );
}

export default function PreparingScreen({
  set,
  prefix,
  now = Date.now(),
  managerDown = false,
  onRetry,
}: {
  set: CourseSet;
  prefix: string;
  now?: number;
  /** The screenplay is on disk but no manager has written its snapshot for minutes. */
  managerDown?: boolean;
  /** Ask the manager to shoot the opening again after it failed. */
  onRetry?: () => void;
}) {
  const card = STYLE_CARDS.find((c) => c.id === set.style.id);
  const styleName = set.style.name || card?.name || set.style.id;
  const asset = (file?: string) => (file ? `/content/${prefix ? `${prefix}/` : ""}${file}` : null);
  const sampleVideo = asset(set.style.sample?.video);
  const sampleImage = asset(set.style.sample?.image) ?? card?.thumb ?? null;

  const beats = set.outline;
  const planned = beats.length > 0;
  const grounded = beats.filter((b) => b.evidence.length > 0).length;
  const nodes = Object.values(set.nodes);
  // The screenplay has landed once a main scene carries shots.
  const scenes = nodes.filter((n) => n.shots.length > 0);
  const scripted = scenes.some((n) => n.kind === "main");
  const shotsTotal = scenes.reduce((s, n) => s + n.shots.length, 0);
  const root = set.nodes[set.rootNode];
  const shooting = !!root && IN_PRODUCTION.has(root.status);
  const failed = root?.status === "failed";

  // The outline lands first and evidence streams in per beat: the plan
  // step stays active until every beat carries evidence, and neither the
  // screenplay nor the opening waits for it.
  const groundedAll = planned && grounded === beats.length;
  const scriptState: StepState = scripted ? "done" : planned ? "active" : "pending";
  const scriptDetail = scripted ? COPY.scriptDone(scenes.length, shotsTotal) : planned ? COPY.scriptActive : COPY.scriptWaiting;
  const shootState: StepState = shooting || failed || managerDown ? "active" : "pending";
  const started = root?.startedAt ? Date.parse(root.startedAt) : NaN;
  const clock = Number.isFinite(started) ? ` · ${fmtElapsed(Math.max(0, now - started))}` : "";
  const shootDetail = managerDown
    ? COPY.managerDown
    : failed
      ? COPY.shootFailed
      : shooting && root
        ? `${productionLabel(root)}${clock}`
        : scripted
          ? COPY.shootReady
          : COPY.shootWaiting;

  return (
    <CinemaShell step={COPY.step}>
      <CinemaScreen video={sampleVideo} poster={sampleImage} alt={styleName} />
      <CinemaCaption>{set.style.sample?.hook ? `「${set.style.sample.hook}」` : null}</CinemaCaption>
      <CinemaCard>
        <div className="flex items-center gap-4">
          <Step state="done" title={COPY.styleStep} detail={styleName} />
          <div className="h-px w-8 shrink-0 bg-cc-border" />
          <Step
            state={groundedAll ? "done" : "active"}
            title={COPY.planStep}
            detail={planned ? COPY.planProgress(grounded, beats.length) : COPY.planActive}
          />
          <div className="h-px w-8 shrink-0 bg-cc-border" />
          <Step state={scriptState} title={COPY.scriptStep} detail={scriptDetail} />
          <div className="h-px w-8 shrink-0 bg-cc-border" />
          <Step state={shootState} title={COPY.shootStep} detail={shootDetail} />
        </div>
        {managerDown && (
          <div className="mt-3 rounded-md border border-cc-error/40 bg-cc-error/10 px-3 py-2 text-xs text-cc-fg/90" data-plotwise-manager-silent>
            剧本已经写好,但制片进程没有起来。已请导演启动它;启动后开场会从第一个镜头开始拍。
          </div>
        )}
        {failed && !managerDown && (
          <div className="mt-3 flex items-center gap-3 rounded-md border border-cc-error/40 bg-cc-error/10 px-3 py-2 text-xs text-cc-fg/90" data-plotwise-opening-failed>
            <span className="min-w-0 truncate">开场没拍成{root?.error ? `:${root.error}` : ""}</span>
            {onRetry && (
              <button onClick={onRetry} className="shrink-0 rounded-full border border-cc-primary/50 bg-cc-primary/10 px-3 py-1 text-cc-primary transition-colors hover:bg-cc-primary/20">
                再拍一次
              </button>
            )}
          </div>
        )}
        <div className="mt-4 border-t border-cc-border pt-4">
          <div className="text-[11px] uppercase tracking-[0.2em] text-cc-muted">{COPY.outlineTitle}</div>
          {planned ? (
            <ol className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
              {beats.map((b, i) => (
                <li key={b.id} className="flex min-w-0 items-baseline gap-2.5 text-sm">
                  <span className="w-4 shrink-0 text-right text-xs tabular-nums text-cc-muted/70">{i + 1}</span>
                  <span className="truncate text-cc-fg/90">{b.title}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-2 text-sm text-cc-muted/70">{COPY.outlineHint}</div>
          )}
        </div>
      </CinemaCard>
    </CinemaShell>
  );
}
