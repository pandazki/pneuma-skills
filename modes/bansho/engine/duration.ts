/**
 * I8 duration model — every timing constant of the engine lives HERE and
 * nowhere else (T5 recalibration touches exactly one file).
 *
 * Layering (G2): engine core, zero imports beyond `./types.js`. Pure
 * arithmetic over strings — no DOM, no clock. Both the pure compile layer
 * (`inference.ts` / `timeline.ts`) and the T3 factories consume these
 * helpers, so content-derived durations agree byte-for-byte across layers.
 *
 * The G10 values are PROTOTYPE-MEASURED INITIAL VALUES, recalibrated after
 * full serialization (same demo content 9.0s → 13.7s — deliberately on the
 * slow side). T5 measured them on the two shipped seed boards and left the
 * whole table alone (see the verdict on `DEFAULT_DURATIONS` below); the
 * final values remain the product owner's call.
 */

import type { DurationConstants } from "./types.js";

/**
 * G10 — the I8 constants table (seconds), prototype-measured initial values.
 *
 * T5 residual check — MEASURED on the two shipped seed boards, every value
 * left as it is. The numbers, so a later pass can tell "measured and fine"
 * from "never looked at":
 *
 *  - **Writing rate** (`perChar` × `cjkBoost` + `wordBase`, amortized over
 *    the I9 1–2-glyph segments): **13.4 CJK glyphs/s on tech-zh, 13.8 on
 *    pitch-zh while the pen is down** — ~75 ms per character. That is the
 *    one value a viewer can judge without a reference, and it reads as a
 *    fast but human hand: a 26-glyph line takes ~2 s to appear, so a
 *    sentence lands inside one breath and the eye can still follow the
 *    stroke order. Halving it would make the board a waiting room; the
 *    prototype's pre-serialization rate (roughly double) read as a printer.
 *  - **Pause budget** — the three text pauses spend 16.35 s of tech-zh's
 *    91.78 s and 13.08 s of pitch-zh's 70.71 s: `gap` 9.07 s / 6.97 s over
 *    349 / 268 segments, `comma` 3.38 s over 26 / 2.21 s over 17, `period`
 *    3.90 s over 13 sentences on both. The ratios are what matter and they
 *    hold: a comma beat is 4.4× the inter-segment gap and a period 2.3× a
 *    comma, so clause / sentence / paragraph are three audibly different
 *    rests rather than one blurred pause.
 *  - **Whole-board split** — 59.8% / 57.3% pen-down. Against the prose-only
 *    31.4% / 32.4% pen-up already derived in the CHART_GLUE note, the extra
 *    pen-up is the structural pauses (`paraGap` × HEADING_GAP_MULT, chart
 *    glue, `annotDelay` / `afterAnnot`), which is where a lecture's silence
 *    belongs — between ideas, not between words.
 *  - `annotate` (0.44 s for one ink mark) was checked against I2, which
 *    holds every mark until its sentence is written: the two-circle cluster
 *    in tech-zh's closing paragraph draws in 0.88 s + delays, matching the
 *    single-pen frames shot for G7 (08-tech-zh-ink-single-pen).
 *
 * No constant stood out against those bands, so none moved. What a future
 * recalibration should change FIRST if the board feels wrong: the writing
 * rate (`perChar`/`cjkBoost`) for "too slow / too fast", `period` for "it
 * doesn't breathe between sentences" — in that order.
 */
