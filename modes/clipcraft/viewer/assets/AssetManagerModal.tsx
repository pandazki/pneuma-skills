import { useCallback, useEffect, useMemo, useState } from "react";
import type { AssetType } from "@pneuma-craft/react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  AudioIcon,
  CameraFrontIcon,
  VideoIcon,
  WarningIcon,
  XIcon,
} from "../icons/index.js";
import { theme } from "../theme/tokens.js";
import { classifyByUri } from "./classify.js";
import type {
  FsEntry,
  ReconcileReport,
  RegisteredEntry,
  RegisteredReconciled,
} from "./reconcile.js";
import { useAssetActions } from "./useAssetActions.js";

type Filter = "all" | AssetType;

/**
 * Unified row shape used by both panes so a row's layout stays
 * identical when items transfer across.
 *
 *   key       — React key / selection token (uri on the left,
 *               assetId on the right — they live in separate
 *               selection sets).
 *   selectKey — alias exposed to the caller; kept in sync with `key`.
 *   missing   — right-pane only: registered URI with no matching
 *               file on disk. Size / mtime are unknown in that case.
 */
interface Row {
  key: string;
  uri: string;
  filename: string;
  type: AssetType | null;
  size?: number;
  mtime?: number;
  missing: boolean;
}

export interface AssetManagerModalProps {
  open: boolean;
  onClose: () => void;
  report: ReconcileReport;
  refetchFs: () => void;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
];

function filenameOf(uri: string): string {
  return uri.split("/").pop() ?? uri;
}

function matchesFilter(uri: string, filter: Filter): boolean {
  if (filter === "all") return true;
  return classifyByUri(uri) === filter;
}

function contentUrl(uri: string): string {
  if (!uri) return "";
  return `/content/${uri.split("/").map(encodeURIComponent).join("/")}`;
}

/** Compact human-readable byte formatter — deliberately inline to
 *  avoid pulling in a dep for three lines of math. */
function formatSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  const precision = n >= 10 ? 0 : 1;
  return `${n.toFixed(precision)} ${units[i]}`;
}

