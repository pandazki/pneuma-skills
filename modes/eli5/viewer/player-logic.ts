/**
 * The audience-ladder player's decisions, kept out of React.
 *
 * The viewer is a player: the agent writes every file, and this module
 * answers the four questions the component asks each render — which ladder
 * is on screen, where its pages live, what document the iframe should hold,
 * and what a `navigate-to` address means. All pure, all tested in
 * `__tests__/player.test.ts`.
 *
 * The one thing to keep straight while reading this file is that page paths
 * live in TWO spaces:
 *
 *  - the RAW source space (`sources.files`) — always full, always prefixed
 *    with the content-set directory: `how-llms-work/pages/pm.html`;
 *  - the FRAMEWORK space (`activeFile`, `selection.file`, `resolveItems`) —
 *    stripped of that prefix whenever a content set is active, because the
 *    store hands the viewer's resolvers a filtered, re-mapped file list and
 *    `src/ws.ts` re-prefixes the attribute on its way to the agent.
 *
 * `pagePath` speaks the first; `frameworkPath` speaks the second. Handing
 * one to the other's consumer fails silently in both directions.
 */

import type {
  ViewerActionResult,
  ViewerAddress,
  ViewerFileContent,
} from "../../../core/types/viewer-contract.js";
import type { AudienceEntry, Explainer, ExplainerManifest } from "../domain.js";

// ── The ladder in view ──────────────────────────────────────────────────────

/** One topic's manifest plus the directory prefix it was parsed from. */
export interface Ladder {
  /** Content-set directory key — `""` for a root-level manifest. */
  prefix: string;
  manifest: ExplainerManifest;
}

/**
 * Pick the ladder to render.
 *
 * The fallback is not defensive padding — it is the common case. A
 * workspace holding a single topic directory surfaces NO content set (the
 * directory resolver needs two to call either one a set), so
 * `activeContentSet` is null while `byContentSet` is keyed by that topic's
 * directory name. Falling back to the first parsed manifest is what makes
 * a lone explainer visible; returning its own prefix is what keeps every
 * page path below pointing at a real file. Same fallback covers the frame
 * mid-switch, where the store's active set has moved but the aggregate
 * source has not re-emitted yet.
 */
export function selectLadder(
  explainer: Explainer | null,
  activeContentSet: string | null,
): Ladder | null {
  if (!explainer) return null;
  const { byContentSet } = explainer;

  const key = activeContentSet ?? "";
  const direct = byContentSet[key];
  if (direct) return { prefix: key, manifest: direct };

  const firstKey = Object.keys(byContentSet)[0];
  if (firstKey === undefined) return null;
  return { prefix: firstKey, manifest: byContentSet[firstKey] };
}

// ── Paths ───────────────────────────────────────────────────────────────────

/** Join a page onto its content-set prefix — the raw `sources.files` space. */
export function pagePath(prefix: string, file: string): string {
  if (!file) return "";
  return prefix === "" ? file : `${prefix}/${file}`;
}

/**
 * The same page as the framework names it: bare while a content set is
 * active (the store strips the prefix before `resolveItems` and re-adds it
 * on the way out), prefixed when there is no active set.
 */
export function frameworkPath(
  prefix: string,
  file: string,
  activeContentSet: string | null,
): string {
  if (!file) return "";
  return activeContentSet ? file : pagePath(prefix, file);
}

/**
 * Which rung is on screen, in priority order:
 *
 *  1. the reader's own wish for THIS ladder — a rung they climbed to, or
 *     one a `navigate-to` put them on;
 *  2. the framework's `activeFile` — the persisted position, restored by
 *     `src/App.tsx` from `/api/viewer-state` on every session resume and
 *     replay. Without this step a resumed session always reopens on rung
 *     0 while the store still names another page, so the visible page and
 *     the next `<viewer-context>` describe different rungs;
 *  3. rung 0 — a fresh ladder starts at the bottom.
 *
 * `activeFile` is matched in BOTH path spaces (see the file header). The
 * store hands it over stripped while a content set is active and prefixed
 * while none is, and a viewer that understood only one of the two would
 * restore correctly in single-topic workspaces and silently fail in
 * multi-topic ones, or the reverse.
 *
 * A wish naming a rung this ladder does not have is not honoured — that is
 * what happens right after a content-set switch, and falling through to
 * the file (then to rung 0) is what keeps the ladder pointing at a real
 * page instead of an empty one.
 */
