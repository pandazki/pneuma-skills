/**
 * The audience-ladder player's decisions, as pure values.
 *
 * Everything the ELI5 viewer does that can be wrong without throwing lives
 * in `viewer/player-logic.ts`: which ladder is on screen, which file holds
 * the page, what the iframe document says, and what a `navigate-to` address
 * resolves to. The component around it is wiring; these are the parts that
 * fail silently.
 *
 * Two of these pin traps this repo has already paid for:
 *
 *  - **Two path spaces.** `sources.files` always carries full paths
 *    (`how-llms-work/pages/pm.html`), but the framework's `activeFile` and
 *    a selection's `file` live in the CONTENT-SET-STRIPPED space whenever a
 *    content set is active — that is the space `resolveItems` sees and the
 *    space `src/ws.ts` re-prefixes. Mix them and `extractContext` quietly
 *    stops naming the rung in view.
 *  - **Identically-named pages across topics.** Both seeds ship a
 *    `pages/engineer.html`; a lookup that matches on suffix hands the
 *    English page to a reader on the Chinese ladder, under the right title.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import type { Explainer } from "../domain.js";
import {
  activeRungIndex,
  anchorVerdict,
  audienceAddress,
  buildPageSrcdoc,
  comparePaneIndex,
  findPageHtml,
  frameworkPath,
  nextRung,
  pageBaseHref,
  pagePath,
  readAddress,
  resolveNavigateTarget,
  selectLadder,
} from "../viewer/player-logic.js";

const MODE_DIR = join(import.meta.dir, "..");

const EN = {
  title: "What is a database index?",
  language: "en",
  audiences: [
    { id: "age-5", label: "Age 5", file: "pages/age-5.html" },
    { id: "manager", label: "Manager", file: "pages/manager.html" },
    { id: "engineer", label: "Engineer", file: "pages/engineer.html" },
  ],
};

const ZH = {
  title: "大语言模型是怎么工作的？",
  language: "zh",
  audiences: [
    { id: "kid-8", label: "8 岁孩子", file: "pages/kid-8.html" },
    { id: "pm", label: "产品经理", file: "pages/pm.html" },
    { id: "engineer", label: "工程师", file: "pages/engineer.html" },
  ],
};

const TWO_TOPICS: Explainer = {
  byContentSet: { "database-index": EN, "how-llms-work": ZH },
};

const FILES: ViewerFileContent[] = [
  { path: "database-index/manifest.json", content: "{}" },
  { path: "database-index/pages/engineer.html", content: "<p>B+tree</p>" },
  { path: "how-llms-work/manifest.json", content: "{}" },
  { path: "how-llms-work/pages/engineer.html", content: "<p>注意力</p>" },
];

const SETS = [{ prefix: "database-index" }, { prefix: "how-llms-work" }];

// ── selectLadder ────────────────────────────────────────────────────────────

describe("which ladder is on screen", () => {
  test("the active content set names the ladder", () => {
    expect(selectLadder(TWO_TOPICS, "how-llms-work")).toEqual({
      prefix: "how-llms-work",
      manifest: ZH,
    });
  });

  test("a single-topic workspace surfaces no content set, and still renders", () => {
    // The directory resolver needs two directories to call either one a
    // content set, so a workspace holding one topic reports `null` while a
    // topic directory sits on disk. The fallback is what makes the lone
    // seed visible — and the prefix must be the MANIFEST'S OWN key, not
    // the empty active set, or every page path below points at nothing.
    const one: Explainer = { byContentSet: { "database-index": EN } };
    expect(selectLadder(one, null)).toEqual({
      prefix: "database-index",
      manifest: EN,
    });
  });

  test("an active set the explainer has not parsed yet falls back rather than blanking", () => {
    // Mid-switch the store's `activeContentSet` moves before the aggregate
    // source re-emits. Rendering nothing for that frame reads as a crash.
    expect(selectLadder(TWO_TOPICS, "not-parsed-yet")?.prefix).toBe(
      "database-index",
    );
  });

  test("no explainer, and an explainer with no manifests, are both empty", () => {
    expect(selectLadder(null, null)).toBeNull();
    expect(selectLadder({ byContentSet: {} }, "database-index")).toBeNull();
  });
});

// ── path spaces ─────────────────────────────────────────────────────────────

describe("the two path spaces", () => {
  test("pagePath speaks the raw source space — always prefixed", () => {
    expect(pagePath("how-llms-work", "pages/pm.html")).toBe(
      "how-llms-work/pages/pm.html",
    );
    expect(pagePath("", "pages/pm.html")).toBe("pages/pm.html");
    expect(pagePath("topic", "")).toBe("");
  });

  test("frameworkPath speaks the framework's space — stripped while a set is active", () => {
    // `resolveItems` sees stripped files when a content set is active, so
    // an unprefixed activeFile is the only one that survives the store's
    // "is this item still in the workspace" check.
    expect(frameworkPath("how-llms-work", "pages/pm.html", "how-llms-work")).toBe(
      "pages/pm.html",
    );
    expect(frameworkPath("how-llms-work", "pages/pm.html", null)).toBe(
      "how-llms-work/pages/pm.html",
    );
  });

  test("a page lookup never crosses topics, even when the filenames match", () => {
    expect(findPageHtml(FILES, "how-llms-work", "pages/engineer.html")).toBe(
      "<p>注意力</p>",
    );
    expect(findPageHtml(FILES, "database-index", "pages/engineer.html")).toBe(
      "<p>B+tree</p>",
    );
  });

  test("a rung with no page yet reads as missing, not as an empty page", () => {
    expect(findPageHtml(FILES, "database-index", "pages/age-5.html")).toBeNull();
    expect(findPageHtml(FILES, "database-index", "")).toBeNull();
  });

  test("the base href points at the page's own directory under the content route", () => {
    // With this base, `../assets/index.png` inside the page resolves to
    // `<topic>/assets/index.png` — the layout the skill tells the agent to
    // write.
    expect(pageBaseHref("http://localhost:17007", "database-index", "pages/age-5.html")).toBe(
      "http://localhost:17007/content/database-index/pages/",
    );
    expect(pageBaseHref("", "", "index.html")).toBe("/content/");
  });

  test("the skill teaches the reference form this base href actually resolves", () => {
    // The agent never sees `pageBaseHref`; it sees SKILL.md, and writes the
    // `<img src>` that sentence tells it to write. The two have to agree or
    // every generated image 404s inside the iframe — silently, as a broken
    // image rather than an error. Pinned as source text because SKILL.md is
    // the only place this contract is stated to the agent.
    const skill = readFileSync(join(MODE_DIR, "skill", "SKILL.md"), "utf-8");
    expect(skill).toContain("../assets/<file>.png");
    // The prior wording — `reference it as assets/<file>.png` — resolved to
    // `<topic>/pages/assets/…`, one directory too deep.
    expect(skill).not.toContain("reference it as `assets/");

    // And nothing anywhere in the mode may model the bare form. The seeds
    // are the agent's most-copied example, so a bare `src="assets/…"` there
    // would teach the broken path more effectively than any sentence.
    const modeled = [
      join(MODE_DIR, "skill", "SKILL.md"),
      ...readdirSync(join(MODE_DIR, "seed"), { recursive: true })
        .map(String)
        .filter((rel) => rel.endsWith(".html"))
        .map((rel) => join(MODE_DIR, "seed", rel)),
    ];
    for (const path of modeled) {
      const text = readFileSync(path, "utf-8");
      expect([path, /["'(]assets\//.test(text)]).toEqual([path, false]);
    }
  });
});

// ── srcdoc ──────────────────────────────────────────────────────────────────

const SCRIPT = "<script>/* selection */</script>";
const srcdocOf = (html: string, imageVersion = 0) =>
  buildPageSrcdoc(html, {
    baseHref: "http://localhost:17007/content/database-index/pages/",
    script: SCRIPT,
    imageVersion,
  });

