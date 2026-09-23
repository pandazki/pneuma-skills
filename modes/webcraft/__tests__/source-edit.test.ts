/**
 * Text edits made in the webcraft preview are applied to the page's source
 * (`applyTextEdit`), not by writing the rendered page back.
 *
 * The rendered-body save this replaced failed on the new seeds (2026-09-23
 * review): it deleted the landing's authored `<script src="main.js">`, froze
 * the console's script-generated table into its source, and — because the
 * body was spliced in with a `String.replace` template — turned `$1…` / `$2…`
 * / `$3…` in the page into regex back-references. The Gazette front page's
 * authored "$1.8 million" and "$212 million" doubled the file (22,832 → 44,878
 * bytes, two <body> tags) on a plain paragraph edit.
 *
 * The final review of the same day found the first handle (tag + text + the
 * element's ordinal among RUNTIME look-alikes) saved into the wrong element
 * once the page's script had removed, inserted or reordered look-alikes; the
 * next round found that a structural path with equal look-alike counts still
 * saved into the wrong card once a script reordered the cards. The cases
 * below build the handle the way the preview does — `describeEdit` on the
 * rendered DOM, after the page's "script" has run — and check which source
 * element changed, or that the edit was refused.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { applyTextEdit, applyTextEdits, describeEdit, describeEditSource, innerRanges, type TextEdit } from "../viewer/source-edit.js";

const win = new Window();
const parser = new win.DOMParser();
const parse = (html: string) => parser.parseFromString(html, "text/html") as unknown as Document;
afterAll(() => win.happyDOM.close());

/**
 * The handle the preview would send: render `source`, let the page's script
 * `run`, pick the edited element, type `after` into it.
 */
function edit(source: string, pick: (doc: Document) => Element, after: string, run?: (doc: Document) => void): TextEdit {
  const doc = parse(source);
  run?.(doc);
  const el = pick(doc);
  const before = el.innerHTML;
  el.innerHTML = after;
  return describeEdit(el, before, el.innerHTML, (e) => e.innerHTML);
}

const LANDING = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Pneuma Skills</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <h2 class="h2" id="pillars-h">Four pillars hold it up.</h2>
    <p class="lead">Costs <b>$1.8 million</b> a year, $212 million in all; $3.73 per seat.</p>
    <button class="pause" aria-label="Pause demo">Pause</button>
  </main>
  <script src="main.js" defer></script>
</body>
</html>
`;

const h2 = (d: Document) => d.querySelector("h2")!;

describe("an edit changes only the edited element", () => {
  test("authored scripts survive, and nothing else of the file moves", () => {
    const r = applyTextEdit(LANDING, edit(LANDING, h2, "Four pillars."), parse);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toBe(LANDING.replace("Four pillars hold it up.", "Four pillars."));
    expect(r.html).toContain('<script src="main.js" defer></script>');
  });

  test("dollar amounts in the page stay literal (the $1 / $2 back-reference bug)", () => {
    const after = 'Costs <b>$1.8 million</b> a year, $212 million overall; $3.73 per seat.';
    const r = applyTextEdit(LANDING, edit(LANDING, (d) => d.querySelector("p.lead")!, after), parse);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toBe(LANDING.replace("in all", "overall"));
    expect(r.html.match(/<body/g)?.length).toBe(1);
    expect(r.html.length).toBe(LANDING.length + "overall".length - "in all".length);
  });

  test("an edit that itself contains $1 / $& is written literally", () => {
    const r = applyTextEdit(LANDING, edit(LANDING, h2, "Pay $1 and $& $2 now"), parse);
    expect(r.ok && r.html).toBe(LANDING.split("Four pillars hold it up.").join("Pay $1 and $&amp; $2 now"));
  });

  test("inline markup in the new text is kept", () => {
    const r = applyTextEdit(LANDING, edit(LANDING, h2, "Four <em>pillars</em>."), parse);
    expect(r.ok && r.html).toContain('<h2 class="h2" id="pillars-h">Four <em>pillars</em>.</h2>');
  });

  test("the Gazette's own markup: a paragraph among $-amounts, comments and scripts", () => {
    const gazette = `<!DOCTYPE html><html lang="en"><head><style>p{margin:0}</style></head><body>
