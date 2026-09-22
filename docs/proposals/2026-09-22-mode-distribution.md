# Mode distribution — bundled modes in the package, the rest on the CDN

Status: **accepted 2026-09-23** with the default answers to the owner decisions
(see the last section). Base: `main` at v3.51.0 (`57993957`).

Owner request, in order:

1. The npm package (238 MB unpacked) is too close to the registry's 413 ceiling
   because every mode ships in it. Split **release packaging** of modes from the
   core; development stays in this one repository.
2. Only a few example modes are built in — **the starred ones**. Every other mode
   appears in the launcher as a list entry and is **fetched from the remote on
   first use**, from the Cloudflare CDN.
3. A catalog mode keeps **only its main preview images and its introduction** in
   the package; the rest is downloaded.
4. The publishing script **publishes the modes together with the core, by version
   number**.

## What already exists

Most of the machinery is in the tree; the split mainly routes first-party modes
through it.

| Piece | Where | What it gives us |
|---|---|---|
| Prebuilt viewer bundles for modes outside the package | `snapshot/mode-build.ts::buildModeForPublish` | `Bun.build` of `pneuma-mode.ts` + `manifest.ts` into `.build/`, third-party deps inlined, React and the host store external |
| Launch without a build step | `bin/pneuma.ts:2483-2488` | a mode with `.build/pneuma-mode.js` is served as-is at `/mode-assets/*` |
| Host singletons for external bundles | `src/main.tsx` (`window.__PNEUMA_REACT__`, `__PNEUMA_REACT_DOM__`, `__PNEUMA_JSX_RUNTIME__`, `__PNEUMA_STORE__`), `server/index.ts:4070-4118` (`/vendor/*.js` shims) | one React and one Zustand store across the host/mode boundary |
| Tarball install | `core/mode-resolver.ts` `url` source, `tar xzf` into `~/.pneuma/modes/<name>/` | download-and-extract path |
| A CDN with a custom domain | R2 bucket behind `https://pneuma-storage.vibecoding.icu`, credentials in `~/.pneuma/r2.json` (`snapshot/r2.ts`) | already serves mode-maker publishes (`modes/<name>/<version>.tar.gz`) and the community catalog `registry/index.json` |
| A listed-but-remote launcher entry | `server/index.ts:813-1005` `buildRegistry()` → `published` bucket | card from remote metadata, launch by URL |
| Starred defaults | `core/favorites.ts:47-54` `DEFAULT_FAVORITES` | webcraft, slide, diagram, illustrate, remotion, kami, cosmos |

Three facts make first-party modes different from mode-maker publishes, and
they drive the design:

- **Every first-party mode reaches into the host with relative imports**
  (`../../../src/store.js`, `src/hooks/useSource.js`, `src/utils/api.js`,
  `src/components/ScaffoldConfirm.js`, `core/...`; 4–25 per mode). Moved out of the
  tree, those paths break, so a catalog mode must travel as a prebuilt bundle.
  The backend side is clean: no `domain.ts` / `types.ts` / `manifest.ts` of a
  catalog candidate has a runtime import that leaves its own directory.
- **A prebuilt bundle is coupled to the core it was built from.** It inlines
  `src/`/`core/` helpers and relies on the host's store shape and on Tailwind
  utilities compiled into the host CSS (Tailwind v4 scans `modes/**` when the
  host is built). A bundle from one release running on another release's host is
  the failure the owner's "publish together, by version" rule prevents.
- **The launch-time build for an unbuilt external mode does not externalize the
  store** (`bin/pneuma.ts:2496-2534` redirects `/core/` and `/src/` to the
  project root and inlines them, store included), while `snapshot/mode-build.ts`
  does. Two build configurations disagree about the host ABI today. Any
  external mode importing `src/store` by relative path gets a second, silent
  store in production.

## Decisions

**D1 — Bundled set.** Bundled = the starred defaults plus the framework's hidden
modes: `webcraft slide diagram illustrate remotion kami cosmos` + `evolve
project-evolve project-tidy project-onboard` + `_shared`. Everything else is a
catalog mode: `backlot bansho clipcraft doc draw eli5 gridboard lucid mode-maker
plotwise sprite wordtaste`. `mode-maker` follows the owner's rule (not starred);
move it into the bundled list if forking should work offline on first run.

**D2 — One authority for the set.** `modes/distribution.json`:
`{ "bundled": [...] }`. It is a release-packaging decision of this distribution,
not a property a mode declares about itself, so it lives beside the modes rather
than in `ModeManifest`. Consumers read it or are tested against it:
`core/mode-loader.ts` builtin registry, `server/index.ts` registry route (replaces
the hard-coded order list at `:829`), `package.json` `files`,
`desktop/electron-builder.yml`, the pack script. A test also asserts every
`DEFAULT_FAVORITES` entry is bundled, so a first-run Quick Start never shows a
mode that needs a download.

