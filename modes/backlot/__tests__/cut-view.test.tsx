/** @jsxImportSource react */
/**
 * The Cut stage's header (`CutView.tsx`): which film is on screen.
 *
 * Pinned by a real run (2026-09-24, the tanka-launch film): the finished film
 * — a web composition layer, dissolves, speed ramps and its own mix over the
 * plain assembly — was copied over `cut/final.mp4` by hand, and nothing on
 * the page could say it was not the assembly. A registered finish is drawn as
 * `finished`, with the assembly it was made over and what the pass added; a
 * plain final carries no such label.
 *
 * Rendered through `react-dom/server`: the header is static markup, and the
 * effects that drive the player are not what is under test.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { loadFilm } from "../domain.js";
import { CutView } from "../viewer/CutView.js";

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

function header(edl: Record<string, unknown>): string {
  const project = loadFilm([
    { path: "film/backlot.json", content: MANIFEST },
    { path: "film/shots/a/shot.json", content: SHOT },
    { path: "film/cut/edl.json", content: JSON.stringify(edl) },
  ])!.projects.film;
  return renderToStaticMarkup(
    <CutView
      project={project}
      selectedSegment={null}
      onSelectSegment={() => {}}
      time={0}
      onTime={() => {}}
      urlFor={(path) => `/content/${path}`}
    />,
  );
}

const SEGMENTS = [{ shot: "a", source: "take-01", offset: 0, seconds: 2 }];

describe("the cut header", () => {
  test("a registered finish says it is finished, over which assembly, and what the pass added", () => {
    const html = header({
      kind: "final",
      file: "finished.mp4",
      seconds: 2,
      segments: SEGMENTS,
      finish: {
        by: "glass UI cards, captions & a re-mix",
        source: "render/launch.mp4",
        retimed: false,
        assembly: { kind: "final", file: "final.mp4", seconds: 2, segments: SEGMENTS },
      },
    });
    expect(html).toContain("finished.mp4");
    expect(html).toContain(">finished</span>");
    expect(html).toContain("over final.mp4 — glass UI cards, captions &amp; a re-mix");
    // The full text rides in the title, because the span truncates.
    expect(html).toContain('title="over final.mp4 — glass UI cards, captions &amp; a re-mix"');
  });

  test("a plain final carries no finish label", () => {
    const html = header({ kind: "final", file: "final.mp4", seconds: 2, segments: SEGMENTS });
    expect(html).toContain("final.mp4");
    expect(html).not.toContain(">finished</span>");
    expect(html).not.toContain("over final.mp4");
  });
});
