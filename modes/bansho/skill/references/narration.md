# Voice-over — giving the board a voice

One voice, one pen. Each speakable step gets its own audio clip, keyed to
its exact text, and the clip's recorded length paces that step's writing
within sensible bounds — a longer sentence of speech makes the pen settle,
a shorter one lets it move on.

**What this workflow produces:** the clip files, the manifest, a writing
schedule paced to the recorded lengths — and playback: the board sounds
each clip in step with the writing, and a clip far longer than its
sentence makes the clock wait at the next pen-down until the voice
finishes. Subtitles ride the same material (below). The player degrades
per clip, never as a whole, and never silently: a clip file confirmed
**missing** on disk stops pacing its step — that step plays silent at its
natural pace, the board shows a voice chip and `check-board` reports it
as `narrationClipMissing`; a file that exists but **cannot play** (load
or decode failure, a mid-play stall) leaves its step silent at the
written pace, chip included. The browser may also keep the voice muted
until the user's first interaction (the "voice muted" chip; playback
itself never stops for audio). `narrate` checks each recorded clip
actually exists on disk — one reported missing means re-synthesize to
the same `output` path (the manifest entry is already correct), and
calling `narrate` again is what tells the board the file is back.

**Speed.** The voice follows the reader's playback speed up to 4x — the
clip plays faster and the writing keeps step with it, so the pacing you
recorded still holds. Above 4x (the 8x and 16x rungs, for skimming a wall
rather than listening to it) the voice steps aside entirely and the board
runs silent at exactly the speed asked for: no browser agrees on what a
sixteen-times playback rate does to sound, and a clip that kept its own
speed would hold the pen still while it finished. Nothing about this is
yours to arrange — it is what a reader gets when they reach for the top
of the ladder.

A board with no voice is a normal board. No key, no manifest, no clips —
it plays exactly as written. The voice is a layer you add, never a
requirement.

## The workflow

1. **Ask the board for the plan.** Call the `narrate` action (`{}`; see
   SKILL.md's viewer protocol). It answers with every speakable step:
   its address, its **cache key**, the suggested spoken line, **two clip
   paths** — `file` (the manifest value, relative to the content set) and
   `output` (the same clip as a workspace path, for the synthesis
   command) — and whether a recorded clip is already fresh; plus
   `orphans`: recorded clips that no longer match any step, safe to
   delete. You cannot compute cache keys yourself; always ask the board.
2. **Synthesize only what is marked `needs-audio`.**

   ```bash
   node {SKILL_PATH}/scripts/generate-tts.mjs --json \
     --text "the spoken line" \
     --voice Kore --language "cmn-CN" \
     --output <the step's "output" from the plan>
   ```

   Always `--json`, always the `.wav` path the plan's `output` names: the
   command prints `{"path": "...", "seconds": N}`, and `seconds` can only
   be measured from `.wav` output. Needs `FAL_KEY` in the session `.env`
   (the fal.ai key init parameter); if it is missing, tell the user the
   board cannot get a voice rather than working around it.
3. **Record each clip in the manifest.** `narration/manifest.json` sits
   next to `board.md` in the same content set:

   ```json
   {
     "voice": "Kore",
     "language": "cmn-CN",
     "clips": {
       "1a2b3c4d": {
         "file": "narration/1a2b3c4d.wav",
         "seconds": 3.42,
         "text": "第一句话,讲清楚一件事。"
       }
     }
   }
   ```

   The key is the plan's cache key; `seconds` is copied verbatim from the
   `--json` output; `text` is what you actually had spoken. **`file` is
   the plan's `file` value verbatim — always relative to the content set,
   never prefixed with the set directory** (writing the workspace path
   here is the one way to corrupt the cache: the board would prefix it
   again on every read). Save the manifest LAST — its write is what tells
   the board the voice changed.

## The cache is the file name

A clip's key is a fingerprint of its step's exact text. Edit one sentence
and only that step's key changes: one new clip to synthesize, everything
else stays paid-for. The old key shows up in `orphans` on your next
`narrate` call — delete its file and its manifest entry. Never reuse a
file name for different audio; a new take of the same sentence with a new
voice keeps its key, so re-synthesize to the same file and update
`seconds`.

## What to speak, and what not to

- **Prose, headings, list items, asides** — the plan hands you their text.
  Prefer speaking it as written; rephrase only where written language
  reads badly aloud, and keep the manifest `text` honest about what was
  said.
- **Formulas appear in the plan with status `silent`** — zero characters
  to the board, so no spoken line is suggested and no clip is owed; they
  never count as needs-audio. To voice one, write the spoken line
  yourself — "E equals m c squared" — synthesize it to that step's
  `output`, and record it in the manifest under the step's key, both
  taken from its `silent` entry in the plan.
- **Charts, structure and ink marks speak through the pen.** They need no
  clip; the voice naturally rests while evidence draws itself.
- **One voice per board.** Keep `voice` / `style` / `language` at the top
  of the manifest and reuse them for every clip; a board that changes
  voice mid-lecture sounds like a different lecturer walked in.

## Subtitles

Subtitles come for free from the same material. Call the `subtitles`
action (`{}`): it answers with the finished SRT and VTT text — a voiced
step's cue spans its clip's audio window (start of the voice to where the
clip actually ends), an unvoiced step's cue spans the window in which it
is written — plus the workspace paths to save them under (`data.save`). Save the
returned text **verbatim** — never compute or adjust a cue time yourself;
keep the manifest `text` accurate and the subtitles are automatically
right. This works with no voice-over at all: where a step has no clip, its
cue falls back to the words written on the board.