**D3 — Lockstep releases.** Each core release builds and publishes **every
catalog mode from the same commit**, addressed by both versions:

```
https://pneuma-storage.vibecoding.icu/official/v<core>/<name>-<modeVersion>.tar.gz
https://pneuma-storage.vibecoding.icu/official/v<core>/catalog.json
```

The package carries the catalog that pins those exact URLs and their SHA-256, so
a core release is a closed set: a user on 3.52.0 only ever runs bundles built
with 3.52.0. The `official/` prefix keeps first-party archives apart from
mode-maker's `modes/<name>/<version>.tar.gz` keys in the same bucket. Keys are
immutable once that core version is on npm (see D9).

**D4 — What a catalog mode leaves in the package.** `modes/<name>/showcase/**`
(hero plus highlights — the "main preview images") and its entry in a generated
`modes/catalog.json`. No `manifest.ts`, viewer, skill, seed or scripts. The
launcher's showcase route keeps working unchanged for the card.

**D5 — Catalog entry contract** (`core/types/mode-catalog.ts`, new):

```ts
interface ModeCatalog {
  formatVersion: 1;
  coreVersion: string;               // the release that built every archive below
  modes: ModeCatalogEntry[];         // launcher order
}
interface ModeCatalogEntry {
  name: string;
  version: string;                   // the mode's manifest version
  displayName: LocalizedString;      // the "introduction": copied from the manifest
  description: LocalizedString;
  icon?: string;                     // manifest icon SVG
  archive: { url: string; size: number; sha256: string };
  unpackedSize: number;              // shown on the card before download
}
```

`LocalizedString` is the manifest's existing type (`core/types/mode-manifest.ts:28`). The
catalog is generated by the pack step from `parseManifestTs`; it is never
hand-edited and is not committed (gitignored, listed in `files`).

**D6 — Archive contract.** A gzip tar of the mode directory as a first-party
mode lays it out, minus `__tests__/`, `harness/` and `showcase/`, plus
`.build/` from the unified bundle builder (D7), plus a
`pneuma-package.json` stamp `{ formatVersion: 1, name, version, coreVersion,
builtAt }`. The stamp is what `patchViteEnvTokens` never had: a declared format
version, so the next change to the layout is detectable instead of silently
patched.

**D7 — One bundle builder, one host ABI.** `snapshot/mode-build.ts` becomes the
only way a mode viewer is compiled for production: the pack step, mode-maker
publish and the launch-time build in `bin/pneuma.ts` all call it. It owns the
external list — `react`, `react-dom`, both JSX runtimes, the host store (by
resolved path as well as by `pneuma-skills/src/store` specifier), and
`i18next` / `react-i18next` through a new `/vendor/i18n.js` shim over a host
instance exposed as `window.__PNEUMA_I18N__` (needed because
`src/components/ScaffoldConfirm.tsx`, imported by two catalog modes, calls
`useTranslation`). This fixes the store-inlining defect above as a side effect.

**D8 — Where modes are installed and when they are fetched.** Catalog installs
live under `~/.pneuma/catalog/<name>/`, owned by the catalog installer and kept
apart from user modes in `~/.pneuma/modes/` (so they never appear twice in the
launcher and never clobber an evolved fork). Install =
download to a temp file → verify size and SHA-256 → extract to a sibling temp
dir → atomic rename → write `.pneuma-install.json`
`{ name, version, coreVersion, sha256, installedAt }` last. The record's
presence means the install is complete; a directory without it is removed and
re-fetched.

On launch (CLI `pneuma <name>`, launcher click, session resume, handoff/borrow
target):

| State | Behaviour |
|---|---|
| bundled | as today |
| in-tree catalog mode (a repo checkout) | runs from `modes/<name>/` source, no network: dev through Vite, production through the D7 builder |
| installed, record SHA = catalog SHA | launch |
| installed for another core version, or not installed | download, then launch; the launcher shows progress with the size from the catalog |
| download fails / offline / SHA mismatch | the launch stops with the reason and the URL; nothing half-installed is left, and no stale bundle from another core is run |

**D9 — Release flow.** `scripts/publish-modes.ts --version X.Y.Z`:
build every catalog mode with D7 → pack (D6) → upload to `official/vX.Y.Z/` →
write `modes/catalog.json` → upload a copy beside the archives. Re-upload of an
existing key is allowed while `pneuma-skills@X.Y.Z` is not on npm (a failed
release gate followed by a fix commit, as happened with 3.51.0) and refused
afterwards. The release job gains a step before `Publish to npm` that runs the
script and then HEAD-checks every catalog URL against its recorded size; a
missing archive stops the release before anything is tagged. The desktop jobs
fetch `official/vX.Y.Z/catalog.json` instead of rebuilding it, so npm and the
installers carry the same pins.

CI needs R2 credentials for that step (four repository secrets: account id,
access key id, secret access key, bucket). Until they exist, `/bump` runs the
same script locally with `~/.pneuma/r2.json` before pushing, and CI only
verifies.