export const DEFAULT_DURATIONS: DurationConstants = {
  perChar: 0.0195,
  wordBase: 0.052,
  cjkBoost: 1.5,
  gap: 0.026,
  comma: 0.13,
  period: 0.3,
  paraGap: 0.42,
  annotate: 0.44,
  annotDelay: 0.1,
  afterAnnot: 0.14,
  chartLead: 0.45,
  axis: 0.4,
  tick: 0.2,
  series: 1.45,
  label: 0.4,
  // C2 camera-path constants (Van Wijk & Nuij) — initial values pending the
  // T5 calibration pass like everything else in this table. ρ = √2 is the
  // paper's (and d3's) recommendation; speed 1.0 makes a one-viewport pan
  // land around 0.9 s, between an ink mark (0.44 s) and a series (1.45 s).
  cameraRho: 1.42,
  cameraSpeed: 1.0,
  // C3 — one erase sweep across a board. Sits between a chart series
  // (1.45 s) and twice an ink mark: long enough to read as a hand
  // travelling the board, short enough that an auto-erase never stalls
  // the lecture. T5-family initial value.
  erase: 1.6,
  // S1 — one `@turn` walk (nothing erased): the topic-change breath.
  // Initial value = paraGap (0.42) × HEADING_GAP_MULT (2) — the `---` /
  // heading tier, the dialect's longest breath (board-snapshot design
  // §7.6-Q2 pins the derivation; the value is read from this file's own
  // constants, not invented). T5-family.
  turn: 0.84,
  // Canvas pivot V2 (design §3.1) — one `@at` walk: the pen crosses the
  // board to a region. Same family as `turn` (a room action, not writing),
  // and the initial value is deliberately the SAME number: walking to the
  // right-hand column and walking to the next board are the same gesture at
  // different scales, and there is no evidence yet that separates them.
  // Read from here, never re-derived at a call site; T5's final pass owns
  // the number.
  place: 0.84,
};

/**
 * I1 — a step following a heading or a `---` rule waits paraGap × THIS
 * (设计稿 §5.1 I1: "heading 与 --- 后取段间 ×2(倍数随 M5 终校)").
 *
 * T5 residual check — MEASURED on the two shipped seed boards, left at 2.
 * ×2 = 0.84 s, spent 6 times per board (4 headings + 1 rule + the closing
 * rule): 5.04 s of tech-zh's 92.05 s (5.5%) and of pitch-zh's 70.71 s
 * (7.1%). The reference that decides it is the heading the pause follows:
 * writing one takes 0.62–1.44 s across the ten headings, so the board goes
 * quiet for about as long as the title took to write — a section break
 * reads as a section break without stalling, and against the 0.42 s
 * paragraph pause it is still audibly the bigger of the two. No visible
 * outlier, so no change; the final value stays the product owner's.
 */
export const HEADING_GAP_MULT = 2;

/**
 * Intra-chart glue pauses (seconds unless noted) — prototype-measured micro
 * rhythm, kept OUT of the frozen `DurationConstants` contract on purpose
 * (engine-contract.test.ts instantiates that interface; extending it would
 * be a contract change). Centralized here so T5 calibration still edits one
 * file. Provenance: prototype `buildChart` (+.08 after each axis line, +.12
 * after the skeleton, +.15 after each series label, +.2 block tail,
 * `chartLead * .6` for accumulation layers). The prototype's staggered tick
 * fades are superseded by rev-4 full serialization (I4) — ticks now run one
 * by one, `afterEntry` between them.
 *
 * T5 residual check — MEASURED on the two shipped seed boards, every value
 * left as it is. Summed over the three chart blocks each board carries,
 * glue is 1.98 s of 10.08 s of chart-block time on tech-zh (19.6%) and
 * 1.90 s of 9.60 s on pitch-zh (19.8%); per block it runs ~23% on the
 * skeleton frame and ~16% on the two accumulation layers. The comparison
 * that decides it is the same boards' prose rhythm: prose spends 31.4% /
 * 32.4% of its time pen-up. A chart therefore breathes noticeably LESS
 * than narration, which is the intended feel — the skeleton stands up in
 * one motion and each series then draws through — and no individual
 * constant stood out against that band. Final values stay the product
 * owner's; measured here so a later pass can tell "measured and fine"
 * from "never looked at".
 */
