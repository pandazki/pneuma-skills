/**
 * Prompt — the prompt pack, with a copy button on the one part that is
 * literal.
 *
 * `prompts.md` is prose the agent wrote plus a fenced ```prompt block that is
 * the EXACT text the video model receives; `previz.mjs generate` reads that
 * same block. The copy button copies the block, not the page, so what lands
 * on the clipboard is what the model would get.
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CopyIcon, CheckIcon } from "../icons.js";
import { extractPromptBlock } from "../stage-model.js";

export interface PromptTabProps {
  markdown: string | null;
  dark: boolean;
}

export function PromptTab({ markdown, dark }: PromptTabProps) {
  const [copied, setCopied] = useState(false);
  const prompt = markdown ? extractPromptBlock(markdown) : null;

  const copy = () => {
    if (!prompt) return;
    void navigator.clipboard
      ?.writeText(prompt)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        /* a denied clipboard is not worth an error state — the text is
           visible below and selectable */
      });
  };

  if (!markdown) {
    return (
      <p className="text-[11px] leading-relaxed text-cc-muted">
        No <code>prompts.md</code> yet. The prompt pack is written against the greybox — the look,
        the fenced prompt the model receives, and the constraints it must not break.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {prompt ? (
        <section className="rounded-md border border-cc-border bg-cc-card">
          <header className="flex items-center gap-2 border-b border-cc-border px-2 py-1.5">
            <h3 className="text-[11px] font-medium text-cc-fg">The prompt the model receives</h3>
            <button
              type="button"
              onClick={copy}
              title="Copy the fenced prompt block"
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-cc-border px-2 py-0.5 text-[10px] text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary/60"
            >
              {copied ? <CheckIcon size={10} /> : <CopyIcon size={10} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </header>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-2 py-2 text-[11px] leading-relaxed text-cc-fg">
            {prompt}
          </pre>
        </section>
      ) : (
        <p className="rounded-md border border-cc-warning/40 bg-cc-warning/10 px-2.5 py-2 text-[11px] leading-relaxed text-cc-fg">
          <code>prompts.md</code> has no fenced <code>prompt</code> block, which is the block
          <code> generate</code> reads. Until it is there, no take can be submitted.
        </p>
      )}

      <div
        // A prompt is one very long line; an unwrapped `pre` would run off
        // the panel with no scrollbar the user can find.
        className={`prose prose-sm max-w-none text-[12px] [&_pre]:whitespace-pre-wrap [&_pre]:break-words ${
          dark ? "prose-invert prose-neutral" : "prose-neutral"
        }`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
}

export default PromptTab;