describe("the document handed to the iframe", () => {
  const seed = readFileSync(
    join(MODE_DIR, "seed", "database-index", "pages", "manager.html"),
    "utf-8",
  );

  test("a real seed page keeps its own document, plus a base and the selection script", () => {
    const doc = srcdocOf(seed);
    expect(doc).toContain(
      '<base href="http://localhost:17007/content/database-index/pages/">',
    );
    expect(doc).toContain(SCRIPT);
    expect(doc.indexOf(SCRIPT)).toBeLessThan(doc.indexOf("</body>"));
    // The page itself is untouched — same title, same styles.
    expect(doc).toContain("What is a database index? — for a manager");
    expect(doc).toContain("--accent-soft");
  });

  test("the base lands before anything in the head that could resolve against it", () => {
    const doc = srcdocOf(
      `<!DOCTYPE html><html><head><link rel="stylesheet" href="theme.css"></head><body>x</body></html>`,
    );
    expect(doc.indexOf("<base ")).toBeLessThan(doc.indexOf("theme.css"));
  });

  test("an explainer page scrolls — the slide viewer's viewport clamp must NOT come along", () => {
    // Slide injects `html,body{...height:100%;overflow:hidden}` because a
    // slide IS a viewport. An explainer page is a document; the same line
    // would cut every page off at the fold with no scrollbar.
    const doc = srcdocOf(seed);
    expect(doc).not.toContain("overflow:hidden");
    expect(doc).not.toContain("overflow: hidden");
  });

  test("an asset change reaches the page — the version rides in the document", () => {
    expect(srcdocOf(seed, 3)).not.toBe(srcdocOf(seed, 4));
  });

  test("a fragment is wrapped into a real document rather than rendered bare", () => {
    const doc = srcdocOf("<h1>Half-written</h1>");
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toContain("<h1>Half-written</h1>");
    expect(doc).toContain("<base ");
    expect(doc).toContain(SCRIPT);
  });

  test("a quote in the base href cannot break out of the attribute", () => {
    const doc = buildPageSrcdoc("<p>x</p>", {
      baseHref: 'http://x/"><script>alert(1)</script>',
      script: SCRIPT,
      imageVersion: 0,
    });
    expect(doc).not.toContain('"><script>alert(1)');
    expect(doc).toContain("&quot;");
  });
});