export function activeRungIndex(
  audiences: ReadonlyArray<AudienceEntry>,
  prefix: string,
  wantedId: string | null,
  activeFile: string | null | undefined,
): number {
  const wished = audiences.findIndex((a) => a.id === wantedId);
  if (wished >= 0) return wished;

  const file = (activeFile ?? "").trim();
  if (file) {
    const found = audiences.findIndex(
      (a) => a.file && (a.file === file || pagePath(prefix, a.file) === file),
    );
    if (found >= 0) return found;
  }

  return 0;
}

/**
 * One rung's identity across a whole workspace: the topic it belongs to
 * plus the audience it names.
 *
 * Two consumers must agree on it or they drift apart silently — the React
 * key that decides when a pane REMOUNTS (a new document, a fresh scroll
 * position) and the gate that decides which pane an anchor request belongs
 * to. If the gate ever admitted a request the pane's key had already
 * invalidated, the request would land in whatever document replaced it:
 * an anchor found on a page nobody asked about, reported as a success. So
 * both derive from here.
 *
 * Not the file path: two rungs may name the same file mid-edit, and the
 * pane's remount is keyed on the audience.
 */
export function rungKey(prefix: string, audienceId: string | null | undefined): string {
  return `${prefix}::${audienceId ?? ""}`;
}

/**
 * The page's HTML from the raw file snapshot, or null when the agent has
 * not written it yet.
 *
 * Exact path match only. A suffix match would be shorter and wrong: both
 * seeds ship `pages/engineer.html`, so `endsWith` hands whichever topic
 * happens to sort first to a reader standing on the other one — the right
 * title above the wrong page.
 */
export function findPageHtml(
  files: ReadonlyArray<ViewerFileContent>,
  prefix: string,
  file: string,
): string | null {
  const path = pagePath(prefix, file);
  if (!path) return null;
  const hit = files.find((f) => f.path === path);
  return hit ? hit.content : null;
}

/**
 * Base href for the page's iframe: the page's OWN directory under the
 * content route. With `<base href=".../database-index/pages/">`, a page's
 * `../assets/index.png` resolves to `database-index/assets/index.png` —
 * the layout the skill tells the agent to write.
 */
export function pageBaseHref(apiBase: string, prefix: string, file: string): string {
  const full = pagePath(prefix, file);
  const dir = full.includes("/") ? full.slice(0, full.lastIndexOf("/") + 1) : "";
  return `${apiBase}/content/${dir}`;
}

// ── The iframe document ─────────────────────────────────────────────────────

/** Escape a value for use inside a double-quoted HTML attribute. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Straighten curly quotes that landed INSIDE a tag.
 *
 * Not cosmetic: a page written with `class=“sheet”` parses as an attribute
 * named `“sheet”`, so the styling silently drops off one element. Agents
 * writing prose-heavy pages produce this; the page's visible text is left
 * alone because the replacement only runs within `<...>`. Borrowed from
 * slide's `sanitizeHtmlQuotes`, which paid for the lesson.
 */
function sanitizeTagQuotes(html: string): string {
  return html.replace(/<[^>]*>/g, (tag) =>
    tag.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"),
  );
}

export interface SrcdocOptions {
  /** Absolute (dev) or root-relative (prod) content-route directory. */
  baseHref: string;
  /** The dormant selection script, injected at the end of the body. */
  script: string;
  /** Store image tick — rides in the document so an asset change re-renders. */
  imageVersion: number;
}

/**
 * Build the document for one page's iframe.
 *
 * Explainer pages are complete, self-contained HTML documents, so they are
 * served whole: only a `<base>` (asset resolution), a version marker
 * (asset invalidation) and the selection script are added. Note what is
 * deliberately NOT added — slide's `html,body{height:100%;overflow:hidden}`.
 * A slide IS a viewport; an explainer page is a document that scrolls, and
 * that clamp would cut every page off at the fold with no scrollbar.
 *
 * A fragment (half-written page, or a mode-maker experiment) is wrapped
 * into a minimal document rather than rendered bare.
 */
