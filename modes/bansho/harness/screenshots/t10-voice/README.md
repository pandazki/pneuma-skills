# T10-4 — audio playback + clock gate, live evidence

Captured against a scratch workspace (3-sentence board, locally generated
sine-tone wavs: sentence 1 = 12 s clip, sentence 2 = 10 s clip, sentence 3
unvoiced), `bun run dev bansho --dev` from this branch, driven with
chrome-devtools CLI. The numeric traces below are the load-bearing part —
audio correctness is asserted, not eyeballed.

| Shot | What it shows |
|------|---------------|
| `01-open-export-subtitles.jpeg` | Opening at the tip; the **Export subtitles** command renders in the ask bar beside the three pointing commands. |
| `02-hold-clock-pinned-5.5s.jpeg` | 7.5 s of wall clock after replay, the canonical clock reads **5.5s / 9.6s** — the pen finished sentence 1 and WAITS at the next pen-down while the 12 s voice finishes (the hold). |

Sampled facts (evaluate_script, 0.9 s cadence, `Audio.prototype.play`
instrumented):

- **Audio master is a projection, not a follow**: while clip 1 sounded,
  `transport clock − element.currentTime` stayed `1.60 ± 0.01`
  (= the window's canonical start) across every sample — zero drift by
  construction.
- **The hold binds at pen-downs**: clock pinned at `5.5s` for ~7 s while
  clip 1's `currentTime` ran `4.6 → 12.0`, then released seamlessly;
  later pinned at `8.8s` while clip 2's 10 s tone finished over the
  unvoiced final sentence.
- **Voiced-next handover**: with BOTH sentences voiced and windows
  adjacent, the next clip took the board at its own window start
  (`activeClipAt` precedence) — the documented tail-cut, pinned in
  `__tests__/clock-gate.test.ts`.
- **Degradation, live**: a deleted wav and a manifest entry whose file
  never existed both produced `[bansho] narration clip failed to load … —
  playing on without it` warnings, per-hash muting, and an uninterrupted
  0 → end playback. No stall, no error surface, no chip (a load failure
  is not an autoplay block).

NOT verified visually: the autoplay-blocked "voice muted — click to
enable" chip — this debug Chrome grants autoplay, so the blocked latch
never trips live; the latch, the one-gesture re-arm and `unlock()` are
pinned by `__tests__/audio-conductor.test.ts` and the hook-glue test
instead.
