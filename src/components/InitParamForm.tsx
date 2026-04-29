/**
 * InitParamForm — shared rendering for mode init parameters.
 *
 * Extracted from `Launcher.tsx` so the launcher dialog and the project-panel
 * launch sheet can share one source of truth for how `select` / `number` /
 * `password` / `text` fields look + behave, including the
 * "auto-filled-from-stored-keys" affordance and the `modeName → displayName`
 * convenience mapping for mode-maker.
 *
 * Behaviour mirrors the original block at `Launcher.tsx:2091–2170` exactly:
 *
 *   - autoFilled values render as a masked-preview disabled input plus a
 *     Clear button that empties the value; the input flips to a normal
 *     editable field as soon as the user clears or edits it.
 *   - select renders a `<select>` whose value falls back to defaultValue.
 *   - number / text inputs share the same row; sensitive params use
 *     type="password" (matches Launcher's existing branching).
 *   - Editing modeName auto-populates displayName (Title Case, split on
 *     `-`/`_`/space) until the user explicitly touches displayName.
 *
 * Props are intentionally minimal. The owning component holds `values`
 * (so it can read them on submit) and re-renders on every onChange.
 */
import { useRef } from "react";
import type { InitParam } from "../../core/types/mode-manifest.js";

/**
 * `/api/launch/prepare` returns InitParam plus optional `autoFilled` +
 * `maskedPreview` annotations when the server matched a stored API key.
 * We re-declare the shape here so consumers don't need to know about the
 * server-side annotation.
 */
export type InitParamWithAutoFill = InitParam & {
  autoFilled?: boolean;
  maskedPreview?: string;
};

interface InitParamFormProps {
  params: InitParamWithAutoFill[];
  values: Record<string, string | number>;
  onChange: (next: Record<string, string | number>) => void;
  /** Read-only mode (existing-session resume in Launcher). */
  disabled?: boolean;
}

export function InitParamForm({
  params,
  values,
  onChange,
  disabled = false,
}: InitParamFormProps) {
  // Keep a "user has touched displayName" flag so modeName → displayName
  // auto-population stops as soon as the user edits displayName directly.
  // Using a ref (not state) matches the original Launcher behaviour and
  // avoids re-renders.
  const displayNameTouchedRef = useRef(false);

  if (params.length === 0) return null;

  return (
    <div className="space-y-3">
      {params.map((param) => {
        const showMasked =
          param.autoFilled && values[param.name] === param.defaultValue;

        return (
          <div key={param.name}>
            <label className="block text-sm text-cc-muted mb-1">
              {param.label}
              {param.autoFilled && (
                <span className="text-cc-success/70 text-xs ml-2">
                  from global keys
                </span>
              )}
              {param.description && !param.autoFilled && (
                <span className="text-cc-muted/60"> — {param.description}</span>
              )}
            </label>
            {showMasked ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={param.maskedPreview ?? ""}
                  disabled
                  className="flex-1 px-3 py-2 bg-cc-input-bg border border-cc-border rounded-lg text-cc-muted text-sm opacity-70 cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...values, [param.name]: "" })}
                  disabled={disabled}
                  className="text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
              </div>
            ) : param.type === "select" && Array.isArray(param.options) ? (
              <select
                value={String(values[param.name] ?? param.defaultValue)}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...values, [param.name]: e.target.value })
                }
                className={`w-full px-3 py-2 bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg text-sm focus:outline-none focus:border-cc-primary/50 ${
                  disabled ? "opacity-60 cursor-not-allowed" : ""
                }`}
              >
                {param.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={
                  param.type === "number"
                    ? "number"
                    : param.sensitive
                      ? "password"
                      : "text"
                }
                value={values[param.name] ?? param.defaultValue}
                disabled={disabled}
                onChange={(e) => {
                  let val: string | number =
                    param.type === "number"
                      ? Number(e.target.value)
                      : e.target.value;
                  if (param.name === "modeName" && typeof val === "string") {
                    val = val.toLowerCase().replace(/[^a-z0-9-]/g, "");
                  }
                  const next: Record<string, string | number> = {
                    ...values,
                    [param.name]: val,
                  };
                  if (
                    param.name === "modeName" &&
                    typeof val === "string" &&
                    !displayNameTouchedRef.current
                  ) {
                    const hasDisplayName = params.some(
                      (p) => p.name === "displayName",
                    );
                    if (hasDisplayName) {
                      next.displayName = val
                        .split(/[-_\s]+/)
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(" ");
                    }
                  }
                  if (param.name === "displayName") {
                    displayNameTouchedRef.current = true;
                  }
                  onChange(next);
                }}
                className={`w-full px-3 py-2 bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg text-sm focus:outline-none focus:border-cc-primary/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                  disabled ? "opacity-60 cursor-not-allowed" : ""
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default InitParamForm;
