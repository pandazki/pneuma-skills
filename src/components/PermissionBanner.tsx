import { useState } from "react";
import { useStore } from "../store.js";
import { sendPermissionResponse } from "../ws.js";
import type { PermissionRequest } from "../types.js";

export default function PermissionBanner() {
  const pendingPermissions = useStore((s) => s.pendingPermissions);

  if (pendingPermissions.size === 0) return null;

  return (
    <div className="space-y-2 p-3">
      {Array.from(pendingPermissions.values()).map((perm) =>
        perm.tool_name === "AskUserQuestion" ? (
          <AskUserQuestionCard key={perm.request_id} perm={perm} />
        ) : (
          <ToolPermissionCard key={perm.request_id} perm={perm} />
        ),
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tool Permission (existing Allow / Deny UI)                         */
/* ------------------------------------------------------------------ */

function ToolPermissionCard({ perm }: { perm: PermissionRequest }) {
  return (
    <div className="bg-amber-900/40 border border-amber-700/50 rounded-lg p-3">
      <div className="text-sm font-medium text-amber-200 mb-1">
        Permission Request: {perm.tool_name}
      </div>
      {perm.description && (
        <div className="text-xs text-amber-300/80 mb-2">
          {perm.description}
        </div>
      )}
      <div className="text-xs text-cc-muted mb-2 font-mono max-h-32 overflow-y-auto bg-cc-bg/50 rounded p-2">
        {JSON.stringify(perm.input, null, 2)}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => sendPermissionResponse(perm.request_id, "allow")}
          className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
        >
          Allow
        </button>
        <button
          onClick={() => sendPermissionResponse(perm.request_id, "deny")}
          className="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AskUserQuestion — options + custom input                           */
/* ------------------------------------------------------------------ */

function AskUserQuestionCard({ perm }: { perm: PermissionRequest }) {
  const questions: Record<string, unknown>[] = Array.isArray(perm.input.questions)
    ? perm.input.questions
    : [];

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const [showCustom, setShowCustom] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);

  function submit(answers: Record<string, string>) {
    setSubmitted(true);
    sendPermissionResponse(perm.request_id, "allow", {
      ...perm.input,
      answers,
    });
  }

  function handleOptionClick(qIdx: number, label: string) {
    const key = String(qIdx);
    setSelections((prev) => ({ ...prev, [key]: label }));
    setShowCustom((prev) => ({ ...prev, [key]: false }));
    // Auto-submit for single question
    if (questions.length <= 1) submit({ [key]: label });
  }

  function handleCustomToggle(qIdx: number) {
    const key = String(qIdx);
    setShowCustom((prev) => {
      const wasOpen = Boolean(prev[key]);
      const next = { ...prev, [key]: !wasOpen };
      if (wasOpen) {
        // closing — clear custom state
        setSelections((s) => { const c = { ...s }; delete c[key]; return c; });
        setCustomText((t) => { const c = { ...t }; delete c[key]; return c; });
      }
      return next;
    });
  }

  function handleCustomChange(qIdx: number, value: string) {
    const key = String(qIdx);
    setCustomText((prev) => ({ ...prev, [key]: value }));
    const trimmed = value.trim();
    setSelections((prev) => {
      if (!trimmed) { const c = { ...prev }; delete c[key]; return c; }
      return { ...prev, [key]: trimmed };
    });
  }

  function handleCustomSubmit(qIdx: number) {
    const key = String(qIdx);
    const text = customText[key]?.trim();
    if (!text) return;
    setSelections((prev) => ({ ...prev, [key]: text }));
    if (questions.length <= 1) submit({ [key]: text });
  }

  // Fallback: no structured questions
  if (questions.length === 0) {
    const question = typeof perm.input.question === "string" ? perm.input.question : "";
    return (
      <div className="bg-cc-primary/5 border border-cc-primary/20 rounded-lg p-3">
        <div className="text-sm font-medium text-cc-primary mb-1">Question</div>
        {question && <div className="text-xs text-cc-primary/80">{question}</div>}
      </div>
    );
  }

  return (
    <div className="bg-cc-surface border border-cc-primary/20 rounded-lg p-3 space-y-3">
      <div className="text-sm font-medium text-cc-primary">Question</div>

      {questions.map((q, i) => {
        const header = typeof q.header === "string" ? q.header : "";
        const text = typeof q.question === "string" ? q.question : "";
        const options: Record<string, unknown>[] = Array.isArray(q.options) ? q.options : [];
        const key = String(i);
        const selected = selections[key];
        const isCustom = showCustom[key];

        return (
          <div key={i} className="space-y-2">
            {header && (
              <span className="inline-block text-[10px] font-semibold text-cc-primary bg-cc-primary/10 px-1.5 py-0.5 rounded">
                {header}
              </span>
            )}
            {text && <p className="text-sm text-cc-fg leading-relaxed">{text}</p>}

            {options.length > 0 && (
              <div className="space-y-1.5">
                {options.map((opt, j) => {
                  const label = typeof opt.label === "string" ? opt.label : String(opt);
                  const desc = typeof opt.description === "string" ? opt.description : "";
                  const isSelected = selected === label && !isCustom;

                  return (
                    <button
                      key={j}
                      onClick={() => handleOptionClick(i, label)}
                      disabled={submitted}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-all cursor-pointer disabled:opacity-50 ${
                        isSelected
                          ? "border-cc-primary bg-cc-primary/10 ring-1 ring-cc-primary/30"
                          : "border-cc-border bg-cc-bg hover:bg-cc-hover hover:border-cc-primary/30"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          isSelected ? "border-cc-primary" : "border-cc-border"
                        }`}>
                          {isSelected && <span className="w-2 h-2 rounded-full bg-cc-primary" />}
                        </span>
                        <div>
                          <span className="text-xs font-medium text-cc-fg">{label}</span>
                          {desc && <p className="text-[11px] text-cc-muted mt-0.5 leading-snug">{desc}</p>}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* "Other..." custom input */}
                <button
                  onClick={() => handleCustomToggle(i)}
                  disabled={submitted}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-all cursor-pointer disabled:opacity-50 ${
                    isCustom
                      ? "border-cc-primary bg-cc-primary/10 ring-1 ring-cc-primary/30"
                      : "border-cc-border bg-cc-bg hover:bg-cc-hover hover:border-cc-primary/30"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      isCustom ? "border-cc-primary" : "border-cc-border"
                    }`}>
                      {isCustom && <span className="w-2 h-2 rounded-full bg-cc-primary" />}
                    </span>
                    <span className="text-xs font-medium text-cc-muted">Other...</span>
                  </div>
                </button>

                {isCustom && (
                  <div className="pl-6">
                    <input
                      type="text"
                      value={customText[key] || ""}
                      onChange={(e) => handleCustomChange(i, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleCustomSubmit(i); }}
                      placeholder="Type your answer..."
                      className="w-full px-2.5 py-1.5 text-xs bg-cc-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/50"
                      autoFocus
                    />
                    {questions.length <= 1 && (
                      <p className="mt-1 text-[10px] text-cc-muted">Press Enter to submit</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Submit button for multi-question forms */}
      {questions.length > 1 && Object.keys(selections).length > 0 && (
        <button
          onClick={() => submit(selections)}
          disabled={submitted}
          className="px-4 py-1.5 text-xs font-medium bg-cc-primary hover:bg-cc-primary-hover text-white rounded-lg disabled:opacity-50 transition-colors cursor-pointer"
        >
          Submit answers
        </button>
      )}
    </div>
  );
}
