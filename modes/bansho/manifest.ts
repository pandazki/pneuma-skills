/**
 * Bansho Mode Manifest (design §10).
 *
 * G4 (hard rule): NO React imports — this file is read by both the Bun
 * backend (skill install, source registry, watch patterns) and the
 * frontend. React bindings live in `pneuma-mode.ts`.
 *
 * v0.1 scope: the player shell (T4), the shipped seed boards (T5 wrote the
 * Chinese pair, T8 the English one and the gallery catalogue — see
 * `init.seeds` below), the interaction surface (T6 — the actions and
 * commands declared under `viewerApi`, plus the selection and notification
 * halves that live in the viewer), and the expression skill (T7 —
 * `skill/SKILL.md` + `skill/references/`, acceptance pinned by
 * `__tests__/skill.test.ts`).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { loadBoard, saveBoard } from "./domain.js";

const banshoManifest: ModeManifest = {
  name: "bansho",
  version: "0.25.1",
  // The name is the brand and stays romanized where the script has no
  // word for it (house style — `modes/kami/manifest.ts` ships "Kami" ×7);
  // the CJK locales have their own reading of 板書 and use it.
  displayName: {
    en: "Bansho",
    "zh-CN": "板书",
    "zh-TW": "板書",
    ja: "板書",
    ko: "판서",
    es: "Bansho",
    de: "Bansho",
  },
  description: {
    en: "Board-writing explainer — write a lecture in plain markdown and watch it perform itself: streaming handwriting, hand-drawn annotations, charts that draw stroke by stroke as the narration reaches them, scrubbable like a live lecture",
    "zh-CN":
      "板书式讲解——用普通 Markdown 写一份讲稿，它自己演出来：手写流式浮现、手绘标注、讲到哪画到哪的图表，可像回看直播一样拖动时间轴",
    "zh-TW":
      "板書式講解——用普通 Markdown 寫一份講稿，它自己演出來：手寫流式浮現、手繪標註、講到哪畫到哪的圖表，可像回看直播一樣拖動時間軸",
    ja: "板書で説明するモード——普通の Markdown で講義を書くと、板がそのまま演じます：手書きが流れ、強調は手描きの印になり、話が進むにつれてグラフが描かれる。生放送の講義のように時間を巻き戻せます",
    ko: "판서로 설명하는 모드 — 평범한 마크다운으로 강의를 쓰면 칠판이 그대로 연기합니다. 손글씨가 흘러나오고, 강조는 손으로 그린 자국이 되며, 이야기가 닿는 순간 그래프가 그려집니다. 생방송 강의처럼 되감을 수 있습니다",
    es: "Explicar escribiendo en la pizarra: redacta la clase en Markdown corriente y la pizarra la interpreta sola — escritura a mano que fluye, marcas dibujadas a mano y gráficas que se trazan cuando el relato llega a ellas, con línea de tiempo para volver atrás",
    de: "Erklären wie an der Tafel: Schreib die Vorlesung in schlichtem Markdown, und die Tafel führt sie selbst auf — fließende Handschrift, handgezeichnete Hervorhebungen und Diagramme, die entstehen, sobald die Erzählung sie erreicht; jederzeit zurückspulbar",
  },
  changelog: {
    // Wording discipline: these bullets render VERBATIM in the launcher's
    // skill-update prompt, so they may only claim what the build actually
    // does.
    "0.25.1": [
      "A place the board never writes is no longer a dead link. @board, an explicit pause and an unreadable block hold a step number without any ink of their own, so a chat card or a navigate-to addressed at one used to do nothing whatsoever — no move, and the refusal went into a result a card click throws away. It now goes to the moment the pen reaches that line, which for a lecture's opening @board is the top of the lecture",
      "A locator card in chat can only take the user to a place: it parks the board at that step, paused, and never plays. The skill never said so, so a card could be labelled 'play this from the top' and then sit still when it was clicked. It now says what a click does, and points at play-from — the action that actually plays, and that starts from the very top when given no address",
    ],
    "0.25.0": [
      "The board stops accusing writing that fits. A @strike or @circle paints its ink across the whole panel by design, and the width check was reading that bleed as the marked paragraph running off the board — on the stock tech seed it warned about a 565px column being '633px over' while every word stood inside it and the strike sat exactly on its target. The check now looks at what actually crosses the edge and stays quiet when it is only the board's own marks",
      "When something really is cut off, the warning now says what a fix needs: which edge, how far over in px, and the piece responsible — an unbreakable token is quoted back, an inline formula is told the display-formula move, a step taller than one board is told to split. 'Runs past the right edge' with an address alone sent an agent hunting through a paragraph that wrapped fine",
      "A step taller than one board is no longer described in right-edge words — it was riding the same warning with the wrong axis, so the fix it pointed at could not exist",
      "The unasked warnings carry each spot's own sentence now, not just its address and a quote. What reaches you unprompted is the same words check-board would answer with",
    ],
    "0.24.0": [
      "The board stops warning you about fonts it is drawing perfectly. Chinese characters are full-width in every Chinese font, so the check behind those warnings — which compared how WIDE the text came out — could never tell one Chinese face from another; it now compares what the two actually draw. On a 绿板·行楷 board with Xingkai SC installed, that check was calling all 312 Chinese characters of the lecture 'fallen back' while Xingkai SC was writing every one of them",
      "When a face really is missing, the theme picker now says what took its place — 'Xingkai SC → Zhi Mang Xing' rather than 'the board will fall back'. Getting 行草 instead of 行楷 is a substitution you might happily accept and getting a printed face is one you would not, and the old message read the same either way. The replacement is measured on your machine, not read off the order the fonts are listed in",
    ],
    "0.23.0": [
      "A board can choose its look. Three themes ship — 牛皮纸 (paper, pen), 绿板·行楷 (slate, running script, chalk) and 可爱·奶油 (cream, rounded) — and the picker shows you the actual board in each one rather than a name and a swatch. Picking writes the content set's own theme.css, so a lecture still carries its look with it",
      "Two of the faces ship with the mode, so a board looks the same on every machine. The cream theme's face covers Chinese and Latin in one family, and the slate theme now falls back to a bundled 行书 rather than to something printed — Xingkai SC is an optional macOS download, which the picker will also tell you",
      "The slate board writes in chalk. The ink carries grain, and erasing is a hand sweeping an arc rather than a straight cut — it takes most of the chalk and leaves a little, the way a real board does. The residue is seeded from the erase itself, so scrubbing back and forth shows the same marks every time",
      "Chalk belongs to slate. A paper board is unchanged: ink is either there or struck through, an erase is an exact absence, and none of the texture code runs",
      "The wall has an outside. Dragging past the edge now leaves a margin of room beyond the boards instead of stopping dead at the content — the give is a slice of the window, so it feels the same zoomed in or out",
    ],
    "0.22.1": [
      "Placing the pen with @at no longer sends the view back to the board you just left. Right after a @turn, a placement made the camera flash to the first board and sit there for over a second before correcting itself — the writing landed on the right board the whole time, so only the view was ever wrong. It now stays where the pen is",
    ],
    "0.22.0": [
      "A graph now grows into the room it was given instead of sitting in it. It used to be capped at whatever width its own boxes happened to need — a three-box Chinese chain drew at 452px on a 1242px board, a postage stamp beside 34px handwriting — and its lettering was a fixed 24px no matter how much room it had. Both are derived from the board now: a graph fills its region and is written in a hand you can read from the back of the room",
      "The eraser stays on the board the pen is standing at. It could be aimed by a quoted anchor at content anywhere in the room, which turned it into a way to grab space — clear a board you are not standing at, then move in. An erase now retires only what the pen is standing over and what the talk has finished with, and the lecture says so before it wipes",
      "The example lecture stopped teaching the move it is not allowed to make. Both technical seeds reached across the room to erase a board they had already left; a seed is few-shot material, so it taught that louder than the prose forbade it",
      "A figure gets looked at before it is left alone. A picture's size is the one thing about it that cannot be read back from the file, so the skill now treats seeing it as part of drawing it",
      "The voice is offered rather than forgotten. Narration is an optional finishing pass once the content is settled — the board says so when it is done, instead of quietly skipping it or spending on it unasked",
      "Muting releases the voice instead of silencing it, and the voice steps aside outside 1x-1.5x rather than being stretched. In both cases the lecture is unchanged: the same pacing, the same schedule, the pen still waiting for a long line",
    ],
    "0.21.1": [
      "Seeking no longer sends the voice back to the opening word. Scrubbing the timeline, playing from a step, or jumping back to live positioned the pen correctly and the narration not at all — the audio restarted from the beginning of the lecture every time. The board was asking for the right position; the file was being served in a way no browser can seek inside, so the request was silently clamped to zero. It is served properly now, and the voice lands where the pen does",
    ],
    "0.21.0": [
      "The voice has an off switch. A speaker button sits beside the playback-rate control in the transport, on any board that has recorded narration; a board with no voice does not grow one. The choice is remembered by your browser, so a lecture opened later stays the way you left it",
      "Muting silences the sound and nothing else. The pacing, the schedule and where the pen is are untouched: a step whose voice runs long still holds the pen until that voice would have finished, exactly as it does with sound on. A muted lecture is the same lecture",
      "It works on both voice paths — the mixed track and the clip-at-a-time fallback — and it stays muted when the board switches between them mid-lecture",
    ],
    "0.20.0": [
      "The lecture's voice can now be ONE continuous track instead of one clip per step. Playing a clip at a time meant every clip started from nothing buffered, and the browser ate the first syllable of each — this removes the seam rather than managing it. Run narrate, and once every clip is fresh it hands you a mix plan; scripts/mix-narration.mjs fuses the clips in PCM and writes narration/track.mp3 plus a layout sidecar",
      "The board VERIFIES that track against itself every time it loads: the clip order and every position must still match what it now performs. They do not — you appended a sentence, or the theme changed the font and the words re-wrapped — and the track is not played at all. The clips play one at a time instead (first syllable and all), a chip says so, and check-board reports staleTrack with the reason. Re-mix and it is right again",
      "So: mix LAST, after the writing has settled, and re-mix whenever the board changes",
    ],
    "0.19.1": [
      "A picture is fitted INSIDE the room its @at word gave it, on both sides: as wide as that room allows and never deeper than it. It used to be drawn the full width of the board whatever room you put it in, so a figure in a column hung off the right edge — and moving it to a bigger room made that worse, not better. Corner and band placements are worth a second look on any lecture written before this version",
      "A figure narrower than its room now stands centred in it, the way display math already did. Its shape is still exactly the ratio you declared: what gives is the size, never the proportions",
      "The room itself is unchanged, and it still fills up: a heading and a figure together in a half-deep band still overflows, and check-board still says so",
    ],
    "0.19.0": [
      "The board has a new voice: ByteDance Seed-Speech, chosen because it reads a bilingual lecture the way a bilingual person does — 「阿姆达尔定律」 and \"NVIDIA\" in one breath, with no language flag set at all. The old voice is still one flag away (--model gemini-3.1-flash-tts) and is still the one for inline expressive tags",
      "Clips are .mp3 now, because this voice returns no .wav — and their length is still MEASURED, not estimated, so a clip still paces the pen exactly as it did. A lecture already voiced keeps every clip it paid for and plays unchanged",
      "Asking a voice for a format it cannot make is refused before the request instead of writing the wrong bytes into a file with the right name; the same goes for a language spelled the other vendor's way, which used to cost a request and return no audio",
    ],
    "0.18.0": [
      "A lecture can carry a figure the board cannot draw itself. Two tiers, both decided in plan.md before the first board step: whatever a chart, a graph or ink on the words can say stays the board's own and is drawn in front of you one line at a time, and only a picture that needs real hand-drawing ability — a neuron, a cross-section, a thing whose likeness is the point — is ordered from an outside hand",
      "You never write how it should look. The skill owns the whole chalk-on-black opening of that order and the agent fills in the subject only, so the figure arrives in the board's own hand — and it carries no lettering, because every other word on that board was written by the pen, and a label drawn into the picture would be in the wrong hand",
      "Every ordered picture is drawn in ONE batch the moment the design is settled, never in the middle of writing. Each one costs real money and the better part of a minute; batched, the lecture is written without a single pause for one",
      "No fal.ai key stays an honest outcome: the design says which figure lost its tier, and the lecture either falls back to a chart or a graph the board draws itself, or drops the figure and tells you which one. Never a faked one",
    ],
    "0.17.4": [
      "The voice-over workflow's very first command now works. The synthesis example passed `--language \"cmn-CN\"`, which the service refuses outright — no audio was written, so every Chinese board that followed the documented steps got an error instead of a voice. It takes an English name: `\"Chinese Mandarin (China)\"`",
      "Recording a clip now asks for everything a clip needs. The instruction named only the file path, while a manifest entry is rejected without `seconds` and `text` as well — so a step could be synthesized, paid for, written down, and still play silent, with the instruction that caused it reading as correct",
    ],
    "0.17.3": [
      "A chart's y range is drawn from BOTH the ends you declare. Only the top one was read, so every plot's floor was an assumed zero: `y: -3 .. 3` was drawn on a 0..3.48 scale, which put its own lower end 235px below the bottom of the picture — the tick, its label and the whole negative half of the data off the canvas, with nothing reported anywhere. `y: -40 .. 25` lost even more. A range you already write as `0 .. N` scales exactly as it did",
      "That also makes the lower end worth choosing: a series that never drops below 60 says more on `y: 60 .. 100` than on `y: 0 .. 100`",
      "`y: 0 .. 0` (and the `y: 0 ..` typo) is now refused with a badge, like any other unreadable row. It used to quietly substitute a scale taken from your own numbers and mention it on a console nobody reads — so the board drew a real line between two axis labels that both said 0, and `check-board` called that board clean",
      "A graph annotation is written out in full. Past three wrapped lines the rest was dropped — no badge, no warning, no finding — and the box grows downward to hold it instead. A node whose box has swollen into a paragraph is the board telling you that sentence belongs in the talk",
    ],
    "0.17.2": [
      "`@turn` written straight under a sentence now turns the board. With no blank line between them it was read as part of that sentence and HANDWRITTEN onto the board — the words `@turn` in the middle of your prose, in front of the audience — and the room never turned. Every other verb (`@erase`, `@at`, `@focus`, `@overview`, `@board`, `@wait`) already broke the paragraph; this one was the exception",
      "Nothing warned you, and nothing could: a turn swallowed into a paragraph is valid prose, so `check-board` had nothing to report and the only signal was the line itself standing on the board",
      "A malformed turn glued the same way (`@turn 3`) is now told back to you as a broken step instead of being written out silently. Whether the author hears about a mistake no longer depends on the blank line above it",
      "Nothing else changed. A lecture that already left a blank line before every `@turn` — every seed, every existing board — performs exactly as it did",
    ],
    "0.17.1": [
      "The highlighter covers the characters it marks. The yellow band was placed on the middle of the LINE rather than on the middle of the writing — and a Chinese character fills its whole square, so the bottom of every single one of them stood outside the yellow. It read as a stripe cut through the writing instead of a marker laid over it: measured on a real board, nine tenths of a character covered at best, two thirds once the stroke's own taper and tilt are counted in",
      "The same mistake had moved two other marks, and both are fixed with it. `**下划线**` ran THROUGH the bottom of every Chinese character and through the tail of every j, p, q and y; it now passes under the writing. The ring of `((圈注))` cleared the top of what it circled by six pixels and the bottom by half a pixel — it now sits evenly around it",
      "`~~删除线~~` is exactly where it was, and that is deliberate: it was measured too, found to sit a hair above the middle of a character, which is where a strike belongs, and left alone",
      "The band still looks drawn by a hand — it lands, sweeps and lifts, and its edges are uneven — but the unevenness now only ever spills OUTSIDE the stroke. Whether a character ended up covered used to depend on which way the wobble happened to fall on that particular phrase",
      "Nothing else on any board moved. Only the four marks' own geometry changed: every wrap, every board break and every other stroke is exactly where it was",
    ],
    "0.17.0": [
      "The script now folds away, and the wall gets the room it was taking. The script sat in a permanent left column costing about a quarter of the window at every size — on a lecture with four boards that was the difference between reading the wall and squinting at it. It is a drawer now, shut when you arrive",
      "The way back is a slim spine down the left edge marked Script: one click slides it out, one click folds it back, and the choice is remembered so an author who works with it open is not re-opening it after every reload",
      "Shut, it still tells you something is wrong. The count of blocks that could not be read, formulas that failed to render and placements standing on each other used to live in the script's header, where folding it away would have hidden it — it now sits on the spine, so a board with a problem cannot look like a finished one",
      "Open, it works exactly as it did: the line being performed lights up as the pen reaches it, and the board stays fully visible beside it rather than hiding behind the panel",
      "Nothing on any board moved. A board has a fixed size, so opening or folding the drawer changes how much of the wall fits on your screen and never how the lecture is written — measured, not assumed: every wrap, every board break and every stroke comes back byte-identical with the drawer open and with it shut, at both window widths",
    ],
    "0.16.2": [
      "How full a board is now counts everything standing on it. Occupancy only ever counted the room's own flow, so a board composed with `@at` — two pools side by side, a top band, any named placement — reported near-zero while standing visibly full. `glance-board` called such a board blank and never printed its percentage at all, and `check-board` accused it of being abandoned half-written: one lecture collected twelve of those false findings and its author had to photograph every board by hand to be sure",
      "The number is now the share of the face that stands written on, every claim counted once — two half-width pools written to 80% read 80%, and writing that overlaps is not counted twice. `glance-board` and `turnUnderfilled` quote the same field, so the two readings an author sees minutes apart can no longer disagree",
      "'Room for about N more steps' is now the room the PEN has. Standing in a named region it is that region's own remaining depth, not the whole face's — a frame does not migrate, so the bare half beside it was never the pen's to use. Standing in the room's flow, ink an `@at` already put on the face shortens the answer instead of being invisible to it",
      "Nothing moved on any board: this is accounting, not placement. A lecture written before this version performs exactly as it did, and reads its own occupancy correctly for the first time",
    ],
    "0.16.1": [
      "Pointing at a step on a wall no longer leaves the last one outlined. On a lecture with more than one board, every step you pointed at kept its orange outline forever: six clicks, six outlines, while the chat's chip named one — and clearing the chip left all six standing for a selection that was gone. The board and the chip now always name the same step, or nothing at all",
    ],
    "0.16.0": [
      "A passage that runs off the bottom of a board now SHOWS it. The board's edge clips whatever passes it, so a lecture could end a sentence in the middle of a word and look, in the picture and in `capture`, exactly like a board that had simply ended. The cut now wears a dashed line across the column that ran off, captioned with how much writing is below it. Nothing moved and nothing shrank — the mark reports, it does not repair",
      "The overflow finding says what to do about it, and stops saying the one thing that was not true. `regionBurst` used to end with 'it is written in full anyway', which reads as permission — an agent measured its own 101px overrun, wrote the passage anyway, and shipped two boards ending mid-sentence. It now says how far past the board's edge the writing falls, that nothing past that edge is written, and the three moves that actually change the height: say less, take a word with more room, or `@turn` for a board of its own",
      "'Split the step' is gone from that advice, because it could not work: a named region never migrates, so two short steps in the same frame stand exactly as tall as one long one. And when the room's own flow is what ran off, the message no longer suggests a wider word or a turn — neither exists for it; it names the retirement (`@erase \"锚\"`) that does",
      "The skill teaches the word now. A region's size is a budget you weigh a passage against BEFORE naming it, with rough capacities per word in the planning reference, and the full consequence — including that a board is an object with an edge, not a budget — in the dialect reference",
    ],
    "0.15.0": [
      "You can watch a lecture at 2x, 4x, 8x or 16x. Judging a wall used to cost the whole lecture in real time — 1.5x was the ceiling, so five minutes of board took five minutes to look at. Sixteen makes those five minutes twenty seconds, which is a glance rather than a sitting. The slow end is untouched: 0.75x is still there for watching one stroke land",
      "The speed control is a MENU now, not a button that steps forward one notch. Eight rungs on a cycle would be seven clicks to reach the top and one more to fall off it; the menu is one click open and one click to any speed, in either direction. It still shows the current speed on its face, and it still opens and walks from the keyboard",
      "Above 4x a recorded voice steps aside and the board runs silent. Browsers do not agree on what a sixteen-times playback rate means — some clamp it, some ignore it, some mute it — and a voice that quietly kept its own speed would have dragged the board back down to it, with a long clip holding the pen at a standstill while it finished. So past 4x the picture is the whole performance, at exactly the speed asked for. The menu says which rungs those are before you pick one, on a board that has a voice",
    ],
    "0.14.0": [
      "A board has a size of its own. Until now a board was exactly as wide as your window, so every consequence of its width followed your window too: how wide a line is, where it wraps, how much one board holds, which board a passage lands on, whether a `@turn` finds a clean one. Two people opening the same `board.md` on two screens were watching two different lectures — and every clean `check-board` was a claim about one window",
      "The board is 1242 x 894 now, on every screen, and the camera is what adapts: at rest it shows exactly one board, whatever your window. A wide monitor therefore shows a 2x2 room BIGGER rather than showing a bigger room — which is the whole of the complaint that the type kept shrinking as the window grew",
      "The proof is a measurement, not a promise: the board's canonical layout is captured at 1280 and at 1990 and the two files are byte-identical. `harness/two-width.sh` is that check, and it is a standing leg of the layout gate now",
      "What this costs, said plainly: every wrap in every existing lecture is re-based once against the canonical width, so a passage may land on a different board than it did before. Re-read a lecture written before this version once, and re-run `check-board`",
    ],
    "0.13.5": [
      "The lecture gets designed before it gets written. There was no move that happened BEFORE writing — six of them, all rhetorical moves inside a lecture — so a board got written well sentence by sentence and was never designed as a whole. Measured on a real wall: four boards, three of them holding one column of two, and not a single figure in a lecture whose central idea was a picture. The design now lands in `plan.md` beside `board.md`, and it names, for every passage, whether it is words or a picture, which board and which column it takes, and roughly how long it runs",
      "A passage that counts, compares, splits or traces a flow is a picture — that is now a rule you can apply rather than a hope. It is the decision that never got made, because it can only be made BEFORE the sentences exist: prose that has already been written reads finished, and nobody deletes finished prose to draw the picture it was standing in for",
      "A design is not the cached picture of the board the skill has always forbidden, and the two are now stated in one breath. The board is the only thing that can say what stands; nothing but you can say what you meant to teach. When they disagree, you look at the board and then rewrite the design in the file — in one line, saying what changed. A design silently abandoned mid-lecture is the failure the whole move exists to prevent",
      "In Claude Code the design is a workflow, not just advice: rival arcs are proposed in parallel and judged, the design is written, and a second agent critiques it for missing pictures and unused columns — all before one board step exists. Backends without a workflow runner follow the same strategy from the skill text, which is where it is written first",
    ],
    "0.13.4": [
      "Walking away from a half-written board is now said back to you. A face fills in two columns, so a lecture that wrote down the left of a board and turned had spent a whole blackboard on one column of talk — and at the old setting the board called that a legitimate composition and stayed quiet. `check-board` now names any `@turn` that leaves a board less than three quarters written, which is the point past which the room really had no space left for the next section",
    ],
    "0.13.3": [
      "A dot product written in a sentence and a `\\cdot` written in a formula are now the same mark in the same hand. Three characters no handwriting face carries — the dot operator, the conditional bar and the minus sign — were being drawn by a Chinese font while the chalk around them came from another, and prose had never had the fix that formulas got",
      "An arrow is left exactly as you wrote it, and this is a decision rather than an omission: no handwriting face on the machine carries one, and printing `->` in its place would be a different mark. Measured, it is a properly drawn arrow from a face the board itself declares — unlike the conditional bar, which was a hairline adrift in a slot twice a letter's width",
      "The board now NAMES the characters it cannot write by hand, instead of only saying that something fell back. A stack missing a Chinese family reads `handwriting font fallback: 字 形 巡 检 …` — which is a five-second diagnosis, where the old chip sent authors to `document.fonts.check` (which answers about the font family and never about the character) and then to giving up",
      "`P(+)` is written `P(+)` and not `P( + )`. A plus with nothing on its left is not an addition, and mathematics sets it tight; the board was giving every `+` and `−` the full space of an operator between two numbers. A genuine `(a + b) - c` and `n! + m` keep their air",
    ],
    "0.13.2": [
      "The wall map shows what is written RIGHT NOW. It used to draw the finished lecture at every moment of it, so scrubbing the timeline changed nothing and a reader looking at the map to find their place was shown the future. Each step's marks now appear when its own writing starts and leave when the sweep that erases them begins",
      "The board behaves like the infinite canvas it is: the wheel (and a trackpad's scroll) zooms at the cursor with no modifier, the middle button drags the view, and nothing scrolls a page any more. Left-drag still pans and pinch still zooms",
      "Taking the camera \u2014 by wheel or by hand \u2014 now stops the performance, so a lecture can no longer walk on to the next board behind a view you are holding. Pressing play puts you back where the performance is: standing in front of the board being written on, with the live line comfortably in view and its context above it",
      "A camera following the pen across a wall of boards stays ON the board it is following. In a window too short to hold a whole board, crossing to the row below used to leave the view stranded in the gap between rows with the previous board still filling it",
    ],
    "0.13.1": [
      "A conditional probability is written by the same hand as the letters beside it. The bar in `P(D \\mid +)` was the one character on the board no handwriting face carries, so it was quietly drawn by a Chinese font at double a letter's width — a thin stroke floating in a two-space gap, which is why the formula read as coming apart. It is the pen's own bar now, and the formula is about a seventh narrower, so it is set larger in the same column",
      "A formula wobbles as ONE written thing instead of one letter at a time. Every glyph used to be tilted and nudged on its own, which is a hand on prose and a broken expression in mathematics — a bracket no longer matched its partner. The whole expression leans one way now, with the line drifting slowly under it, so the pairing and stacking the notation depends on survive",
    ],
    "0.13.0": [
      "The board is written by a hand now, not printed by a machine: every block sits at its own slight angle, each word drifts a hair off the line, and the slate carries chalk grain and the smears a cloth leaves. It is content-seeded, so the same lecture leans the same way on every reload and in every export",
      "One knob controls all of it \u2014 `--bansho-flaw` in a content set's `theme.css`. 0 is a perfectly clean board, 1 is the default hand, 3 is deliberately overdone. Every bit of it is paint-time: the writing leans where it already stood, so line breaks, timings and the board's height are byte-for-byte what they were",
    ],
    "0.12.2": [
      "A line never begins with a full stop or a comma again, and never ends with an opening bracket. Punctuation now belongs to the word it sits against \u2014 the pen writes \u300c\u540e\u9a8c\u3002\u300d in one motion, the way a hand does \u2014 so a narrow column can no longer strand a lone \u3002 at the head of the next line. Latin marks follow the same rule",
      "When the whole wall is smaller than the window, it hangs in the MIDDLE of it instead of against the top-left corner with dead room to the right",
    ],
    "0.12.1": [
      "An underline now sits under the words it belongs to, on every line they take. When a bold or highlighted phrase wrapped, the mark used to run past the end of the phrase to the edge of the column and the second line got no mark at all — the board was measuring your writing against the whole width of the face while writing it into a column half that wide, so every line break, every mark and every block height answered a page nobody was reading. All of them are measured in the column the writing actually lives in now",
      "A wrapped bullet HANGS: its later lines line up under the item's text instead of starting back under the dot, so a long item reads as one item",
    ],
    "0.12.0": [
      "A board is written on now, not printed on. The writing is HALF AGAIN AS LARGE \u2014 lines of about a dozen characters instead of thirty-six, which is what a line on a real blackboard is \u2014 and a title is twice the writing under it instead of a slightly bigger paragraph, so a board reads from the back of the room and you can see at a glance what it is about",
      "The pen fills a board in COLUMNS. When writing reaches the bottom of the left half it carries on at the TOP OF THE RIGHT, the way a teacher fills a wide board, and only a full FACE sends it to a clean one \u2014 so a board holds about twice what it held before, and consecutive sections stop starting at the same corner. You write nothing new for this: it is what happens when you say nothing at all",
      "A formula is now the CENTREPIECE of its stretch, not another line in the queue \u2014 half again the size of the words around it, centred in its column with room to breathe on both sides, so the thing a section is ABOUT is the thing you see first. A chart or a graph takes the whole board: they are sized by their own drawing rather than by where the words wrap",
      "check-board tells you when a @turn walks away from a board you had barely written on (turnUnderfilled), with the percentage it was filled to",
    ],
    "0.11.0": [
      "Your boards hang in a ROOM now, not in a line. Four boards used to march off to the right, so seeing all of them meant shrinking the wall to a quarter and staring at a strip of postcards over an empty void. They stand two across and two high, the way the sliding panels in a lecture hall do \u2014 with a frame around each one, a chalk tray under every row, and lit wall behind them. Two boards stand side by side; three stand two over one. Nothing you write changes, and the camera walks the new shape: moving down to the board below is a journey now, exactly like moving to the one beside it",
      "The overview is a MAP of the wall, in the corner, and it shows the real shape of what is written on every board \u2014 the board with the formula in the middle looks like the board with the formula in the middle. The orange rectangle on it is where you are standing: drag the map to walk the room, roll the wheel to zoom into it, click a board to go and stand in front of that one. It folds away when you want the board to yourself",
    ],
    "0.10.0": [
      "EVERY change of board is now a walk, not a cut. @turn already glided; the other eleven board changes in a real lecture did not \u2014 when the pen moved to the next board on its own, when the hand crossed the room to wipe a board, when a curve was added to a chart standing somewhere else, the room simply WAS somewhere else the next frame. All of them travel now, on the same path @turn takes, and the pause before the step is widened to exactly the time the journey needs so nothing is written while the camera is moving",
      "A map of the wall sits above the board: one tile per board, filled from the top as you write, with the board you are looking at outlined. It answers the three questions you could not ask before \u2014 how many boards there are, which one you are on, and how full each one is \u2014 and clicking a tile takes you there",
    ],
    "0.9.0": [
      "You can SEE the pen walk to the next board. @turn used to be an instant cut — the board was simply somewhere else the next frame, and four boards read as four slides. Now the walk is a real move: the room pulls back far enough that you see both boards at once, turns toward where it is going, and settles square-on in front of the new one. Nothing you write changes; every @turn you have already written now performs",
      "@turn is taught as what it actually is: \"there is no room left here\", not \"new topic\". The room already carries overflow onto a blank board by itself, so a heading needs no turn — and a turn written at a topic boundary spends a whole blackboard on a paragraph. Before you turn, the question is whether the right half of the board under you is still empty, because that is where the next block belongs (@at right), not on a fresh board",
    ],
    "0.8.1": [
      "The full-dialect reference now teaches @at — it shipped with the placement verb missing entirely, so looking up the form found nothing. Both forms, all nine words, and the one asymmetry that decides your first board: only full writes below what already stands; a named region starts at its own word's place, so a full-width title followed by @at left puts the column on the title. The shape that says it without the overlap (@at top for the banner, the two bottom corners for the columns) is written out beside it",
      "Three promises the reference still made about a room that changed are gone: it said the board would erase your earliest-filled one to keep going, that @turn into a full wall would retire a board for you, and that the eraser always takes a whole board. None of those is true since the room stopped erasing on your behalf, and the reference now says what @erase actually reaches (the region the pen stands in) and what a full wall actually does (nothing, out loud)",
    ],
    "0.8.0": [
      "Before you write, you can SEE what a placement would cover: frame-board draws your candidate @at declarations over a picture of the real board and says, per candidate, how big it is and which standing writing it lands on. It draws declarations, not predictions \u2014 nothing is moved to dodge a collision, and whether the writing fills its frame is still answered after you write",
      "You can say WHERE to write — @at right, @at top-left \"那个定义\", @at full to come back — and the words are all there is to say: no pixels, no percentages, no board numbers, just nine names for parts of a board (three on the long strip). Everything you write after it lands there until you say otherwise",
      "The room stopped erasing on your behalf. A full board still sends writing to a blank one, but a full WALL now leaves the pen where it is and lets the writing run past the bottom edge, in view — and @turn on a full wall does nothing at all and says so. Which board gets retired is yours to decide, always, with @erase",
      "@erase narrowed to what you actually finished: bare @erase clears the region the pen is standing in, so a corner definition survives while the flow beside it is wiped",
      "The board says what your declarations did — two placements standing on each other, or writing taller than the frame it was put in, come back as regionCollision and regionBurst, and the first collision of a pair arrives unasked",
    ],
    "0.7.0": [
      "The board turns as the camera travels — a switch between boards or in and out of @overview now carries perspective, leaning toward where the view is going and squaring up again the moment it arrives; at rest the board always faces you with unskewed writing, because at rest its job is to be read",
      "A Parallax switch above the board — turn it on and the pointer rocks the board a few degrees, so the depth is something you can feel rather than take on trust; it is off by default, and stays off when your system asks for reduced motion",
    ],
    "0.6.0": [
      "Formulas are written in the board's own hand — the browser used to force its math font onto every symbol, so a formula sat on the board as a typeset patch beside the handwriting; fraction bars are drawn strokes now, and each glyph carries a small seeded wobble",
      "The shipped boards now teach the room — the concept explainer stands four boards, turns to a fresh one at each movement, retires the algebra board by name once the curves have taken it over, and steps back with @overview before its close",
      "The proposal boards draw their pipeline as a graph — boxes, arrows and a note written into one of them — and walk the camera back with @focus to the one line the ask rests on",
    ],
    "0.5.1": [
      "Take the board in your hand — drag anywhere to pan it like a canvas; the drag pauses the performance, and pressing play again returns the view to the pen",
    ],
    "0.5.0": [
      "Look up before you write — the glance-board action answers what stands on each board, the room left, what has been erased, and what the room will do when the current board fills; cheap enough to call before every append",
      "@turn — the dialect's third stage verb: new topic, leave that board standing; the room picks the next board, and on a full wall it erases the earliest-filled one first",
      "The room speaks when it erases — an auto-erase (overflow or @turn) pushes one notice naming the board, its sections and step count, so nothing is retired in silence",
    ],
    "0.4.0": [
      "The room is configurable — @board 2-4 as the lecture's first line stands that many boards side by side; the lecture fills them in order and the camera walks with the pen",
      "The camera takes direction — @focus \"anchor text\" walks the view back to earlier writing, @overview steps back to show everything written so far, and the camera returns to the pen when writing resumes",
      "Erasing is a move — @erase clears the board under the pen, @erase \"anchor text\" clears the board that text lives on, and a full room erases its earliest-filled board by itself; scrubbing back always brings erased content back",
      "A Notes view beside the board — the whole lecture on one long page, erased content included; nothing that played is ever lost",
    ],
    "0.3.1": [
      "The voice keeps its lane — a long clip finishes before the next voiced step takes the board, and scrubbing past a hold skips the tail instead of carrying it over the next step's writing",
      "A stalled or missing clip never freezes or slows the board silently — playback continues, a chip counts the silent clips, and check-board reports each as narrationClipMissing",
      "Formulas are listed in the narrate plan with status silent, so their cache keys are available before the first clip exists",
      "A freshly applied seed board performs from the first stroke instead of appearing fully written",
    ],
    "0.3.0": [
      "The board speaks — recorded clips play in step with the writing; a clip that outruns its sentence holds the clock at the next pen-down until the voice finishes, and a board with no voice plays exactly as before",
      "Subtitles within reach — an Export subtitles button under the board asks the agent to save the SRT / VTT files",
      "Honest voice status — narrate checks each recorded clip exists on disk and flips missing ones back to needs-audio",
    ],
    "0.2.0": [
      "Voice-over groundwork — the narrate action plans per-sentence clips with content-addressed caching, and a recorded clip's length paces the writing",
      "Subtitles — the subtitles action answers the lecture as finished SRT / VTT text; voiced cues follow their clip's audio window, unvoiced cues the writing",
    ],
    "0.1.0": [
      "First playable build — streaming board player with scrub, rate and live-follow",
    ],
  },
  // Board + chalk stroke motif.
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M6.5 8.5c2.5-1.2 5-1.2 7.5 0"/><path d="M6.5 12.5h6"/><path d="m15.5 20.5 3-3.5"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-bansho",
    // Two shared CLIs (the same sources clipcraft and illustrate install),
    // both fed by the ONE falApiKey init param below via .env: the voice's
    // synthesis half, and the drawing hand a tier-2 figure is ordered from
    // (`skill/references/illustrations.md`). No key is an honest outcome
    // for both — the board plays as written, and a figure the board cannot
    // draw itself falls back to tier 1 or is dropped out loud.
    sharedScripts: ["generate-tts.mjs", "generate_image.mjs"],
    envMapping: {
      FAL_KEY: "falApiKey",
    },
    mdScene:
      "You and the user are at a whiteboard inside Pneuma. You explain by writing a lecture — plain structured markdown in board.md. Everything you write performs itself on the user's board: handwriting flows in, your emphasis marks become hand-drawn ink, your charts draw themselves as the narration reaches them. History only accumulates — an appended @erase can retire a finished board while scrubbing back still re-shows everything, and @focus / @overview direct the camera at the turns. The user can scrub back through time like replaying a lecture.",
  },

  viewer: {
    // Narration audio is content-addressed (narration/<step hash>.wav —
    // new content is a new file name), so only the MANIFEST is watched:
    // its write is the agent's commit signal, and stale-URL caching is
    // structurally impossible. A drawn figure is watched BOTH ways: its
    // sidecar (the write the skill says to save LAST — the commit signal
    // that a lecture's pictures changed) and the picture files themselves,
    // because a re-draw lands on the SAME path — the one thing content
    // addressing rules out for audio and does not for a re-ordered figure.
    watchPatterns: [
      "**/board.md",
      "**/theme.css",
      "**/assets/**/*",
      "**/narration/manifest.json",
      "**/narration/track.json",
      "**/illustrations/manifest.json",
      "**/illustrations/**/*",
    ],
    ignorePatterns: [],
    serveDir: ".",
  },

  sources: {
    board: {
      kind: "aggregate-file",
      config: {
        patterns: [
          "**/board.md",
          "**/theme.css",
          "**/narration/manifest.json",
          "**/narration/track.json",
          "**/illustrations/manifest.json",
        ],
        load: loadBoard,
        save: saveBoard, // v1 stub — the viewer is a player, not an editor
      },
    },
    assets: {
      kind: "file-glob",
      config: { patterns: ["**/assets/**/*"] },
    },
  },

  viewerApi: {
    workspace: {
      type: "single",
      multiFile: false,
      ordered: false,
      hasActiveFile: false,
      supportsContentSets: true,
    },

    // The address vocabulary these share is `{section, step}` — sections
    // counted from 0 (the opening, before the first `##`), steps from 1.
    // The board reports the same shape back whenever the user points at
    // something, so an address can be copied straight out of a
    // `<viewer-context>` block into any of these.
    //
    // Deliberately ABSENT: play / pause / scrub / playback rate. Those are
    // the user's own controls over their own board; an action for them
    // would be taking the remote out of their hand.
    actions: [
      {
        id: "glance-board",
        label: "Glance at the board",
        category: "custom",
        agentInvocable: true,
        params: {},
        // The rhythm lives in this description on purpose (design §10.4):
        // it is injected through the pneuma:viewer-api marker block —
        // a standing teaching surface that costs zero SKILL.md lines.
        description:
          "Look up at the board before you write — the teacher's glance. Answers what is standing on each board (sections and step ranges), how much room is left, which boards are blank or finished, what has been erased, where writing goes when the current board fills — a blank board, or nowhere, because the room never retires anything for you — and the last thing written. Cheap by design: call it before every append batch to decide — take a blank board, retire a finished one yourself, place the next block with @at, or keep writing — and after any mid-document edit. Check that the tip echoes your latest append; if it does not, ask again.",
      },
      {
        id: "navigate-to",
        label: "Show a step",
        category: "navigate",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              'Which step to show, as {"section":N,"step":M}. Sections count from 0 — section 0 is the opening, before the first "##" heading. Steps count from 1 within their section. Leave out "step" to land on the section title itself. This moves the board the user is watching: an address that names another board ("contentSet") is refused rather than applied to this one — hand the user a <viewer-locator> card to take them across.',
            required: true,
          },
        },
        description:
          "Put the board at the moment that step finished being written and bring it into view. Use it right after you add or correct something, so the user is looking at what you changed instead of hunting for it.",
      },
      {
        id: "play-from",
        label: "Play from a step",
        category: "ui",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              'Where to start, as {"section":N,"step":M}. Leave it out to play the whole board from the top. Like navigate-to, it plays the board the user is watching and refuses an address that names another one.',
            required: false,
          },
        },
        description:
          'Play the board forward from that step — the "let me walk you through this part again" verb. The user can still take over at any time.',
      },
      {
        id: "check-board",
        label: "Check the board",
        category: "custom",
        agentInvocable: true,
        params: {},
        description:
          "Ask the board what it could not perform: blocks it could not read, quoted look-backs and chart names that matched nothing on the board, formulas it could not write out, and lines that run past the right edge. Each finding names the step it happened in, so its address goes straight into navigate-to. Worth running after a batch of edits.",
      },
      {
        id: "frame-board",
        label: "Frame a placement",
        category: "custom",
        agentInvocable: true,
        params: {
          placements: {
            type: "object",
            description:
              'Up to 8 candidate placements, in the dialect\'s own words: [{"at":"right"},{"at":"top-left","anchor":"\u90a3\u4e2a\u5b9a\u4e49","label":"B"}]. "at" is a region word (full / left / right / top / bottom / the four corners; only full / left / right on the long strip), "anchor" is the quoted look-back an anchored placement hangs from, "label" captions the frame. Omit it entirely to get the wall annotated with nothing proposed.',
          },
        },
        description:
          "Before you write a batch that deserves a place, see what your declaration would cover: the candidate frames drawn over a picture of the real board, plus a line per candidate saying how big it is, where it sits, and which standing writing it lands on. It draws DECLARATIONS, not predictions \u2014 the frame is exactly the rectangle your words claim, nothing is moved to avoid a collision, and whether the content FILLS its frame is answered after you write, by glance-board and capture.",
      },
      {
        id: "narrate",
        label: "Plan the voice-over",
        category: "custom",
        agentInvocable: true,
        params: {},
        description:
          'Ask the board which steps want a voice. Every speakable step comes back with its address, cache key, suggested spoken line, both clip paths — "file" is the manifest value (relative to the content set, use verbatim) and "output" is the workspace path to synthesize to — and whether a recorded clip is already fresh; plus clips that no longer match anything and are safe to delete. Synthesize only the steps marked needs-audio, then record each clip in the content set\'s narration/manifest.json under the step\'s key with all three required fields — "file", "seconds" (from the synthesis command\'s --json output) and "text" (what was actually spoken); an entry missing any of them is rejected and that step loses its voice. See the skill\'s references/narration.md for the workflow. A board with no voice plays fine without any of this.',
      },
      {
        id: "subtitles",
        label: "Export subtitles",
        category: "custom",
        agentInvocable: true,
        params: {},
        description:
          "Ask the board for the lecture's subtitles as finished SRT and VTT text. A voiced step's cue spans its clip's audio window; an unvoiced step's cue spans its writing window on the schedule. Save data.srt / data.vtt verbatim to the paths in data.save — never compute or adjust a cue time yourself. Works without any voice-over: cue text falls back to each step's written words.",
      },
    ],

    // The other direction: what the user hands back to you. All three are
    // about the explanation, never about the board's controls.
    commands: [
      {
        id: "continue-here",
        label: "Continue from here",
        description:
          "The user wants you to keep explaining from the step they are pointing at — go deeper, give an example, answer what it raises. The viewer context names the exact step. Append to board.md; do not rewrite what is already up there.",
      },
      {
        id: "retell-this",
        label: "Say this part again",
        description:
          "The user did not follow this part. Rewrite that stretch of board.md to explain the same thing more carefully — smaller steps, plainer words. Repeating the same sentences is not an answer.",
      },
      {
        id: "another-angle",
        label: "Explain it differently",
        description:
          "The user follows the words but not the point. Replace that stretch with a different route to the same idea: another example, a comparison, a smaller case first. Change the approach, not just the wording.",
      },
      // The one command that is not about a pointed-at step: it needs the
      // AGENT because the deliverable is files in the workspace (§9 —
      // files are the collaboration surface; the viewer computes the text,
      // the agent is the one who writes it to disk).
      {
        id: "export-subtitles",
        label: "Export subtitles",
        description:
          "The user wants the lecture's subtitles saved as files. Call the subtitles action, then save data.srt and data.vtt verbatim to the workspace paths in data.save — never retime or edit a cue yourself — and tell the user where the two files landed.",
      },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Bansho" skill="pneuma-bansho" session="new"></system-info>
The user opened Bansho to have something explained on a board. Write the lecture into board.md as plain structured markdown — append one or two steps per edit so the board performs live. History only accumulates: never delete or rewrite what is already told — correct it in view, and retire a finished board with an appended @erase when it has served its purpose, or @turn to a fresh board when the subject changes. The room never retires a board on your behalf, so retiring is always yours to say. A board is a surface, not a column: when a block wants a place — a figure beside the prose, a definition parked in a corner — say @at right / @at top-left and it lands there. Look up before you write — the glance-board action tells you what is standing and where there is room, the way a teacher glances at the wall before writing the next line.`,
  },

  init: {
    contentCheckPattern: "**/board.md",
    // Directory-shaped entries (§13): each seed is a content set —
    // `board.md` + its own `theme.css`. Directory shape alone would let the
    // gallery auto-derive a card per seed (see `.claude/rules/modes.md`),
    // but an auto-derived card is a title guessed from the folder name and
    // nothing else — so the catalogue below is declared for real.
    seedFiles: {
      "modes/bansho/seed/tech-zh/": "tech-zh/",
      "modes/bansho/seed/pitch-zh/": "pitch-zh/",
      "modes/bansho/seed/tech-en/": "tech-en/",
      "modes/bansho/seed/pitch-en/": "pitch-en/",
    },
    // Two boards, each in both languages. The pairs are lectures on the
    // same subject written natively in each language, not translations of
    // one another — a board is few-shot material for the agent as much as
    // a first impression for the user, and translated prose would teach
    // translated rhythm.
    seeds: [
      {
        id: "tech-zh",
        sourceKey: "modes/bansho/seed/tech-zh/",
        thumbnail: "tech-zh.png",
        displayName: {
          en: "Concept explainer · Chinese",
          "zh-CN": "讲透一个概念 · 中文",
          "zh-TW": "講透一個概念 · 中文",
          ja: "概念を解きほぐす · 中国語",
          ko: "개념 풀어내기 · 중국어",
          es: "Explicar un concepto · Chino",
          de: "Ein Konzept erklären · Chinesisch",
        },
        description: {
          en: "Amdahl's law across four boards: formulas written by hand, two curves on one chart, the chart put down once it has made its point, the saying crossed out.",
          "zh-CN":
            "用四块板讲「加机器为什么不一定更快」：公式一笔笔写出来，两条曲线画在同一张图上，图讲完了就把眼前这块板擦掉、结论写在原地，最后回头划掉那句口头禅。",
        },
        tags: ["中文", "技术讲解"],
      },
      {
        id: "pitch-zh",
        sourceKey: "modes/bansho/seed/pitch-zh/",
        thumbnail: "pitch-zh.png",
        displayName: {
          en: "Proposal pitch · Chinese",
          "zh-CN": "讲清一份提案 · 中文",
          "zh-TW": "講清一份提案 · 中文",
          ja: "提案を語る · 中国語",
          ko: "제안 설득하기 · 중국어",
          es: "Defender una propuesta · Chino",
          de: "Einen Vorschlag vortragen · Chinesisch",
        },
        description: {
          en: "A release-cadence proposal on one long board: three claims in columns, the pipeline drawn as boxes and arrows, two trends on one chart, the ask circled.",
          "zh-CN":
            "一份改发布节奏的提案，写在一条长板上：三点并列对齐，流水线画成方框和箭头，前后两条曲线画在同一张图上，最后镜头走回中间那一行，把结论圈起来。",
        },
        tags: ["中文", "方案提案"],
      },
      {
        id: "tech-en",
        sourceKey: "modes/bansho/seed/tech-en/",
        thumbnail: "tech-en.png",
        displayName: {
          en: "Concept explainer · English",
          "zh-CN": "讲透一个概念 · 英文",
          "zh-TW": "講透一個概念 · 英文",
          ja: "概念を解きほぐす · 英語",
          ko: "개념 풀어내기 · 영어",
          es: "Explicar un concepto · Inglés",
          de: "Ein Konzept erklären · Englisch",
        },
        description: {
          en: "The same subject in English, on four boards: Amdahl's ceiling, the coherence cost that bends the curve down, and a saying struck out once it is earned.",
          "zh-CN":
            "同一个题目的英文板，站四块板：阿姆达尔天花板、让曲线掉头的相干开销，等论证站住了再回头把那句口头禅划掉。",
        },
        tags: ["English", "Explainer"],
      },
      {
        id: "pitch-en",
        sourceKey: "modes/bansho/seed/pitch-en/",
        thumbnail: "pitch-en.png",
        displayName: {
          en: "Proposal pitch · English",
          "zh-CN": "讲清一份提案 · 英文",
          "zh-TW": "講清一份提案 · 英文",
          ja: "提案を語る · 英語",
          ko: "제안 설득하기 · 영어",
          es: "Defender una propuesta · Inglés",
          de: "Einen Vorschlag vortragen · Englisch",
        },
        description: {
          en: "The same pitch in English: the pipeline as boxes and arrows, monthly releases against daily ones, recovery time falling, and the ask circled at the close.",
          "zh-CN":
            "同一份提案的英文板：流水线画成方框和箭头，月发与日发对照，半年里恢复时间一路下降，最后把诉求圈出来。",
        },
        tags: ["English", "Proposal"],
      },
    ],
    params: [
      {
        name: "falApiKey",
        label: "fal.ai API Key",
        description:
          "lets the agent give the board a voice (TTS clips) and order the few figures the board cannot draw itself — leave empty and both are skipped: the lecture plays as written, and a figure that needed a drawing hand falls back to a chart or a graph, or is dropped out loud",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
    ],
  },

  // What `pneuma evolve bansho` goes looking for. It is a description of
  // what to LEARN about this user, never a list of things to do to the
  // board — the evolution agent reads this, then writes skill text the
  // main agent reads, so a "do X" here becomes a house rule two hops down
  // and outranks the user's own way of explaining.
  evolution: {
    directive: `Learn how this user explains things, from their conversation history and the boards they left behind.
Focus on: the pacing of an explanation — short quick steps or long settled ones, how long they dwell before turning a corner;
what they habitually emphasize, and what they are content to leave plain;
whether they give the conclusion first and then earn it, or lay the ground first and arrive at it;
how readily they reach for a chart or a formula instead of plain sentences;
and their wording habits in Chinese and in English, which are seldom the same habits twice.
Augment the skill so a board written for this user sounds like the way they themselves explain, while their explicit instructions always win.`,
  },

  // "Replay a lecture" is a real consumption scenario (--viewing / player).
  editing: { supported: true },

  layout: "app",
};

export default banshoManifest;
