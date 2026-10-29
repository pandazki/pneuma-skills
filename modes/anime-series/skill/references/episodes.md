# Episodes: ideas, structure, the shot table

One episode is one self-contained gag in one place. Anyone can start at any
episode; nothing carries over except the cast and the world.

## Ideas

1. Run `series.mjs ideas-context`. It lists every logged episode's place,
   goal, abilities used and ending, and the distinct values of each — what a
   new idea should not repeat. Episodes listed as "not logged yet" are written
   or shot but missing from that record: read their `episode.json` too.
2. An idea is one line: **place + goal + the ability that solves it + the
   ending.** For the seed's flame 光 and ox 牛马, for instance:
   - the server room in a power cut, a phone on 1 %, 光 lights the way to the
     one live socket, and 牛马 is already plugged in there, asleep;
   - the stairwell on moving day, a tower of boxes and a broken lift, 牛马
     carries all of it up nine floors, and the lift opens as they arrive;
   - the office kitchen at midnight, the last cup of noodles, 光 boils the
     water by sitting in it, and the noodles come out glowing orange.
3. With a theme from the user, write one idea on that theme. Without one,
   offer three that differ in place, goal and which ability carries them.
4. Vary what has been used. The same place is fine with a new goal; the same
   ability use twice in a row is not.

## Length

| Duration | Parts | Shots | Average per shot |
|---|---|---|---|
| 15 s | 1 | 6 (2 × 3 grid) | 2.5 s |
| 30 s (default) | 1 | 9 (3 × 3) | 3.3 s |
| 60 s | 2 × 30 s | 9 + 9 | 3.3 s |

One Seedance request renders 4 to 30 whole seconds, so a part is at most 30 s
and an episode's duration must divide evenly into its parts. 15 s is tight: it
has room for one gag and no lull. 30 s is the default for a reason.

## Structure

A 30 s episode in six beats (seconds are a guide, not a grid):

| Beat | Around | What happens |
|---|---|---|
| Setup | 0–3 s | We see what the leads are after, and what stands in their way |
| Obstacle | 3–13 s | The way is blocked; one use of an ability clears it |
| Lull | 13–16 s | A moment of relief: it seems settled |
| Setback | 16–19 s | The prize slips away again |
| Comeback | 19–26 s | The ability once more, bigger, wins it back |
| Payoff | 26–30 s | The closing gag, then the frame holds |

At 15 s keep setup → obstacle → payoff. At 60 s each part keeps its own rise:
part A ends at a natural cut (the goal flies out of the window — cut to the
street), never mid-action, and part B opens on the new place or moment. The
join is an ordinary hard cut; nothing is carried across by frame.

## Rules that keep an episode readable

1. **Silent by default.** A gag told with bodies and faces needs no
   subtitles in any market. When the user wants lines, set `set-series
   --dialogue true` (a style-card change: once the user re-locks, earlier
   episodes are flagged) and keep it to one or two short lines per episode,
   written into the shot's `desc` with who says them.
2. **One place per episode.** Every new location is another set the model
   invents, and the cuts between them stop reading as one story: desks, then
   the lift, then the car park looks like three unrelated stills. One
   `scene`, one `time`; the prompt states it for every shot.
3. **One action per shot**: one action and its result.
4. **Use an ability at least once**, ideally twice, the second bigger than the
   first.
5. **Land the ending on a turn**: the win comes with a catch, or the loss is
   the joke.
6. **Only who is in it is in `cast`.** A character who does not appear costs a
   reference image and a column of checks for nothing. Groups go in `groups`.

## The shot table

Show it in chat before anything is written, in the user's language:

| # | s | Picture | Sound |
|---|---|---|---|
| 1 | 3 | Deep night in the office; the wall clock nearly at eleven; ... Slow push in. | clock ticking, monitor hum |

How to write each column: `shots.md`. When the user nods, write the episode in
one command, with the shots on stdin so no scratch file is left behind:

```bash
node "<SKILL_DIR>/scripts/series.mjs" add-episode --title "准点下班" --duration 30 \
  --cast guang,niuma --groups stickies --scene office-night --time "深夜" \
  --shots-file - <<'JSON'
[
  { "dur": 3, "desc": "…", "sfx": "…" },
  { "dur": 3, "desc": "…", "sfx": "…", "sketch": "…" }
]
JSON
```

- A flat list is one part. A 60 s episode is a list of two lists (part A, part
  B), or `{ "parts": [{ "shots": [...] }, { "shots": [...] }] }`.
- `--episode epNN` is optional; the next free number is used.
- Without `--continuity` the episode gets the method's two continuity lines;
  `--continuity` replaces them (`shots.md`).
- It refuses a shot list that breaks the timing rules and names the rule;
  warnings (a shot over 5 s, an untidy grid) are printed and written anyway.
- `--force` replaces an existing episode file — only when the user asked to
  start that episode over.

## After it is written

- Change words with `set-shot --episode <id> --shot <n> --desc … --sfx …
  --sketch …` (an empty `--sketch ""` removes it) and seconds with `set-shot
  --dur <s> [--from both|next|prev]`, which moves the difference to the
  neighbours. The user can do both on the strip.
- Change the setup with `set-episode` (title, duration, cast, groups, scene,
  time, continuity, or a whole new `--shots-file`). A setup change after a
  clip marks the clip as made under a different setup.
- Re-read `episode.json` before a hand edit: the viewer may have written it
  since you last looked.

## The log

When the episode is finished, record what it used:

```bash
node "<SKILL_DIR>/scripts/series.mjs" log --episode ep01 --location "夜晚的办公区" \
  --goal "赶在十一点前下班" --used "变成手电筒光束" --used "拉成光桥" --ending "…"
```

`--used` repeats, one ability use each. `location` defaults to the scene's
name. Update the log when a fix changes the goal, an ability or the ending.
The season overview and `ideas-context` are built from these logs; there is no
separate log file.
