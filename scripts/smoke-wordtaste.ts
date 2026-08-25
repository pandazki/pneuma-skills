// scripts/smoke-wordtaste.ts — local end-to-end smoke harness for wordtaste in
// the player. Materializes a play package from a synthetic writing session —
// a math-heavy Chinese draft in the review stage, with a full structured plan
// (claims + units table), source materials and a taste profile — and serves it
// alongside the player build from one origin, so the SW + provider work
// without R2/CORS. This exercises the REAL WordtastePreview: KaTeX typeset in
// the draft AND the material rail, the plan table, the process rail, the skin
// toggle, and the readonly gating of every human-gate button.
//
// The .pneuma/*.json sources (cross-family probe, config) are deliberately
// NOT in the package — shadow git excludes `.pneuma` — which is exactly the
// degradation the player must survive (missing file → source stays null).
//
// Open: http://localhost:18083/player.html?pkg=/plays/wordtaste-smoke
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../server/shadow-git.js";
import { materializePlayPackage } from "../server/play-export.js";

const serveRoot = "/tmp/pneuma-wordtaste-serve";
rmSync(serveRoot, { recursive: true, force: true });
mkdirSync(join(serveRoot, "plays"), { recursive: true });
cpSync("dist-player", serveRoot, { recursive: true });

const ws = mkdtempSync(join(tmpdir(), "smoke-wordtaste-"));
mkdirSync(join(ws, ".pneuma"), { recursive: true });
await initShadowGit(ws);

const set = "scaling-essay";
mkdirSync(join(ws, set, "materials"), { recursive: true });
mkdirSync(join(ws, set, "taste"), { recursive: true });

// A math-heavy draft — inline $..$ and display $$..$$ both present, plus GFM
// (table) so the whole plugin pipeline is exercised.
const DRAFT = `# 加机器的边界：一笔算清并行的天花板

慢了就加机器，这句话在小规模上几乎总是对的。把机器数记作 $n$，单机吞吐记作 $T_1$，直觉是总吞吐等于 $n T_1$。

但任何任务里总有一段跑不并行。设可并行的比例是 $p$，阿姆达尔定律把加速比写成：

$$S(n) = \\frac{1}{(1 - p) + \\frac{p}{n}}$$

代两个数进去就够清醒了：$p = 0.95$ 时上限是 20 倍；哪怕 $p = 0.99$，也不过 100 倍。

机器之间还要互相说话。通用可扩展性定律在分母上多加了串扰的代价：

$$C(n) = \\frac{n}{1 + \\alpha(n - 1) + \\beta n(n - 1)}$$

$\\alpha$ 是排队，$\\beta$ 是相干。排队让曲线变平，相干让曲线掉头向下。

| 机器数 | 只算串行占比 | 加上相干开销 |
| --- | --- | --- |
| 8 | 5.9 | 5.5 |
| 32 | 12.6 | 8.4 |
| 64 | 15.4 | 7.1 |

所以那句口头禅错的不是结论，是它藏着的两个前提：一是串行段为零，二是协调不要钱。
`;

writeFileSync(join(ws, set, "materials", "notes.md"), `# 素材笔记

- 阿姆达尔定律的原始表述：$S(n) = 1/((1-p) + p/n)$，天花板由串行段单独决定。
- USL 在分母加了 $\\beta n(n-1)$ 一项：相干开销，让曲线掉头。
- 实测数据（64 台）：只算串行占比 15.4 倍，加上相干开销 7.1 倍。
`);

writeFileSync(join(ws, set, "taste", "taste-profile.md"), `# Taste profile

<!-- voice-floor:start -->
先立直觉，再下刀。每一刀只切一个前提，数字要代进去看。
<!-- voice-floor:end -->
`);

