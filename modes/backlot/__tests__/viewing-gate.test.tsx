/** @jsxImportSource react */
/**
 * No request controls without an agent to receive them.
 *
 * A local `--viewing` session starts no agent. Until the shell passed
 * `editing` in the editor layout (`src/hooks/useViewerProps.tsx`), this
 * viewer rendered with `editing` undefined there and offered "Check this
 * greybox" and "Generate a take" to nobody; a press queued a notification for
 * whichever agent started next. The shell half is pinned by
 * `src/hooks/__tests__/useViewerProps.editing.test.tsx`; this is the viewer
 * half: given `editing: false`, the shot's command row is not there.
 *
 * Rendered through `react-dom/server`: the gate is decided on the first
 * render, and the players' effects are not what is under test.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { loadFilm } from "../domain.js";
import manifest from "../manifest.js";
import BacklotPreview from "../viewer/BacklotPreview.js";

const MANIFEST = JSON.stringify({
  version: 1,
  title: "Launch",
  defaults: { seconds: 2, fps: 24, width: 320, height: 180 },
  shots: ["a"],
});
const SHOT = JSON.stringify({
  version: 1,
  id: "a",
  title: "A",
  spec: { seconds: 2, fps: 24, width: 320, height: 180, frames: 48 },
  takes: [{ id: "take-01", status: "done", file: "takes/take-01.mp4", selected: true }],
});

const still = (value: unknown) => ({
  current: () => value,
  subscribe: () => () => {},
  write: async () => {},
  destroy() {},
});

function stage(over: Partial<ViewerPreviewProps>): string {
  const film = loadFilm([
    { path: "film/backlot.json", content: MANIFEST },
    { path: "film/shots/a/shot.json", content: SHOT },
  ]);
  const props = {
    sources: { film: still(film), docs: still([]), metas: still([]) },
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
  return renderToStaticMarkup(<BacklotPreview {...props} />);
}

const SHOT_COMMANDS = (manifest.viewerApi?.commands ?? [])
  .filter((c) => c.id !== "approve-stage")
  .map((c) => c.label);

describe("backlot's request controls", () => {
  test("an editing session shows the shot's commands", () => {
    expect(SHOT_COMMANDS.length).toBeGreaterThan(0);
    const html = stage({ editing: true });
    for (const label of SHOT_COMMANDS) expect({ label, shown: html.includes(label) }).toEqual({ label, shown: true });
  });

  test("a viewing-only session shows none of them", () => {
    const html = stage({ editing: false });
    for (const label of SHOT_COMMANDS) expect({ label, shown: html.includes(label) }).toEqual({ label, shown: false });
  });

  test("nor does a replay", () => {
    const html = stage({ editing: true, readonly: true });
    for (const label of SHOT_COMMANDS) expect({ label, shown: html.includes(label) }).toEqual({ label, shown: false });
  });
});
