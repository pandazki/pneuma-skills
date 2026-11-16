import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiBase } from "../utils/api.js";
import { Icon } from "./Icon.js";
import { createSetupRequest, readSetupStatus, setupHostname, type CollaborationSetupPath, type CollaborationSetupStatus } from "./setup-request.js";

const focus = "focus-visible:ring-2 focus-visible:ring-cc-primary focus-visible:ring-offset-2 focus-visible:ring-offset-cc-bg";

/** Shared, read-only onboarding: setup is performed only after the user pastes the request into their agent. */
export function CollaborationSetupGuide() {
  const { t, i18n } = useTranslation("collaboration-setup");
  const id = useId();
  const [path, setPath] = useState<CollaborationSetupPath>("lan");
  const [hostname, setHostname] = useState("");
  const [status, setStatus] = useState<CollaborationSetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [rechecking, setRechecking] = useState(false);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const copyOperation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const normalizedHostname = setupHostname(hostname);
  const validHostname = path !== "named" || normalizedHostname !== null;
  const guideUrl = new URL(`${getApiBase()}/api/collaboration/setup/guide`, location.origin).href;
  const prompt = useMemo(() => status && validHostname ? createSetupRequest(status, path, guideUrl, path === "named" ? normalizedHostname ?? "" : "", i18n.getResourceBundle(i18n.resolvedLanguage ?? i18n.language, "collaboration-setup") ?? i18n.getResourceBundle("en", "collaboration-setup")) : "", [status, path, guideUrl, normalizedHostname, validHostname, i18n.resolvedLanguage, i18n.language]);

  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setLoading(true); setLoadError(false); setStatus(null);
    try {
      const response = await fetch(`${getApiBase()}/api/collaboration/setup`, { signal: nextController.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Setup status unavailable");
      const next = readSetupStatus(await response.json());
      if (sequence === request.current && !nextController.signal.aborted) setStatus(next);
    } catch {
      if (sequence === request.current && !nextController.signal.aborted) setLoadError(true);
    } finally {
      if (sequence === request.current && !nextController.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => { ++request.current; ++copyOperation.current; controller.current?.abort(); if (timer.current) clearTimeout(timer.current); };
  }, [refresh]);
  useEffect(() => {
    ++copyOperation.current;
    if (timer.current) clearTimeout(timer.current);
    setCopyState("idle");
  }, [prompt]);
  useEffect(() => { if (copyState === "error") { textarea.current?.focus(); textarea.current?.select(); } }, [copyState]);

  const copy = async () => {
    if (!prompt || loading) return;
    const sequence = ++copyOperation.current;
    if (timer.current) clearTimeout(timer.current);
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(prompt);
      if (sequence !== copyOperation.current) return;
      setCopyState("copied");
      timer.current = setTimeout(() => { setCopyState("idle"); }, 3000);
    } catch {
      if (sequence !== copyOperation.current) return;
      setExpanded(true); setCopyState("error");
    }
  };

  // The control stays in place, spinning, while the check it started runs, instead of vanishing until the result.
  const recheck = () => {
    if (loading) return;
    setRechecking(true);
    void refresh().finally(() => { setRechecking(false); });
  };

  const steps = t(`steps.${path}`, { returnObjects: true }) as string[];
  // Checking reads only facts that can change while the guide is open: a failed status read, or a
  // cloudflared install the public paths still wait for. Same-network setup needs neither.
  const canRecheck = loadError || (path !== "lan" && status !== null && !status.cloudflared.installed);
  return <section aria-labelledby={`${id}-title`} className="collaboration-setup-guide min-w-0 text-xs leading-relaxed text-cc-fg">
    <h3 id={`${id}-title`} className="text-sm font-semibold">{t("title")}</h3>
    <p className="mt-1.5 text-cc-muted">{t("intro")}</p>
    <div role="group" aria-label={t("path_label")} className="mt-4 flex flex-wrap gap-1.5">
      {(["lan", "temporary", "named"] as const).map((item) => <button key={item} type="button" aria-pressed={path === item} onClick={() => setPath(item)} className={`rounded-md border px-2.5 py-2 text-xs cursor-pointer ${focus} ${path === item ? "border-cc-primary/60 bg-cc-primary/10 text-cc-fg" : "border-cc-border text-cc-muted hover:text-cc-fg hover:bg-cc-hover"}`}>{t(`paths.${item}`)}</button>)}
    </div>
    <p className="mt-3 text-cc-muted">{t(`descriptions.${path}`)}</p>
    {path === "named" && <div className="mt-3">
      <label htmlFor={`${id}-hostname`} className="block font-medium">{t("hostname_label")}</label>
      <input id={`${id}-hostname`} type="text" autoComplete="off" spellCheck={false} value={hostname} onChange={(event) => setHostname(event.target.value)} aria-invalid={!validHostname} aria-describedby={!validHostname ? `${id}-hostname-error` : undefined} placeholder={t("hostname_placeholder")} className={`mt-1.5 w-full min-w-0 appearance-none rounded-md border border-cc-border bg-cc-input-bg px-3 py-2 text-xs text-cc-fg placeholder:text-cc-muted caret-cc-primary ${focus}`}/>
      {!validHostname && <p id={`${id}-hostname-error`} role="alert" className="mt-1.5 text-cc-error">{t("hostname_error")}</p>}
    </div>}
    <div className="mt-4 flex items-start gap-1.5 text-cc-muted">
      <p role="status" className={loadError ? "text-cc-error" : undefined}>{loading ? t("checking") : loadError ? t("check_error") : status ? t(path === "lan" ? "lan_ready" : status.cloudflared.installed ? "cloudflared_found" : "cloudflared_missing") : ""}</p>
      {(canRecheck || rechecking) && <button type="button" aria-label={t("check_again")} title={t("check_again")} aria-disabled={loading} onClick={recheck} className={`inline-grid size-5 shrink-0 place-items-center rounded hover:text-cc-fg hover:bg-cc-hover cursor-pointer aria-disabled:cursor-default ${focus}`}>
        <span className={loading ? "motion-safe:animate-spin" : undefined}><Icon name="refresh" size={13}/></span>
      </button>}
    </div>
    <button type="button" disabled={!prompt || loading || copyState === "copying"} onClick={() => void copy()} className={`button primary mt-4 w-full rounded-md bg-cc-primary px-3 py-2.5 text-xs font-semibold text-cc-bg [.cc-theme-light_&]:!text-cc-fg hover:brightness-110 disabled:opacity-50 cursor-pointer ${focus}`}>{copyState === "copied" ? t("copied") : copyState === "copying" ? t("copying") : t("copy_request")}</button>
    <p className="mt-1.5 text-cc-muted">{t("paste_hint")}</p>
    {copyState === "error" && <p role="alert" className="mt-2 text-cc-error">{t("copy_error")}</p>}
    <button type="button" aria-expanded={expanded} aria-controls={`${id}-request`} onClick={() => setExpanded(!expanded)} className={`mt-2 rounded text-cc-muted underline underline-offset-4 hover:text-cc-fg cursor-pointer ${focus}`}>{t(expanded ? "hide_request" : "show_request")}</button>
    {expanded && <textarea ref={textarea} id={`${id}-request`} aria-label={t("request_label")} readOnly value={prompt} rows={7} onFocus={(event) => event.currentTarget.select()} className={`mt-2 block w-full min-w-0 resize-y appearance-none rounded-md border border-cc-border bg-cc-input-bg p-2.5 text-xs leading-relaxed text-cc-fg caret-cc-primary ${focus}`}/>}
    <details className="mt-4 border-t border-cc-border pt-3">
      <summary className={`cursor-pointer rounded text-cc-muted hover:text-cc-fg ${focus}`}>{t("steps_title")}</summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 marker:text-cc-muted">{Array.isArray(steps) && steps.map((step, index) => <li key={`${path}-${index}`} className="pl-1">{step}</li>)}</ol>
      {path !== "lan" && status && !status.cloudflared.installed && <p className="mt-3 text-cc-muted">{t("install_hint")}</p>}
      <p className="mt-4 text-cc-muted">{t("keep_online")}</p>
      {path !== "lan" && <><p className="mt-2 text-cc-muted">{t("public_lifecycle")}</p><p className="mt-2 text-cc-muted">{t("public_recovery")}</p></>}
    </details>
    <details className="mt-4 border-t border-cc-border pt-3 text-cc-muted">
      <summary className={`cursor-pointer rounded hover:text-cc-fg ${focus}`}>{t("advanced_title")}</summary>
      <p className="mt-2">{t("advanced_body")}</p>
    </details>
  </section>;
}

export function CollaborationSetupEntry() {
  const { t } = useTranslation("collaboration-setup");
  return <details className="border-b border-cc-border pb-4 mb-4">
    <summary className={`cursor-pointer rounded text-xs text-cc-fg ${focus}`}>{t("entry")}</summary>
    <div className="mt-4"><CollaborationSetupGuide/></div>
  </details>;
}
