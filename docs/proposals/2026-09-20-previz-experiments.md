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
