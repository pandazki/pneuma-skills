/**
 * GalleryEmptyState — empty-state surface shown when a session opens with
 * no agent-authored content yet.
 *
 * Replaces the legacy auto-seed step. The framework mounts this in place
 * of the mode viewer when `files.length === 0` (modulo `.pneuma/`); the
 * gallery fetches the mode's seed catalog from `/api/seeds/list` and
 * renders cards. Clicking a card calls `POST /api/seeds/apply`, which
 * copies one seed into the workspace; the file watcher then surfaces
 * the new files via WS, the store's `setFiles` resolves content sets,
 * and the gallery unmounts naturally because the empty condition no
 * longer holds.
 *
 * Layout: editorial split — sticky intro pane on the left (mode identity
 * + a three-step "how to start"), scrollable card grid on the right.
 * Stacks vertically below ~960px. Matches Pneuma's Ethereal Tech surface
 * vocabulary (`cc-*` tokens, restrained orange accent, glass surfaces).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiBase } from "../utils/api.js";
import { ModeIcon } from "./ModeIcon.js";
import { useStore } from "../store/index.js";

interface SeedCard {
  id: string;
  sourceKey: string;
  displayName: string;
  description?: string;
  thumbnailUrl?: string;
  tags?: string[];
}

interface GalleryPayload {
  modeName: string;
  modeIntro: {
    displayName: string;
    description: string;
    tagline?: string;
    heroUrl?: string;
    icon?: string;
  };
  seeds: SeedCard[];
}

type CardState =
  | { kind: "idle" }
  | { kind: "applying"; sourceKey: string }
  | { kind: "error"; sourceKey: string; message: string };

export function GalleryEmptyState({ onDismiss }: { onDismiss?: () => void }) {
  const { t } = useTranslation("gallery");
  const [payload, setPayload] = useState<GalleryPayload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [cardState, setCardState] = useState<CardState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBase()}/api/seeds/list`)
      .then((r) => r.json())
      .then((data: GalleryPayload) => {
        if (!cancelled) setPayload(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPick = useCallback(async (seed: SeedCard) => {
    if (cardState.kind === "applying") return;
    setCardState({ kind: "applying", sourceKey: seed.sourceKey });
    try {
      const res = await fetch(`${getApiBase()}/api/seeds/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceKey: seed.sourceKey }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "apply failed");
      }
      // Optimistic UI: pull /api/files immediately so the viewer mounts
      // without waiting for the chokidar echo. The file watcher will
      // arrive next and reconcile via updateFiles — same path the agent
      // uses, so duplicate-write detection in registerSelfWrite covers
      // us against double-render.
      const filesRes = await fetch(`${getApiBase()}/api/files`).then((r) => r.json());
      if (filesRes.files?.length) {
        useStore.getState().setFiles(filesRes.files);
      }
      // Don't reset cardState — the gallery unmounts when files arrive.
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      setCardState({ kind: "error", sourceKey: seed.sourceKey, message });
    }
  }, [cardState.kind]);

  // While the initial fetch is in flight, render a near-empty shell so the
  // surface doesn't flash from light skeleton → full content. Single
  // breathing dot communicates "loading" without committing to a skeleton
  // shape that may not match what arrives.
  if (!payload && !loadError) {
    return (
      <div className="h-full w-full flex items-center justify-center text-cc-muted/40">
        <div className="w-2 h-2 rounded-full bg-cc-primary/60 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
      </div>
    );
  }

  if (loadError || !payload) {
    return (
      <div className="h-full w-full flex items-center justify-center text-cc-muted">
        <p className="text-sm">{t("cards.loadError")}</p>
      </div>
    );
  }

  const { modeIntro, seeds } = payload;
  const applyingKey = cardState.kind === "applying" ? cardState.sourceKey : null;
  const errorKey = cardState.kind === "error" ? cardState.sourceKey : null;

  return (
    <div className="gallery-empty h-full w-full overflow-hidden text-cc-fg">
      <div className="gallery-grid h-full w-full grid grid-cols-1 xl:grid-cols-[minmax(280px,420px)_1fr]">
        <GalleryIntro intro={modeIntro} t={t} />
        <GalleryCards
          seeds={seeds}
          applyingKey={applyingKey}
          errorKey={errorKey}
          errorMessage={cardState.kind === "error" ? cardState.message : undefined}
          onPick={onPick}
          onDismiss={onDismiss}
          t={t}
        />
      </div>
    </div>
  );
}

// ── Intro pane ──────────────────────────────────────────────────────────

function GalleryIntro({
  intro,
  t,
}: {
  intro: GalleryPayload["modeIntro"];
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <aside
      className="gallery-intro relative flex flex-col justify-between px-8 py-10 lg:px-12 lg:py-14 border-b xl:border-b-0 xl:border-r border-cc-border/40 bg-cc-surface/30 backdrop-blur-sm"
    >
      {/* Decorative oversized glyph — pinned bottom-right, very low opacity, drifts off-frame */}
      {intro.icon && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -bottom-16 w-[340px] h-[340px] text-cc-primary/[0.06]"
        >
          <ModeIcon svg={intro.icon} className="w-full h-full" />
        </div>
      )}

      <div className="relative z-10">
        <div className="flex items-center gap-2.5 mb-7 text-cc-muted/70">
          {intro.icon && (
            <ModeIcon svg={intro.icon} className="w-4 h-4 text-cc-primary/80 shrink-0" />
          )}
          <span className="text-[11px] tracking-[0.18em] uppercase font-medium">
            {t("intro.eyebrow", { mode: intro.displayName })}
          </span>
        </div>

        <h1 className="font-logo font-medium leading-[1.05] tracking-tight text-cc-fg text-[clamp(2.25rem,4vw,3.5rem)]">
          {intro.displayName}
        </h1>

        {intro.tagline && (
          <p className="mt-3 text-base text-cc-fg/80 leading-relaxed max-w-[34ch]">
            {intro.tagline}
          </p>
        )}

        <p className="mt-5 text-sm text-cc-muted leading-relaxed max-w-[42ch]">
          {intro.description}
        </p>
      </div>

      <div className="relative z-10 mt-10">
        <h2 className="text-[11px] tracking-[0.18em] uppercase font-medium text-cc-muted/70 mb-4">
          {t("intro.howTitle")}
        </h2>
        <ol className="space-y-3.5">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className="flex gap-3.5 text-sm text-cc-fg/85 leading-relaxed">
              <span className="shrink-0 mt-[3px] inline-flex items-center justify-center w-[22px] h-[22px] rounded-full font-logo text-[12px] text-cc-primary border border-cc-primary/40">
                {n}
              </span>
              <span className="max-w-[36ch]">{t(`intro.step${n}` as const)}</span>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}

