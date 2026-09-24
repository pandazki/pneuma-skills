/** @jsxImportSource react */
/**
 * No request controls without an agent to receive them.
 *
 * A local `--viewing` session starts no agent. Until the shell passed
 * `editing` in the editor layout (`src/hooks/useViewerProps.tsx`), the stage
 * rendered with `editing` undefined there and offered its commands — and the
 * Export tab its Generate buttons and MP4 colour — to nobody. The shell half
 * is pinned by `src/hooks/__tests__/useViewerProps.editing.test.tsx`, the
 * Export tab's rows by `canAskAgent` in viewer-logic; this is the stage
 * itself, rendered with the flag the shell now passes.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { loadRoster } from "../domain.js";
import manifest from "../manifest.js";
import SpritePreview from "../viewer/SpritePreview.js";

const MINI = readFileSync(join(import.meta.dir, "fixtures", "mini", "project.json"), "utf-8");

const still = (value: unknown) => ({
  current: () => value,
  subscribe: () => () => {},
  write: async () => {},
  destroy() {},
});

function stage(over: Partial<ViewerPreviewProps>): string {
  const roster = loadRoster([{ path: "mini/project.json", content: MINI }]);
  const props = {
    sources: { roster: still(roster) },
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
  return renderToStaticMarkup(<SpritePreview {...props} />);
}

/** The stage's command bar: every declared command but the Export tab's. */
const BAR = (manifest.viewerApi?.commands ?? []).filter((c) => c.id !== "export").map((c) => c.label);

describe("sprite's request controls", () => {
  test("an editing session shows the command bar", () => {
    const html = stage({ editing: true });
    expect(BAR.some((label) => html.includes(label))).toBe(true);
  });

  test("a viewing-only session shows none of it", () => {
    const html = stage({ editing: false });
    for (const label of BAR) expect({ label, shown: html.includes(label) }).toEqual({ label, shown: false });
  });
});
