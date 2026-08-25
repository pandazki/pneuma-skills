/**
 * InitParamForm — shared rendering for mode init parameters.
 *
 * Extracted from `Launcher.tsx` so the launcher dialog and the project-panel
 * launch sheet can share one source of truth for how `select` / `multi-select`
 * / `number` / `password` / `text` fields look + behave, including the
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
 * `multi-select` is the one control that is not a form element: a set-valued
 * parameter is a set of checkable chips, grouped so "presets" read differently
 * from "the specific things you have". A native `<select multiple>` would be
 * both OS-native chrome (forbidden — see `.claude/rules/frontend.md`) and a
 * poor fit: the presets are exclusive, which a native list cannot express.
 * All of the selection rules live in `core/init-param-options.ts` so the
 * interactive CLI computes the identical stored value.
 *
 * Props are intentionally minimal. The owning component holds `values`
 * (so it can read them on submit) and re-renders on every onChange.
 */
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { InitParam, InitParamOption } from "../../core/types/mode-manifest.js";
import {
  groupInitParamOptions,
  initParamOptionLabel,
  normalizeInitParamOptions,
  parseInitParamSelection,
  serializeInitParamSelection,
  toggleInitParamSelection,
  visibleInitParamOptions,
} from "../../core/init-param-options.js";

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

/** The check mark on a selected chip — an SVG, never an emoji. */
function CheckMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="w-3.5 h-3.5 shrink-0 text-cc-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

/**
 * A set-valued parameter: checkable chips, grouped.
 *
 * Every rule about *what* a click does — presets are exclusive, the selection
 * never empties, the serialized order follows the declared option order — is
 * imported from `core/init-param-options.ts`, the same module the CLI prompt
 * uses. This component only decides how it looks.
 */
function MultiSelectField({
  param,
  value,
  onChange,
  disabled,
  missingGroupLabel,
}: {
  param: InitParamWithAutoFill;
  value: string | number | undefined;
  onChange: (next: string) => void;
  disabled: boolean;
  missingGroupLabel: string;
}) {
  const declared = normalizeInitParamOptions(param.options);
  const selected = parseInitParamSelection(value ?? param.defaultValue);
  const options = visibleInitParamOptions(declared, selected, missingGroupLabel);
  const groups = groupInitParamOptions(options);

  const toggle = (option: InitParamOption) => {
    onChange(serializeInitParamSelection(toggleInitParamSelection(options, selected, option.value)));
  };

  return (
    <div
      role="group"
      aria-label={param.label}
      data-init-param-multiselect={param.name}
      className={`space-y-2.5 ${disabled ? "opacity-60" : ""}`}
    >
      {groups.map((group) => (
        <div key={group.group ?? ""} className="space-y-1.5">
          {group.group && (
            <div className="text-[10px] uppercase tracking-[0.12em] text-cc-muted/60">
              {group.group}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {group.options.map((option) => {
              const isSelected = selected.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  data-value={option.value}
                  disabled={disabled}
                  onClick={() => toggle(option)}
                  title={option.description}
                  className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-left text-sm transition-colors cursor-pointer disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/40 ${
                    isSelected
                      ? "border-cc-primary/50 bg-cc-primary-muted text-cc-fg"
                      : "border-cc-border bg-cc-input-bg text-cc-muted hover:text-cc-fg hover:border-cc-primary/30"
                  }`}
                >
                  {isSelected && <CheckMark />}
                  <span className="flex flex-col min-w-0">
                    <span className="truncate">{initParamOptionLabel(option)}</span>
                    {option.description && (
                      <span className="text-[11px] leading-tight text-cc-muted/70 truncate max-w-[22rem]">
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

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
  const { t } = useTranslation("init-param");
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
                  {t("from_global_keys")}
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
                  {t("clear")}
                </button>
              </div>
            ) : param.type === "multi-select" ? (
              <MultiSelectField
                param={param}
                value={values[param.name]}
                onChange={(next) => onChange({ ...values, [param.name]: next })}
                disabled={disabled}
                missingGroupLabel={t("not_found")}
              />
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
                {normalizeInitParamOptions(param.options).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {initParamOptionLabel(opt)}
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