export const CHART_GLUE = {
  /** Pen-up pause after each of the two axis lines. */
  afterAxisLine: 0.08,
  /** Extra breath once the whole skeleton (axes + ticks + labels) stands. */
  afterSkeleton: 0.12,
  /** Pause between serialized ticks / axis labels / mark & note rows. */
  afterEntry: 0.08,
  /** Pause after writing a series name label (prototype `+ .15`). */
  afterSeriesLabel: 0.15,
  /** Tail breath after the chart block's last unit (prototype `+ .2`). */
  tail: 0.2,
  /** I5 — accumulation layers get the softer lead: chartLead × THIS. */
  layerLeadFactor: 0.6,
} as const;

/**
 * Intra-graph glue pauses (seconds) — the graph's counterpart to
 * `CHART_GLUE`, and kept OUT of the frozen `DurationConstants` contract for
 * the same reason (engine-contract.test.ts instantiates that interface;
 * extending it would be a contract change, and T12 is a feature task).
 *
 * The rhythm these encode is a person drawing a flow chart: box, name, box,
 * name — a short beat between the two halves of one node, a longer one
 * before the next node goes up — and then the arrows, which come as a run
 * once the boxes stand. Initial values are the chart glue's neighbours
 * (nothing on this board should breathe on a scale the chart does not
 * already use); T5's calibration pass owns the final numbers, and it edits
 * this one file.
 */
export const GRAPH_GLUE = {
  /** Pen-up between a box and the name written into it. */
  afterBox: 0.08,
  /** Breath after a finished node, before the next box goes up. */
  afterNode: 0.12,
  /** Extra breath once every box of this block stands, before the arrows. */
  beforeEdges: 0.12,
  /** Pause between consecutive arrows. */
  afterEdge: 0.08,
  /** Tail breath after the graph block's last unit (mirrors CHART_GLUE). */
  tail: 0.2,
} as const;

/**
 * A drawn figure's timing (I1) — the illustration's counterpart to
 * `CHART_GLUE`, and kept OUT of the frozen `DurationConstants` contract for
 * the same reason (engine-contract.test.ts instantiates that interface;
 * extending it would be a contract change).
 *
 * WHAT THE TIME IS A FUNCTION OF — and what it deliberately is NOT. A
 * figure is drawn across its own width, and its width is always the width
 * of the space it stands in, so the only thing that varies from figure to
 * figure is how TALL it is for that width: the declared aspect. Time is a
 * function of that declared number and of the constants below, and of
 * nothing else.
 *
 * Not of pixels, and this is load-bearing rather than stylistic: the same
 * lecture must compile to a byte-identical timeline at every window size
 * (the two-width gate). A time derived from a measured box would make the
 * schedule a function of the browser's layout, and a time derived from the
 * loaded file's own size would additionally make it a function of WHEN
 * that file arrived. Both are R8 violations; the declared aspect is
 * neither.
 */
export const IMAGE_GLUE = {
  /**
   * A SQUARE figure's drawing time — the reference. Sits above one chart
   * series (1.45 s) and below a whole chart skeleton: a figure is one
   * continuous piece of drawing, bigger than a line and smaller than a
   * built diagram. T5-family initial value.
   */
  sweep: 2.4,
  /** Tail breath after the figure lands (mirrors `CHART_GLUE.tail`). */
  tail: 0.2,
  /**
   * Bounds on the tallness factor (height ÷ width). A letterbox banner
   * still reads as a drawing rather than a flick, and a freak column
   * cannot stall the board for a minute.
   */
  minTallness: 0.5,
  maxTallness: 2,
  /**
   * The aspect the PURE plan assumes before any figure is built — the
   * square reference. The plan cannot see the sidecar (it is a function of
   * the document alone), so it schedules the reference and the built
   * figure reports its real, aspect-derived time through the ordinary
   * measured-wins-per-unit channel (`engine/timeline.ts`). Same shape as
   * `CAMERA_FALLBACK`.
   */
  nominalAspect: 1,
} as const;

/**
 * I1 — one drawn figure's time, from its DECLARED aspect (width ÷ height).
 * Total over its input domain: an aspect that is not a positive finite
 * number falls back to the square reference rather than producing NaN
 * (unreachable past the manifest reader, kept defensive).
 */
