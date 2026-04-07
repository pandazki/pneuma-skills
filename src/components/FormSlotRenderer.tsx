import { useState, useCallback } from "react";
import type { FormSlotDeclaration, FormField } from "../../core/types/plugin.js";

interface FormSlotRendererProps {
  declaration: FormSlotDeclaration;
  values?: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}

function renderField(
  field: FormField,
  value: unknown,
  onFieldChange: (name: string, value: unknown) => void,
) {
  const baseInputClass =
    "w-full px-3 py-2 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder-cc-muted/40 outline-none focus:border-cc-primary/50 transition-colors";

  switch (field.type) {
    case "text":
    case "password":
      return (
        <input
          type={field.type}
          value={(value as string) ?? field.defaultValue ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onFieldChange(field.name, e.target.value)}
          className={baseInputClass}
        />
      );

    case "textarea":
      return (
        <textarea
          value={(value as string) ?? field.defaultValue ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onFieldChange(field.name, e.target.value)}
          rows={3}
          className={baseInputClass + " resize-y"}
        />
      );

    case "select":
      return (
        <select
          value={(value as string) ?? field.defaultValue ?? ""}
          onChange={(e) => onFieldChange(field.name, e.target.value)}
          className={baseInputClass}
        >
          <option value="">{field.placeholder || "Select..."}</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case "checkbox":
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!value ?? !!field.defaultValue}
            onChange={(e) => onFieldChange(field.name, e.target.checked)}
            className="w-3.5 h-3.5 rounded border-cc-border bg-cc-input-bg accent-cc-primary"
          />
          <span className="text-xs text-cc-fg">{field.label}</span>
        </label>
      );

    default:
      return null;
  }
}

export function FormSlotRenderer({ declaration, values, onChange }: FormSlotRendererProps) {
  const [localValues, setLocalValues] = useState<Record<string, unknown>>(values ?? {});

  const handleFieldChange = useCallback(
    (name: string, value: unknown) => {
      const next = { ...localValues, [name]: value };
      setLocalValues(next);
      onChange(next);
    },
    [localValues, onChange],
  );

  return (
    <div className="space-y-3">
      {declaration.fields.map((field) => (
        <div key={field.name} className="space-y-1">
          {field.type !== "checkbox" && (
            <label className="block text-[10px] font-medium text-cc-muted uppercase tracking-wider">
              {field.label}
              {field.required && <span className="text-cc-primary ml-0.5">*</span>}
            </label>
          )}
          {renderField(field, localValues[field.name], handleFieldChange)}
          {field.description && (
            <p className="text-[10px] text-cc-muted/50">{field.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}