export function buildPageSrcdoc(html: string, opts: SrcdocOptions): string {
  const page = sanitizeTagQuotes(html);
  const head =
    `<base href="${escapeAttr(opts.baseHref)}">` +
    `<meta name="pneuma-image-version" content="${escapeAttr(String(opts.imageVersion))}">`;

  const isFullDoc = page.includes("<!DOCTYPE") || /<html[\s>]/i.test(page);
  if (!isFullDoc) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body>
${page}
${opts.script}
</body>
</html>`;
  }

  // The base has to precede anything in the head that could resolve
  // against it, so it goes immediately after the opening <head> — not at
  // `</head>`, where a relative stylesheet earlier in the head would
  // already have been resolved against the srcdoc's own (opaque) URL.
  let doc = page;
  const headOpen = doc.match(/<head[^>]*>/i);
  if (headOpen) {
    doc = doc.replace(headOpen[0], `${headOpen[0]}${head}`);
  } else if (/<body[\s>]/i.test(doc)) {
    doc = doc.replace(/<body/i, `<head>${head}</head><body`);
  } else {
    doc = `${head}${doc}`;
  }

  if (doc.includes("</body>")) {
    doc = doc.replace("</body>", `${opts.script}</body>`);
  } else {
    doc += opts.script;
  }
  return doc;
}

// ── Addresses ───────────────────────────────────────────────────────────────

/**
 * The round-trippable handle for one rung: coarse `audience`, plus the
 * framework-reserved `contentSet` only when one is actually active (an
 * address naming a set the workspace does not surface would be refused by
 * `planNavigate` on the way back in), plus an optional fine `anchor`.
 */
export function audienceAddress(
  audience: AudienceEntry,
  activeContentSet: string | null,
  anchor?: string,
): ViewerAddress {
  return {
    ...(activeContentSet ? { contentSet: activeContentSet } : {}),
    audience: audience.id,
    ...(anchor ? { anchor } : {}),
  };
}

/**
 * Read an address off an agent-supplied action param.
 *
 * `navigate-to` declares `address` as an object, but a viewer action's
 * params cross the wire as a JSON body an agent hand-wrote, and complex
 * values routinely arrive as a JSON *string* (slide's `checkContentFit`
 * parses its array param for the same reason). Leniency belongs at this
 * boundary and nowhere deeper: everything past here is a real object or a
 * refusal the agent can read.
 */
export function readAddress(raw: unknown): ViewerAddress | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as ViewerAddress;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as ViewerAddress;
      }
    } catch {
      // Not JSON — fall through to the refusal below rather than guessing
      // what the agent meant.
    }
  }
  return null;
}

/** A content set as the store knows it — only the key matters here. */
export interface ContentSetLike {
  prefix: string;
}

export type NavigateTarget =
  | {
      ok: true;
      /** Content set to switch to, or null when already there / not switchable. */
      switchTo: string | null;
      /** The `byContentSet` key of the ladder the target lives on. */
      prefix: string;
      /** Rung to select, or null when the address named only a topic. */
      audienceId: string | null;
      /** Fine handle inside the page (element id or CSS selector). */
      anchor?: string;
    }
  | { ok: false; message: string };

/** Content-set keys are directories; agents copy them with a trailing slash. */
const trimKey = (key: string): string => key.replace(/^\/+|\/+$/g, "");

const asText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";

/**
 * Resolve a `navigate-to` / locator address against the explainer.
 *
 * Resolution runs against `byContentSet` directly rather than against the
 * ladder currently rendered, so a cross-topic address is checked BEFORE
 * anything is switched — a name this workspace does not have is refused
 * instead of landing on the topic that happens to be open, which is the
 * failure that looks exactly like a success.
 *
 * `switchTo` is only ever a prefix the STORE knows: a single-topic
 * workspace surfaces no content sets, and setting one there would be
 * reverted on the next file event while the fallback ladder was already
 * showing the right topic.
 */
export function resolveNavigateTarget(
  explainer: Explainer | null,
  activeContentSet: string | null,
  contentSets: ReadonlyArray<ContentSetLike>,
  address: ViewerAddress,
): NavigateTarget {
  if (!explainer || Object.keys(explainer.byContentSet).length === 0) {
    return { ok: false, message: "No explainer is loaded yet." };
  }

  const named = trimKey(asText(address.contentSet));
  let prefix: string;

  if (named) {
    const knownKey = Object.keys(explainer.byContentSet).find(
      (key) => trimKey(key) === named,
    );
    if (knownKey === undefined) {
      const available = Object.keys(explainer.byContentSet)
        .map((k) => k || "(root)")
        .join(", ");
      return {
        ok: false,
        message: `Unknown topic "${named}". This workspace has: ${available}.`,
      };
    }
    prefix = knownKey;
  } else {
    const current = selectLadder(explainer, activeContentSet);
    if (!current) return { ok: false, message: "No explainer is loaded yet." };
    prefix = current.prefix;
  }

  const manifest = explainer.byContentSet[prefix];
  const switchable =
    contentSets.some((cs) => trimKey(cs.prefix) === trimKey(prefix)) &&
    trimKey(activeContentSet ?? "") !== trimKey(prefix);

  const wanted = asText(address.audience);
  const anchor = asText(address.anchor) || asText(address.selector);

  if (!wanted) {
    return {
      ok: true,
      switchTo: switchable ? prefix : null,
      prefix,
      audienceId: null,
      ...(anchor ? { anchor } : {}),
    };
  }

  const rung = manifest.audiences.find((a) => a.id === wanted);
  if (!rung) {
    const available = manifest.audiences.map((a) => a.id).join(", ") || "none yet";
    return {
      ok: false,
      message: `Unknown audience "${wanted}" in "${manifest.title}". This topic has: ${available}.`,
    };
  }

  return {
    ok: true,
    switchTo: switchable ? prefix : null,
    prefix,
    audienceId: rung.id,
    ...(anchor ? { anchor } : {}),
  };
}

/**
 * What a landed navigation says, once the page has answered about its
 * fine anchor.
 *
 * The page opening IS the navigation, so a missed anchor is reported as a
 * successful move carrying a caveat rather than as a failure — the reader
 * did land somewhere meaningful, and telling the agent "navigate failed"
 * would invite it to try again at an address that is already correct.
 *
 * But `success: true` is exactly the case
 * `src/store/viewer-slice.ts::resolveNavigate` drops on the floor: it
 * keeps a `message` only when `success === false`, so on the locator-card
 * path the caveat never reaches the person who clicked. That is the
 * silent half of the failure this repo has already paid for once
 * (`.claude/rules/frontend.md`, the `<viewer-locator>` entry): the card
 * looks like it worked, and only the audience page moved.
 *
 * So the miss is returned twice — once as the action result the agent
 * reads, once as a `notice` the viewer paints where the reader is
 * looking. `notice` is non-null exactly when the anchor missed.
 */
export function anchorVerdict(
  found: boolean,
  where: string,
  anchor: string,
): { result: ViewerActionResult; notice: string | null } {
  if (found) return { result: { success: true }, notice: null };
  const message = `Opened "${where}", but no element matched anchor "${anchor}".`;
  return { result: { success: true, message }, notice: message };
}

/** The compare pane's default partner: the next rung up, wrapping at the top. */
export function nextRung(index: number, count: number): number {
  if (count <= 0) return 0;
  return (index + 1) % count;
}

/**
 * Which rung the second pane shows.
 *
 * The reader's choice wins — except when it would put the same page in
 * both panes, which is not a comparison. That collision is reachable
 * without anyone asking for it (climb onto the rung the second pane holds,
 * or let an agent's `navigate-to` land there), so the pane steps to the
 * next rung: the same rule that chose its default.
 */
export function comparePaneIndex(
  audiences: ReadonlyArray<AudienceEntry>,
  activeIndex: number,
  wantedCompareId: string | null,
): number {
  const wanted = audiences.findIndex((a) => a.id === wantedCompareId);
  return wanted >= 0 && wanted !== activeIndex
    ? wanted
    : nextRung(activeIndex, audiences.length);
}

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Where the Export button goes: the server's `/export/eli5` page for the
 * topic in view. The export routes live on the backend, so in dev the
 * `apiBase` prefix matters (Vite serves nothing under /export); the active
 * content set rides along so the server exports the ladder the reader is
 * looking at rather than re-discovering one.
 */
export function exportUrl(apiBase: string, activeContentSet: string | null): string {
  const qs = activeContentSet
    ? `?contentSet=${encodeURIComponent(activeContentSet)}`
    : "";
  return `${apiBase}/export/eli5${qs}`;
}