export function imageDuration(aspect: number): number {
  const usable = Number.isFinite(aspect) && aspect > 0 ? aspect : IMAGE_GLUE.nominalAspect;
  const tallness = Math.min(
    Math.max(1 / usable, IMAGE_GLUE.minTallness),
    IMAGE_GLUE.maxTallness,
  );
  return IMAGE_GLUE.sweep * tallness;
}

/**
 * Borrowed-constant aliases — non-chart units whose INITIAL timing happens
 * to equal a chart-skeleton constant. The coupling is declared here, in the
 * one calibration file, so a T5 pass retiming the chart skeleton can SEE
 * every non-chart borrower and break an alias (give it its own value)
 * instead of silently retiming rules, bullets and images too — call sites
 * never reach for `d.axis` / `d.tick` / `d.label` outside the chart
 * domain. Reading through `DurationConstants` keeps them host-tunable.
 */

/** A hand-drawn line: `---` and a heading's baseline (§4.3). */
export const ruleDuration = (d: DurationConstants): number => d.axis;

/**
 * An aside's hand-drawn margin bar (§4.3 旁注) — the aside's counterpart to
 * the list item's 手绘弹点, and it borrows the BULLET's time, not
 * `ruleDuration`'s: both are a short marker flick that declares the block
 * before its text arrives, where `---` and a heading baseline are
 * full-width pulls. Spending d.axis (0.4 s) on a ~40 px bar would read as a
 * crawl next to the 13 glyphs/s the same hand writes at. Declared as an
 * alias like every other borrower so a T5 pass retiming the chart skeleton
 * SEES it.
 */
export const asideBarDuration = (d: DurationConstants): number => d.tick;

/**
 * The pen-lift before a heading's 手绘底线 is drawn. Borrows `annotDelay`
 * (the pen-lands delay of the ANNOTATION rhythm) — declared as an alias so
 * a T5 pass retiming annotations sees this borrower and can break the
 * coupling instead of silently retiming every heading's baseline lift too.
 */
export const headingBaselineLift = (d: DurationConstants): number =>
  d.annotDelay;

/** A list item's hand-drawn bullet dot (§4.3 手绘弹点). */
export const bulletDuration = (d: DurationConstants): number => d.tick;

/**
 * A graph node's hand-drawn box, and one arrow between two boxes. Both are
 * a single framing stroke, so they borrow the chart's axis-line time —
 * declared as aliases (like `ruleDuration`) so a T5 pass retiming the chart
 * skeleton SEES these borrowers and can break the coupling instead of
 * silently retiming every flow chart on every board too.
 */
export const graphBoxDuration = (d: DurationConstants): number => d.axis;
export const graphEdgeDuration = (d: DurationConstants): number => d.axis;

/**
 * The camera step's PLAN-side fallback duration (seconds) — the value the
 * pure plan carries before the host has measured any geometry. The real
 * duration is the Van Wijk arc length of the move (`engine/stage.ts`),
 * applied through the G3 override channel; that channel rescales the
 * step's natural footprint, so this fallback MUST stay > 0 — a zero here
 * would make the override's `naturalTotal > 0` guard reject the measured
 * value and pin every camera step at zero seconds. Kept out of the frozen
 * `DurationConstants` contract like `CHART_GLUE`: hosts tune the metric
 * (`cameraRho` / `cameraSpeed`), not the unmeasured placeholder.
 */
export const CAMERA_FALLBACK = 0.9;

/**
 * I9 — the CJK reveal-segment width, in CODE POINTS: CJK-bearing tokens
 * slice into pieces of this many characters ("中文按 1–2 字切成揭示单元" —
 * G10 states this rule 比常数本身更重要: it sets the unit count and with it
 * the whole 一笔一笔 cadence). It lives HERE, next to the other rhythm
 * knobs, so a T5 recalibration pass cannot miss it; `inference.ts`
 * (`splitRevealSegments`) is the sole consumer.
 */
