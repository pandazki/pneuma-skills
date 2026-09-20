/**
 * Screenplay typography, derived from ordinary markdown.
 *
 * The agent writes `screenplay.md` as markdown — that is the file the creator
 * reads, edits and hands to anybody else — so the viewer does NOT invent a
 * second format. It classifies each block the way a script page is set:
 * scene headings, character cues, parentheticals, dialogue and action.
 *
 * The rules are deliberately shallow and reversible. Anything the classifier
 * is not sure about is ACTION, the neutral setting, and a block with list or
 * table syntax is handed back to the markdown renderer whole. Nothing is
 * dropped and no text is rewritten: the worst case is a paragraph set as
 * action that a typesetter would have centred.
 */

export type ScreenplayBlockKind =
  | "scene"
  | "cue"
  | "parenthetical"
  | "dialogue"
  | "action"
  | "markdown";

export interface ScreenplayBlock {
  kind: ScreenplayBlockKind;
  text: string;
  /** Heading depth for `scene`, 1..6. */
  level?: number;
}

/** `- x`, `* x`, `1. x`, `| a | b |`, `` ``` `` — leave these to markdown. */
const MARKDOWN_BLOCK = /^(\s*([-*+]|\d+\.)\s|\||```|\s{4})/;

/**
 * A line that names who speaks next.
 *
 * Three spellings are accepted because three are in the wild: `**KAI**` (what
 * an agent writing markdown reaches for), `KAI` (what a script page looks
 * like), and `小凯：` (what a Chinese screenplay looks like). Length is
 * capped so a shouted line of action is not mistaken for a name.
 */
const CUE_BOLD = /^\*\*([^*]{1,40})\*\*[:：]?$/;
const CUE_CAPS = /^[A-Z][A-Z0-9 .'’\-()]{0,39}$/;
const CUE_CJK = /^[^\s（(]{1,16}[:：]$/;
/** `小凯：还开着吗？` — the name and its line on one line, as Chinese writes it. */
const CUE_INLINE = /^(\*\*)?([^\s*（(：:]{1,16})(\*\*)?[：:]\s*(\S.*)$/;

/** The name a line names, or null. `rest` is the speech on the same line. */
function cueOf(line: string): { name: string; rest: string } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const bold = trimmed.match(CUE_BOLD);
  if (bold) return { name: bold[1].trim(), rest: "" };
  // `INT.`/`EXT.` slug lines are scene headings, not names, even in caps.
  if (/^(INT|EXT|I\/E)[. ]/.test(trimmed)) return null;
  if (CUE_CAPS.test(trimmed) && /[A-Z]{2,}/.test(trimmed)) {
    return { name: trimmed.replace(/[:：]$/, ""), rest: "" };
  }
  if (CUE_CJK.test(trimmed)) return { name: trimmed.replace(/[:：]$/, ""), rest: "" };
  const inline = trimmed.match(CUE_INLINE);
  // `他说：“还开着吗？”` is narration, not a cue — prose attribution quotes
  // what was said, a screenplay cue does not. Everything else that starts
  // with a short name and a colon is read as a cue.
  if (inline && !/^["“「『'']/.test(inline[4])) {
    return { name: inline[2].trim(), rest: inline[4].trim() };
  }
  return null;
}

function isParenthetical(line: string): boolean {
  const trimmed = line.trim();
  return /^[(（].*[)）]$/.test(trimmed);
}

/**
 * Split `markdown` into typeset blocks.
 *
 * A cue "opens" dialogue: the lines under it in the same block, and the block
 * after it, are set as speech until an empty line follows something that is
 * not a cue, a parenthetical or dialogue.
 */
export function screenplayBlocks(markdown: string): ScreenplayBlock[] {
  const out: ScreenplayBlock[] = [];
  const paragraphs = markdown.replace(/\r\n/g, "\n").split(/\n{2,}/);
  let speaking = false;

  for (const paragraph of paragraphs) {
    const block = paragraph.replace(/\s+$/, "");
    if (block.trim().length === 0) continue;

    const lines = block.split("\n");
    const first = lines[0].trim();

    const heading = first.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      out.push({ kind: "scene", text: heading[2].trim(), level: heading[1].length });
      // Everything after the heading line in the same block is action.
      const rest = lines.slice(1).join("\n").trim();
      if (rest.length > 0) out.push({ kind: "action", text: rest });
      speaking = false;
      continue;
    }

    if (MARKDOWN_BLOCK.test(lines[0])) {
      out.push({ kind: "markdown", text: block });
      speaking = false;
      continue;
    }

    // A quoted block is speech wherever it appears — that is what `>` is for
    // in a screenplay written as markdown. It carries its own line, so the
    // block after it starts fresh.
    if (first.startsWith(">")) {
      out.push({
        kind: "dialogue",
        text: lines.map((l) => l.replace(/^\s*>\s?/, "")).join("\n").trim(),
      });
      speaking = false;
      continue;
    }

    // A cue keeps the floor only until its line arrives: when the speech is
    // in the same block, the next block is action again. A cue standing
    // alone means the line is in the block below it.
    //
    // A parenthetical may come BEFORE the name (`（很轻）` then `店员：`),
    // which is how a direction addressed to the reader is often written; the
    // leading run is emitted first and the cue is still found.
    let head = 0;
    while (head < lines.length && isParenthetical(lines[head])) head += 1;
    const cue = head < lines.length ? cueOf(lines[head]) : null;
    if (cue !== null) {
      for (let i = 0; i < head; i += 1) {
        out.push({ kind: "parenthetical", text: lines[i].trim() });
      }
      out.push({ kind: "cue", text: cue.name });
      let index = head + 1;
      while (index < lines.length && isParenthetical(lines[index])) {
        out.push({ kind: "parenthetical", text: lines[index].trim() });
        index += 1;
      }
      const tail = lines.slice(index).join("\n").trim();
      const rest = [cue.rest, tail].filter((part) => part.length > 0).join("\n");
      if (rest.length > 0) out.push({ kind: "dialogue", text: rest });
      speaking = rest.length === 0;
      continue;
    }

    if (isParenthetical(first) && speaking) {
      out.push({ kind: "parenthetical", text: first });
      const rest = lines.slice(1).join("\n").trim();
      if (rest.length > 0) out.push({ kind: "dialogue", text: rest });
      speaking = rest.length === 0;
      continue;
    }

    if (speaking) {
      out.push({ kind: "dialogue", text: block.trim() });
      speaking = false;
      continue;
    }

    out.push({ kind: "action", text: block.trim() });
  }

  return out;
}

/** Cheap test for "does this text need the markdown renderer at all". */
export function hasInlineMarkdown(text: string): boolean {
  return /[*_`[\]]/.test(text);
}
