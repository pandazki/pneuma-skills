# Previz — experiment record (2026-09-20)

Everything paid for and everything learned while building `previz` in one day, kept because none of
it is derivable from the code. Design brief: [2026-09-20-previz-mode.md](2026-09-20-previz-mode.md).
All video is Seedance 2.5 reference-to-video on fal, 480p, 8 s, greybox as `[Video1]`: **$2.1168 and
about five minutes per take**. Seven takes of mine + five by trial agents ≈ $25 in total.

## 1. What was tested

| # | what | who built the greybox | result |
|---|---|---|---|
| S1 | spike: upstream's "8-second lab" as raw `bpy` (box mannequin) | me | the take kept layout, walk-in, stop, hand on console, glow after touch, push-in — the claim holds |
| S2 | same shot rebuilt on the first kit (hinged mannequin, distance-phased gait, fingertip reach) | me, via `previz.mjs` | blocking and order held; **the camera over-pushed** (device cropped by 7.8 s) → recorded honestly as `take-camera: fail` |
| T1 | blind trial, **Claude Code / Fable**, brief below, first skill | cold-start agent | 28 min to the take; 7 greybox revisions, 240-line scene, a full store with a tracking shot; take followed the greybox; agent failed its own `take-order` (dark scene hid the reach; light snapped in 3 frames), re-shot once with a named fix, failed again by 0.17 s, stopped. $4.23 |
| T2 | blind trial, **Codex / GPT-6 Astra medium**, same brief, same (pinned) skill | cold-start agent | 11 min to the take; 3 revisions, 112-line scene, a simpler set from a high wide angle; **light came on before the door opened**, the person rendered child-sized next to an over-tall cooler |
| A/B | the lab shot with a **limbless pawn** and the body action moved into the prompt | me | natural walk with real steps, stop on the pawn's second, left hand on the button ~5.0–5.4 s, glow after; the "final framing" sentence fixed the over-push |
| S3 | the shipped seed, re-made with the pawn kit | me, via `previz.mjs` | all thirteen checks looked at and passed; sphere dull grey until the press, first blue 5.9 s, ramp to 7.8 s |
| T3 | blind trial, **Codex / GPT-6 Astra medium**, same brief, **pawn skill** | cold-start agent | 15 min to the take; 86-line scene using only public kit calls (`figure travel turn hold hinge×2 swing×2`); natural gait, correct adult scale, **cause before effect correct**; agent failed `take-motion` (the arm started reaching ~0.5 s before the last step ended) and re-shot once with a named fix |

Trial brief (identical in T1–T3, delivered over the browser WebSocket to a fresh workspace):

> 帮我做一个 8 秒的镜头：深夜的便利店，一个人推门走进来，走到靠墙的冷柜前停下，伸手拉开冷柜的玻璃门，门一拉开，冷柜里的灯才亮起来。镜头在货架这一侧缓慢横移跟着他，最后停稳。成片想要写实的电影感夜景，店里偏暗偏暖，冷柜的光是冷白色的。先把白模做出来、验收好，再生成视频，全程你自己做完就行，不用每一步都问我。

Artifacts: `~/previz-trial-1`, `~/previz-trial-2`, `~/previz-trial-3` (workspaces), and side-by-sides under
`~/Desktop/previz-sample/`.

## 2. What it established

1. **A greybox video is a strong constraint.** Across every take the room layout, the path, the stop
   point and the second of each event followed the reference. The model never invented a different
   room or a different order of large events when the greybox showed them.
2. **Limbs in the greybox hurt; pawns help.** Same model, same brief, only the skill changed (T2 → T3):
   wrong order → right order, child-sized → adult, stiff → natural gait, private-API hacks → public
   calls only. The product owner's review ("the legs look unnatural — leave bodies to the model")
   was right, and the division of labour is now the mode's spine: **space, blocking, prop events and
   camera live in the greybox; body action and look live in the prompt.**
3. **Three prompt sentences are worth a re-shot each**: keep the action readable *before* a light
   event in a dark look; give a light's ramp in seconds and say what the object looks like before
   it; name the final framing, not just the move.