export const CJK_SEGMENT_CHARS = 2;

/** Prototype `isCJK` — does the token carry CJK/kana glyphs at all? */
const HAS_CJK = /[一-鿿぀-ヿ]/;

/** Prototype cjk counter — only Han chars carry the cjkBoost weight. */
const CJK_CHAR = /[一-鿿]/g;

/** True when the token should be sliced into 1–2 char segments (I9). */
export function hasCjk(token: string): boolean {
  return HAS_CJK.test(token);
}

/**
 * I8 — one written segment's reveal time (prototype `wordDur`):
 * `wordBase + (cjkChars × cjkBoost + latinChars) × perChar`.
 */
export function wordDuration(text: string, d: DurationConstants): number {
  const t = text.trim();
  if (!t) return 0;
  const cjk = (t.match(CJK_CHAR) ?? []).length;
  // Code points, not UTF-16 units — an astral char (emoji, CJK-ext) is one
  // written glyph and must be billed as one char, not two.
  const chars = [...t].length;
  return d.wordBase + (cjk * d.cjkBoost + (chars - cjk)) * d.perChar;
}

/** Comma-class trailing punctuation (prototype `/[，,、；;]$/`). */
const TRAILING_COMMA = /[，,、；;]$/;

/** Sentence-ending trailing punctuation (prototype `/[。.!?！？]$/`). */
const TRAILING_PERIOD = /[。.!?！？]$/;

/** Any pause-carrying punctuation — the I9 chunk boundary inside CJK text. */
const PAUSE_CHAR = /[，,、；;。.!?！？]/;

/**
 * True when the char carries an I1 pause (comma or sentence class). CJK
 * segmentation cuts AFTER such a char so the punctuation ends its segment —
 * blind 2-char slicing would glue "。" onto the NEXT chars ("。然") and
 * silently lose both the period pause (I1) and the I2 sentence-flush
 * boundary. The prototype had this artifact; the rev-4 rules ("句末标点带
 * 自然停顿", "写完本句后") make the pause load-bearing, so the cut is spec.
 */
export function isPauseChar(ch: string): boolean {
  return PAUSE_CHAR.test(ch);
}

/** Cut-without-pause punctuation: the colon of a "label:value" pair. */
const CUT_ONLY_CHAR = /[:：]/;

/**
 * 禁则 (kinsoku) — the two classes of punctuation that may not stand alone
 * at a line boundary: a CLOSING mark may never BEGIN a line, an OPENING
 * mark may never END one. Every writing system this board carries obeys
 * the rule; it is not a Chinese-only convention (`)` `,` `.` break exactly
 * the same way), so both sets carry the fullwidth and the ASCII forms.
 *
 * A browser enforces this for free INSIDE text — and cannot enforce it
 * here, because every revealed segment is its own `inline-block` (the
 * reveal clip needs a box). Blink feeds each atomic inline to the UAX14
 * breaker as U+FFFC, class CB, and LB20 breaks freely around CB: the mode's
 * own per-word reveal is what destroys the rule. Measured 2026-08-12: a
 * WORD JOINER between the two boxes does NOT restore it (LB11 loses to the
 * atomic-inline handling), and neither does making the mark `display:
 * inline`. So the rule has to be enforced where the units are decided —
 * `splitRevealSegments` merges a lone mark into the neighbour it belongs
 * to — with a `white-space: nowrap` group in `factories/prose.ts` for the
 * one residue the segmenter structurally cannot reach (a mark whose whole
 * RUN is punctuation: `**先验 × 似然 → 后验**。` puts the full stop in its
 * own text run, and merging across that boundary would make the srcSpan
 * swallow the `**` markers — G6 says a unit's span is its exact source
 * slice).
 *
 * Set membership is CORPUS-DRIVEN, and the corpus was read rather than
 * imagined: every reveal unit of the four shipped seeds plus the four wall
 * boards was planned and every mark-only unit inspected (86 of them).
 * Closing = pause punctuation, label colons, closing brackets and quotes,
 * the ellipsis, and the percent sign — 行頭禁則 covers `%‰℃`, and the
 * corpus produced a real `%，` unit (a bolded number's tail, `**20**%，`)
 * that would otherwise have been free to open a line. The mirror set is
 * the opening brackets and quotes.
 *
 * Three deliberate exclusions, each with corpus hits:
 *  - `—` / `——` (34 units): UAX14 class B2, a legitimate break opportunity
 *    on BOTH sides. A dash ending a line is how the boards already read.
 *  - `=` and `+` (one each): arithmetic, not punctuation. A line beginning
 *    `= 594` is ordinary setting; forbidding it would be inventing a rule.
 *  - Straight `"` / `'`: both halves of the pair, and no rule can tell
 *    which one a given occurrence is.
 */
