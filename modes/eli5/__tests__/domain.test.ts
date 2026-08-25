/**
 * ELI5 domain tests — the `Explainer` aggregate.
 *
 * An explainer is one topic explained N times, once per audience. The
 * manifest is the only structural truth the viewer has: it names the
 * ladder order, the audience labels, and which page file each audience
 * reads. Everything below pins that parse, because the manifest is
 * written by an agent — a dropped field or a number where a string
 * belongs must degrade to a renderable ladder, never to a crash.
 */

import { describe, expect, test } from "bun:test";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { loadExplainer, saveExplainer } from "../domain.js";

function files(map: Record<string, string>): ViewerFileContent[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

const DATABASE_INDEX = JSON.stringify({
  title: "What is a database index?",
  topic: "database indexes",
  language: "en",
  audiences: [
    { id: "age-5", label: "Age 5", file: "pages/age-5.html", tone: "playful" },
    { id: "manager", label: "Manager", file: "pages/manager.html" },
  ],
});

const HOW_LLMS_WORK = JSON.stringify({
  title: "大语言模型是怎么工作的?",
  audiences: [{ id: "kid", label: "8 岁孩子", file: "pages/kid.html" }],
});

describe("loadExplainer", () => {
  test("keys every content set by its directory prefix", () => {
    const explainer = loadExplainer(
      files({
        "database-index/manifest.json": DATABASE_INDEX,
        "database-index/pages/age-5.html": "<p>hi</p>",
        "how-llms-work/manifest.json": HOW_LLMS_WORK,
      }),
    )!;

    expect(Object.keys(explainer.byContentSet).sort()).toEqual([
      "database-index",
      "how-llms-work",
    ]);
    expect(explainer.byContentSet["database-index"].title).toBe(
      "What is a database index?",
    );
    expect(explainer.byContentSet["how-llms-work"].audiences[0].label).toBe(
      "8 岁孩子",
    );
  });

  test("preserves audience order — the manifest order IS the ladder order", () => {
    const explainer = loadExplainer(
      files({
        "t/manifest.json": JSON.stringify({
          title: "T",
          audiences: [
            { id: "age-5", label: "Age 5", file: "pages/age-5.html" },
            { id: "manager", label: "Manager", file: "pages/manager.html" },
            { id: "engineer", label: "Engineer", file: "pages/engineer.html" },
          ],
        }),
      }),
    )!;

    expect(explainer.byContentSet["t"].audiences.map((a) => a.id)).toEqual([
      "age-5",
      "manager",
      "engineer",
    ]);
  });

  test("carries optional topic / language / tone through untouched", () => {
    const explainer = loadExplainer(
      files({ "database-index/manifest.json": DATABASE_INDEX }),
    )!;
    const manifest = explainer.byContentSet["database-index"];

    expect(manifest.topic).toBe("database indexes");
    expect(manifest.language).toBe("en");
    expect(manifest.audiences[0].tone).toBe("playful");
    // Absent optional fields stay absent rather than becoming "undefined"
    // strings or empty-string noise the viewer would have to re-filter.
    expect(manifest.audiences[1].tone).toBeUndefined();
  });

  test("a root-level manifest lands under the empty-string key", () => {
    const explainer = loadExplainer(
      files({
        "manifest.json": JSON.stringify({
          title: "Rooted",
          audiences: [{ id: "kid", label: "Kid", file: "pages/kid.html" }],
        }),
        "pages/kid.html": "<p>hi</p>",
      }),
    )!;

    expect(Object.keys(explainer.byContentSet)).toEqual([""]);
    expect(explainer.byContentSet[""].title).toBe("Rooted");
  });

  test("coerces malformed manifest fields into a renderable ladder", () => {
    const explainer = loadExplainer(
      files({
        "broken/manifest.json": JSON.stringify({
          // title missing entirely
          topic: 42,
          language: null,
          audiences: [
            // id and label missing — derive from the page file
            { file: "pages/manager.html" },
            // everything a number
            { id: 7, label: 8, file: 9, tone: 10 },
            // not an object at all
            null,
            "nonsense",
          ],
        }),
      }),
    )!;
    const manifest = explainer.byContentSet["broken"];

    expect(manifest.title).toBe("Untitled");
    expect(manifest.topic).toBeUndefined();
    expect(manifest.language).toBeUndefined();

    expect(manifest.audiences[0]).toEqual({
      id: "manager",
      label: "manager",
      file: "pages/manager.html",
    });
    // Non-string scalars are dropped, not stringified into "7" / "10" —
    // a fabricated id would collide with a real one in a ViewerAddress.
    expect(manifest.audiences[1].file).toBe("");
    expect(manifest.audiences[1].id).toBe("audience-2");
    expect(manifest.audiences[1].tone).toBeUndefined();
    // Junk entries still occupy their rung so ladder indices keep matching
    // the manifest the agent wrote.
    expect(manifest.audiences).toHaveLength(4);
    expect(manifest.audiences[2].id).toBe("audience-3");
    expect(manifest.audiences[3].label).toBe("audience-4");
  });

  test("a non-array audiences field degrades to an empty ladder", () => {
    const explainer = loadExplainer(
      files({
        "broken/manifest.json": JSON.stringify({
          title: "No ladder",
          audiences: { manager: "pages/manager.html" },
        }),
      }),
    )!;

    expect(explainer.byContentSet["broken"].audiences).toEqual([]);
  });

  test("returns null when no manifest exists yet", () => {
    expect(
      loadExplainer(
        files({
          "database-index/pages/age-5.html": "<p>orphan page</p>",
          "database-index/assets/cover.png": "",
        }),
      ),
    ).toBeNull();
    expect(loadExplainer([])).toBeNull();
  });

  test("lets a syntactically broken manifest throw for the provider to report", () => {
    // The aggregate-file provider catches this and emits an error event
    // while keeping the source alive; swallowing it here would show the
    // user a silently empty ladder instead.
    expect(() =>
      loadExplainer(files({ "broken/manifest.json": "{ not json" })),
    ).toThrow();
  });
});

describe("saveExplainer", () => {
  test("is a no-op — the viewer is a player, the agent owns every write", () => {
    const snapshot = files({ "t/manifest.json": DATABASE_INDEX });
    const explainer = loadExplainer(snapshot)!;

    expect(saveExplainer(explainer, snapshot)).toEqual({
      writes: [],
      deletes: [],
    });
  });

  test("leaves the file snapshot untouched", () => {
    const snapshot = files({ "t/manifest.json": DATABASE_INDEX });
    const before = JSON.stringify(snapshot);

    saveExplainer(loadExplainer(snapshot)!, snapshot);

    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