// ── addresses ───────────────────────────────────────────────────────────────

describe("the address a rung reports", () => {
  test("contentSet rides along only when one is active", () => {
    expect(audienceAddress(EN.audiences[1], "database-index")).toEqual({
      contentSet: "database-index",
      audience: "manager",
    });
    expect(audienceAddress(EN.audiences[1], null)).toEqual({ audience: "manager" });
  });

  test("a fine anchor joins the coarse rung", () => {
    expect(
      audienceAddress(EN.audiences[1], null, "section.cost > p:nth-child(2)"),
    ).toEqual({ audience: "manager", anchor: "section.cost > p:nth-child(2)" });
  });
});

describe("resolving a navigate-to address", () => {
  test("an audience on the ladder in view needs no switch", () => {
    expect(
      resolveNavigateTarget(TWO_TOPICS, "database-index", SETS, {
        audience: "manager",
      }),
    ).toEqual({ ok: true, switchTo: null, prefix: "database-index", audienceId: "manager" });
  });

  test("a topic plus an audience switches the content set", () => {
    expect(
      resolveNavigateTarget(TWO_TOPICS, "database-index", SETS, {
        contentSet: "how-llms-work",
        audience: "pm",
      }),
    ).toEqual({ ok: true, switchTo: "how-llms-work", prefix: "how-llms-work", audienceId: "pm" });
  });

  test("the trailing slash an agent copies out of the seed catalogue is tolerated", () => {
    const target = resolveNavigateTarget(TWO_TOPICS, "database-index", SETS, {
      contentSet: "how-llms-work/",
      audience: "pm",
    });
    expect(target).toMatchObject({ ok: true, switchTo: "how-llms-work" });
  });

  test("a single-topic workspace has no set to switch to, and still resolves", () => {
    // `contentSets` is empty because the directory resolver needs two.
    // Calling `setActiveContentSet("database-index")` there would be
    // reverted by the store on the next file event — so: no switch, but
    // the audience still resolves against that topic's own manifest.
    const one: Explainer = { byContentSet: { "database-index": EN } };
    expect(
      resolveNavigateTarget(one, null, [], {
        contentSet: "database-index",
        audience: "engineer",
      }),
    ).toEqual({ ok: true, switchTo: null, prefix: "database-index", audienceId: "engineer" });
  });

  test("an unknown audience is refused, and the refusal says what exists", () => {
    const target = resolveNavigateTarget(TWO_TOPICS, "database-index", SETS, {
      audience: "grandma",
    });
    expect(target.ok).toBe(false);
    if (target.ok) throw new Error("unreachable");
    expect(target.message).toContain("grandma");
    expect(target.message).toContain("age-5");
    expect(target.message).toContain("engineer");
  });

  test("an unknown topic is refused rather than landing on the open one", () => {
    // The 2026-08-20 lesson: a wrong destination that looks like a move is
    // worse than a refusal.
    const target = resolveNavigateTarget(TWO_TOPICS, "database-index", SETS, {
      contentSet: "quantum-tunnelling",
      audience: "manager",
    });
    expect(target.ok).toBe(false);
    if (target.ok) throw new Error("unreachable");
    expect(target.message).toContain("quantum-tunnelling");
  });

  test("an empty workspace refuses instead of throwing", () => {
    expect(resolveNavigateTarget(null, null, [], { audience: "manager" }).ok).toBe(
      false,
    );
  });

  test("an anchor rides through, and an address with no audience keeps the rung", () => {
    expect(
      resolveNavigateTarget(TWO_TOPICS, "database-index", SETS, {
        audience: "manager",
        anchor: "#cost",
      }),
    ).toMatchObject({ ok: true, anchor: "#cost" });
    expect(
      resolveNavigateTarget(TWO_TOPICS, "database-index", SETS, {
        contentSet: "how-llms-work",
      }),
    ).toEqual({ ok: true, switchTo: "how-llms-work", prefix: "how-llms-work", audienceId: null });
  });
});