4. **The programs held up cold.** No trial agent needed a hint. All three read strips before
   recording checks, failed their own takes with precise reasons, re-shot exactly once with a named
   fix and then stopped. `generate`'s submit-first record, the take policy and `stuck` behaved as
   designed. Zero script errors across 13 greybox revisions by agents.
5. **Dogfooding found what review would not**: the lost update in `generate` (a check recorded while
   a take was in flight was erased), 163 MB of PNG frames per render, a starter scene that only
   rendered at 8 s, and a seed installer that corrupted `.glb` / `.blend` (386 KB → 630 KB).

## 3. What is not established

- One kind of shot: 8 s, one person, interior, one continuous take, 480p. No two-person shot, exterior,
  vehicle, fast action, vertical aspect, 720p, or multi-shot film.
- **The recreate entry has never been run end to end by an agent** — only `reference` / `compare`
  at script level and the reference lane against a fixture.
- Camera fidelity is the least reliable axis (one over-push in three of my takes; fixed by a
  sentence, n = 2).
- Agents may be stricter than a person (a 0.17 s order deviation cost a second $2.1 take). The skill
  gives no tolerance yet.
- A pawn is friendly to the model and less readable for a person: the front marker is small, two
  pawns would be indistinguishable. Untested.
- Whether trial agents ever called `navigate-to` / `get-player-state` is unknown — the server log
  does not record it, and the trial workspaces were not reviewed in the player afterwards.
- Model comparison is n = 1 per backend: Fable was slower, more elaborate and stricter; Astra medium
  was 2–3× faster with simpler sets.

## 4. Where this goes next (product owner, 2026-09-20)

The experiments are judged sufficient. The mode's real centre is not the greybox but **a natural
creative flow for a film-maker**, of which previz is one stage:

> idea → screenplay → character and environment design → storyboard / concept art → greybox previz →
> final render — with dialogue, music and sound alongside.

What exists maps onto the last third of that line: the *shot* as the unit, `previz.mjs` (state,
acceptance, take ledger, cost), the pawn kit, the player with its three lanes. What the flow adds
upstream — a story bible, a cast and locations with designed looks, storyboard frames per shot — has
a concrete technical hook already paid for: Seedance reference-to-video accepts up to 30 reference
**images** and 10 **audio** clips next to the greybox video, so character sheets and concept frames
can condition the same take as `[Image1]…` while the greybox stays `[Video1]`, and
`modes/_shared/scripts/` already carries image generation, image edit and TTS. The formal build
starts from a new brief around that flow; this branch is its proven core, not its final shape.

## 5. Backlot acceptance runs (2026-09-21, Codex GPT-6 Astra, medium)

The mode was renamed `backlot` and widened to the eight-stage flow
([brief](2026-09-20-backlot-mode.md)). Two acceptance runs on the same wuxia
brief (《一寸止风》, seven shots, ~30 s, 480p), the user's creative direction:
an open, landmark-rich ruined temple courtyard, two fighters, a wide orbit, a
dolly zoom on the landing, a three-angle collage of one strike, a crane rise.

### Round 1 — the flow holds, the joins do not

- Every gate held. The agent stopped at idea, screenplay, bible, boards,
  previz (with a free greybox reel) and asked before spending past $15 and
  before a third submit. Stage `changed` fired when beats were added after
  the shot list was approved — the creator re-approved, as designed.
