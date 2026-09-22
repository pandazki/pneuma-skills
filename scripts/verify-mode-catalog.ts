#!/usr/bin/env bun
/**
 * verify-mode-catalog — prove that this package pins every catalog mode of
 * this checkout, and that every archive it pins is really on the CDN, before
 * the package is published.
 *
 *   bun scripts/verify-mode-catalog.ts            # verify modes/catalog.json
 *   bun scripts/verify-mode-catalog.ts --fetch    # download the release's
 *                                                 # catalog first, then verify
 *
 * A catalog mode is downloaded at first use from a URL pinned in
 * `modes/catalog.json`, so a core on npm whose archives never reached the
 * bucket is a release that looks fine and cannot launch half its modes. A
 * catalog that never mentioned those modes fails the same way while every URL
 * it does list checks out, which is why the set is compared against the
 * checkout before anything is fetched. This is the gate the release job runs
 * before `npm publish`.
 *
 * `--fetch` is the CI shape: `modes/catalog.json` is generated, not committed,
 * so the job pulls `official/v<version>/catalog.json` — the copy
 * `scripts/publish-modes.ts` uploaded beside the archives — verifies every
 * entry, and leaves it on disk as the file the package ships. What gets
 * published is then exactly what was verified.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MODE_CATALOG_FILE, type ModeCatalog } from "../core/types/mode-catalog.js";
import { catalogModeNames, DEFAULT_PUBLIC_BASE_URL, OFFICIAL_PREFIX, readModeMetadata } from "./publish-modes.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface EntryVerdict {
  name: string;
  url: string;
  ok: boolean;
  /** Human-readable reason; `"ok"` when the archive matched. */
  detail: string;
}

/**
 * HEAD every pinned archive and compare status and length with the pin.
 * A missing `content-length` counts as a failure: an unverifiable archive is
 * exactly what this gate exists to catch.
 */
export async function verifyCatalog(
  catalog: ModeCatalog,
  options: { timeoutMs?: number } = {},
): Promise<EntryVerdict[]> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const verdicts: EntryVerdict[] = [];
  for (const entry of catalog.modes) {
    const { url, size } = entry.archive;
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
      if (res.status !== 200) {
        verdicts.push({ name: entry.name, url, ok: false, detail: `HTTP ${res.status}` });
        continue;
      }
      const header = res.headers.get("content-length");
      if (header === null) {
        verdicts.push({ name: entry.name, url, ok: false, detail: "no content-length — size cannot be confirmed" });
        continue;
      }
      const actual = Number(header);
      if (actual !== size) {
        verdicts.push({ name: entry.name, url, ok: false, detail: `size ${actual} B, catalog pins ${size} B` });
        continue;
      }
      verdicts.push({ name: entry.name, url, ok: true, detail: "ok" });
    } catch (error) {
      verdicts.push({ name: entry.name, url, ok: false, detail: `unreachable: ${(error as Error).message}` });
    }
  }
  return verdicts;
}

/**
 * Compare the catalog with the checkout that is about to be published.
 *
 * HEAD-checking the pinned URLs only proves that what the catalog *does* list
 * is there; it says nothing about what the catalog left out. A partial publish
 * run (`--only`) produces exactly that shape — a well-formed catalog with real,
 * reachable archives that covers one mode instead of twelve — and shipping it
 * means the release's other catalog modes do not exist for anyone who installs
 * it. The mode's own version is compared too, because the archive key carries
 * it: a catalog pinning last commit's `<name>-<old>.tar.gz` resolves fine and
 * hands users a mode this release never built.
 *
 * Returns one line per problem; an empty array means the catalog describes
 * this checkout exactly.
 */
export function catalogCoverage(catalog: ModeCatalog, modesDir: string): string[] {
  const expected = catalogModeNames(modesDir);
  const listed = new Map(catalog.modes.map((entry) => [entry.name, entry]));
  const problems: string[] = [];
  for (const name of expected) {
    const entry = listed.get(name);
    if (!entry) {
      problems.push(`${name}: a catalog mode of this checkout, missing from the catalog`);
      continue;
    }
    try {
      const source = readModeMetadata(join(modesDir, name), name);
      if (entry.version !== source.version) {
        problems.push(`${name}: catalog pins ${entry.version}, this checkout's manifest says ${source.version}`);
      }
    } catch (error) {
      problems.push(`${name}: manifest cannot be read here — ${(error as Error).message}`);
    }
  }
  for (const entry of catalog.modes) {
    if (!expected.includes(entry.name)) {
      problems.push(`${entry.name}: listed in the catalog but not a catalog mode of this checkout`);
    }
  }
  return problems;
}

export function readCatalog(path: string): ModeCatalog {
  return JSON.parse(readFileSync(path, "utf-8")) as ModeCatalog;
}

