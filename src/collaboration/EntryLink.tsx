import { useState } from "react";
import type { SessionCollaborationStatus } from "../../core/types/collaboration-session.js";
import { shareUrl } from "./client-state.js";

export function EntryLink({ token, roomId, invitation, entries, fallback }: {
  token: string;
  roomId?: string;
  invitation?: boolean;
  entries?: SessionCollaborationStatus["entries"];
  fallback?: string;
}) {
  const [selected, setSelected] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const current = entries?.find((entry) => entry.kind === selected) ?? entries?.find((entry) => entry.kind === "public") ?? entries?.[0];
  const url = shareUrl(token, roomId, { publicOrigin: current?.baseUrl || fallback, invitation });
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setCopied(true); setError("");
    } catch { setCopied(false); setError("Copy failed. Select the link and copy it manually."); }
  };
  return <div className="copy-link">
    {!!entries && entries.length > 1 && <div className="duration-picker entry-picker" role="group" aria-label="Link access"><span className="sr-only">Choose link access</span>{entries.map((entry) => <button key={entry.kind} type="button" className={current?.kind === entry.kind ? "selected" : ""} aria-pressed={current?.kind === entry.kind} onClick={() => { setSelected(entry.kind); setCopied(false); }}>{entry.kind === "lan" ? "Local network" : entry.kind === "public" ? "Internet" : "Cloud"}</button>)}</div>}
    <label>Share link<input aria-label="Share link" readOnly value={url} onFocus={(event) => event.currentTarget.select()}/></label>
    <button className="button" type="button" onClick={() => { void copy(); }}>{copied ? "Copied" : "Copy link"}</button>
    {current?.kind === "lan" && <p className="muted">Available to people on the host's local network.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
