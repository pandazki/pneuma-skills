/**
 * Plotwise segment library — the pure half of the play loop, pinned.
 *
 * `play-manager.mjs` is one process that turns the screenplay into
 * ready scenes; everything it decides without the network lives in
 * `segment-lib.mjs` and is tested here: which recipe a style id resolves
 * to, which evidence a beat offers, how references are numbered, when a
 * transcript passes without a judge, and how course.json is committed
 * under a lock without ever touching path[] or the outline.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QA_AUTO_FAIL,
  QA_AUTO_PASS,
  QA_COVERAGE_PASS,
  SPEECH_OVERRUN,
  compareNarration,
  digitsToChinese,
  speechBudgetUnits,
  speechUnits,
  appendWatched,
  autoVerdict,
  beatEvidence,
  checkFigureGate,
  detectLanguage,
  normalizeForCompare,
  parseStyleCatalog,
  chooseEndpoint,
  describeAvailableRefs,
  injectBindings,
  planRefs,
  readEnvValue,
  resolveEvidence,
  shootableFigures,
  similarity,
  upsertNode,
  withCourseLock,
} from "../skill/scripts/segment-lib.mjs";
import type { CourseLike, CourseNodeLike } from "../skill/scripts/segment-lib.mjs";

type Course = CourseLike & { path: string[]; nodes: Record<string, CourseNodeLike> };

const STYLES_MD = join(import.meta.dir, "..", "skill", "references", "styles.md");

function tempSet(course: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "plotwise-set-"));
  writeFileSync(join(dir, "course.json"), JSON.stringify(course, null, 2));
  return dir;
}

describe("parseStyleCatalog", () => {
  test("reads every recipe of the shipped catalog", () => {
    const catalog = parseStyleCatalog(readFileSync(STYLES_MD, "utf-8"));
    expect(catalog.size).toBe(18);
    expect(catalog.get("chalkboard")?.narration).toBe("voiceover");
    expect(catalog.get("teacher")?.narration).toBe("on-camera");
    expect(catalog.get("comic")?.narration).toBe("on-camera");
    expect(catalog.get("isometric-tech")?.recipe).toMatch(/^Isometric technical infographic/);
    // Multi-line recipe quotes are joined into one line.
    for (const [, s] of catalog) expect(s.recipe).not.toContain("\n");
  });

  test("skips prose headings and sections without a recipe", () => {
    const md = `# Style presets\n\n## Extended roster\n\n### ink-wash\n\n- **Recipe**: "Ink on rice paper."\n- **Narration**: voiceover (serene).\n\n## Auditioning well\n\ntext`;
    const catalog = parseStyleCatalog(md);
    expect([...catalog.keys()]).toEqual(["ink-wash"]);
  });
});

describe("detectLanguage", () => {
  test("zh for CJK, ja for kana, en otherwise", () => {
    expect(detectLanguage("Plexus 是什么")).toBe("zh");
    expect(detectLanguage("フーリエ変換")).toBe("ja");
    expect(detectLanguage("Fourier transform")).toBe("en");
  });
});

describe("speech budget", () => {
  test("CJK counts characters plus two per Latin token; English counts words", () => {
    expect(speechBudgetUnits("zh", 10)).toBe(48);
    expect(speechBudgetUnits("en", 10)).toBe(26);
    expect(speechUnits("匿名 .well-known 只报身份", "zh")).toBe(6 + 2);
    expect(speechUnits("The v0.1.4 handshake opens a session", "en")).toBe(6);
  });

  test("a script the clip spoke fine sits under the overrun line; twice that does not", () => {
    // Spoken verbatim in a 10s clip on 2026-09-02 (similarity 1.0).
    const fine = "匿名 .well-known 只报身份和注册端点，刻意隐藏能力；握手清单按授权，补全每项描述、输入输出、动词及信任窗口。接下来做什么？";
    const cap = speechBudgetUnits("zh", 10) * SPEECH_OVERRUN;
    expect(speechUnits(fine, "zh")).toBeLessThanOrEqual(cap);
    expect(speechUnits(`${fine}${fine}`, "zh")).toBeGreaterThan(cap);
  });
});

describe("transcript comparison", () => {
  test("punctuation, width and spacing never count", () => {
    expect(normalizeForCompare("偷到 Scoped Token,只能在 Scope 内调用。")).toBe(normalizeForCompare("偷到Scoped Token只能在Scope内调用"));
    expect(similarity("Hello, world!", "hello world")).toBe(1);
  });

  test("a homophone slip passes automatically; a dropped clause does not", () => {
    const script = "偷到 Scoped Token 只能在 Scope 和短 TTL 内调用,Refresh 也受原 Session 限制,Session 一结束链条就断。";
    const homophone = "偷到Scoped Token只能在Scope和短TTL内调用Refresh也受原Session限制Session一结束链条就断";
    expect(autoVerdict(similarity(script, homophone))).toBe("pass");
    const dropped = "偷到 Scoped Token 只能在 Scope 和短 TTL 内调用。";
    const sim = similarity(script, dropped);
    expect(sim).toBeLessThan(QA_AUTO_PASS);
    expect(autoVerdict(sim)).not.toBe("pass");
  });

  test("digits and arithmetic symbols in the transcript read as the words the narrator said", () => {
    // Measured 2026-09-03 (泰勒展开, e^0.5): the take was spoken perfectly and
    // scored 0.587 twice because the recognizer writes numbers as digits.
    const script = "代入零点五，取到二阶，得到一加零点五加零点五平方除以二；取到四阶，再加三次方除以六和四次方除以二十四。";
    const real = "代入0.5,取到2阶,得到1加0.5加0.5平方除以2,取到4阶,再加3次方除以6和4次方除以24。";
    expect(compareNarration(script, real)).toEqual({ similarity: 1, coverage: 1 });
    const symbolic = "代入0.5，取到2阶，得到1+0.5+0.5²/2；取到4阶，再加3次方÷6和4次方÷24。";
    const cmp = compareNarration(script, symbolic);
    expect(autoVerdict(cmp.similarity, cmp.coverage)).toBe("pass");
    // A script written with digits meets a transcript written with words the same way.
    expect(similarity("总共 24 个，两个一组", "总共二十四个，二个一组")).toBe(1);
    expect(normalizeForCompare("1+1=2")).toBe("一加一等于二");
  });

  test("digits become spoken Chinese numerals", () => {
    expect(["24", "10", "11", "105", "110", "2024", "1000000", "0.5", "3.14", "0"].map(digitsToChinese)).toEqual([
      "二十四", "十", "十一", "一百零五", "一百一十", "二千零二十四", "一百万", "零点五", "三点一四", "零",
    ]);
    expect(digitsToChinese("123456789")).toBe("一二三四五六七八九");
  });

  test("garbage fails without a judge; the ambiguous band asks for one", () => {
    expect(autoVerdict(QA_AUTO_FAIL - 0.01)).toBe("fail");
    expect(autoVerdict((QA_AUTO_FAIL + QA_AUTO_PASS) / 2)).toBeNull();
    // Mid-band similarity with a coverage deficit is not recognizer noise.
    expect(autoVerdict(0.94, 0.85)).toBeNull();
  });

  test("real recognizer noise on code-switched narration passes on coverage; a garbled take does not", () => {
    // Measured 2026-09-02: every word spoken, the recognizer mangled 网关→网间,
    // HANDSHAKE→Handtake, 作用域→作用于. A Luna judge failed this twice.
    const script = "v0.1.4 的五步依次是：DISCOVER 发现网关；ENROLL 用一次性注册码换持久 PAT；HANDSHAKE 开会话并返回清单；GRANT 签发作用域令牌；INVOKE 持令牌调用，完成协议循环。";
    const noisy = "V0.1.4的五步依次是Discover发现网间Enroll用一次性注册码换持久PATHandtake开会化并返回清单Grant签发作用于令牌Invoke持令牌调用完成协议循环";
    const cmp = compareNarration(script, noisy);
    expect(cmp.similarity).toBeGreaterThanOrEqual(QA_COVERAGE_PASS);
    expect(Math.abs(cmp.coverage - 1)).toBeLessThanOrEqual(0.08);
    expect(autoVerdict(cmp.similarity, cmp.coverage)).toBe("pass");

    // The re-shoot that lost two step names entirely.
    const garbled = "V0.1.4的五步依次式Discover发现网关Enroll用一次性注册码换持久Pate开绘画返回清单签发作用于令牌Vake持令牌调用完成协议循环";
    const bad = compareNarration(script, garbled);
    expect(autoVerdict(bad.similarity, bad.coverage)).not.toBe("pass");
  });
});

describe("evidence resolution", () => {
  test("lifts the outline beat's evidence, legacy figures[] and sources pointers", () => {
    const beat = {
      id: "b2",
      title: "t",
      evidence: [{ kind: "world-knowledge", note: "textbook" }],
      figures: ["evidence/b2/fig.png"],
      sources: "evidence/b2/sources.json",
    };
    const refs = beatEvidence(beat);
    expect(refs).toEqual([
      { kind: "world-knowledge", note: "textbook" },
      { kind: "rendered-figure", file: "evidence/b2/fig.png", note: "" },
      { kind: "citation", file: "evidence/b2/sources.json", note: "" },
    ]);
  });

  test("expands sources.json, scans the beat and node directories, dedupes, flags missing files", () => {
    const set = tempSet({ title: "x", outline: [], nodes: {} });
    mkdirSync(join(set, "evidence", "b2"), { recursive: true });
    mkdirSync(join(set, "evidence", "sq1"), { recursive: true });
    writeFileSync(join(set, "evidence", "b2", "fig.png"), "png");
    writeFileSync(join(set, "evidence", "b2", "render.py"), "print()");
    writeFileSync(
      join(set, "evidence", "b2", "sources.json"),
      JSON.stringify([{ url: "https://example.org/a", note: "A" }]),
    );
    writeFileSync(join(set, "evidence", "sq1", "extra.png"), "png");
    writeFileSync(
      join(set, "evidence", "sq1", "evidence.json"),
      JSON.stringify({ evidence: [{ kind: "code-verification", file: "evidence/sq1/check.py", note: "ran" }] }),
    );

    const beat = {
      id: "b2",
      title: "t",
      evidence: [{ kind: "rendered-figure", file: "evidence/b2/fig.png", note: "the figure" }],
      sources: "evidence/b2/sources.json",
    };
    const refs = resolveEvidence({ setDir: set, beat, nodeId: "sq1" });

    const files = refs.filter((r) => r.file).map((r) => r.file);
    expect(files.filter((f) => f === "evidence/b2/fig.png")).toHaveLength(1);
    expect(refs.find((r) => r.file === "evidence/b2/fig.png")?.note).toBe("the figure");
    expect(refs.find((r) => r.url === "https://example.org/a")?.kind).toBe("citation");
    expect(files).toContain("evidence/sq1/extra.png");
    expect(files).not.toContain("evidence/b2/render.py");
    expect(refs.find((r) => r.file === "evidence/sq1/check.py")?.missing).toBe(true);
    expect(refs.find((r) => r.file === "evidence/b2/fig.png")?.missing).toBeUndefined();

    expect(shootableFigures(refs).map((f) => f.file)).toEqual(["evidence/b2/fig.png", "evidence/sq1/extra.png"]);
  });

  test("the gate binds by path or basename and names what is missing", () => {
    const figures = [
      { kind: "rendered-figure", file: "evidence/b2/fig.png", note: "" },
      { kind: "rendered-figure", file: "evidence/b2/two.png", note: "" },
    ];
    const ok = checkFigureGate(["fig.png", "evidence/b2/two.png", "evidence/b2/two.png"], figures);
    expect(ok.ok).toBe(true);
    expect(ok.bound.map((f) => f.file)).toEqual(["evidence/b2/fig.png", "evidence/b2/two.png"]);
    const bad = checkFigureGate(["imagined-plot.png"], figures);
    expect(bad).toEqual({ ok: false, bound: [], missing: ["imagined-plot.png"] });
    expect(checkFigureGate(undefined, figures).ok).toBe(true);
  });
});

describe("planRefs", () => {
  test("continuity is Image 1, characters next, figures last, capped at four", () => {
    const plan = planRefs({
      anchorFile: "nodes/n2/prev-frame.png",
      characters: ["style/host.png"],
      figures: [
        { file: "evidence/b1/a.png", note: "A" },
        { file: "evidence/b1/b.png", note: "" },
        { file: "evidence/b1/c.png", note: "" },
      ],
    });
    expect(plan.refs.map((r) => r.job)).toEqual(["continuity", "character", "figure", "figure"]);
    expect(plan.lines[0]).toMatch(/^Image 1 is the exact scene this shot continues from/);
    expect(plan.lines[2]).toContain('"a.png" (A)');
    expect(plan.lines).toHaveLength(4);
  });

  test("a style anchor is described as a look reference, not content", () => {
    const plan = planRefs({ anchorFile: "style/anchor.png", anchorKind: "style-anchor" });
    expect(plan.lines[0]).toContain("style anchor");
    expect(plan.lines[0]).toContain("not content to show");
  });

  test("the voice reference rides as Audio 1, outside the image budget", () => {
    const plan = planRefs({
      anchorFile: "nodes/n2/s1.last.png",
      characters: ["style/character-1.png", "style/character-2.png"],
      figures: [{ file: "evidence/b1/a.png", note: "" }, { file: "evidence/b1/b.png", note: "" }],
      voice: "style/voice.mp3",
    });
    // Four images (the cap), then the audio.
    expect(plan.refs.map((r) => [r.job, r.kind])).toEqual([
      ["continuity", "image"],
      ["character", "image"],
      ["character", "image"],
      ["figure", "image"],
      ["voice", "audio"],
    ]);
    expect(plan.lines[4]).toBe("Audio 1 is the narrator's voice — the voiceover keeps exactly this voice, timbre and pace.");
    const spoken = planRefs({ anchorFile: "style/anchor.png", anchorKind: "style-anchor", voice: "style/voice.mp3", narration: "on-camera" });
    expect(spoken.lines[1]).toContain("the speaker's voice");
    // No voice, no audio line.
    expect(planRefs({ anchorFile: "style/anchor.png" }).refs.some((r) => r.kind === "audio")).toBe(false);
  });
});

describe("chooseEndpoint (from what the script shows)", () => {
  const anchor = "nodes/n2/prev-frame.png";
  const fig = (n: string) => ({ file: `evidence/b1/${n}.png` });
  test("a scene to continue and nothing to show: image-to-video from the parent's last frame", () => {
    expect(chooseEndpoint({ anchorFile: anchor })).toBe("image");
  });
  test("a figure on screen or a recurring character: reference-to-video", () => {
    expect(chooseEndpoint({ anchorFile: anchor, figures: [fig("a")] })).toBe("reference");
    expect(chooseEndpoint({ anchorFile: anchor, characters: ["style/host.png"] })).toBe("reference");
    expect(chooseEndpoint({ figures: [fig("a")] })).toBe("reference");
  });
  test("nothing to continue from and nothing to show: text-to-video", () => {
    expect(chooseEndpoint({})).toBe("text");
  });
  test("an explicit request is honoured when it is possible", () => {
    expect(chooseEndpoint({ requested: "reference", anchorFile: anchor })).toBe("reference");
    expect(chooseEndpoint({ requested: "image", anchorFile: null, figures: [fig("a")] })).toBe("reference");
    expect(chooseEndpoint({ requested: "image", anchorFile: null })).toBe("text");
    expect(chooseEndpoint({ requested: "text", anchorFile: anchor })).toBe("text");
  });
});

describe("describeAvailableRefs / injectBindings", () => {
  test("the writer hears what is on offer by name, never by number", () => {
    const lines = describeAvailableRefs({
      anchorKind: "continuity",
      characters: ["style/refs/host.png"],
      figures: [{ file: "evidence/b1/a.png", note: "A" }],
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^This shot continues seamlessly from the previous segment's last frame/);
    expect(lines[1]).toContain('the reference image "host.png"');
    expect(lines[2]).toContain('the reference figure "a.png"');
    expect(lines.join(" ")).not.toMatch(/Image \d/);
  });
  test("bindings land in the visual section, ahead of the soundscape", () => {
    const prompt = "integrated_multimodal_description: [Shot 1] A board.\noverall_soundscape: quiet.\nnon_diegetic_music: N/A";
    const out = injectBindings(prompt, ["Image 1 is the scene.", "Image 2 is the figure."]);
    expect(out).toBe("integrated_multimodal_description: [Shot 1] A board. Image 1 is the scene. Image 2 is the figure.\noverall_soundscape: quiet.\nnon_diegetic_music: N/A");
    expect(injectBindings("just a prompt", ["Image 1 is the scene."])).toBe("just a prompt Image 1 is the scene.");
    expect(injectBindings(prompt, [])).toBe(prompt);
  });
});

describe("planRefs in image mode", () => {
  test("continuity only: the chain frame is the first frame and no figure ever becomes a keyframe", () => {
    const plan = planRefs({
      anchorFile: "nodes/n2/prev-frame.png",
      characters: ["style/host.png"],
      figures: [{ file: "evidence/b1/a.png", note: "A" }, { file: "evidence/b1/b.png" }],
      mode: "image",
    });
    expect(plan.refs.map((r) => [r.job, r.role])).toEqual([["continuity", "first-frame"]]);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatch(/^The first frame of this shot is the exact last frame of the previous segment/);
  });
});

describe("course.json commits", () => {
  const base = (): Course => ({
    title: "t",
    outline: [{ id: "b1", title: "one" }],
    rootNode: "n1",
    path: ["n1"],
    nodes: {
      n1: { beat: "b1", kind: "main", children: [{ nodeId: "n2", label: "old label" }], status: "ready", video: { file: "nodes/n1/video.mp4", duration: 5 } },
      n2: { parent: "n1", kind: "main", children: [{ nodeId: "n3", label: "keep" }], status: "generating" },
    },
  });

  test("upsertNode creates, links to the parent once, and preserves children", () => {
    const c = upsertNode(base(), { id: "n2a", parent: "n2", beat: "b1", kind: "branch", choiceLabel: "深挖", status: "generating", video: null });
    expect(c.nodes.n2a).toEqual({ parent: "n2", beat: "b1", kind: "branch", choiceLabel: "深挖", children: [], status: "generating" });
    expect(c.nodes.n2.children).toEqual([{ nodeId: "n3", label: "keep" }, { nodeId: "n2a", label: "深挖" }]);

    upsertNode(c, { id: "n2a", status: "ready", video: { file: "nodes/n2a/video.mp4", duration: 10.1 } });
    expect(c.nodes.n2.children).toHaveLength(2);
    expect(c.nodes.n2a.status).toBe("ready");
    expect(c.nodes.n2a.video).toEqual({ file: "nodes/n2a/video.mp4", duration: 10.1 });
    expect(c.nodes.n2a.parent).toBe("n2");
  });

  test("re-labeling updates the existing link instead of duplicating it", () => {
    const c = upsertNode(base(), { id: "n2", parent: "n1", choiceLabel: "new label", status: "ready", video: { file: "nodes/n2/video.mp4", duration: 5 } });
    expect(c.nodes.n1.children).toEqual([{ nodeId: "n2", label: "new label" }]);
    expect(c.nodes.n2.children).toEqual([{ nodeId: "n3", label: "keep" }]);
  });

  test("appendWatched keeps the latest watched at the tail, once", () => {
    const c = appendWatched(appendWatched(base(), "n2"), "n2");
    expect(c.path).toEqual(["n1", "n2"]);
    // Watching an earlier segment again moves it to the tail: the line
    // now ends there, and nothing seen is recorded twice.
    expect(appendWatched(c, "n1").path).toEqual(["n2", "n1"]);
  });

  test("withCourseLock writes atomically, releases the lock, and never touches path/outline", () => {
    const set = tempSet(base());
    const next = withCourseLock<Course>(set, (c) => upsertNode(c, { id: "n9", parent: "n2", kind: "sidequest", choiceLabel: "q", status: "failed" }));
    expect(next.nodes.n9.status).toBe("failed");
    const onDisk = JSON.parse(readFileSync(join(set, "course.json"), "utf-8"));
    expect(onDisk.nodes.n9).toEqual(next.nodes.n9);
    expect(onDisk.path).toEqual(["n1"]);
    expect(onDisk.outline).toEqual([{ id: "b1", title: "one" }]);
    expect(existsSync(join(set, "course.json.lock"))).toBe(false);
  });

  test("a held lock blocks until it times out — and a stale one is reclaimed", () => {
    const set = tempSet(base());
    mkdirSync(join(set, "course.json.lock"));
    expect(() => withCourseLock(set, (c) => c, { timeoutMs: 250, pollMs: 50 })).toThrow(/locked by another producer/);
    // A lock older than staleMs belongs to a dead producer.
    const c = withCourseLock<Course>(set, (c) => appendWatched(c, "n2"), { timeoutMs: 250, pollMs: 10, staleMs: 0 });
    expect(c.path).toEqual(["n1", "n2"]);
    expect(existsSync(join(set, "course.json.lock"))).toBe(false);
  });
});

describe("readEnvValue", () => {
  test("reads a quoted or bare value and ignores comments", () => {
    const env = `# keys\nFAL_KEY="abc"\nOPENROUTER_API_KEY=def\n`;
    expect(readEnvValue(env, "FAL_KEY")).toBe("abc");
    expect(readEnvValue(env, "OPENROUTER_API_KEY")).toBe("def");
    expect(readEnvValue(env, "MISSING")).toBeNull();
  });
});