// ── Cards pane ──────────────────────────────────────────────────────────

function GalleryCards({
  seeds,
  applyingKey,
  errorKey,
  errorMessage,
  onPick,
  onDismiss,
  t,
}: {
  seeds: SeedCard[];
  applyingKey: string | null;
  errorKey: string | null;
  errorMessage?: string;
  onPick: (seed: SeedCard) => void;
  onDismiss?: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const hasSeeds = seeds.length > 0;

  return (
    <section className="gallery-cards h-full overflow-y-auto px-8 py-10 lg:px-12 lg:py-14 relative">
      <header className="mb-9">
        <h2 className="font-logo text-2xl text-cc-fg leading-tight">
          {t("cards.heading")}
        </h2>
        {hasSeeds ? (
          <p className="mt-2 text-sm text-cc-muted">
            {t("cards.subheading", { count: seeds.length })}{" "}
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                className="text-cc-muted/60 hover:text-cc-primary transition-colors cursor-pointer underline-offset-4 hover:underline"
              >
                {t("cards.skipHint")}
              </button>
            ) : (
              <span className="text-cc-muted/60">{t("cards.skipHint")}</span>
            )}
          </p>
        ) : (
          <p className="mt-2 text-sm text-cc-muted max-w-[52ch]">
            {t("cards.empty")}{" "}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="text-cc-primary/80 hover:text-cc-primary transition-colors cursor-pointer underline-offset-4 hover:underline"
              >
                {t("cards.skipHint")}
              </button>
            )}
          </p>
        )}
      </header>

      {hasSeeds && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {seeds.map((seed, idx) => (
            <SeedCardView
              key={seed.id}
              seed={seed}
              index={idx}
              applying={applyingKey === seed.sourceKey}
              errored={errorKey === seed.sourceKey}
              errorMessage={errorKey === seed.sourceKey ? errorMessage : undefined}
              busy={applyingKey !== null}
              onPick={onPick}
              t={t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SeedCardView({
  seed,
  index,
  applying,
  errored,
  errorMessage: _errorMessage,
  busy,
  onPick,
  t,
}: {
  seed: SeedCard;
  index: number;
  applying: boolean;
  errored: boolean;
  errorMessage?: string;
  busy: boolean;
  onPick: (seed: SeedCard) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const disabled = busy && !applying;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(seed)}
      className={[
        "gallery-card group relative text-left rounded-xl overflow-hidden border border-cc-border/40",
        "bg-cc-surface/50 backdrop-blur-sm",
        "transition-[transform,border-color,box-shadow] duration-300 ease-out",
        applying
          ? "border-cc-primary/60 shadow-[0_0_28px_rgba(249,115,22,0.18)]"
          : disabled
          ? "opacity-50 cursor-default"
          : "hover:-translate-y-[2px] hover:border-cc-primary/50 hover:shadow-[0_18px_36px_-22px_rgba(0,0,0,0.55),0_0_22px_rgba(249,115,22,0.08)]",
      ].join(" ")}
      style={{ animation: `gallery-card-fade-in 0.55s ${index * 70}ms ease-out backwards` }}
      aria-label={t("card.openLabel")}
    >
      <SeedThumb seed={seed} applying={applying} />

      <div className="px-5 py-4 flex flex-col gap-2">
        <h3 className="font-logo text-lg text-cc-fg leading-snug">
          {seed.displayName}
        </h3>
        {seed.description && (
          <p className="text-[13px] text-cc-muted leading-relaxed line-clamp-2">
            {seed.description}
          </p>
        )}
        {seed.tags && seed.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 mt-1">
            {seed.tags.map((tag) => (
              <li
                key={tag}
                className="text-[10px] tracking-wide uppercase px-2 py-0.5 rounded-full border border-cc-border/40 text-cc-muted/80"
              >
                {tag}
              </li>
            ))}
          </ul>
        )}
      </div>

      {applying && (
        <div className="absolute inset-0 flex items-end justify-center bg-cc-bg/40 backdrop-blur-[2px] pb-5">
          <span className="text-[11px] tracking-[0.18em] uppercase text-cc-primary">
            {t("cards.preparing")}
          </span>
        </div>
      )}

      {errored && !applying && (
        <div className="absolute bottom-0 inset-x-0 px-5 py-2 text-[11px] text-cc-primary bg-cc-primary/[0.08] border-t border-cc-primary/30">
          {t("card.applyError")}
        </div>
      )}
    </button>
  );
}

function SeedThumb({ seed, applying: _applying }: { seed: SeedCard; applying: boolean }) {
  const hue = useMemo(() => hashHue(seed.id), [seed.id]);

  if (seed.thumbnailUrl) {
    return (
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-cc-bg/50">
        <img
          src={seed.thumbnailUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.02]"
        />
      </div>
    );
  }

  // Typographic fallback — uses a unique hue derived from the seed id so
  // each card stays distinguishable without bespoke art.
  const initial = seed.displayName.replace(/[^a-zA-Z0-9一-龥]/g, "").slice(0, 1) || "·";
  return (
    <div
      className="relative aspect-[16/10] w-full overflow-hidden"
      style={{
        background: `radial-gradient(circle at 30% 30%, oklch(0.42 0.08 ${hue}), oklch(0.16 0.04 ${hue}) 80%)`,
      }}
    >
      <span className="absolute inset-0 flex items-center justify-center font-logo text-[clamp(3rem,7vw,5rem)] text-white/30 select-none">
        {initial}
      </span>
      <span className="absolute bottom-3 left-4 text-[10px] tracking-[0.2em] uppercase text-white/40">
        {seed.id}
      </span>
    </div>
  );
}

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}
