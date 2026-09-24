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
