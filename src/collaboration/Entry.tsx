import { useState, type FormEvent } from "react";
import { CollaborationApp } from "./App.js";
import { HOST_OFFLINE_MESSAGE, credentialKey, type readCredentials } from "./client-state.js";

type Credentials = ReturnType<typeof readCredentials>;

export function CollaborationEntry({ initial }: { initial: Credentials }) {
  const [credentials, setCredentials] = useState(initial);
  if (credentials.inviteToken) return <InvitationJoin baseUrl={credentials.baseUrl} inviteToken={credentials.inviteToken} onJoin={(token, roomId) => {
    try {
      sessionStorage.setItem(credentialKey(location.href, "token"), token);
      sessionStorage.setItem(credentialKey(location.href, "invitation"), "");
    } catch { /* The current tab can still join without persistence. */ }
    const url = new URL(location.href);
    url.hash = new URLSearchParams({ room: roomId }).toString();
    history.replaceState(null, "", url);
    setCredentials({ token, roomId, inviteToken: "", cleanUrl: url.toString(), baseUrl: credentials.baseUrl });
  }}/>;
  return <CollaborationApp key={credentials.token} token={credentials.token} initialRoom={credentials.roomId} baseUrl={credentials.baseUrl}/>;
}

export function InvitationJoin({ inviteToken, onJoin, baseUrl = "" }: { inviteToken: string; baseUrl?: string; onJoin: (token: string, roomId: string) => void }) {
  const [name, setName] = useState(() => {
    try { return sessionStorage.getItem(credentialKey(location.href, "visitor-name")) || ""; }
    catch { return ""; }
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [hostOffline, setHostOffline] = useState(false);
  const join = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true); setError(""); setHostOffline(false);
    try { sessionStorage.setItem(credentialKey(location.href, "visitor-name"), name.trim()); } catch { /* Keep the entered name in memory. */ }
    try {
      const response = await fetch(`${baseUrl}/api/invitations/redeem`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: inviteToken, name: name.trim() }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 423) {
        setHostOffline(true);
        throw new Error(HOST_OFFLINE_MESSAGE);
      }
      if (!response.ok) throw new Error(data.error || data.message || "This invitation has expired or been revoked. Ask the host for a new link.");
      if (typeof data.token !== "string" || !data.token || typeof data.roomId !== "string" || !data.roomId) throw new Error("The host returned an incomplete invitation. Please try again.");
      onJoin(data.token, data.roomId);
    } catch (failure) {
      setError(failure instanceof Error && failure.name === "TimeoutError" ? "The host did not respond. Please try again." : failure instanceof Error ? failure.message : "Unable to join. Please try again.");
    } finally { setPending(false); }
  };
  return <div className="welcome invitation-welcome"><span className="brand-mark" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span><h1>{hostOffline ? "The host is offline" : "Step into the workspace"}</h1><p>{hostOffline ? "This workspace is available while the host is online. Your name and invitation are saved for when they return." : "See the work as it happens. Add your name so everyone knows who’s here."}</p><form className="invitation-form" onSubmit={(event) => void join(event)}><label className="field-label">Your name<input autoComplete="name" placeholder="e.g. Alex Chen" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} disabled={pending} required/></label>{error && <p className="inline-error" role="alert">{error}</p>}<button className="button primary wide" type="submit" disabled={pending || !name.trim()}>{pending ? "Joining workspace…" : hostOffline ? "Try again" : "Join workspace"}</button></form><p className="invitation-footnote">Your invitation opens one workspace. Agent conversations stay private.</p></div>;
}
