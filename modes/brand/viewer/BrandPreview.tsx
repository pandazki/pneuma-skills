import { useEffect, useRef, useState } from "react";
import type { Source } from "../../../core/types/source.js";
import type { ViewerAddress, ViewerActionResult, ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import { contentUrl, resolveAddress, stages, type BrandItem, type BrandStudio, type ProjectState } from "../domain.js";
import "./brand.css";

const labels = { references: "References", identity: "Identity system", assets: "Core assets", applications: "Application examples" };
const EMPTY: BrandStudio = { byContentSet: {} };

function Media({ item, state, contentSet, revision, onReady, region, onRegion }: {
  item: BrandItem; state: ProjectState; contentSet: string; revision: number;
  onReady?: (ok: boolean) => void; region?: string; onRegion?: (id: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (item.status !== "ready" || !item.file) return <div className="brand-placeholder"><strong>{item.status === "failed" ? "Generation failed" : item.status === "generating" ? "Generating artwork" : "Work planned"}</strong><p>{item.error ?? item.description}</p></div>;
  if (failed || (item.kind === "html" && state.html[item.file] === undefined)) return <div className="brand-placeholder" role="alert"><strong>Preview unavailable</strong><p>Check that {item.file} exists, then update the work.</p></div>;
  const url = contentUrl(contentSet, item.file, revision);
  return <div className={`brand-media brand-media-${item.kind}`} aria-busy={!loaded}>
    {item.kind === "html" ? <iframe title={item.title} src={url} sandbox="allow-scripts allow-same-origin" style={{ width: item.width, height: item.height }} aria-busy={!loaded}
      onLoad={() => { setLoaded(true); onReady?.(true); }} onError={() => { setFailed(true); onReady?.(false); }} />
      : <div className="brand-image-wrap"><img src={url} alt={item.title} onLoad={() => { setLoaded(true); onReady?.(true); }} onError={() => { setFailed(true); onReady?.(false); }} />
        {item.regions.filter((r) => r.id === region).map((r) => <div key={r.id} className="brand-region" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }}><span>{r.label}</span></div>)}
      </div>}
    {onRegion && item.regions.length > 0 && <div className="brand-regions">{item.regions.map((r) => <button key={r.id} aria-pressed={region === r.id} onClick={() => onRegion(r.id)}>{r.label}</button>)}</div>}
  </div>;
}

export default function BrandPreview(props: ViewerPreviewProps) {
  const { value } = useSource(props.sources.studio as Source<BrandStudio> | undefined);
  const studio = value ?? EMPTY;
  const activeSet = useStore((s) => s.activeContentSet) ?? "";
  const staticPlayer = useStore((s) => s.staticPlayer);
  const state = studio.byContentSet[activeSet];
  const project = state?.project;
  const canGuide = props.editing !== false && !props.readonly;
  const [stage, setStage] = useState("all");
  const [context, setContext] = useState("all");
  const [selected, setSelected] = useState<ViewerAddress | null>(null);
  const [compare, setCompare] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [pending, setPending] = useState<{ key: string; done: (result: ViewerActionResult) => void } | null>(null);
  const handled = useRef<object | null>(null);
  const handledAction = useRef("");
  const revision = (props.contentVersion ?? 0) + props.imageVersion;
  const detail = selected?.contentSet === activeSet ? project?.items.find((i) => i.id === selected.item) : undefined;
  const reference = detail?.referenceIds[0] ? project?.items.find((i) => i.id === detail.referenceIds[0]) : undefined;
  const mediaKey = detail ? `${activeSet}/${detail.id}/${detail.file}/${revision}` : "";

  function select(item: BrandItem, region?: string, contentSet = activeSet) {
    const address = { contentSet, item: item.id, ...(region ? { region } : {}) };
    setSelected(address);
    setNotice("");
    props.onActiveFileChange?.(item.file ?? null);
    if (canGuide) props.onSelect({ type: "brand-work", address, file: item.file ? [contentSet, item.file].filter(Boolean).join("/") : undefined,
      label: item.title, content: `${item.description}\nStage: ${item.stage}\nReferences: ${item.referenceIds.join(", ")}${region ? `\nRegion: ${region}` : ""}` });
  }

  function navigate(address: ViewerAddress, comparing: boolean, done: (r: ViewerActionResult) => void) {
    const found = resolveAddress(studio, activeSet, address);
    if ("error" in found) { done({ success: false, message: found.error }); return; }
    if (comparing && !found.item.referenceIds.length) { done({ success: false, message: "This work has no reference to compare." }); return; }
    if (found.contentSet !== activeSet) useStore.getState().setActiveContentSet(found.contentSet);
    select(found.item, found.region?.id, found.contentSet);
    setStage("all"); setCompare(comparing);
    if (found.item.status !== "ready" || !found.item.file || (found.item.kind === "html" && found.state.html[found.item.file] === undefined)) {
      done({ success: false, message: found.item.error ?? "Work is not ready for preview." }); return;
    }
    const key = `${found.contentSet}/${found.item.id}/${found.item.file}/${revision}`;
    setPending({ key, done });
  }

  useEffect(() => {
    const request = props.navigateRequest;
    if (!request || handled.current === request || !value) return;
    handled.current = request;
    navigate(request.address, false, (r) => props.onNavigateComplete?.(r));
  }, [props.navigateRequest, value]);

  useEffect(() => {
    const request = props.actionRequest;
    if (!request || handledAction.current === request.requestId || !value) return;
    handledAction.current = request.requestId;
    const done = (r: ViewerActionResult) => props.onActionResult?.(request.requestId, r);
    const address = request.params?.address;
    if ((request.actionId !== "navigate-to" && request.actionId !== "compare") || !address || typeof address !== "object" || Array.isArray(address)) {
      done({ success: false, message: "Expected navigate-to or compare with a ViewerAddress." }); return;
    }
    navigate(address as ViewerAddress, request.actionId === "compare", done);
  }, [props.actionRequest, value]);

  useEffect(() => {
    if (!pending) return;
    if (loadedKey === pending.key && mediaKey === pending.key) {
      pending.done({ success: true }); setPending(null); return;
    }
    const timeout = setTimeout(() => { pending.done({ success: false, message: "Preview did not finish loading. Check the work file and its assets." }); setPending(null); }, 12000);
    return () => clearTimeout(timeout);
  }, [pending, loadedKey, mediaKey]);

  useEffect(() => {
    setStage("all"); setContext("all"); setNotice("");
    if (selected?.contentSet !== activeSet) {
      setSelected(null); setCompare(false); props.onSelect(null);
    }
  }, [activeSet]);

  function guide(command: NonNullable<ViewerPreviewProps["commands"]>[number]) {
    if (!canGuide) return;
    props.onNotifyAgent?.({ type: "brand-command", severity: "info", summary: command.label,
      message: `Brand command: ${command.id}\n${command.description ?? ""}\nAddress: ${JSON.stringify(detail ? selected : { contentSet: activeSet })}` });
    setNotice(`${command.label} added to your next message.`);
  }

  const projectsNav = staticPlayer && Object.keys(studio.byContentSet).length > 1
    ? <nav className="brand-projects" aria-label="Brand projects">{Object.entries(studio.byContentSet).map(([prefix, state]) => <button key={prefix} aria-pressed={prefix === activeSet} onClick={() => useStore.getState().setActiveContentSet(prefix)}>{state.project?.title ?? prefix}</button>)}</nav>
    : null;
  if (!value) return <div className="brand-empty">Loading brand workspace…</div>;
  if (state?.error) return <div className="brand-studio">{projectsNav}<div className="brand-empty" role="alert"><h2>Brand project needs attention</h2><p>Fix the project file to continue. Other projects remain available.</p><pre>{state.error}</pre></div></div>;
  if (!project || !state) return <div className="brand-studio">{projectsNav}<div className="brand-empty"><h2>Start with a brand</h2><p>Create a project from the toolbar, or ask the agent to define your brand.</p></div></div>;

  return <div className="brand-studio">
    {projectsNav}
    <header className="brand-header"><div><h1>{project.title}</h1><p>{project.description}</p></div><button onClick={() => setRulesOpen(!rulesOpen)} aria-expanded={rulesOpen}>Brand brief</button>{!staticPlayer && <a className="brand-export" href={`/export/brand?contentSet=${encodeURIComponent(activeSet)}`} target="_blank" rel="noreferrer">Export book</a>}</header>
    {rulesOpen && <section className="brand-brief" aria-label="Brand brief"><div><h2>{project.brief.promise || "Define your promise"}</h2><p>{project.brief.audience}</p><p>{project.brief.personality.join(" · ")}</p></div><ul>{project.brief.rules.map((rule, i) => <li key={i}>{rule}</li>)}</ul></section>}
    <div className="brand-palette">{project.palette.map((color) => <span key={color.name}><i style={{ background: color.value }} />{color.name}<code>{color.value}</code></span>)}</div>
    {project.contexts.length > 0 && <section className="brand-contexts" aria-label="Application contexts"><span>Designed for</span><button aria-pressed={context === "all"} onClick={() => { setContext("all"); setSelected(null); props.onSelect(null); }}>Every context</button>{project.contexts.map((c) => <button key={c.id} aria-pressed={context === c.id} onClick={() => { setContext(c.id); setSelected(null); setStage("all"); props.onSelect(null); }}>{c.title}</button>)}{context !== "all" && <p>{project.contexts.find((c) => c.id === context)?.purpose}<br />{project.contexts.find((c) => c.id === context)?.guidance}</p>}</section>}
    <nav className="brand-toolbar" aria-label="Work stages"><div className="brand-tabs">{["all", ...stages].map((s) => <button key={s} aria-pressed={stage === s && !detail} onClick={() => { setStage(s); setSelected(null); props.onSelect(null); }}>{s === "all" ? "All work" : labels[s as keyof typeof labels]}<span>{s === "all" ? project.items.length : project.items.filter((i) => i.stage === s).length}</span></button>)}</div></nav>
    <main className="brand-workspace">
      {detail ? <section className="brand-detail" aria-label="Work details"><div className="brand-detail-bar"><button onClick={() => { setSelected(null); setCompare(false); props.onSelect(null); }}>← All work</button><h2>{detail.title}</h2>{reference && <button aria-pressed={compare} onClick={() => setCompare(!compare)}>{compare ? "Single view" : "Compare reference"}</button>}</div>
        <div className={`brand-preview-grid${compare && reference ? " is-comparing" : ""}`}>
          {compare && reference && <section><h3>Reference · {reference.title}</h3><Media key={`${activeSet}/${reference.id}/${revision}`} item={reference} state={state} contentSet={activeSet} revision={revision} /></section>}
          <section><h3>{detail.kind === "html" ? "Brand specimen" : "Artwork"} · {detail.status}</h3><Media key={mediaKey} item={detail} state={state} contentSet={activeSet} revision={revision} region={selected?.region as string | undefined} onRegion={canGuide ? (region) => select(detail, region) : undefined}
            onReady={(ok) => { if (ok) setLoadedKey(mediaKey); else if (pending?.key === mediaKey) { pending.done({ success: false, message: `Could not load ${detail.file}` }); setPending(null); } }} /></section>
        </div>
        <div className="brand-detail-notes"><p>{detail.description}</p>{detail.referenceIds.length > 0 && <div className="brand-lineage"><span>Built from</span>{detail.referenceIds.map((id) => { const ref = project.items.find((i) => i.id === id)!; return <button key={id} onClick={() => { select(ref); setCompare(false); }}>{ref.title}</button>; })}</div>}{detail.prompt && <details><summary>Generation brief</summary><p>{detail.prompt}</p></details>}</div>
      </section> : <div className="brand-board">
        {project.items.length === 0 ? <div className="brand-empty"><h2>Your brand starts here</h2><p>Describe the audience, promise and materials you already have. The agent will assemble your first direction.</p></div> : stages.filter((s) => stage === "all" || s === stage).map((s) => {
          const items = project.items.filter((i) => i.stage === s && (context === "all" || i.contexts.includes(context)));
          if (!items.length) return null;
          return <section className="brand-stage" key={s}><h2>{labels[s]}<span>{items.length} {items.length === 1 ? "work" : "works"}</span></h2><div className="brand-cards">{items.map((item) => {
            const thumb = item.kind === "image" ? item : project.items.find((i) => item.referenceIds.includes(i.id) && i.kind === "image");
            return <button className="brand-work" key={item.id} onClick={() => { select(item); setCompare(false); }} aria-label={`Inspect ${item.title}`}>
              <div className="brand-thumb">{thumb?.file && thumb.status === "ready" ? <img key={`${thumb.file}/${revision}`} src={contentUrl(activeSet, thumb.file, revision)} alt="" loading="lazy" onLoad={(event) => { event.currentTarget.style.visibility = ""; event.currentTarget.parentElement?.removeAttribute("data-missing"); }} onError={(event) => { event.currentTarget.style.visibility = "hidden"; event.currentTarget.parentElement?.setAttribute("data-missing", "Preview unavailable"); }} /> : <span>{item.status === "failed" ? "Generation failed" : item.status === "generating" ? "Generating…" : item.status === "ready" ? "Brand specimen" : "Work planned"}</span>}{item.kind === "html" && <span className="brand-live">Brand specimen</span>}</div>
              <div className="brand-work-title"><strong>{item.title}</strong><span>{item.status}</span></div><p>{item.description}</p>
            </button>;
          })}</div></section>;
        })}
        {project.items.length > 0 && !project.items.some((i) => (stage === "all" || i.stage === stage) && (context === "all" || i.contexts.includes(context))) && <div className="brand-empty"><h2>No work in this view yet</h2><p>Choose another context or ask the agent to explore this application.</p></div>}
      </div>}
    </main>
    {canGuide && <footer className="brand-command-bar"><div>{props.commands?.map((command) => <button key={command.id} onClick={() => guide(command)}>{command.label}</button>)}</div><span role="status">{notice || "Select a work to give the agent precise feedback."}</span></footer>}
  </div>;
}