describe("reading the address off an action param", () => {
  test("an object passes through", () => {
    expect(readAddress({ audience: "manager" })).toEqual({ audience: "manager" });
  });

  test("the JSON string an agent actually sends is parsed", () => {
    // Viewer action params cross the wire as a hand-written JSON body;
    // complex values arrive stringified often enough that slide parses
    // its own array param the same way.
    expect(readAddress('{"audience":"manager","anchor":"#cost"}')).toEqual({
      audience: "manager",
      anchor: "#cost",
    });
  });

  test("nonsense is refused, not guessed at", () => {
    expect(readAddress(undefined)).toBeNull();
    expect(readAddress("manager")).toBeNull();
    expect(readAddress("[1,2]")).toBeNull();
    expect(readAddress(7)).toBeNull();
  });
});

describe("compare defaults", () => {
  test("the second pane opens on the next rung, wrapping at the top", () => {
    expect(nextRung(0, 3)).toBe(1);
    expect(nextRung(2, 3)).toBe(0);
    expect(nextRung(0, 1)).toBe(0);
    expect(nextRung(0, 0)).toBe(0);
  });

  test("the reader's pick wins", () => {
    expect(comparePaneIndex(EN.audiences, 0, "engineer")).toBe(2);
  });

  test("with no pick, the pane sits one rung up", () => {
    expect(comparePaneIndex(EN.audiences, 1, null)).toBe(2);
    expect(comparePaneIndex(EN.audiences, 2, null)).toBe(0);
    expect(comparePaneIndex(EN.audiences, 0, "not-a-rung")).toBe(1);
  });

  test("the panes never show the same page twice", () => {
    // Observed live 2026-08-25: compare was pinned to "engineer", then a
    // cross-topic locator card landed the FIRST pane on "engineer" too —
    // two identical pages side by side under a header promising a
    // comparison. Nobody asked for that, so nobody has to undo it.
    expect(comparePaneIndex(EN.audiences, 2, "engineer")).toBe(0);
  });
});

// ── which rung is on screen ─────────────────────────────────────────────────