// The shared layout block — a full structured plan so the layout gate's
// claims + units table have real rows to show.
const LAYOUT = {
    title: "加机器的边界",
    thesis: [],
    units: [],
    plan: {
      version: 1,
      title: "加机器的边界",
      claims: [
        { text: "任何任务里总有一段跑不并行", source: "materials/notes.md#L3" },
        { text: "排队让曲线变平，相干让曲线掉头向下", source: "materials/notes.md#L4" },
        { text: "口头禅藏着两个前提：串行段为零、协调不要钱", source: "materials/notes.md#L5" },
      ],
      units: [
        {
          id: "u1", role: "background",
          spans: [{ file: "materials/notes.md", from: "- 阿姆达尔定律的原始表述：$S(n) = 1/((1-p) + p/n)$，天花板由串行段单独决定。", to: "" }],
          must_keep: ["慢了就加机器"], target_chars: 220, pace: "loose", ends: "open",
          notes_en: "Stand the folk claim up before cutting it.",
        },
        {
          id: "u2", role: "reasoning",
          spans: [{ file: "materials/notes.md", from: "- USL 在分母加了 $\\beta n(n-1)$ 一项：相干开销，让曲线掉头。", to: "" }],
          must_keep: [], target_chars: 360, pace: "dense", ends: "stop",
          notes_en: "Two cuts: the serial fraction, then coherence cost.",
        },
        {
          id: "u3", role: "conclusion",
          spans: [{ file: "materials/notes.md", from: "- 实测数据（64 台）：只算串行占比 15.4 倍，加上相干开销 7.1 倍。", to: "" }],
          must_keep: [], target_chars: 180, pace: "mixed", ends: "stop",
          notes_en: "Name the two hidden premises and close.",
        },
      ],
    },
};

// Checkpoint 1: the LAYOUT gate — the plan table + claims are the visible
// surface, emphasis buttons must be disabled in the read-only player.
writeFileSync(join(ws, set, "workflow.json"), JSON.stringify({
  version: 2,
  contentSet: set,
  stage: "layout",
  goal: "把「加机器为什么不一定更快」写成一篇能代数字进去的短文",
  entry: "idea",
  layout: LAYOUT,
  emphasis: [0, 2],
  candidates: [],
}, null, 2));
await enqueueCheckpoint(ws, 1);

// Checkpoint 2: the review stage — draft written, whole-piece check running.
writeFileSync(join(ws, set, "draft.md"), DRAFT);
writeFileSync(join(ws, set, "workflow.json"), JSON.stringify({
  version: 2,
  contentSet: set,
  stage: "review",
  goal: "把「加机器为什么不一定更快」写成一篇能代数字进去的短文",
  entry: "idea",
  layout: LAYOUT,
  emphasis: [0, 2],
  progress: { completedUnits: ["u1", "u2", "u3"], totalUnits: 3 },
  review: {
    summary: "整体成立；第二段的两刀之间少一句过渡。",
    issues: [
      { quote: "排队让曲线变平", problem: "转折太快，读者还没看到排队从哪来", status: "open" },
    ],
  },
  candidates: [],
}, null, 2));
await enqueueCheckpoint(ws, 2);

writeFileSync(join(ws, ".pneuma", "session.json"), JSON.stringify({
  sessionId: "wordtaste-smoke", mode: "wordtaste", backendType: "claude-code", createdAt: Date.now(),
}));
writeFileSync(join(ws, ".pneuma", "history.json"), JSON.stringify([
  { type: "user_message", content: "把加机器的边界写成短文", timestamp: 1000, id: "u1" },
  { type: "assistant", message: { id: "a1", content: [{ type: "text", text: "论点和写作单元排好了，请确认这就是要做的论证。" }, { type: "tool_use", name: "Write", input: { file_path: `${set}/workflow.json` } }], model: "x", stop_reason: "end_turn", role: "assistant" }, timestamp: 1500 },
  { type: "result", data: { num_turns: 1 } },
  { type: "user_message", content: "就是这个论证，开写", timestamp: 2000, id: "u2" },
  { type: "assistant", message: { id: "a2", content: [{ type: "text", text: "三个写作单元逐段完成，整篇进入复查。" }, { type: "tool_use", name: "Write", input: { file_path: `${set}/draft.md` } }], model: "x", stop_reason: "end_turn", role: "assistant" }, timestamp: 2500 },
  { type: "result", data: { num_turns: 1 } },
]));

const res = await materializePlayPackage(ws, {
  output: join(serveRoot, "plays", "wordtaste-smoke"),
  title: "加机器的边界 (wordtaste)",
  importUrl: "https://example.r2.dev/histories/wordtaste.tar.gz",
});
console.log("[smoke] wordtaste package:", res.index.id, "supported:", res.index.supported, "checkpoints:", res.checkpointCount, "blobs:", res.blobCount);

Bun.serve({
  port: 18083,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p === "/") p = "/player.html";
    const file = Bun.file(join(serveRoot, p));
    if (await file.exists()) {
      return new Response(file, { headers: { "access-control-allow-origin": "*" } });
    }
    if (p.startsWith("/s/")) return new Response(Bun.file(join(serveRoot, "player.html")));
    return new Response("not found", { status: 404 });
  },
});
console.log("[smoke] serving http://localhost:18083/player.html?pkg=/plays/wordtaste-smoke");
