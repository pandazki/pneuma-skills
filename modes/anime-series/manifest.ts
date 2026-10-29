/**
 * Anime Series Mode Manifest — pure data, no React deps.
 *
 * A short-form animated series (动画单元剧): a fixed cast, one gag per
 * episode, 15 / 30 / 60 seconds each. What makes it hard is not one episode
 * but the tenth one, where the two leads must still be the two leads. The
 * method comes from ai-anime-series: the look is written down once, design
 * sheets are references, the storyboard only fixes composition, prompts are
 * assembled by a script and never typed, and every finished clip is sampled
 * back against the sheets.
 *
 * Three files, three kinds of writer:
 *   bible.json                    the cast, the place, the style and the
 *                                 locks — the agent drafts, the human edits
 *                                 text, picks sheets and locks a version
 *   episodes/<id>/episode.json    title, timing, shot list, log, picks — the
 *                                 agent writes the script, the human edits
 *                                 text, drags seconds and makes decisions
 *   project.json                  the craft project: every generated file,
 *                                 its provenance and its cost, plus the
 *                                 `series` sidecar of machine state — only
 *                                 the mode's scripts write it
 *
 * Every derived status (locks, the stale-bible flag, conservation of a
 * part's seconds, which take is in effect) is computed by
 * `skill/scripts/series-state.mjs`, which the scripts and the viewer's
 * `domain.ts` both import — one algorithm, two runtimes.
 *
 * Upstream: 10291124jcjc-dotcom/ai-anime-series, which is dual-licensed.
 * Its scripts/ are MIT, and this mode's scripts port their logic (and their
 * Chinese prompt wording) with that notice kept. Everything else upstream —
 * docs, SKILL.md, README, templates, the example series — is CC BY-NC 4.0;
 * from those the method is re-expressed in this mode's own words and
 * examples, and credited as inspiration. NOTICE.md maps what was ported,
 * adapted, added and dropped, and names the few short phrases in the seed
 * that come from the CC template.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { loadSeries, saveSeries } from "./domain.js";

const animeSeriesManifest: ModeManifest = {
  name: "anime-series",
  version: "0.1.0",
  changelog: {
    "0.1.0": [
      "A series is a cast wall, an episode desk and a season rail: the character, group, scene and style cards stay in view while you judge a shot (with the newest lineup of the picked sheets at one scale), one episode sits on the desk at a time, and the rail above holds every episode with its status and cost",
      "The bible is the one authority: every storyboard and video prompt is assembled by a script from the bible and the episode, never typed by hand, and the viewer shows the same text the script sends",
      "Lock a version of the bible and every episode remembers which version it was shot under — change a character's look afterwards and only the episodes that character appears in are flagged, with the field that moved",
      "The shot strip is the storyboard, the shot list and the timeline at once: cells are as wide as their seconds, the playhead runs across them, and dragging the border between two shots moves seconds from one to the other without changing the part's length",
      "Every generated file carries its stamps — which sheets and which storyboard it was made from, the bible version and what it cost — read from the craft project's provenance, so nobody has to remember what went into a clip",
      "A finished clip is sampled shot by shot and checked against the design sheets: each shot × character or group is ok, drift, not in the shot, or unverified; a character the shot's words name but the clip lost is flagged, a re-shot span is judged on its own frames, an episode with unchecked cells never reads as finished, and a drift is either re-shot or accepted on the record",
      "Pick a design sheet or a storyboard, edit a card, lock the bible, change a shot's words or seconds, accept a drift — the viewer writes those decisions straight into bible.json and episode.json; generation, provenance, checks and cost stay with the scripts",
      "Binge mode plays every finished episode in order, theatre-size, with the wall and the details out of the way",
      "No API key? Every sheet, storyboard, panel redraw, clip and re-shoot prompt comes as copy-ready text for the Jimeng / Dreamina canvas, saying which nodes to select and in what order; each file you bring back is registered and checked like a generated one",
    ],
  },
  displayName: {
    en: "Toon Series",
    "zh-CN": "动画单元剧",
    ja: "アニメ連作",
  },
  description: {
    en: "A short animated series with a fixed cast: write the characters down once, lock the design sheets, and turn one sentence into a 15–60 second episode — storyboard, video and a shot-by-shot check that the leads still look like themselves.",
    "zh-CN":
      "固定班底的动画单元剧：角色写定一次、设定图锁住，一句话出一集 15–60 秒的短片——故事板、成片，再逐镜对照设定图，确认主角还是那两个主角。",
    ja: "固定キャストの短編アニメ連作。キャラクターを一度書き定め、設定画をロックし、一文から 15〜60 秒の一話へ —— 絵コンテ、本編、そして主役が主役のままかをショットごとに照合します。",
  },
  // A film frame holding two round figures, with a sprocket row on top: a
  // recurring cast inside one frame of a series.
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M2.5 8h19"/><path d="M6 4v4M10 4v4M14 4v4M18 4v4"/><path d="M8.5 11.2c1.3 1.4 1.9 2.4 1.9 3.6a1.9 1.9 0 0 1-3.8 0c0-1.2.6-2.2 1.9-3.6z"/><rect x="12.6" y="13" width="6" height="4" rx="2"/><path d="M14 13l-.4-1.3M17.2 13l.4-1.3"/></svg>`,

  // Everything is a script the agent runs and an image it reads back (sheets,
  // storyboards, contact sheets). No model-side image or video tool is
  // required, so both harnesses qualify.
  supportedBackends: ["claude-code", "codex"],

  // The method's source (credited, not copied — see NOTICE.md for the MIT
  // script port and the CC BY-NC boundary).
  inspiredBy: {
    name: "10291124jcjc-dotcom/ai-anime-series",
    url: "https://github.com/10291124jcjc-dotcom/ai-anime-series",
  },

  skill: {
    sourceDir: "skill",
    installName: "pneuma-anime-series",
    mdScene: `You and the user are making a short animated series with a fixed cast. The bible (bible.json) writes every character, group, scene and the style down once; each episode (episodes/<id>/episode.json) is a title, a duration and a shot list. Prompts are never typed: the mode's scripts assemble them from the bible and the episode, generate design sheets, storyboards and clips, and record every file with its provenance and cost in the craft project (project.json). In front of the user is the cast wall, the episode desk with its shot strip — storyboard, shot list and timeline in one — and the season rail.`,
    envMapping: {
      FAL_KEY: "falApiKey",
      OPENROUTER_API_KEY: "openrouterApiKey",
    },
    // sharedScripts is a WHITELIST and it is transitive: every shared script
    // a mode script imports has to be listed even when the agent never runs
    // it directly. series.mjs imports craft-project.mjs (pure: validation,
    // lifecycle, cost reading; also bundled into the viewer through
    // domain.ts), craft-project-io.mjs (atomic load/save, probing),
    // generate_image.mjs and seedance-video.mjs; seedance-video.mjs and
    // craft-project-io.mjs both import fal-queue.mjs.
    sharedScripts: [
      "craft-project.mjs",
      "craft-project-io.mjs",
      "fal-queue.mjs",
      "seedance-video.mjs",
      "generate_image.mjs",
    ],
  },

  viewer: {
    // EVERY pattern here must end in a literal extension — the watcher derives
    // its file-type allowlist from these globs
    // (`server/file-watcher.ts::extractWatchExtensions`).
    //
    // THIS LIST IS THE VIEWER'S TEXT INPUTS AND NOTHING ELSE. Every match is
    // read as UTF-8 by the watcher and by `GET /api/files` on cold start and
    // shipped to the browser in one JSON payload; a media glob here turns a
    // series' sheets, storyboards and clips into megabytes of mangled text
    // (backlot measured 4.1 MB against 17 KB for one `.png` pattern). Media
    // is read from `/content/<uri>` instead, cache-busted by the craft asset's
    // `createdAt` — and project.json, which IS watched, changes whenever a
    // script lands a file. The watcher's image branch also fires before the
    // pattern filter, so a new PNG still bumps `imageVersion`.
    watchPatterns: ["bible.json", "project.json", "episodes/*/episode.json"],
    ignorePatterns: [
      "node_modules/**",
      ".pneuma/**",
      // Scratch the scripts write while assembling (frame samples, panel
      // crops before a grid is recomposed). Never read by the viewer.
      "**/tmp/**",
    ],
    serveDir: ".",
  },

  sources: {
    // A series is ONE object assembled from three kinds of file: the bible,
    // each episode, and the craft project with its `series` sidecar. Every
    // status the viewer draws — a card's lock, an episode's stale-bible flag,
    // a shot's check, the take in effect — is derived from all of them
    // together by series-state.mjs, so they load as one aggregate, not as a
    // file list. `save` writes bible.json and episode.json only: the viewer
    // never writes machine state (project.json).
    series: {
      kind: "aggregate-file",
      config: {
        patterns: ["bible.json", "project.json", "episodes/*/episode.json"],
        load: loadSeries,
        save: saveSeries,
      },
    },
  },

  viewerApi: {
    workspace: {
      // One workspace is one series (v0.1). The episodes are its items, in
      // id order; the season rail is the navigation and lives beside the
      // desk it drives, so there is no TopBar item selector.
      type: "manifest",
      multiFile: true,
      ordered: true,
      hasActiveFile: false,
      manifestFile: "bible.json",
      supportsContentSets: false,
      topBarNavigation: false,
    },
    actions: [
      {
        id: "navigate-to",
        label: "Show a card / episode / shot / moment",
        category: "navigate",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              'ViewerAddress. Wall: `{ "character": "niuma" }`, `{ "group": "stickies" }`, `{ "scene": "office-night" }`, `{ "bible": "style" }`, one sheet candidate `{ "character": "niuma", "candidate": "<assetId>" }`. Season: `{ "season": "overview" }`. Desk: `{ "episode": "ep01" }`, add `"part": "B"` on a 60 s episode, `"shot": 5` (1-based within the part) with optional `"lane": "board" | "clip"`, `"check": "niuma"` to open the drift compare for that character, `"time": 13.2` or `"range": [12, 18]` in seconds on the episode clock, `"take": "<assetId>"` to show one take or patch.',
            required: true,
          },
        },
        description:
          "Put the viewer on the card, episode, shot or second you are talking about, so the user is looking at what your sentence is about. It always pauses — call it before `capture` so the frame is the one you mean. An episode, part, shot, character or take that does not exist is refused by name and nothing moves; the reply's `data` says where the viewer actually is.",
      },
      {
        id: "get-view-state",
        label: "Read what the viewer shows",
        category: "custom",
        agentInvocable: true,
        params: {},
        description:
          "Read the viewer exactly as the user sees it: `{ level, episode, part, shot, lane, take, playhead, markedRange, selected, candidatesOpen, flags: { bibleStale, drift[], unverified[] } }`. `level` is `desk`, `overview` or `binge`; `playhead` is seconds on the episode clock; `markedRange` is the span the user shift-dragged on the shot strip, or null. Call it before answering a message that says \"this\" or \"here\".",
      },
      {
        id: "play",
        label: "Play the episode",
        category: "ui",
        agentInvocable: true,
        params: {
          episode: {
            type: "string",
            description: "Episode id, e.g. `ep01`. Defaults to the episode on the desk.",
          },
          from: { type: "number", description: "Start second on the episode clock." },
          to: { type: "number", description: "Stop second on the episode clock." },
        },
        description:
          "Play the clip in effect from `from` to `to` (seconds on the episode clock), e.g. to show the user a patched span after it landed. Refused when the episode has no ready take.",
      },
      {
        id: "pause",
        label: "Pause",
        category: "ui",
        agentInvocable: true,
        params: {},
        description: "Pause playback and keep the playhead where it is.",
      },
    ],
    // User → agent. `description` is the ONE-LINE HINT THE USER READS — never
    // a script, a flag or a file name. The agent's briefing for each lives in
    // the skill's Commands section.
    commands: [
      { id: "new-episode", label: "New episode", description: "Pitch the next episode and write its shot list" },
      { id: "make-sheets", label: "Make design sheets", description: "Draw design sheet candidates for this card" },
      { id: "check-sheets", label: "Check design sheets", description: "Check the sheets against what the card says" },
      { id: "shoot-board", label: "Shoot the storyboard", description: "Draw the storyboard for this episode from the shot list" },
      { id: "shoot-video", label: "Shoot the video", description: "Generate the episode's clip from the storyboard and the sheets" },
      { id: "redo-panel", label: "Redraw this panel", description: "Redraw this one storyboard panel and put it back in the grid" },
      { id: "patch-range", label: "Re-shoot this span", description: "Re-shoot the marked shots and splice them into the clip" },
      { id: "review-episode", label: "Check the frames", description: "Sample the clip shot by shot and check every character against the sheets" },
      { id: "compile-season", label: "Export the season", description: "Join every finished episode into one film with title cards" },
      { id: "retry", label: "Retry", description: "Try the failed generation again" },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Anime Series Mode" skill="pneuma-anime-series" session="new"></system-info>
The user just opened the series workspace. Greet them briefly (1-2 sentences) in their language: if the bible has a cast, name the leads and the next step the desk shows; otherwise ask who the leads are — one or two sentences each, or offer to pitch three pairs. If image or video generation is not configured, say so in the same breath and name what still works without it.`,
  },

  init: {
    contentCheckPattern: "bible.json",
    // The seed is a real run, shipped as it came out: a locked bible with its
    // design sheets and lineup, and episode 1 shot through these scripts —
    // the storyboard with one redrawn panel, the take checked shot by shot
    // with its drifts left open, shot 8 re-shot and spliced into the final,
    // and what each call cost. Every file is one a provider returned or a
    // script derived; nothing is invented or retouched.
    seedFiles: {
      "modes/anime-series/seed/guang-niuma/": "./",
    },
    seeds: [
      {
        id: "guang-niuma",
        sourceKey: "modes/anime-series/seed/guang-niuma/",
        displayName: {
          en: "Glow & Ox — episode 1, shot and checked",
          "zh-CN": "光和牛马 · 第一集已拍完、逐镜查过",
          ja: "光と牛馬 —— 第 1 話、撮影・照合済み",
        },
        description: {
          en: "Two office spirits — a tiny flame that turns into light and a tired misty ox that carries anything — against a swarm of sticky notes, in a night office. A real run, as it came out: the bible locked at v1 with its design sheets; episode 1 (30 s, nine shots) storyboarded with one panel redrawn, shot, checked shot by shot against the sheets with three drifts left open, and shot 8 re-shot and spliced into the final — about $7.99 in all.",
          "zh-CN":
            "两个办公室小灵魂——会变成光的小火苗、什么都能驮的累坏了的牛马——对上一群便利贴，舞台是深夜的办公区。这是一次真实的制作，原样保留：设定 v1 已锁，设定图都是真画的；第一集（30 秒、九个镜头）出了故事板并重画过一格，拍成片后逐镜对照设定图检查，留着三处走样没处理，第 8 镜补拍后接进了成片，一共花了约 $7.99。",
          ja: "オフィスの小さな精霊ふたり —— 光に変わる小さな炎と、何でも運べる疲れた霧の牛 —— 対するは付箋の群れ、舞台は深夜のオフィス。実際の制作をそのまま収録：設定は v1 でロック済み、設定画は実際に描いたもの。第 1 話（30 秒・9 ショット）は絵コンテを 1 コマ描き直して撮影し、設定画とショットごとに照合（崩れ 3 件は未対応のまま）、第 8 ショットは撮り直して本編に差し込み済み —— 費用は合計約 $7.99。",
        },
        tags: ["series", "seedance", "storyboard"],
      },
    ],
    params: [
      {
        name: "falApiKey",
        label: "fal.ai API Key",
        description:
          "Optional — enables the episode clips (Seedance 2.5 reference-to-video) and re-shoots. Without it you still get the bible, the storyboard and the assembled video prompt to paste elsewhere.",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
      {
        name: "openrouterApiKey",
        label: "OpenRouter API Key",
        description:
          "Optional — enables the design sheets and the storyboards (GPT Image 2.5). Without it the prompts are still assembled and can be copied into another tool.",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
    ],
    // The installer's template engine has `{{#key}}` sections and no inverted
    // form, so "no key" needs its own truthy key. The viewer reads the same
    // flags to grey out a paid button and say why.
    deriveParams: (params) => ({
      ...params,
      videoEnabled: params.falApiKey ? "true" : "",
      videoDisabled: params.falApiKey ? "" : "true",
      imagesEnabled: params.openrouterApiKey ? "true" : "",
      imagesDisabled: params.openrouterApiKey ? "" : "true",
    }),
  },

  evolution: {
    directive: `Learn how this user makes a series: the shape of their leads (silhouettes,
palettes, signature abilities), the gags and endings they like and the ones they
cut, their default episode length and shot count, how strict they are about a
drift, and what they are willing to spend per episode. Evidence comes from
session history, bible.json and its locks, each episode.json (shot lists, the
seconds they dragged, accepted drifts) and the craft project's costs. Write them
back as this skill's defaults so a new episode starts from the user's house
style while explicit instructions still win.`,
  },
};

export default animeSeriesManifest;