- It found the collage/floor conflict on its own (three angles of a 1.2 s
  strike vs Seedance's 4 s minimum) and proposed the trim mechanism before
  it existed in the scripts; `trim` was added the same night.
- Six of seven takes came back with one bible (character sheets + set
  concept + board as `@Image` references beside the greybox `@Video1`):
  faces, wardrobe and the courtyard held across every take. The seventh, a
  photoreal low-angle close-up board, was refused twice by fal's likeness
  filter (HTTP 422) — the text "original fictional characters" did not help.
- What failed: shots did not connect (each take invented its own body
  action, so a pose at the end of shot N never met shot N+1); no tempo (one
  speed); the model cut to a new angle inside two 6 s shots; a dolly zoom
  became a dissolve; a light-handed 250-word prompt lost the camera lock.
  Recorded cost ≈ $11.6 at table price (cancelled and 422 jobs counted
  conservatively; four re-shots were SIGINT-cancelled before landing).

### Round 2 — design carried forward, anchors, hand-offs, tempo

Same idea/screenplay/bible re-used (approvals kept). New in the mode: beat
`detail` written at boards; opt-in `continuity {from, entry, exit}` per cut
with the previous take's last used frame attached and `take-handoff`
checked; `anchor` frames (GPT-Image i2i from the greybox frame + bible) and
the `lineup` joint review at the previz gate; `slowmo`/`impact` in the kit;
`prompt-skeleton` with time-coded beats and a job for every reference.

- Boards: 41 beats with details, six cuts each with a coordinate-level
  entry/exit and a written decision (all "continuous action" — this film is
  one duel; the opt-in rule was honoured by reasoning, not skipped).
- Previz: 2 of 7 shots hit the `stuck` rule (same framing check failing
  twice); the agent stopped and asked for a camera change; one was resolved,
  one left as a stated trade-off the creator accepted. Anchors: 14 images,
  $2.15. Observation: GPT-Image weighted the rendered board over the grey
  frame — several anchors follow the board's composition, not the greybox's.
- Takes (in hand-off order): 01 passed 5/5; 01→02 hand-off visibly worked
  (same courtyard, the challenger carried from the stair top to the
  landing) though pose matching was judged partial; 02 and 03 still
  contained a model-inserted cut in a 6 s two-character shot; 04 struck
  early; 05 hit the likeness filter again until its board and anchors were
  redrawn in an explicit anime-illustration idiom.
- 05 passed 6/6 after the redraw (the filter is about the picture, not the
  words); 06 and 07 landed with model-inserted cuts and timing drift and
  were left failed-but-selected by the creator's decision to finish the run.
- Sound and cut: one Lyria music bed ($0.08), one VO line (TTS, the keeper's
  recorded voice), `cut --final` → 30.0 s, 854×480, 24 fps, AAC 48 kHz; VO
  measured at −26 dB against −37 dB ambience at 25 s, music under at −18 dB
  with a 2 s fade. Recorded cost $15.68 at table price (36 paid records,
  all priced; the two 422 refusals counted).
- Verdict: the eight-stage flow runs end to end with a Codex agent at
  medium effort, every gate and stop behaving as specified, and the
  bible + anchor + greybox references hold look and layout across a whole
  film. The open problem is now the video model's own behaviour inside a
  6 s two-character shot — it inserts a cut of its own in roughly half of
  them regardless of "one continuous shot" — and pose-exact hand-offs,
  which the frame reference improves but does not guarantee. Next
  experiments: 4–5 s shots for two-character action, hand-off with a `last`
  anchor as well as the frame, and anchor prompts that weight the greybox
  frame over the board.
- Correction (2026-09-21 morning, user review of the round-2 prompts): the
  skill's "120–180 words" prompt budget was my extrapolation from community
  text-to-video guides; fal documents no word limit. The agent obeyed the
  cap and deleted the designed beat details down to clauses. The budget is
  gone; the pack is now the user's greybox template (替换句 → 素材映射
  只参考…不用… → 一句话成片 → 全局设定 → 时间戳分镜 one event per
  contiguous segment with 景别/构图/按白模路线/材质光影/肢体自然化 → 声音 →
  重新生成自然的… → 全局锁 last), scaffolded by `prompt-skeleton` in the
  film's language with every `detail` carried whole, and `generate` warns
  when a designed detail no longer survives in the pack. The doctrine lives
  in `skill/references/prompting.md`. Beat details are written in the
  film's language from the boards stage on.
- A/B on s03 (2026-09-21 midday, same greybox and reference set, 480p unless
  noted): A = round-2 prompt; B, B2 = v3 template (two seeds); C = v3 at 720p;
  D1, D2 = v3 with the board and the second anchor removed; E = v3 with
  every segment's 景别 held at 中全景 under the one orbit. Findings: v3 fixed
  the environment (the temple set from frame 1 where A showed a bare wall),
  put the blade contact on its designed second and ended on the designed
  wide two-shot; 720p sharpened faces and cloth but C's own inserted
  close-up read as incoherent; fewer references did not reduce cuts and
  lost the set again (the board and second anchor were anchoring it); all
  five v3 samples cut at 2.0 s — the segment where the pack's 景别 changed
  from 中全景 to 中景偏近. E, with the shot size held constant, read as one
  camera passing round the fighters. Rule recorded in prompting.md: in a
  one-take shot the 景别 column describes what the single move yields at
  that second and never varies on its own; a 景别 change is a cut and
  belongs only to 按时间戳切镜. Cost of the A/B ≈ $13.