## Size

Measured with `npm pack --dry-run` on v3.51.0 plus this split:

| | unpacked |
|---|---|
| today | 239 MB |
| removed: catalog modes' code, skills, seeds and scripts | −64 MB |
| kept: catalog modes' showcase images (already in today's figure) | 17 MB |
| **after the split** | **~175 MB** |

Download on first use (uncompressed): backlot 19.9 MB, clipcraft 16.8, bansho
7.6, lucid 6.8, sprite 6.1, plotwise 4.5, gridboard 0.9, wordtaste 0.7, eli5
0.3, doc 0.1, draw 0.1 (mode-maker ~1.9).

The bundled set keeps 84 MB of seeds, most of it three starred modes: kami 38.5
MB (two 18 MB fonts), illustrate 23.5, remotion 14.7. The split alone leaves the
package 60 MB under the ceiling. The next lever, if wanted, is seeds on demand
for bundled modes too (Phase 2), which would bring the package to roughly 90 MB.

## What changes where

| Area | Change |
|---|---|
| `modes/distribution.json` | new, D2 |
| `core/types/mode-catalog.ts` + `core/__tests__/` | new contract, D5/D6 |
| `core/mode-catalog.ts` | read the packaged catalog; install / verify / record (D8) |
| `core/mode-loader.ts` | builtin registry = bundled only; catalog modes register as external (in-tree path or install root) |
| `core/mode-resolver.ts`, `bin/pneuma.ts` | resolve a catalog name to install-then-launch; launch-time build calls D7 |
| `snapshot/mode-build.ts` | the single builder with the ABI externals, D7 |
| `src/main.tsx`, `server/index.ts` | expose the i18n instance; `/vendor/i18n.js` shim |
| `server/index.ts` registry | `catalog` bucket with install state; order from the catalog; showcase route unchanged |
| `src/components/Launcher.tsx` | catalog card: preview, introduction, download size, "download and open", progress, failure message |
| `server/` mode-maker fork / evolution copy | read catalog-mode source from the install root when it is not in the package |
| `core/local-modes.ts` (`pneuma mode list --local`) | list catalog modes with an `installed` flag so handoff can target them |
| `scripts/publish-modes.ts` | new, D9 |
| `package.json` `files`, `desktop/electron-builder.yml` | exclude catalog modes except `showcase/`; include `modes/catalog.json` |
| `.github/workflows/release.yml` | publish-or-verify step before npm |
| `.agents/skills/bump/` + `references/release-process.md` | the lockstep step and its recovery rule |
| `docs/reference/project-guide.md` | mode source table gains `catalog`; contracts table gains `ModeCatalog` |

Unchanged: the hosted player (built from this repo at deploy time, so it keeps
compiling every whitelisted viewer), mode-maker's own publish keys, the
community `registry/index.json`, libraries.

## Phases

1. **Builder and ABI (D7).** Unify the three build paths; externalize store and
   i18n; test that a catalog mode built outside the host shares the host store.
   Independently useful: fixes the store inlining for external modes today.
2. **Catalog and install (D2–D6, D8).** Distribution file, catalog contract,
   installer, loader/resolver changes, CLI path. Local HTTP server fixture for
   tests.
3. **Launcher surface.** Catalog cards, install progress, failure states;
   screenshot-verified.
4. **Release (D9).** Pack/upload script, package exclusions, CI step, `/bump`
   update. First release under the split is a minor version.
5. **Later.** Seeds on demand for bundled modes; content-hash dedupe of
   unchanged archives across releases; moving uploads fully into CI.

## Acceptance

- `npm pack --dry-run` contains no catalog-mode source and is at or under ~175 MB
  unpacked; the desktop installers exclude the same files.
- In a fresh `HOME` with the packed tarball installed: the launcher shows every
  catalog mode with its preview, introduction and download size; opening
  backlot downloads, verifies and launches it, and selecting a content set in
  its viewer updates the host (one store).
- Offline with nothing installed: the launch stops with the reason; offline with
  a matching install: it launches.
- After upgrading the core, the first launch of an installed catalog mode
  re-downloads the new build; an archive whose SHA-256 does not match is
  rejected and nothing is left behind.
- In the repo: every mode runs from source with no network, in dev and in
  production builds.
- `bun run test:all`, `bun run typecheck`, `bun run check:guidance`,
  `bun run build` pass; the release job's verify step fails when an archive is
  missing.

## Owner decisions (resolved 2026-09-23)

1. **mode-maker** — catalog, per the starred rule.
2. **Where uploads run** — `/bump` runs `scripts/publish-modes.ts` locally with
   `~/.pneuma/r2.json` before pushing; CI verifies every catalog URL before npm.
   Moving the upload into CI (four R2 secrets) stays a Phase 5 item.
3. **Seeds of bundled modes** — stay in the package; seeds on demand is Phase 5.
