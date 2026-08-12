/**
 * Compose highlight-plan.png: the real plan.md beside the real wall it produced.
 * Both artifacts come off disk verbatim; this only lays them out.
 */
const OUT = process.env.BANSHO_SHOT_DIR ?? ".";
const plan = await Bun.file("/Users/pandazki/bansho-new/three-months/plan.md").text();
const lines = plan.split("\n");

// Verbatim slices: the design header + the passage table, then the note the
// agent wrote after looking at the real board.
const head = lines.slice(0, 16);
const note = lines.slice(23, 27);
const walk = lines.slice(28, 41);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const color = (s) => {
  let h = esc(s);
  h = h.replace(/(FIGURE (?:graph|chart))/g, '<b class="fig">$1</b>');
  h = h.replace(/(@board 4|@at [a-z]+|@erase)/g, '<b class="verb">$1</b>');
  h = h.replace(/(~\d+s)/g, '<b class="len">$1</b>');
  return h;
};

const body = `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: x; src: local("Menlo"); }
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1376px; height: 768px; overflow: hidden;
    background: radial-gradient(1200px 700px at 22% 18%, #17151a 0%, #09090b 62%);
    color: #e4e4e7; font-family: "Inter", "SF Pro Text", system-ui, sans-serif;
    display: grid; grid-template-columns: 540px 50px 702px; align-items: center; justify-content: center;
    padding: 30px 26px 34px; gap: 0;
  }
  .cap { font-size: 12.5px; letter-spacing: .14em; text-transform: uppercase; color: #a1a1aa; margin-bottom: 9px; }
  .cap i { font-style: normal; color: #f97316; }
  .panel {
    border: 1px solid #27272a; border-radius: 12px; background: rgba(24,24,27,.72);
    backdrop-filter: blur(8px); padding: 15px 17px; overflow: hidden;
  }
  pre { font-family: Menlo, ui-monospace, monospace; font-size: 11.1px; line-height: 1.58;
        color: #c7c7cf; white-space: pre-wrap; word-break: break-word; }
  pre .fig { color: #f97316; font-weight: 600; }
  pre .verb { color: #7dd3fc; font-weight: 600; }
  pre .len { color: #a3e635; }
  pre.note { color: #8d8d96; font-size: 11px; border-left: 2px solid #f97316; padding-left: 11px; margin-top: 12px; }
  .arrow { display: grid; place-items: center; }
  .arrow svg { filter: drop-shadow(0 0 12px rgba(249,115,22,.55)); }
  .frame { position: relative; width: 702px; height: 372px; overflow: hidden; border-radius: 10px; border: 1px solid #3f3f46; box-shadow: 0 18px 48px rgba(0,0,0,.55); }
  .frame img { position: absolute; width: 740.8px; left: -30.1px; top: -4.3px; display: block; }
  .foot { position: absolute; left: 30px; bottom: 12px; font-size: 12.5px; color: #71717a; font-style: italic; }
</style>
<div>
  <div class="cap">plan.md <i>&mdash; written before one board exists</i></div>
  <div class="panel">
    <pre>${head.map(color).join("\n")}</pre>
    <pre class="note">${note.map(esc).join("\n")}</pre>
    <pre style="margin-top:12px">${walk.map(color).join("\n")}</pre>
  </div>
</div>
<div class="arrow">
  <svg width="56" height="26" viewBox="0 0 56 26"><path d="M2 13 H44" stroke="#f97316" stroke-width="2.4" stroke-linecap="round"/><path d="M38 5 L50 13 L38 21" fill="none" stroke="#f97316" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
</div>
<div class="board">
  <div class="cap">board.md <i>&mdash; the wall it produced</i></div>
  <div class="frame"><img src="KEEP-wall.png"></div>
</div>
<div class="foot">Every passage gets a medium, a column and a length before a word is written &mdash; then the design is corrected against the real board.</div>
`;
await Bun.write(`${OUT}/plan.html`, body);
console.log("wrote", `${OUT}/plan.html`);