- Bible redesign (user: "整个人设有点一般", then a new story — a female cult
  leader who spares the righteous executor she loves and is wounded):
  art-directed GPT-Image 2.5 sheets at `--quality xhigh` (three views on one
  ground line plus a large lit portrait; face, hair, every costume layer
  and material, weapon, one-line temperament, a contemporary 国风 animation
  idiom — stylised forms, ink-wash texture, one accent colour) were judged
  far above the first bible's technical turnarounds. Rule for bible.md:
  write the sheet as a design brief, not a spec; default xhigh.
- Round 3 (2026-09-21 afternoon, new story: a female cult leader spares the
  executor she loves and is wounded): three findings changed the mode. (1)
  Style must be decided before the bible — painterly/ink directions looked
  "artistic" but hid the body; the user's call was 武侠漫剧 (clean line art,
  cel shading, readable silhouettes), and the bible was regenerated with a
  style key frame as reference. (2) The first 720p take (an orbit with fine
  sword work) was stiff and the sword swapped hands under the orbit: a
  greybox constrains bodies in proportion to their displacement, so a shot
  gets ONE hard thing — a big camera move over a still/walking body, or a
  fine action under a locked camera, never both. (3) Storyboard frames drawn
  from text before the greybox contradicted each other and could not be
  built; pictures now derive from the greybox as key frames (boards stage =
  shot plan, free). Spent ≈ $14 on the abandoned first pass; the redesigned
  run was paused before any take.
- The simplification (2026-09-21 evening): re-reading the upstream project
  settled it — its flow is shot plan → greybox → prompt → video model, with
  the greybox as the ONLY picture of layout and behaviour and key frames
  only as "a weak constraint for image-only models". Every image reference
  this mode had added beside the greybox (storyboards, GPT-Image anchors,
  set concept) carried its own composition and fought the greybox; none
  could be made to obey a grey frame. The user's call, and the new default:
  a take receives the greybox, the character sheets, one project style key
  frame (and the hand-off frame when continuity is declared); the set and
  the body are words. First test (s02, low-angle landing into water, 720p,
  four references, Chinese v3 prompt from the beat details) was the first
  take judged right across three rounds: one real jump and landing, splash
  after contact, hair and ribbon in slow motion, manhua look, locked camera,
  straight sword in the right hand.
- Round 3 takes (2026-09-21 night, eight 720p shots, $20.43): consistent
  across the film, but two failures of the METHOD, not of the model. (1) The
  hand-off frame carried the previous shot's camera into the next shot
  (s02 kept s01's high viewpoint, s04/s05 kept s03's over-the-shoulder) —
  an image with its own composition fights the greybox exactly as boards
  and anchors did; hand-off becomes opt-in, continuity is text. (2) The user's
  verdict: 「完全没有亮点，为了环境一致性把 seedance 的强项完全放弃了」 — every
  shot was locked-off, the pawns barely moved, the climax was four near-
  identical close inserts with the exchange itself elided, and the causal
  chain of the fight was unreadable. Control test the same night: the s03
  exchange shot FREE (character sheets + style frame + a dynamic Chinese
  prompt; no greybox, 6 s, 720p) came back with a real exchange — his thrust
  kicking water lines, her spin with hair and ribbon in arcs, blades
  crossing in a splash, a slow-motion stop one inch from his throat — the
  first shot of the project with a 亮点. Conclusion for the mode: the
  greybox is a tool for the shots where space, geography or a camera move
  the model cannot do alone matters (establishing orbit, crane, dolly zoom,
  the geometric "one inch"); fight and charm beats are shot free or hybrid.
  Conditioning is decided PER SHOT in the shot plan.
