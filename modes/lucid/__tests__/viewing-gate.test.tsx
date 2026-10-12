/** @jsxImportSource react */
/**
 * No request controls without an agent to receive them.
 *
 * A local `--viewing` session starts no agent. Until the shell passed
 * `editing` in the editor layout (`src/hooks/useViewerProps.tsx`), this
 * viewer rendered with `editing` undefined there and offered its commands to
 * nobody; a press queued a notification for whichever agent started next.
 * The shell half is pinned by
 * `src/hooks/__tests__/useViewerProps.editing.test.tsx`; this is the viewer
 * half: given `editing: false`, the command buttons are not there.
 *
 * Rendered through `react-dom/server`: the gate is decided on the first
 * render, and the scene's effects are not what is under test.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { loadLoops } from "../domain.js";
import manifest from "../manifest.js";
import LucidPreview from "../viewer/LucidPreview.js";
import { CostPanel } from "../viewer/CostPanel.js";
import { summarizeCosts } from "../skill/scripts/costs.mjs";

const SHRINE = readFileSync(join(import.meta.dir, "fixtures", "lantern-shrine.json"), "utf-8");

const still = (value: unknown) => ({
  current: () => value,
  subscribe: () => () => {},
  write: async () => {},
  destroy() {},
});

function stage(over: Partial<ViewerPreviewProps>): string {
  const loops = loadLoops([{ path: "lantern-shrine/lucid.json", content: SHRINE }]);
  const props = {
    sources: { loops: still(loops), sceneFiles: still([]), falJobs: still([]) },
    files: [],
    selection: null,
    onSelect: () => {},
    mode: "view",
    imageVersion: 0,
    commands: manifest.viewerApi?.commands,
    onNotifyAgent: () => {},
    theme: "dark",
    locale: "en",
    ...over,
  } as unknown as ViewerPreviewProps;
  return renderToStaticMarkup(<LucidPreview {...props} />);
}

const LABELS = (manifest.viewerApi?.commands ?? []).map((c) => c.label);

describe("lucid's request controls", () => {
  test("an editing session shows the commands", () => {
    expect(LABELS.length).toBeGreaterThan(0);
    const html = stage({ editing: true });
    for (const label of LABELS) expect({ label, shown: html.includes(`>${label}<`) }).toEqual({ label, shown: true });
  });

  test("a viewing-only session shows none of them", () => {
    const html = stage({ editing: false });
    for (const label of LABELS) expect({ label, shown: html.includes(`>${label}<`) }).toEqual({ label, shown: false });
  });

  test("nor does a replay", () => {
    const html = stage({ editing: true, readonly: true });
    for (const label of LABELS) expect({ label, shown: html.includes(`>${label}<`) }).toEqual({ label, shown: false });
  });
});

describe("Lucid image cost receipts", () => {
  test("the viewer attributes saved OpenRouter costs only to the active project", () => {
    const receipt = (cost: number) => JSON.stringify({ model: "openai/gpt-image-2.5-flare", files: ["image.png"], usage: { cost } });
    const html = stage({
      editing: false,
      sources: {
        loops: still(loadLoops([{ path: "lantern-shrine/lucid.json", content: SHRINE }])),
        sceneFiles: still([]), falJobs: still([]),
        imageReceipts: still([
          { path: "lantern-shrine/assets/image-receipts/target.json", content: receipt(0.07) },
          { path: "other-project/assets/image-receipts/target.json", content: receipt(9) },
          { path: "lantern-shrine/assets/image-receipts/broken.json", content: "{" },
        ]),
      } as unknown as ViewerPreviewProps["sources"],
    });
    expect(html).toContain("Cost so far: $0.07 (reported + estimated)");
  });

  test("the panel distinguishes missing prices from reported image costs", () => {
    const summary = summarizeCosts({ imageReceipts: [
      { model: "openai/gpt-image-2.5-flare", files: ["one.png", "two.png"], usage: { cost: 0.08 } },
      { model: "openai/gpt-image-2.5-sunburst", files: ["edited.png"] },
    ] });
    const html = renderToStaticMarkup(<CostPanel summary={summary} open={true} onClose={() => {}} />);
    expect(html).toContain("Known cost so far");
    expect(html).toContain("$0.08");
    expect(html).toContain("1 unpriced");
    expect(html).toContain("without usage costs are excluded");
    expect(html).not.toContain("flat $");
  });
});
