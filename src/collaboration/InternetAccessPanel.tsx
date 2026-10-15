import { useEffect, useState } from "react";
import type { SessionCollaborationStatus } from "../../core/types/collaboration-session.js";

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
  const [now, setNow] = useState(Date.now());
  const [copiedProjectUrl, setCopiedProjectUrl] = useState(false);
  const [copyError, setCopyError] = useState("");
  const publicProjectUrl = access?.status === "active" && access.publicOrigin && status.connection
    ? new URL(`/projects/${encodeURIComponent(status.connection.projectId)}`, access.publicOrigin).toString() : "";
  useEffect(() => { setCopiedProjectUrl(false); setCopyError(""); }, [publicProjectUrl]);
  const providerKey = JSON.stringify(access?.provider ?? null);
  useEffect(() => {
    const provider = access?.provider;
    if (!provider) return;
    setNamed(provider.kind === "named");
    if (provider.kind === "named") { setTunnelId(provider.tunnelId); setCredentialsFile(provider.credentialsFile); setPublicOrigin(provider.publicOrigin); }
  }, [providerKey]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (status.connection?.authorityKind === "cloud") return <div className="internet-access"><h3>Public access</h3><p className="muted">This Project uses a cloud authority. Local tunnel controls are available for Projects hosted on your local network.</p></div>;
  if (!status.canManageInternetAccess || !access) return <div className="internet-access"><h3>Public access</h3><p className="muted">The administrator on the host machine controls public access. Use the current Project URL or a member link to reconnect if its temporary address changes.</p></div>;
  const busy = access.status === "starting" || access.status === "stopping";
  const active = access.status === "active";
  const remaining = access.idleDeadline === null ? null : Math.max(0, Math.ceil((access.idleDeadline - now) / 1000));
  const clock = remaining === null ? "" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const labels = { off: "Off", starting: "Starting…", active: "Active", stopping: "Stopping…", idleexpired: "Stopped after inactivity", failed: "Failed" };
  const change = (enabled: boolean) => { void command("internet-access", { enabled, ...(enabled ? { provider: named ? { kind: "named", tunnelId: tunnelId.trim(), credentialsFile: credentialsFile.trim(), publicOrigin: publicOrigin.trim() } : { kind: "quick" } } : {}) }).catch(() => {}); };
  return <section className="internet-access" aria-label="Public access">
    <div className="internet-access-heading"><h3>Public access</h3><span className={`internet-access-status state-${access.status}`} role="status">{labels[access.status]}</span></div>
    <p>Let people join this local Project from the internet. Your computer hosts the shared workspaces.</p>
    <p className="muted">{access.publicClients} public {access.publicClients === 1 ? "participant" : "participants"}{active && remaining !== null ? ` · Stops in ${clock} without a public participant` : ""}</p>
    {publicProjectUrl && <div className="copy-link"><label className="field-label">Public Project URL<input aria-label="Public Project URL" readOnly value={publicProjectUrl} onFocus={(event) => event.currentTarget.select()}/></label><button className="button" type="button" onClick={() => { void (async () => {
      try { if (!navigator.clipboard) throw new Error("Clipboard unavailable"); await navigator.clipboard.writeText(publicProjectUrl); setCopiedProjectUrl(true); setCopyError(""); }
      catch { setCopiedProjectUrl(false); setCopyError("Copy failed. Select the Project URL and copy it manually."); }
    })(); }}>{copiedProjectUrl ? "Copied Project URL" : "Copy Project URL"}</button><p className="muted">Send this address to existing members so they can reconnect. New members need a member invitation link.</p>{copyError && <p className="inline-error" role="alert">{copyError}</p>}</div>}
    {access.error && <p className="inline-error" role="alert">{access.error}</p>}
    {access.status === "failed" && <button className="button" type="button" disabled={pending} onClick={() => change(false)}>Retry stopping public access</button>}
    {active || busy ? <button className="button" type="button" disabled={pending || busy} onClick={() => change(false)}>{access.status === "starting" ? "Starting public access…" : access.status === "stopping" ? "Stopping public access…" : "Stop public access"}</button> : <>
      <div className="duration-picker" role="group" aria-label="Public address"><button type="button" aria-pressed={!named} className={!named ? "selected" : ""} onClick={() => setNamed(false)}>Free temporary address</button><button type="button" aria-pressed={named} className={named ? "selected" : ""} onClick={() => setNamed(true)}>Your own Tunnel</button></div>
      {!named && <p className="muted">Free temporary addresses are for short sessions and have no uptime guarantee.</p>}
      {named && <div className="named-tunnel-settings"><label className="field-label">Public URL<input type="url" value={publicOrigin} placeholder="https://collaboration.example.com" onChange={(event) => setPublicOrigin(event.target.value)}/></label><label className="field-label">Tunnel ID<input value={tunnelId} autoComplete="off" onChange={(event) => setTunnelId(event.target.value)}/></label><label className="field-label">Credentials file on this computer<input value={credentialsFile} placeholder="/path/to/tunnel-credentials.json" autoComplete="off" onChange={(event) => setCredentialsFile(event.target.value)}/></label><p className="muted">Use an existing locally managed Cloudflare Tunnel, its UUID and JSON credentials file, and a hostname already routed to that Tunnel.</p></div>}
      <button className="button primary" type="button" disabled={pending || access.status === "failed" || named && (!tunnelId.trim() || !credentialsFile.trim() || !publicOrigin.trim())} onClick={() => change(true)}>Enable public access</button>
    </>}
    <p className="muted internet-access-footnote">Automatically stops after 10 minutes with no authenticated public participants, even when this tab is closed. Local network access stays available. Temporary addresses change each time you reopen public access.</p>
  </section>;
}