const CLOSING_PUNCT = /^[、。，．,.!?！？；;：:）)】〕》〉」』｝}］\]”’…%％]+$/;
const OPENING_PUNCT = /^[（(【〔《〈「『｛{［\[“‘]+$/;

/** Is this segment nothing but marks that may never BEGIN a line? */
export function isClosingPunctuation(text: string): boolean {
  return CLOSING_PUNCT.test(text);
}

/** Is this segment nothing but marks that may never END a line? */
export function isOpeningPunctuation(text: string): boolean {
  return OPENING_PUNCT.test(text);
}

/**
 * The full I9 chunk-boundary set: pause punctuation PLUS label colons.
 * Colons must end their segment for the §4.3 align marker to have a
 * boundary to land on — blind 2-char slicing glues "：" onto the value's
 * first char whenever the label has an EVEN char count ("性质:结" vs
 * "权:"), so exactly half of all labels would silently never align.
 * Unlike comma/period the colon adds NO pause (`segmentGapAfter` checks
 * the trailing-comma/period classes only): it is a cut, not a beat.
 */
export function isSegmentCutChar(ch: string): boolean {
  return PAUSE_CHAR.test(ch) || CUT_ONLY_CHAR.test(ch);
}

/**
 * I1 — the pen-up pause after one revealed segment: the inter-WORD gap
 * (G10: `gap` is 词间隙, not 单元间隙), plus the natural comma / sentence
 * pause when the segment ends with punctuation.
 */
export function segmentGapAfter(text: string, d: DurationConstants): number {
  let g = d.gap;
  if (TRAILING_COMMA.test(text)) g += d.comma;
  if (TRAILING_PERIOD.test(text)) g += d.period;
  return g;
}

/** Does this segment end the sentence (I2 ink-flush boundary)? */
export function endsSentence(text: string): boolean {
  return TRAILING_PERIOD.test(text);
}

/**
 * A formula's content-derived reveal time: the TeX source minus whitespace,
 * weighted like one long written word.
 *
 * This is the ONLY source of a formula's duration today — the math factory
 * schedules `planStepUnits`' value and never measures the rendered box, so
 * (contrary to what this comment used to claim) nothing overrides it. TeX
 * source length is a noisy proxy for rendered width in BOTH directions:
 * `\frac{}{}` is 6 chars of markup that renders as a fraction bar, while
 * `\alpha` is 6 chars that render as one glyph. Measured on the T5 boards
 * once the clip box was fixed to hug the formula, the resulting rates land
 * inside the prose range (S(n): 229px/0.70s ≈ 330 px/s; C(n): 408px/0.90s
 * ≈ 450 px/s; prose ≈ 430–450 px/s), so it is left alone. The principled
 * lever is the G3 measurement-override channel (`MeasureContext`), which
 * T10 opens for audio anyway — a rendered-width measurement rides the same
 * seam without a second timeline.
 */
export function mathDuration(tex: string, d: DurationConstants): number {
  return wordDuration(tex.replace(/\s+/g, ""), d);
}
