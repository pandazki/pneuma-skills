import { useCallback, useEffect, useMemo, useState } from "react";
import type { AssetType } from "@pneuma-craft/react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
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

interface RegisteredRow {
  assetId: string;
  uri: string;
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
  const allRegistered: RegisteredRow[] = useMemo(() => {
    const rows: RegisteredRow[] = [];
    for (const r of report.registered as RegisteredReconciled[]) {
      rows.push({ assetId: r.assetId, uri: r.uri, missing: false });
    }
    for (const m of report.missing as RegisteredEntry[]) {
      rows.push({ assetId: m.assetId, uri: m.uri, missing: true });
    }
    rows.sort((a, b) => filenameOf(a.uri).localeCompare(filenameOf(b.uri)));
    return rows;
  }, [report.registered, report.missing]);

  const orphansFiltered: FsEntry[] = useMemo(
    () =>
      report.orphaned
        .filter((o) => matchesFilter(o.uri, filter))
        .slice()
        .sort((a, b) => filenameOf(a.uri).localeCompare(filenameOf(b.uri))),
    [report.orphaned, filter],
  );

  const registeredFiltered: RegisteredRow[] = useMemo(
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
    const rightKeys = new Set(allRegistered.map((r) => r.assetId));
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
          width: "min(720px, 92vw)",
          maxHeight: "80vh",
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
            gridTemplateColumns: "1fr 52px 1fr",
            gap: theme.space.space2,
            padding: theme.space.space3,
            flex: 1,
            minHeight: 320,
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
            {orphansFiltered.map((o) => (
              <TransferRow
                key={o.uri}
                filename={filenameOf(o.uri)}
                selected={leftSelected.has(o.uri)}
                onToggle={() => toggleLeft(o.uri)}
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
            {registeredFiltered.map((r) => (
              <TransferRow
                key={r.assetId}
                filename={filenameOf(r.uri)}
                selected={rightSelected.has(r.assetId)}
                onToggle={() => toggleRight(r.assetId)}
                missing={r.missing}
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
  filename,
  selected,
  onToggle,
  missing = false,
}: {
  filename: string;
  selected: boolean;
  onToggle: () => void;
  missing?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.space.space2,
        padding: `${theme.space.space1}px ${theme.space.space2}px`,
        borderRadius: theme.radius.sm,
        background: selected ? theme.color.accentSoft : "transparent",
        border: `1px solid ${
          selected ? theme.color.accentBorder : "transparent"
        }`,
        cursor: "pointer",
        transition: `background ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.background =
            theme.color.surface3;
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        style={{
          margin: 0,
          accentColor: theme.color.accent,
          cursor: "pointer",
        }}
      />
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: theme.radius.sm,
          background: missing ? theme.color.dangerSoft : theme.color.surface4,
          border: `1px solid ${
            missing ? theme.color.dangerBorder : theme.color.borderWeak
          }`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: missing ? theme.color.dangerInk : theme.color.ink4,
          flexShrink: 0,
        }}
      >
        {missing ? <WarningIcon size={10} /> : null}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
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