export function AssetManagerModal({
  open,
  onClose,
  report,
  refetchFs,
}: AssetManagerModalProps) {
  const { importOrphan, remove } = useAssetActions();
  const [filter, setFilter] = useState<Filter>("all");
  const [leftSelected, setLeftSelected] = useState<Set<string>>(new Set());
  const [rightSelected, setRightSelected] = useState<Set<string>>(new Set());

  // Escape-to-close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset selection whenever the modal opens or the report identity
  // changes (e.g. after a transfer + refetch). Entries that still
  // exist keep selected-ness through the filter list memo below.
  useEffect(() => {
    if (!open) {
      setLeftSelected(new Set());
      setRightSelected(new Set());
    }
  }, [open]);

  // Imported pane = registered (on-disk) ∪ missing (registry-only), flagged.
  const allRegistered: Row[] = useMemo(() => {
    const rows: Row[] = [];
    for (const r of report.registered as RegisteredReconciled[]) {
      rows.push({
        key: r.assetId,
        uri: r.uri,
        filename: filenameOf(r.uri),
        type: classifyByUri(r.uri),
        size: r.size,
        mtime: r.mtime,
        missing: false,
      });
    }
    for (const m of report.missing as RegisteredEntry[]) {
      rows.push({
        key: m.assetId,
        uri: m.uri,
        filename: filenameOf(m.uri),
        type: classifyByUri(m.uri),
        missing: true,
      });
    }
    rows.sort((a, b) => a.filename.localeCompare(b.filename));
    return rows;
  }, [report.registered, report.missing]);

  const orphansFiltered: Row[] = useMemo(() => {
    const rows: Row[] = report.orphaned
      .filter((o) => matchesFilter(o.uri, filter))
      .map((o: FsEntry) => ({
        key: o.uri,
        uri: o.uri,
        filename: filenameOf(o.uri),
        type: classifyByUri(o.uri),
        size: o.size,
        mtime: o.mtime,
        missing: false,
      }));
    rows.sort((a, b) => a.filename.localeCompare(b.filename));
    return rows;
  }, [report.orphaned, filter]);

  const registeredFiltered: Row[] = useMemo(
    () => allRegistered.filter((r) => matchesFilter(r.uri, filter)),
    [allRegistered, filter],
  );

  // After report updates (refetch), prune selections that no longer exist.
  useEffect(() => {
    const leftKeys = new Set(report.orphaned.map((o) => o.uri));
    setLeftSelected((prev) => {
      const next = new Set<string>();
      for (const k of prev) if (leftKeys.has(k)) next.add(k);
      return next.size === prev.size ? prev : next;
    });
    const rightKeys = new Set(allRegistered.map((r) => r.key));
    setRightSelected((prev) => {
      const next = new Set<string>();
      for (const k of prev) if (rightKeys.has(k)) next.add(k);
      return next.size === prev.size ? prev : next;
    });
  }, [report.orphaned, allRegistered]);

  const toggleLeft = useCallback((uri: string) => {
    setLeftSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  }, []);

  const toggleRight = useCallback((assetId: string) => {
    setRightSelected((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  const handleImport = useCallback(() => {
    if (leftSelected.size === 0) return;
    const failed = new Set<string>();
    for (const uri of leftSelected) {
      const entry = report.orphaned.find((o) => o.uri === uri);
      if (!entry) continue;
      const id = importOrphan(entry);
      if (!id) failed.add(uri);
    }
    setLeftSelected(failed);
    refetchFs();
  }, [leftSelected, report.orphaned, importOrphan, refetchFs]);

  const handleUnregister = useCallback(() => {
    if (rightSelected.size === 0) return;
    for (const assetId of rightSelected) remove(assetId);
    setRightSelected(new Set());
    refetchFs();
  }, [rightSelected, remove, refetchFs]);

  if (!open) return null;

  const isPreviewFilter = filter === "image" || filter === "video";

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Asset Manager"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        background: "oklch(0% 0 0 / 0.72)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: theme.font.ui,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1080px, 94vw)",
          height: "85vh",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: theme.color.surface1,
          border: `1px solid ${theme.color.border}`,
          borderRadius: theme.radius.md,
          boxShadow: theme.elevation.s4,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `${theme.space.space3}px ${theme.space.space4}px`,
            borderBottom: `1px solid ${theme.color.borderWeak}`,
          }}
        >
          <div
            style={{
              fontSize: theme.text.base,
              fontWeight: theme.text.weightSemibold,
              color: theme.color.ink0,
              letterSpacing: theme.text.trackingTight,
            }}
          >
            Asset Manager
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            title="Close (Esc)"
            style={{
              width: 26,
              height: 26,
              borderRadius: theme.radius.pill,
              background: "transparent",
              border: `1px solid ${theme.color.borderWeak}`,
              color: theme.color.ink2,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            <XIcon size={12} />
          </button>
        </div>

        {/* Filter tabs */}
        <FilterTabs active={filter} onChange={setFilter} />

        {/* Body: transfer list */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 60px 1fr",
            gap: theme.space.space2,
            padding: theme.space.space3,
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <TransferPane
            title="Not Imported"
            count={orphansFiltered.length}
            emptyText={
              report.orphaned.length === 0
                ? "No orphan files on disk."
                : "No files match this filter."
            }
          >
            {orphansFiltered.map((row) => (
              <TransferRow
                key={row.key}
                row={row}
                isPreview={isPreviewFilter}
                selected={leftSelected.has(row.key)}
                onToggle={() => toggleLeft(row.key)}
              />
            ))}
          </TransferPane>

          {/* Center arrows */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: theme.space.space2,
            }}
          >
            <ArrowButton
              direction="right"
              disabled={leftSelected.size === 0}
              onClick={handleImport}
              label={`Import ${leftSelected.size || ""}`.trim()}
              title="Import selected files"
            />
            <ArrowButton
              direction="left"
              disabled={rightSelected.size === 0}
              onClick={handleUnregister}
              label={`Unregister ${rightSelected.size || ""}`.trim()}
              title="Unregister selected assets (file stays on disk)"
            />
          </div>

          <TransferPane
            title="Imported"
            count={registeredFiltered.length}
            emptyText={
              allRegistered.length === 0
                ? "No registered assets yet."
                : "No assets match this filter."
            }
          >
            {registeredFiltered.map((row) => (
              <TransferRow
                key={row.key}
                row={row}
                isPreview={isPreviewFilter}
                selected={rightSelected.has(row.key)}
                onToggle={() => toggleRight(row.key)}
              />
            ))}
          </TransferPane>
        </div>
      </div>
    </div>
  );
}

/* ─── Filter tabs ─────────────────────────────────────────────────── */

function FilterTabs({
  active,
  onChange,
}: {
  active: Filter;
  onChange: (f: Filter) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: theme.space.space4,
        padding: `${theme.space.space2}px ${theme.space.space4}px`,
        borderBottom: `1px solid ${theme.color.borderWeak}`,
      }}
    >
      {FILTERS.map((f) => {
        const isActive = active === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
            aria-pressed={isActive}
            style={{
              background: "transparent",
              border: "none",
              padding: `${theme.space.space1}px 0`,
              color: isActive ? theme.color.ink0 : theme.color.ink3,
              fontFamily: theme.font.ui,
              fontSize: theme.text.xs,
              fontWeight: theme.text.weightSemibold,
              letterSpacing: theme.text.trackingCaps,
              textTransform: "uppercase",
              borderBottom: isActive
                ? `2px solid ${theme.color.accent}`
                : "2px solid transparent",
              cursor: "pointer",
              transition: `color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
            }}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Transfer pane ───────────────────────────────────────────────── */

function TransferPane({
  title,
  count,
  emptyText,
  children,
}: {
  title: string;
  count: number;
  emptyText: string;
  children: React.ReactNode;
}) {
  const isEmpty = count === 0;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: theme.color.surface2,
        border: `1px solid ${theme.color.borderWeak}`,
        borderRadius: theme.radius.base,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: `${theme.space.space2}px ${theme.space.space3}px`,
          fontFamily: theme.font.ui,
          fontSize: theme.text.xs,
          fontWeight: theme.text.weightSemibold,
          letterSpacing: theme.text.trackingCaps,
          textTransform: "uppercase",
          color: theme.color.ink2,
          background: theme.color.surface3,
          borderBottom: `1px solid ${theme.color.borderWeak}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: theme.space.space2,
          flexShrink: 0,
        }}
      >
        <span>{title}</span>
        <span
          style={{
            color: theme.color.ink4,
            fontWeight: theme.text.weightRegular,
            fontFamily: theme.font.numeric,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: theme.space.space1,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {isEmpty ? (
          <div
            style={{
              fontSize: theme.text.xs,
              color: theme.color.ink5,
              fontStyle: "italic",
              padding: theme.space.space3,
              textAlign: "center",
            }}
          >
            {emptyText}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/* ─── Single row ──────────────────────────────────────────────────── */

function TransferRow({
  row,
  isPreview,
  selected,
  onToggle,
}: {
  row: Row;
  isPreview: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const { filename, type, size, missing, uri } = row;

  // Compact rows stay ~36px; preview rows are ~92px with a real
  // thumbnail. Both share the same props shape so a row's identity
  // survives a transfer across panes.
  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.space.space2,
    padding: isPreview
      ? theme.space.space2
      : `${theme.space.space1}px ${theme.space.space2}px`,
    borderRadius: theme.radius.sm,
    background: selected ? theme.color.accentSoft : "transparent",
    border: `1px solid ${
      selected ? theme.color.accentBorder : "transparent"
    }`,
    cursor: "pointer",
    transition: `background ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
    minHeight: isPreview ? 92 : 32,
  };

  const handleHover = (bg: string | "transparent") =>
    (e: React.MouseEvent<HTMLLabelElement>) => {
      if (!selected) {
        (e.currentTarget as HTMLElement).style.background = bg;
      }
    };

  return (
    <label
      style={rowStyle}
      onMouseEnter={handleHover(theme.color.surface3)}
      onMouseLeave={handleHover("transparent")}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        style={{
          margin: 0,
          accentColor: theme.color.accent,
          cursor: "pointer",
          flexShrink: 0,
        }}
      />

      {isPreview ? (
        <MediaPreview uri={uri} type={type} missing={missing} size={72} />
      ) : (
        <TypeBadge type={type} missing={missing} />
      )}

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <span
          title={filename}
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: theme.font.ui,
            fontSize: theme.text.sm,
            color: missing ? theme.color.dangerInk : theme.color.ink1,
            textDecoration: missing ? "line-through" : "none",
          }}
        >
          {filename}
        </span>
        {isPreview && !missing && size != null && (
          <span
            style={{
              fontFamily: theme.font.numeric,
              fontSize: theme.text.xs,
              color: theme.color.ink4,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatSize(size)}
          </span>
        )}
      </div>

      {missing && (
        <span
          style={{
            fontSize: theme.text.xs,
            fontFamily: theme.font.ui,
            color: theme.color.dangerInk,
            background: theme.color.dangerSoft,
            border: `1px solid ${theme.color.dangerBorder}`,
            borderRadius: theme.radius.sm,
            padding: "0 4px",
            letterSpacing: theme.text.trackingCaps,
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          missing
        </span>
      )}
    </label>
  );
}

/* ─── Compact type badge (All / Audio filters) ────────────────────── */

function TypeBadge({
  type,
  missing,
}: {
  type: AssetType | null;
  missing: boolean;
}) {
  const Icon =
    type === "video"
      ? VideoIcon
      : type === "audio"
      ? AudioIcon
      : type === "image"
      ? CameraFrontIcon
      : null;

  return (
    <span
      aria-hidden
      style={{
        width: 24,
        height: 24,
        borderRadius: theme.radius.sm,
        background: missing ? theme.color.dangerSoft : theme.color.surface4,
        border: `1px solid ${
          missing ? theme.color.dangerBorder : theme.color.borderWeak
        }`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: missing ? theme.color.dangerInk : theme.color.ink3,
        flexShrink: 0,
      }}
    >
      {missing ? (
        <WarningIcon size={12} />
      ) : Icon ? (
        <Icon size={12} />
      ) : null}
    </span>
  );
}

/* ─── Media preview (image / video first-frame) ───────────────────── */

/**
 * Fixed-size preview tile. Renders:
 *   - missing  → dimmed danger-tinted frame with a warning glyph,
 *                never touches the network.
 *   - image    → <img loading=lazy>
 *   - video    → <video preload=metadata> seeked to 0.1s on load,
 *                muted / playsInline so it can render without user
 *                interaction.
 *   - audio/other → same neutral frame as the compact badge, just
 *                bigger (we don't attempt waveforms here — that's
 *                a later task).
 */
function MediaPreview({
  uri,
  type,
  missing,
  size,
}: {
  uri: string;
  type: AssetType | null;
  missing: boolean;
  size: number;
}) {
  const frameStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
    background: missing ? theme.color.dangerSoft : theme.color.surface3,
    border: `1px solid ${
      missing ? theme.color.dangerBorder : theme.color.borderWeak
    }`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: missing ? theme.color.dangerInk : theme.color.ink4,
    flexShrink: 0,
  };

  if (missing) {
    return (
      <div style={frameStyle} aria-hidden>
        <WarningIcon size={20} />
      </div>
    );
  }

  const url = contentUrl(uri);

  if (type === "image") {
    return (
      <div style={frameStyle} aria-hidden>
        <img
          src={url}
          alt=""
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }

  if (type === "video") {
    return (
      <div style={frameStyle} aria-hidden>
        <video
          src={url}
          muted
          playsInline
          preload="metadata"
          onLoadedData={(e) => {
            // Nudge past 0 so browsers that hold a blank poster at
            // currentTime=0 reveal the first real frame instead.
            (e.target as HTMLVideoElement).currentTime = 0.1;
          }}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }

  // Audio / unknown — show the type icon in the frame. Image and
  // video are handled above, so this branch only ever sees "audio",
  // "text" (rare in this modal), or null.
  const Icon = type === "audio" ? AudioIcon : null;

  return (
    <div style={frameStyle} aria-hidden>
      {Icon ? <Icon size={20} /> : null}
    </div>
  );
}

/* ─── Arrow button ────────────────────────────────────────────────── */

function ArrowButton({
  direction,
  disabled,
  onClick,
  label,
  title,
}: {
  direction: "left" | "right";
  disabled: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      style={{
        width: 40,
        height: 32,
        borderRadius: theme.radius.base,
        background: disabled ? "transparent" : theme.color.accentSoft,
        border: `1px solid ${
          disabled ? theme.color.borderWeak : theme.color.accentBorder
        }`,
        color: disabled ? theme.color.ink5 : theme.color.accentBright,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}`,
      }}
    >
      {direction === "right" ? (
        <ArrowRightIcon size={14} />
      ) : (
        <ArrowLeftIcon size={14} />
      )}
    </button>
  );
}