<!-- <p>a commented-out paragraph</p> -->
<article><p>The later sailings will cost the city an estimated $1.8 million a year.</p>
<p>The bond measure, at $212 million, goes to voters.</p>
<script>var t = "<p>not a paragraph</p>";</script>
<p>Continued on Page A10</p></article></body></html>`;
    const e = edit(gazette, (d) => d.querySelectorAll("p")[1], "The bond measure, at $212 million, goes to voters in May.");
    const r = applyTextEdit(gazette, e, parse);
    expect(r.ok && r.html).toBe(gazette.replace("goes to voters.", "goes to voters in May."));
  });

  test("classes the page's script added (a reveal state) do not block the edit", () => {
    const src = `<!DOCTYPE html><html><body><h2 class="reveal">Title</h2></body></html>`;
    const e = edit(src, h2, "New title", (d) => h2(d).classList.add("is-in"));
    expect(applyTextEdit(src, e, parse)).toEqual({ ok: true, html: src.replace("Title", "New title") });
  });
});

describe("which element — a verified source identity, not a runtime ordinal", () => {
  test("of identical twins on a page without scripts, the one at the edited position", () => {
    const src = `<!DOCTYPE html><html><body><p>Same</p><p>Other</p><p>Same</p></body></html>`;
    const e = edit(src, (d) => d.querySelectorAll("p")[2], "Second");
    expect(applyTextEdit(src, e, parse)).toEqual({ ok: true, html: `<!DOCTYPE html><html><body><p>Same</p><p>Other</p><p>Second</p></body></html>` });
  });

  test("the review's case: the script removes #first, the user edits #second — #second changes", () => {
    const src = `<!DOCTYPE html><html><body><p id="first">Same text</p><p id="second">Same text</p></body></html>`;
    const e = edit(src, (d) => d.querySelector("#second")!, "Edited SECOND", (d) => d.querySelector("#first")!.remove());
    const r = applyTextEdit(src, e, parse);
    expect(r).toEqual({ ok: true, html: src.replace('<p id="second">Same text</p>', '<p id="second">Edited SECOND</p>') });
  });

  test("the same without ids is refused: which source twin is on screen cannot be known", () => {
    const src = `<!DOCTYPE html><html><body><p>Same text</p><p>Same text</p></body></html>`;
    const e = edit(src, (d) => d.querySelector("p")!, "Edited", (d) => d.querySelector("p")!.remove());
    const r = applyTextEdit(src, e, parse);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("added or removed");
  });

  test("a look-alike the script inserted is refused, not matched to the authored one", () => {
    const src = `<!DOCTYPE html><html><body><ul><li>Item</li></ul></body></html>`;
    const e = edit(src, (d) => d.querySelectorAll("li")[1], "Changed", (d) => {
      const li = d.createElement("li");
      li.textContent = "Item";
      d.querySelector("ul")!.append(li);
    });
    expect(applyTextEdit(src, e, parse).ok).toBe(false);
  });

  test("twins the script reordered are told apart by their authored attributes", () => {
    const src = `<!DOCTYPE html><html><body><div><p class="a">Same</p><p class="b">Same</p></div></body></html>`;
    const e = edit(src, (d) => d.querySelector("p.b")!, "B edited", (d) => {
      const box = d.querySelector("div")!;
      box.prepend(d.querySelector("p.b")!);
    });
    expect(applyTextEdit(src, e, parse)).toEqual({ ok: true, html: src.replace('<p class="b">Same</p>', '<p class="b">B edited</p>') });
  });

  // Round-3 review: two cards with the same paragraph; the script moves Pro
  // before Basic; editing Pro's paragraph saved into Basic and said success.
  const CARDS = `<!doctype html><html><body><h1>Reordered product cards</h1><article data-product="basic"><h2>Basic</h2><p>Same price</p></article><article data-product="pro"><h2>Pro</h2><p>Same price</p></article><script>document.body.insertBefore(document.querySelector("[data-product=pro]"),document.querySelector("[data-product=basic]"))</script></body></html>`;
  const moveProFirst = (d: Document) => d.body.insertBefore(d.querySelector("[data-product=pro]")!, d.querySelector("[data-product=basic]"));

  test("the review's reordered cards: editing Pro's paragraph changes Pro's, told apart by the card's attribute", () => {
    const e = edit(CARDS, (d) => d.querySelector("[data-product=pro] p")!, "PRO EDIT", moveProFirst);
    expect(applyTextEdit(CARDS, e, parse)).toEqual({
      ok: true,
      html: CARDS.replace('<h2>Pro</h2><p>Same price</p>', '<h2>Pro</h2><p>PRO EDIT</p>'),
    });
  });

  test("reordered cards without distinguishing attributes: told apart by the heading beside the paragraph", () => {
    const src = CARDS.replace(' data-product="basic"', ' class="card basic"').replace(' data-product="pro"', ' class="card pro"')
      .replace(/<article class="card (basic|pro)">/g, "<article>");
    const e = edit(src, (d) => d.querySelectorAll("article")[1].querySelector("p")!, "PRO EDIT", (d) => {
      const [basic, pro] = Array.from(d.querySelectorAll("article"));
      d.body.insertBefore(pro, basic);
    });
    // After the move, the runtime's first article is Pro.
    const r = applyTextEdit(src, edit(src, (d) => d.querySelectorAll("article")[0].querySelector("p")!, "PRO EDIT", (d) => {
      const [basic, pro] = Array.from(d.querySelectorAll("article"));
      d.body.insertBefore(pro, basic);
    }), parse);
    expect(r).toEqual({ ok: true, html: src.replace('<h2>Pro</h2><p>Same price</p>', '<h2>Pro</h2><p>PRO EDIT</p>') });
    // And editing the (now second) Basic card's paragraph changes Basic's.
    expect(applyTextEdit(src, e, parse)).toEqual({ ok: true, html: src.replace('<h2>Basic</h2><p>Same price</p>', '<h2>Basic</h2><p>PRO EDIT</p>') });
  });

  test("the distinguishing text may sit higher up: a card's heading beside the paragraph's wrapper", () => {
    const src = `<!doctype html><html><body><section><h2>Basic</h2><div><p>Same price</p></div></section><section><h2>Pro</h2><div><p>Same price</p></div></section></body></html>`;
    const e = edit(src, (d) => d.querySelectorAll("section")[0].querySelector("p")!, "PRO EDIT", (d) => {
      const [basic, pro] = Array.from(d.querySelectorAll("section"));
      d.body.insertBefore(pro, basic);
    });
    expect(applyTextEdit(src, e, parse)).toEqual({ ok: true, html: src.replace('<h2>Pro</h2><div><p>Same price</p>', '<h2>Pro</h2><div><p>PRO EDIT</p>') });
  });

  // Round-4 review: two fully identical cards swapped by a script. Editing the
  // first visible one must not save into the first source card.
  test("the review's swapped identical articles are refused, not matched by position", () => {
    const src = `<!doctype html><html><body><h1>Reordered identical cards</h1><article><p>Same text</p></article><article><p>Same text</p></article><script>window.cards=[...document.querySelectorAll("article")];document.body.insertBefore(cards[1],cards[0])</script></body></html>`;
    const e = edit(src, (d) => d.querySelector("article p")!, "SECOND CARD EDIT", (d) => {
      const cards = Array.from(d.querySelectorAll("article"));
      d.body.insertBefore(cards[1], cards[0]);
    });
    const r = applyTextEdit(src, e, parse);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("nothing but their position");
  });

  test("in-order identical twins on a page with a script are refused too: the order cannot be proven", () => {
    const src = `<!doctype html><html><body><p>Same</p><p>Other</p><p>Same</p><script>console.log(1)</script></body></html>`;
    expect(applyTextEdit(src, edit(src, (d) => d.querySelectorAll("p")[2], "Second"), parse).ok).toBe(false);
    const handler = `<!doctype html><html><body onload="x()"><p>Same</p><p>Other</p><p>Same</p></body></html>`;
    expect(applyTextEdit(handler, edit(handler, (d) => d.querySelectorAll("p")[2], "Second"), parse).ok).toBe(false);
  });

  test("identical cards that the script reorders are refused: nothing but position tells them apart", () => {
    const src = `<!doctype html><html><body><ul><li><article><p>Same</p></article></li><li><article><p>Same</p></article></li><li>Last</li></ul></body></html>`;
    const e = edit(src, (d) => d.querySelectorAll("p")[0], "Edited", (d) => {
      const ul = d.querySelector("ul")!;
      ul.append(ul.firstElementChild!); // rotate: the first card goes to the end
    });
    const r = applyTextEdit(src, e, parse);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("cannot be told");
  });

  test("an element the script shifted (a banner inserted before it) is still found when unique", () => {
    const src = `<!DOCTYPE html><html><body><p>Intro</p><p>Target</p></body></html>`;
    const e = edit(src, (d) => d.querySelectorAll("p")[2], "Hit", (d) => {
      const banner = d.createElement("p");
      banner.textContent = "Cookie banner";
      d.body.prepend(banner);
    });
    expect(applyTextEdit(src, e, parse)).toEqual({ ok: true, html: src.replace("Target", "Hit") });
  });

  test("the position is counted inside the nearest ancestor with an id", () => {
    const src = `<!DOCTYPE html><html><body><p>Note</p><section id="s"><p>Note</p></section></body></html>`;
    const e = edit(src, (d) => d.querySelector("#s p")!, "Scoped");
    expect(e.scope).toBe("s");
    expect(applyTextEdit(src, e, parse)).toEqual({ ok: true, html: src.replace('<section id="s"><p>Note</p>', '<section id="s"><p>Scoped</p>') });
  });

  test("an id the source has twice is refused", () => {
    const src = `<!DOCTYPE html><html><body><p id="x">A</p><p id="x">A</p></body></html>`;
    const e = edit(src, (d) => d.querySelector("#x")!, "B");
    expect(applyTextEdit(src, e, parse).ok).toBe(false);
  });
});

describe("edits that cannot be applied are refused, leaving the source alone", () => {
  test("an element the page's script generated (it is not in the source)", () => {
    const src = `<!DOCTYPE html><html><body><table><tbody id="rows"></tbody></table><script src="app.js"></script></body></html>`;
    const e = edit(src, (d) => d.querySelector("td")!, "$4.00", (d) => {
      d.querySelector("#rows")!.innerHTML = "<tr><td>$3.73</td></tr>";
    });
    const r = applyTextEdit(src, e, parse);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("not in the page's source");
  });

  test("an element whose end tag the source omits", () => {
    const src = `<!DOCTYPE html><html><body><ul><li>One<li>Two</ul></body></html>`;
    const e = edit(src, (d) => d.querySelector("li")!, "Uno");
    expect(applyTextEdit(src, e, parse).ok).toBe(false);
  });

  test("a batch stops at the first refusal and reports it", () => {
    const out = applyTextEdits(LANDING, [
      edit(LANDING, h2, "Four pillars."),
      { tag: "td", before: "generated", after: "x" },
    ], parse);
    expect(out.applied).toBe(1);
    expect(out.html).toBe(LANDING.replace("Four pillars hold it up.", "Four pillars."));
    expect(out.failure?.edit.tag).toBe("td");
  });
});

describe("describeEdit runs inside the page", () => {
  test("its source is self-contained: rebuilt from text, it gives the same handle", () => {
    const rebuilt = new Function(`return (${describeEditSource});`)() as typeof describeEdit;
    const doc = parse(`<!DOCTYPE html><html><body><section id="s"><p class="x">A</p><p class="x">A</p></section></body></html>`);
    const el = doc.querySelectorAll("p")[1];
    el.innerHTML = "B";
    expect(rebuilt(el, "A", "B", (e) => e.innerHTML)).toEqual(describeEdit(el, "A", "B", (e) => e.innerHTML));
  });

  test("the viewer's own nodes are not part of the identity chain", () => {
    const doc = parse(`<!DOCTYPE html><html><body><p>A</p></body></html>`);
    const overlay = doc.createElement("p");
    overlay.setAttribute("data-pneuma-overlay", "");
    doc.body.prepend(overlay);
    const el = doc.querySelectorAll("p")[1];
    expect(describeEdit(el, "A", "A", (e) => e.innerHTML).chain).toEqual([{ tag: "p", attrs: {}, prev: [], next: [] }]);
  });
});

describe("innerRanges", () => {
  test("skips comments, raw-text elements and quoted '>' in attributes", () => {
    const src = `<p title="a>b">one</p><!-- <p>x</p> --><script>"<p>"</script><p>two</p>`;
    const ranges = innerRanges(src, "p");
    expect(ranges.map((r) => src.slice(r.start, r.end))).toEqual(["one", "two"]);
  });

  test("nests same-tag elements", () => {
    const src = `<span>a<span>b</span>c</span>`;
    expect(innerRanges(src, "span").map((r) => src.slice(r.start, r.end))).toEqual(["a<span>b</span>c", "b"]);
  });
});
