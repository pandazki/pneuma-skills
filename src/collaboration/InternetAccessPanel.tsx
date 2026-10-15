import { useEffect, useRef, useState } from "react";
import type { SessionCollaborationStatus } from "../../core/types/collaboration-session.js";

const disclosure = "mt-4 border-t border-cc-border pt-3";
const summary = "cursor-pointer rounded text-cc-muted hover:text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary focus-visible:ring-offset-2 focus-visible:ring-offset-cc-bg";
const labels = { off: "Off", starting: "Starting…", active: "Active", stopping: "Stopping…", idleexpired: "Stopped after inactivity", failed: "Failed" };

/** The private shell requests runtime changes; the detached authority owns cleanup. */
export function InternetAccessPanel({ status, pending, command }: {
  status: SessionCollaborationStatus;
  pending: boolean;
  command: (path: string, body?: unknown) => Promise<void>;
}) {
  const access = status.internetAccess;
  const [named, setNamed] = useState(access?.provider.kind === "named");
  const [tunnelId, setTunnelId] = useState(access?.provider.kind === "named" ? access.provider.tunnelId : "");
  const [credentialsFile, setCredentialsFile] = useState(access?.provider.kind === "named" ? access.provider.credentialsFile : "");
  const [publicOrigin, setPublicOrigin] = useState(access?.provider.kind === "named" ? access.provider.publicOrigin : "");
  const [optionsOpen, setOptionsOpen] = useState(access?.provider.kind === "named" && (!access.provider.tunnelId.trim() || !access.provider.credentialsFile.trim() || !access.provider.publicOrigin.trim()));
  const [now, setNow] = useState(Date.now());
  const [copiedProjectUrl, setCopiedProjectUrl] = useState(false);
  const copyOperation = useRef(0);
  const [copyError, setCopyError] = useState("");
  const publicProjectUrl = access?.status === "active" && access.publicOrigin && status.connection
    ? new URL(`/projects/${encodeURIComponent(status.connection.projectId)}`, access.publicOrigin).toString() : "";
  useEffect(() => {
    ++copyOperation.current; setCopiedProjectUrl(false); setCopyError("");
    return () => { ++copyOperation.current; };
  }, [publicProjectUrl]);
  const providerKey = JSON.stringify(access?.provider ?? null);
  useEffect(() => {
    const provider = access?.provider;
    if (!provider) return;
    setNamed(provider.kind === "named");
    if (provider.kind === "named") {
      setTunnelId(provider.tunnelId); setCredentialsFile(provider.credentialsFile); setPublicOrigin(provider.publicOrigin);
      if (!provider.tunnelId.trim() || !provider.credentialsFile.trim() || !provider.publicOrigin.trim()) setOptionsOpen(true);
    }
  }, [providerKey]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (status.connection?.authorityKind === "cloud") return <section className="internet-access" aria-label="Public access"><h3>Public access</h3><p className="muted">This Project uses a cloud authority.</p></section>;
  if (!status.canManageInternetAccess || !access) return <section className="internet-access" aria-label="Public access"><div className="internet-access-heading"><h3>Public access</h3>{access && <span className={`internet-access-status state-${access.status}`} role="status">{labels[access.status]}</span>}</div><p className="muted">The administrator on the host machine controls public access.</p></section>;
  const busy = access.status === "starting" || access.status === "stopping";
  const active = access.status === "active";
  const missingNamedFields = named && (!tunnelId.trim() || !credentialsFile.trim() || !publicOrigin.trim());
  const provider = (active || busy ? access.provider.kind === "named" : named) ? "Your own Tunnel" : "Free temporary address";
  const remaining = access.idleDeadline === null ? null : Math.max(0, Math.ceil((access.idleDeadline - now) / 1000));
  const clock = remaining === null ? "" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const change = (enabled: boolean) => { void command("internet-access", { enabled, ...(enabled ? { provider: named ? { kind: "named", tunnelId: tunnelId.trim(), credentialsFile: credentialsFile.trim(), publicOrigin: publicOrigin.trim() } : { kind: "quick" } } : {}) }).catch(() => {}); };
  return <section className="internet-access" aria-label="Public access">
    <div className="internet-access-heading"><h3>Public access</h3><span className={`internet-access-status state-${access.status}`} role="status">{labels[access.status]}</span></div>
    <p className="muted">{provider}{active ? ` · ${access.publicClients} public ${access.publicClients === 1 ? "participant" : "participants"}` : " · Let people join from other networks."}</p>
    {active && remaining !== null && <p className="muted">Stops in {clock} without a public participant.</p>}
    {active && access.provider.kind === "quick" && <p className="muted">Temporary addresses change each time public access restarts.</p>}
    {access.error && <p className="inline-error" role="alert">{access.error}</p>}
    {access.status === "failed" ? <button className="button" type="button" disabled={pending} onClick={() => change(false)}>Retry stopping public access</button> : active || busy ? <button className="button" type="button" disabled={pending || busy} onClick={() => change(false)}>{access.status === "starting" ? "Starting public access…" : access.status === "stopping" ? "Stopping public access…" : "Stop public access"}</button> : <button className="button primary" type="button" disabled={pending || missingNamedFields} onClick={() => change(true)}>Enable public access</button>}
    {!active && !busy && <details className={disclosure} open={optionsOpen} onToggle={(event) => setOptionsOpen(event.currentTarget.open)}>
      <summary className={summary}>Connection options</summary>
      <div className="duration-picker" role="group" aria-label="Public address"><button type="button" aria-pressed={!named} className={!named ? "selected" : ""} onClick={() => setNamed(false)}>Free temporary address</button><button type="button" aria-pressed={named} className={named ? "selected" : ""} onClick={() => { setNamed(true); setOptionsOpen(true); }}>Your own Tunnel</button></div>
      {!named && <p className="muted">Free temporary addresses need no domain or Cloudflare account and have no uptime guarantee.</p>}
      {named && <div className="named-tunnel-settings"><label className="field-label">Public URL<input type="url" value={publicOrigin} placeholder="https://collaboration.example.com" onChange={(event) => setPublicOrigin(event.target.value)}/></label><label className="field-label">Tunnel ID<input value={tunnelId} autoComplete="off" onChange={(event) => setTunnelId(event.target.value)}/></label><label className="field-label">Credentials file on this computer<input value={credentialsFile} placeholder="/path/to/tunnel-credentials.json" autoComplete="off" onChange={(event) => setCredentialsFile(event.target.value)}/></label><p className="muted">Use an existing locally managed Cloudflare Tunnel, its UUID and JSON credentials file, and a hostname already routed to that Tunnel.</p></div>}
    </details>}
    <details className={disclosure}>
      <summary className={summary}>Connection details</summary>
      {publicProjectUrl && <div className="copy-link"><label className="field-label">Public Project URL<input aria-label="Public Project URL" readOnly value={publicProjectUrl} onFocus={(event) => event.currentTarget.select()}/></label><button className="button" type="button" onClick={() => {
        const sequence = ++copyOperation.current; setCopiedProjectUrl(false); setCopyError("");
        void (async () => {
          try {
            if (!navigator.clipboard) throw new Error("Clipboard unavailable");
            await navigator.clipboard.writeText(publicProjectUrl);
            if (sequence !== copyOperation.current) return;
            setCopiedProjectUrl(true);
          } catch {
            if (sequence !== copyOperation.current) return;
            setCopyError("Copy failed. Select the Project URL and copy it manually.");
          }
        })(); }}>{copiedProjectUrl ? "Copied Project URL" : "Copy Project URL"}</button><p className="muted">Existing members can reconnect at this address. Invite guests from Share; add Project members in Collaboration settings → Members & permissions.</p>{copyError && <p className="inline-error" role="alert">{copyError}</p>}</div>}
      <p className="muted internet-access-footnote">Keep this computer, Pneuma, and the sharing Session tab online. Public access stops after 10 minutes with no authenticated public participants, even when this tab is closed, and starts off after a restart. Local network access stays available.</p>
      {!active && <p className="muted">Temporary addresses change each time public access restarts.</p>}
      <p className="muted">If startup fails, fix the reported cause, retry stopping public access, then enable it again.</p>
    </details>
  </section>;
}
