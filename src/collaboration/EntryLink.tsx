import { useEffect, useRef, useState } from "react";
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
  const copyVersion = useRef(0);
  const current = entries?.find((entry) => entry.kind === selected) ?? entries?.find((entry) => entry.kind === "public") ?? entries?.[0];
  const url = shareUrl(token, roomId, { publicOrigin: current?.baseUrl || fallback, invitation });
  useEffect(() => { copyVersion.current += 1; setCopied(false); setError(""); }, [url]);
  const copy = async () => {
    const version = ++copyVersion.current;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      if (version === copyVersion.current) { setCopied(true); setError(""); }
    } catch { if (version === copyVersion.current) { setCopied(false); setError("Copy failed. Select the link and copy it manually."); } }
  };
  return <div className="entry-link copy-link">
    {!!entries && entries.length > 1 && <div className="entry-link-choices" role="group" aria-label="Link access">{entries.map((entry) => <button key={entry.kind} type="button" aria-pressed={current?.kind === entry.kind} onClick={() => setSelected(entry.kind)}>{entry.kind === "lan" ? "Local network" : entry.kind === "public" ? "Internet" : "Cloud"}</button>)}</div>}
    <div className="entry-link-row"><label>Share link<input aria-label="Share link" readOnly value={url} onFocus={(event) => event.currentTarget.select()}/></label>
    <button className="button primary" type="button" onClick={() => { void copy(); }}>{copied ? "Copied" : "Copy link"}</button></div>
    {current?.kind === "lan" && <p className="muted">Available to people on the host's local network.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
