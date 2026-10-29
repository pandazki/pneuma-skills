# Writing shots

A shot is one cell of the storyboard grid, one timed entry in the video prompt
and one stretch of the clip. The same object is the strip cell the user clicks.

## Timing

| Rule | Value | Enforced |
|---|---|---|
| Shortest shot | 2 s — shorter and the action cannot finish; the clip becomes a slideshow | error |
| Typical shot | about 3 s | — |
| Fast action (a chase, a hit) | 2–2.5 s | — |
| Ending gag and its hold | 4 s | — |
| Long shot | over 5 s drags without dialogue | warning |
| Part length | 4–30 whole seconds (one generation) | error |
| Sum of a part's shots | exactly duration ÷ parts, to the tenth | error |
| Shot count per part | 4, 6, 8, 9, 10 or 12 make a tidy grid; 6 and 9 work best | warning |

Seconds are kept in tenths. Change one with `set-shot --dur`: the default
`--from both` splits the difference between the shots before and after,
`next` or `prev` takes it from one neighbour; a neighbour never drops below
2 s, and the command names the largest duration that fits when there is no
room. Dragging the border between two cells on the strip does the same.

Grids by shot count: 4 → 2×2, 6 → 2×3, 8 → 2×4, 9 → 3×3, 10 → 2×5, 12 → 3×4;
any other count gets the nearest square layout and a warning.

## The three text fields

| Field | Goes into | Changing it after… |
|---|---|---|
| `desc` | the clip prompt, timed; also the storyboard panel when there is no `sketch` | the board marks that panel stale (when no `sketch`); the clip marks that shot stale |
| `sketch` (optional) | the storyboard panel only | the board marks that panel stale |
| `sfx` | the clip prompt, under the shot | the clip marks that shot stale |
| `dur` | the clip prompt's timestamps | the clip marks that shot stale |

The episode's `cast`, `groups`, `scene`, `time`, `continuity` and `duration`
are the clip's setup; changing one after a take is reported as "setup changed
since take".

## `desc`: what the video shows

- **Who + how + result**: "光 stretches into an arch of light over the row of
  desks; 牛马 trots across it with the file stack, and the sticky notes below
  grab at empty air".
- **Open on the subject, not the set.** The place already reaches the clip
  through the scene reference and the style line; a `desc` that starts with
  the place and ends on a camera move reads as an establishing shot. In the
  2026-10-29 Ep01 run, "深夜的开放办公区，墙上的挂钟指向十点五十九分；牛马趴在键盘上打盹……镜头缓缓推近。"
  came back as a near copy of the scene sheet with no 牛马 in it, a lost beat.
  Put the character and the action first ("牛马趴在键盘上打盹……") and the
  set details after.
- **One main action per shot.** Anything happening behind it gets one clause
  at most ("the sticky notes flutter after them in the background").
- **Exaggeration as shape**: "flattens into a puddle", "swells to twice its
  size", "eyes pop out on stalks", "squashes flat under the stack". A video
  model draws a shape; it does not draw "hilariously".
- **Ability poses in the sheet's own words.** If the sheet drew "the body as an
  arch, both ends on the ground", the shot says the same; a new phrasing
  invites a new design.
- **One camera word, at the end**: slow push in, slow tilt up, side tracking,
  low angle looking up, top-down, pull back, freeze. Use it where it does work
  (a push in for a reveal, side tracking for a chase).
- **A lights-out shot keeps a light in frame.** "Every light and monitor goes
  out" gives the model nothing to draw: the same run's take went black for
  1.75 s on that shot. The re-shot version has 光 light the clock face with its
  own glow at the same instant, and the patch held a picture throughout.
- **Visible things, not adjectives.** Not "he is furious" but "his brows slam
  down and steam puffs from the top of his head".
- **No written words in the picture.** A clock without numbers, a sign without
  text. The prompt ends with a no-text line; the only exception is a card's
  `markings`. A set's own constraints ("the clock face has no numbers") go in
  the scene's `look` or `rules`; boards and panels carry them as a set-rules
  line, because a board that draws "12" gets copied into the clip.
- **Make the gag panel specific.** A video model sometimes merges two panels
  into one continuous shot or skips one (an upstream run: nine panels, seven
  shots, and the bridge gag replaced by a plank). The shot that carries the
  joke gets the most concrete wording — positions, direction, the result.

Example (the seed's shot 6, in the user's language — action, result, one
camera word):

```
光散成一群小火花，钻进纸球的缝里；便利贴群被烫得卷起边角，纷纷松开飘落，牛马驮着文件堆钻了出来。特写。
```

## `sketch`: the panel, when `desc` is too much

The storyboard is a black-and-white pencil grid that only fixes framing,
staging and action. Add a `sketch` when `desc` carries sound, timing or a
camera move a still cannot show, or two moments a single panel cannot hold:
the panel needs one readable moment ("low angle: the swarm fills the
corridor, the red leader in front").

## `sfx`: two or three cues

Pick from three layers — what the room sounds like, what the action sounds
like, what the score does — and stop at three cues: "clock ticking, monitor
hum"; "pattering feet, rustling paper, a light drum beat"; "a chime, the snap
of the power cutting, silence". Exaggerated cartoon sounds sell a gag the
picture only half shows: a slide whistle on a fall, a squeak on a squash, a
cymbal on the final freeze. Seedance generates the soundtrack from these
(pass `--no-audio` for a silent clip). No commercial songs.

## Continuity

The clip prompt states the place and time of day for every shot and carries
the episode's `continuity` lines. `add-episode` writes two defaults, in the
bible's language: every shot picks up the motion where the previous shot left
it, and every run crosses the frame the same way, left to right.
`--continuity` (one flag per line) **replaces** them, so when you add the
episode's own lines, repeat the defaults you keep; `--continuity ""` writes
none.

Lines worth adding when an episode has them:

- a tracking shot stays on one camera from start to end;
- an object keeps its side, size and carrier across shots;
- what the light does after an event (only one light source left after the
  lights go out).

A line names the shots it concerns when it does not hold for the whole
episode. Two of the seed ep01's own lines:

```
镜头 3 到镜头 7，牛马背上一直驮着同一座文件堆
镜头 8 灯灭以后，画面里只剩光自己发出的橙色光
```

## Shot count and the cost of a change

- Changing a shot's words before the storyboard costs nothing.
- After the storyboard, a changed panel is one `redo-panel` (one image).
- After the clip, a changed shot is a `patch-range` (at least 4 s of video)
  or, when it moves later beats, a new take of the whole part.
- Changing the number of shots after a take makes every shot stale and a patch
  impossible (the take was cut on the old boundaries): re-shoot the part.