describe("activeRungIndex — the restored position is honoured", () => {
  const RUNGS = EN.audiences;

  test("the reader's wish wins while it names a rung of this ladder", () => {
    expect(activeRungIndex(RUNGS, "database-index", "engineer", null)).toBe(2);
    // ...even when the framework still names a different page: the wish is
    // the newer fact, and the effect that reports it upstream has not run
    // yet on the render that first shows it.
    expect(
      activeRungIndex(RUNGS, "database-index", "engineer", "pages/age-5.html"),
    ).toBe(2);
  });

  test("with no wish, `activeFile` decides — STRIPPED space", () => {
    // A content set is active, so the store hands the viewer bare paths.
    expect(activeRungIndex(RUNGS, "database-index", null, "pages/manager.html")).toBe(1);
  });

  test("with no wish, `activeFile` decides — PREFIXED space", () => {
    // Single-topic workspace: no content set is surfaced, so the same
    // position arrives carrying its directory. A viewer fluent in only one
    // of these two spaces restores in one workspace shape and silently
    // reopens on rung 0 in the other.
    expect(
      activeRungIndex(RUNGS, "database-index", null, "database-index/pages/manager.html"),
    ).toBe(1);
  });

  test("this is the bug the fix exists for: rung 0 is NOT the answer", () => {
    // Before `activeFile` was consumed, every resumed session and every
    // replay reopened here while the store named another page — the visible
    // page and the next `<viewer-context>` describing different rungs.
    expect(
      activeRungIndex(RUNGS, "database-index", null, "pages/engineer.html"),
    ).not.toBe(0);
  });

  test("a wish from the topic we just left does not survive the switch", () => {
    // `kid-8` belongs to the Chinese ladder; on the English one it names
    // nothing, so the file (then rung 0) decides instead of an empty pane.
    expect(activeRungIndex(RUNGS, "database-index", "kid-8", "pages/manager.html")).toBe(1);
    expect(activeRungIndex(RUNGS, "database-index", "kid-8", null)).toBe(0);
  });

  test("an unknown or empty file falls back to the bottom rung", () => {
    expect(activeRungIndex(RUNGS, "database-index", null, "pages/nobody.html")).toBe(0);
    expect(activeRungIndex(RUNGS, "database-index", null, "")).toBe(0);
    expect(activeRungIndex(RUNGS, "database-index", null, null)).toBe(0);
    expect(activeRungIndex([], "database-index", null, "pages/manager.html")).toBe(0);
  });

  test("a rung with no page yet is never matched by an empty file", () => {
    const half = [{ id: "pm", label: "PM", file: "" }, ...RUNGS];
    expect(activeRungIndex(half, "database-index", null, "")).toBe(0);
    expect(activeRungIndex(half, "database-index", null, "pages/manager.html")).toBe(2);
  });
});

// ── the anchor verdict ──────────────────────────────────────────────────────

describe("anchorVerdict — a missed anchor is visible to BOTH readers", () => {
  test("a hit is a plain success with nothing to announce", () => {
    expect(anchorVerdict(true, "Manager", "#impact")).toEqual({
      result: { success: true },
      notice: null,
    });
  });

  test("a miss still succeeded — the page did open", () => {
    // Reporting `success: false` would tell the agent to retry an address
    // that is already right, and the reader IS looking at the rung asked
    // for. The caveat rides along instead.
    const { result } = anchorVerdict(false, "Manager", "#impact");
    expect(result.success).toBe(true);
    expect(result.message).toContain("#impact");
    expect(result.message).toContain("Manager");
  });

  test("a miss ALSO produces a notice, because the message alone is dropped", () => {
    // `src/store/viewer-slice.ts::resolveNavigate` keeps a message only
    // when `success === false`, so on the locator-card path this notice is
    // the reader's only evidence that the anchor missed. If this ever goes
    // back to null, a stale locator card becomes a button that looks like
    // it worked.
    const { result, notice } = anchorVerdict(false, "Manager", "#impact");
    expect(notice).not.toBeNull();
    expect(notice).toBe(result.message!);
  });
});

// ── the framework's half ────────────────────────────────────────────────────

describe("the framework's half of the loop", () => {
  test("capture navigates before it shoots for an eli5 address", async () => {
    // `useCaptureAction` drives `navigateRequest` first only for address
    // keys it recognises as coarse. `audience` is eli5's coarse key — leave
    // it out of that registry and `capture {address:{audience:"manager"}}`
    // silently returns whichever rung is already on screen, which is the
    // failure that looks most like success. (`anchor` is deliberately NOT
    // there: it resolves in place, via `fineSelector`.)
    const hook = await Bun.file(
      join(MODE_DIR, "..", "..", "src", "hooks", "useCaptureAction.ts"),
    ).text();
    const list = hook.match(/const COARSE_ADDRESS_KEYS = \[([^\]]+)\]/)?.[1] ?? "";
    expect(list).toContain('"audience"');
  });
});