export function catalogUrl(baseUrl: string, version: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${OFFICIAL_PREFIX}/v${version}/${MODE_CATALOG_FILE}`;
}

export interface VerifyCliArgs {
  catalog?: string;
  version?: string;
  baseUrl?: string;
  modesDir?: string;
  fetchCatalog: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): VerifyCliArgs {
  const args: VerifyCliArgs = { fetchCatalog: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case "--catalog": args.catalog = next(); break;
      case "--version": args.version = next(); break;
      case "--base-url": args.baseUrl = next(); break;
      case "--modes-dir": args.modesDir = next(); break;
      case "--fetch": args.fetchCatalog = true; break;
      case "--help":
      case "-h": args.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

const USAGE = `Usage: bun scripts/verify-mode-catalog.ts [options]

  --catalog <path>   catalog to verify (default modes/catalog.json)
  --fetch            download official/v<version>/catalog.json into that path first
  --version <X.Y.Z>  release to expect (default package.json's version)
  --base-url <url>   CDN base for --fetch (default the public Pneuma bucket)
  --modes-dir <path> checkout to compare the catalog against (default modes/)

Exits non-zero when the catalog does not cover every catalog mode of this
checkout, or when any pinned archive is missing or a different size.`;

export async function main(argv: string[]): Promise<number> {
  let args: VerifyCliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`[verify-mode-catalog] ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const catalogPath = args.catalog ?? join(PROJECT_ROOT, "modes", MODE_CATALOG_FILE);
  const expectedVersion =
    args.version ?? (JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8")) as { version: string }).version;
  const baseUrl = args.baseUrl ?? DEFAULT_PUBLIC_BASE_URL;

  if (args.fetchCatalog) {
    const url = catalogUrl(baseUrl, expectedVersion);
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
    } catch (error) {
      console.error(`[verify-mode-catalog] cannot reach ${url}: ${(error as Error).message}`);
      return 1;
    }
    if (!res.ok) {
      console.error(
        `[verify-mode-catalog] ${url} returned HTTP ${res.status} — the modes for v${expectedVersion} have not been ` +
          `published. Run \`bun scripts/publish-modes.ts --version ${expectedVersion}\` before pushing.`,
      );
      return 1;
    }
    writeFileSync(catalogPath, await res.text());
    console.log(`[verify-mode-catalog] fetched ${url} → ${catalogPath}`);
  }

  if (!existsSync(catalogPath)) {
    console.error(
      `[verify-mode-catalog] ${catalogPath} is missing — it is generated by scripts/publish-modes.ts and is not ` +
        `committed. Run that script (or this one with --fetch) for v${expectedVersion}.`,
    );
    return 1;
  }

  let catalog: ModeCatalog;
  try {
    catalog = readCatalog(catalogPath);
  } catch (error) {
    console.error(`[verify-mode-catalog] ${catalogPath} is not readable JSON: ${(error as Error).message}`);
    return 1;
  }

  if (catalog.coreVersion !== expectedVersion) {
    console.error(
      `[verify-mode-catalog] ${catalogPath} pins archives built for v${catalog.coreVersion}, but this release is ` +
        `v${expectedVersion}. A catalog mode only runs on the core that built it.`,
    );
    return 1;
  }
  if (catalog.modes.length === 0) {
    console.error(`[verify-mode-catalog] ${catalogPath} lists no modes`);
    return 1;
  }

  const modesDir = args.modesDir ?? join(PROJECT_ROOT, "modes");
  let coverage: string[];
  try {
    coverage = catalogCoverage(catalog, modesDir);
  } catch (error) {
    console.error(
      `[verify-mode-catalog] cannot read the catalog mode set from ${modesDir}: ${(error as Error).message}`,
    );
    return 1;
  }
  if (coverage.length > 0) {
    for (const problem of coverage) console.log(`FAIL  ${problem}`);
    console.error(
      `[verify-mode-catalog] ${catalogPath} does not describe this checkout (${coverage.length} problem` +
        `${coverage.length === 1 ? "" : "s"}). The package ships these pins, so a mode missing here is a mode that ` +
        `does not exist for v${expectedVersion}. Re-run \`bun run publish:modes --version ${expectedVersion}\` over ` +
        `the whole catalog — a run restricted with --only cannot produce a release catalog.`,
    );
    return 1;
  }

  const verdicts = await verifyCatalog(catalog);
  for (const verdict of verdicts) {
    console.log(`${verdict.ok ? "  ok " : "FAIL "} ${verdict.name.padEnd(12)} ${verdict.detail}  ${verdict.url}`);
  }
  const failed = verdicts.filter((v) => !v.ok);
  if (failed.length > 0) {
    console.error(
      `[verify-mode-catalog] ${failed.length}/${verdicts.length} archives of v${expectedVersion} are missing or the ` +
        `wrong size. Publishing now would ship a core whose modes cannot be downloaded.`,
    );
    return 1;
  }
  console.log(`[verify-mode-catalog] ${verdicts.length} archives of v${expectedVersion} verified`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
