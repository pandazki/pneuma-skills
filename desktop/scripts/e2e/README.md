# Desktop startup verification

This harness launches the real Electron main/preload, Bun launcher, and built
React application. It selects the packaged runtime paths through a test-only
bootstrap and stages resources with symlinks. It does not run Vite or modify
production code. Measurements do not cover ASAR, signing, installation, or a
machine's first launch after reboot. The fixture scripts require macOS or Linux
with a graphical session; Windows is not covered by this harness.

Build the checkout being measured:

```sh
bun run build
cd desktop
npm ci
PNEUMA_DESKTOP_PREVIEW=1 npm run build:main
npm run test:startup -- --samples 5 --out /tmp/pneuma-startup
```

Use `--project /absolute/checkout` to measure another already-built checkout with
the same Electron and Playwright dependencies. Keep that checkout and its build
unchanged until both sides of a comparison finish. `metadata.json` records the
revision, runtime versions, machine, and build hashes. `samples.jsonl` retains
every timing and observed API response; `summary.json` contains median, p90,
minimum, and maximum. Do not run tests or builds concurrently with timed samples.

The default six scenarios run five samples each:

| Scenario | Controlled condition |
| --- | --- |
| `fresh` | New HOME and Chromium application profile for every launch |
| `warm` | One unmeasured launch primes a reused application profile |
| `slow-shell` | The fixture login shell waits two seconds per invocation |
| `slow-cli-version` | The fake Claude `--version` probe waits two seconds |
| `slow-registry` | Bun's external community-index request waits four seconds |
| `slow-backends` | Bun's `/api/backends` response waits four seconds |

Each application process has a new in-memory server cache. The operating system
disk cache is not flushed. The first timing is from the launch request to the
native `show` event of the actual HTTP launcher window, excluding the splash.
The second waits for the same DOM predicate on both revisions: Create New with a
populated All Modes button, successful local sessions/projects responses, then
two animation frames. It measures local browsing readiness, not readiness to
start an agent. Playwright's normal Electron loader and debugging connection are
part of the host overhead on both revisions.

The HOME, Electron appData, settings, and CLI configuration roots are temporary.
The required preview build disables protocol registration and updates; the
bootstrap rejects accidental registration. A fake Claude executable answers
only `--version` and refuses agent execution. A Bun preload replaces only the
remote community index with an empty deterministic result and optionally delays
or fails `/api/backends`. Local registry assembly and other APIs remain real.
Every quit verifies the launcher child exited. Temporary fixtures are removed;
logs, results, and screenshots remain in `--out`.

Run the candidate's interaction and fault checks separately from timed batches:

```sh
npm run test:startup -- --project /absolute/candidate --samples 1 --e2e \
  --scenarios fresh,slow-registry,slow-backends,failed-registry,failed-backends,no-backend \
  --out /tmp/pneuma-startup-e2e
```

These checks open the gallery and Settings with trusted clicks, check splash
handover, singleton/deep-link behavior, and close/reopen the launcher without
spawning another service. The import POST is intercepted before it can import
files. The no-backend case removes the fake executable and overrides the backend
API availability fields to false, so globally installed host binaries cannot
invalidate the fixture. A cold background-handoff case substitutes a local inert session
page for agent creation, verifies no splash/launcher appears, and sends real
preload status IPC to reveal the completed session. Notifications and external
browser launches are recorded instead of sent to the operating system.

The E2E checks target the improved behavior; running them against an older
revision is expected to fail where that revision still blocks local content or
destroys its splash before the launcher is shown. Inspect saved screenshots as
well as the assertions before accepting UI changes.
