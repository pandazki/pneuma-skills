/**
 * The renderer overrides every markdown surface in the writing room shares.
 *
 * There is exactly one of them today: the asset slot. WordTaste writes text
 * and only text, so where a piece needs something that is not a sentence the
 * writer describes it instead of making it — a fenced `asset` block saying
 * what belongs there and what words that thing has to carry (see
 * `parseAssetSlot` in `domain.ts`). Printed as a code block it reads like a
 * machine artifact dropped into an essay; printed as a card it reads like
 * what it is, a place held open for something that does not exist yet.
 *
 * Kept apart from `markdown-plugins.ts`, which is deliberately React-free so
 * the tests can import it under `bun test` with no bundler. This file is JSX
 * and belongs to the component that mounts it.
 */

import type { ComponentPropsWithoutRef } from "react";
import type { ExtraProps, Options as ReactMarkdownOptions } from "react-markdown";
import { ASSET_FENCE_LANG, parseAssetSlot, type AssetSlot } from "../domain.js";

/**
 * Pull the fenced block's language and raw text out of the hast node behind a
 * `<pre>`. Reading the node rather than the rendered children is what makes
 * this exact: by the time react-markdown has built children, the block's text
 * has been split into elements and the info string lives in a className array.
 */
function readFence(node: unknown): { lang: string | null; value: string } | null {
  const pre = node as { children?: Array<Record<string, unknown>> } | undefined;
  const code = pre?.children?.[0];
  if (!code || code.tagName !== "code") return null;
  const properties = code.properties as { className?: unknown } | undefined;
  const classNames = Array.isArray(properties?.className)
    ? (properties.className as unknown[]).filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const text = (code.children as Array<{ type?: string; value?: unknown }> | undefined)?.[0];
  if (typeof text?.value !== "string") return null;
  const lang = classNames
    .map((name) => (name.startsWith("language-") ? name.slice("language-".length) : null))
    .find((name): name is string => name !== null) ?? null;
  return { lang, value: text.value };
}

function AssetCard({ slot }: { slot: AssetSlot }) {
  return (
    <div className="wordtaste-asset" data-asset="">
      <span className="wordtaste-asset-label">Asset</span>
      <p className="wordtaste-asset-what">{slot.what}</p>
      {slot.copy.length > 0 && (
        <>
          <span className="wordtaste-asset-label">Copy</span>
          <ol className="wordtaste-asset-copy">
            {slot.copy.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/**
 * A fenced block, as a card when it is a parsable asset slot and as the code
 * block it always was otherwise. A malformed slot staying visible is the
 * point: one the author can see is one they can fix, one the renderer
 * swallowed is not.
 */
function Pre({ node, children, ...props }: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
  const fence = readFence(node);
  if (fence?.lang === ASSET_FENCE_LANG) {
    const slot = parseAssetSlot(fence.value);
    if (slot) return <AssetCard slot={slot} />;
  }
  return <pre {...props}>{children}</pre>;
}

export const WORDTASTE_MARKDOWN_COMPONENTS: NonNullable<
  ReactMarkdownOptions["components"]
> = { pre: Pre };
