---
description: Hand the current task off to a Pneuma session for the current directory
argument-hint: <intent> [--mode <name>] [--project | --quick]
---

<!-- pneuma:agent-command version="{{pneumaVersion}}" backend="{{backendType}}" -->

You are routing the user's request to **Pneuma** — a co-creation workspace
that spins up a domain-specific viewer (a deck, a webpage, a board, a
diagram, a video, …) plus an editing agent. Your job in this command is to
collect the minimum information needed, then call
`pneuma handoff-from-external`, which mints the session and returns a URL.

The slash command's argument is `$ARGUMENTS`.

## Steps

1. **Parse `$ARGUMENTS`** into these slots:
   - `INTENT` — free-form text describing what the user wants built. May be
     empty.
   - `--mode <name>` — optional, e.g. `webcraft`, `slide`, `diagram`.
   - `--project` / `--quick` — optional. `--project` initializes the current
     folder as a Pneuma Project (persistent, multi-session). `--quick` skips
     project setup (one-off session).

   If `INTENT` is empty, ask the user:
   > "What would you like Pneuma to build? Describe it in one or two
   > sentences."

   Wait for their reply and treat that as `INTENT`. If the user replies with
   a refusal/cancel, stop here — do NOT call `pneuma handoff-from-external`.

2. **Resolve `--mode`.** If not supplied, run:

   ```bash
   pneuma mode list --local --json
   ```

   If that command fails (e.g. "command not found" — Pneuma's CLI isn't on
   PATH), skip the list step and instead propose a sensible mode from the
   common set: `webcraft` (webpages / dashboards / static sites),
   `slide` (decks), `doc` (markdown), `diagram` (flowcharts), `draw`
   (whiteboard), `illustrate` (AI illustrations), `kami` (paper-canvas
   sites), `remotion` (programmatic video), `gridboard` (tile dashboards),
   `clipcraft` (AIGC clips). Confirm with the user.

   When the JSON command worked, parse its output (an array of
   `{ name, displayName, description, source, hidden }`), drop entries where
   `hidden` is `true`, show the user a numbered list — `displayName` plus a
   one-line description — and ask which fits. You may propose a best guess
   based on `INTENT` and confirm. Map the pick back to the `name` field.

3. **Resolve project init.** If neither `--project` nor `--quick` was given,
   ask the user:

   > "Initialize this folder as a Pneuma Project (recommended for ongoing
   > work — persistent preferences, multiple sessions can share it), or just
   > spin up a one-off session in the current directory?"

   - Project → pass `--init-project` in step 4.
   - Quick → omit `--init-project`.

4. **Run the handoff. Pick the right launcher based on what's installed.**

   First, detect whether the `pneuma` CLI is on PATH:

   ```bash
   command -v pneuma >/dev/null 2>&1 && echo cli || echo nocli
   ```

   ### Path A — CLI is available (works everywhere, preferred when present)

   ```bash
   pneuma handoff-from-external \
     --intent "$INTENT" \
     --mode "$MODE" \
     [--init-project] \
     --source-agent {{sourceAgent}}
   ```

   Run from the user's **current shell directory** — do NOT `cd` first.
   The CLI will validate the mode, stage `inbound-handoff.json`, spawn
   `pneuma <mode>` in the background, open a browser tab, and print the
   session URL on its last stdout line.

   ### Path B — No CLI, but the Pneuma desktop app is installed (macOS preferred)

   The desktop app registers itself as a handler for the `pneuma://` URL
   scheme. Emit a deep link and `open` it:

   ```bash
   # bash/zsh/fish — URL-encode each value (use the shell's URL encoder
   # of choice; below shows python3 as a portable fallback).
   ENC_INTENT=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$INTENT")
   ENC_CWD=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$(pwd)")
   open "pneuma://handoff?intent=$ENC_INTENT&mode=$MODE&cwd=$ENC_CWD&init-project=$INIT_PROJECT&source-agent={{sourceAgent}}"
   ```

   Where `$INIT_PROJECT` is `1` for project init, `0` for quick. The
   desktop app will pick up the URL, stage the handoff, and open a new
   session window. No browser URL gets printed in this path — the app's
   own window IS the result.

   ### Path C — Neither installed

   Tell the user (verbatim) one of these is required, with the install hints:

   - Recommended for terminal users: `bun add -g pneuma-skills`
     (requires [Bun](https://bun.sh/) ≥ 1.3.5).
   - Recommended for desktop users: download the desktop app at
     https://github.com/pandazki/pneuma-skills/releases — it registers the
     `pneuma://` URL scheme automatically.

   Do not attempt to install anything yourself.

5. **Report the URL back to the user (Path A only).** Repeat the URL
   verbatim. The new Pneuma agent already has their intent staged — they
   should continue the conversation in that window. For Path B, just
   confirm "Pneuma opened a new session window for `$INTENT`".

## Notes

- This command is for **new** sessions in the **current** directory. If
  the user wants to resume an existing session, point them at `pneuma`
  with no arguments — that opens the launcher.
- Don't open the URL for the user on Path A — just print it. Pneuma
  itself opens the browser tab.
- On Path A, common failure modes: unknown mode → re-run step 2; port
  exhaustion → re-run (the helper auto-picks).
