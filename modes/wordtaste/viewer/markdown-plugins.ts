/**
 * One markdown pipeline for the whole writing room.
 *
 * WordTaste renders markdown in more than one place — the draft, the
 * candidate a reader is choosing between, the source material rail, the
 * remembered voice floor — and a reader who sees `$\mathbb{J}$` typeset in
 * the draft but printed as source in the rail beside it learns that the
 * surface is unreliable. So the plugin list is a value, defined once, and
 * every `<ReactMarkdown>` in the viewer takes these two constants; adding a
 * surface means passing them, not re-deciding them.
 *
 * `remark-math` keeps `singleDollarTextMath` at its default (on), because
 * the essays this mode is written for use `$x$` inline constantly. The cost
 * is stated rather than hidden: two bare dollar amounts in one paragraph
 * ("从 $100 涨到 $200") read as one inline formula. A lone `$100` is safe —
 * math needs a closing delimiter — and the alternative, turning single
 * dollars off, would leave every inline formula in a technical draft as raw
 * TeX. `modes/wordtaste/__tests__/viewer-math.test.tsx` pins both halves.
 *
 * KaTeX options, and why each one is here:
 *   - `errorColor: "currentColor"` — rehype-katex hands unparsable TeX back
 *     to KaTeX with `throwOnError: false`, which paints the source in this
 *     colour. The default `#cc0000` puts a red alarm in the middle of a
 *     paragraph the writer is reading for rhythm; prose colour degrades to
 *     what the author typed, which is the honest failure.
 *   - `strict: false` — unknown-but-harmless constructs (a Unicode glyph
 *     TeX has no command for, `\newline` in inline math) become silent
 *     passes instead of console noise on every keystroke of a live draft.
 *   - `trust` is deliberately left at its default (false): a draft is
 *     agent-written content, and `\href` / `\includegraphics` / `\htmlClass`
 *     must not be a way for it to inject links or classes into the shell.
 *
 * No React and no CSS import in this file on purpose — the tests import it
 * directly under `bun test`, where a bundler is not there to resolve
 * `katex/dist/katex.min.css`. That stylesheet is loaded by the component
 * that mounts these plugins (`WordtastePreview.tsx`); KaTeX's HTML output
 * is unreadable without it.
 */

import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/** GitHub-flavoured markdown, plus `$…$` / `$$…$$` recognition. */
export const WORDTASTE_REMARK_PLUGINS: NonNullable<
  ReactMarkdownOptions["remarkPlugins"]
> = [remarkGfm, remarkMath];

/** KaTeX typesetting for whatever `remark-math` found. */
export const WORDTASTE_REHYPE_PLUGINS: NonNullable<
  ReactMarkdownOptions["rehypePlugins"]
> = [[rehypeKatex, { errorColor: "currentColor", strict: false }]];
