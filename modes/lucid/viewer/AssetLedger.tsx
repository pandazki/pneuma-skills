/**
 * The asset ledger — every model the scene needs and where it came from.
 *
 * A side sheet rather than a permanent column: the stage is the instrument
 * the user watches, and the ledger is what they open when a prop looks wrong
 * and they want to know whether it was generated, modelled or coded.
 *
 * `source` is the rung of the asset ladder (procedural → Blender →
 * image-to-3D) and `state` is how far it got, so "planned but never made" and
 * "made but never placed in the scene" are visibly different things.
 */

import type { AssetEntry, AssetSource, AssetState } from "../domain.js";
import { CloseIcon } from "./icons.js";

const SOURCE_LABEL: Record<AssetSource, string> = {
  "image-to-3d": "image-to-3D",
  blender: "Blender",
  procedural: "procedural",
  user: "from the user",
};

const STATE_CLASS: Record<AssetState, string> = {
  planned: "border-cc-border text-cc-muted",
  generating: "border-cc-primary/40 text-cc-primary",
  ready: "border-cc-border text-cc-fg",
  placed: "border-cc-success/40 text-cc-success",
  failed: "border-cc-error/40 text-cc-error",
};

export interface AssetLedgerProps {
  assets: AssetEntry[];
  open: boolean;
  onClose: () => void;
}

export function AssetLedger({ assets, open, onClose }: AssetLedgerProps) {
  if (!open) return null;
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-72 max-w-[80%] flex-col border-l border-cc-border bg-cc-surface/95 backdrop-blur">
      <header className="flex shrink-0 items-center gap-2 border-b border-cc-border px-3 py-2">
        <h2 className="text-xs font-medium text-cc-fg">Asset ledger</h2>
        <span className="text-[11px] text-cc-muted">{assets.length}</span>
        <button
          type="button"
          onClick={onClose}
          title="Close the asset ledger"
          className="ml-auto rounded p-1 text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary/60"
        >
          <CloseIcon size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {assets.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-cc-muted">
            No assets recorded. A scene built entirely from code and lights is a
            valid answer — the ledger fills up when the agent starts sourcing
            models.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {assets.map((asset) => (
              <li
                key={asset.id}
                className="rounded-md border border-cc-border bg-cc-card px-2.5 py-2"
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate text-xs text-cc-fg">{asset.id}</span>
                  <span
                    className={`ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${STATE_CLASS[asset.state]}`}
                  >
                    {asset.state}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-cc-muted">
                  {asset.role} · {SOURCE_LABEL[asset.source]}
                </p>
                {asset.note ? (
                  <p className="mt-1 text-[11px] leading-relaxed text-cc-muted">{asset.note}</p>
                ) : null}
                {asset.files.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {asset.files.map((file) => (
                      <li key={file} className="truncate font-mono text-[10px] text-cc-muted" title={file}>
                        {file}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

export default AssetLedger;
