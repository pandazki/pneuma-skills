#!/usr/bin/env node
/**
 * blender.mjs — the only way this mode drives Blender.
 *
 * Blender is the rung of the asset ladder that no web tool replaces: rigging,
 * FBX conversion, and hand polish on a hero model. It is also the rung that
 * fails quietly — a headless run writes a 400-byte empty PNG and exits 0, an
 * importer that is not installed raises inside Python where nobody is looking,
 * and the binary lives in a different place on every machine. So the agent
 * never types a `blender` command line: it calls this file, which finds the
 * binary, says which candidate it used, runs the script, and judges the output
 * by what landed on disk rather than by the exit code.
 *
 * Zero npm dependencies: Node built-ins only. The Python helpers live in
 * `blender/` next to this file and are original code.
 *
 * Every subcommand accepts `--json` (exactly one JSON object on stdout) and
 * `--help`; without `--json`, stdout is a compact human report. Blender's own
 * output is echoed to stderr with a `[blender]` prefix so stdout stays
 * machine-readable — except in `run`, which is a passthrough and streams to
 * stdout unless `--json` is given. Failures print one `ERROR:` line on stderr
 * and exit 1. Paths are resolved against the current working directory; this
 * script never changes directory.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { inspectGlb } from "./glb.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = join(HERE, "blender");

/** A headless Blender that found nothing to render still writes a PNG and
 *  still exits 0. Anything this small is that PNG, not a contact sheet. */
const MIN_SHEET_BYTES = 10 * 1024;

/** Seconds a Blender run may take before it is killed. Import of a large GLB
 *  plus six renders is minutes, not seconds; a hung run is hours. */
const DEFAULT_TIMEOUT_SECONDS = 600;

/** Grace between SIGTERM and SIGKILL when a run times out. */
const KILL_GRACE_MS = 5000;

/** How long the gltf-transform availability probe may take. It is a courtesy
 *  check inside `doctor`, not a dependency of anything here. */
const GLTF_PROBE_TIMEOUT_MS = 15_000;

const SUBCOMMANDS = ["doctor", "run", "kit", "prep", "render-views", "convert", "probe"];

/** The one dimension `prep` normalizes by. Two of them cannot both be met by
 *  one uniform scale, so asking for two is a refusal, not a preference. */
const PREP_DIMENSIONS = ["height", "longest", "width"];

const USAGE = `Usage: blender.mjs <subcommand> [options]

Drive Blender headlessly. Every subcommand accepts --json (exactly one JSON
object on stdout) and --help. Paths are resolved against the current working
directory.

  doctor [--json] [--strict] [--no-gltf-probe]
      Report how Blender was found, or every place that was looked at and came
      up empty. Exits 0 as a report; --strict exits 1 when Blender is missing.

  run <script.py> [--no-kit] [--timeout ${DEFAULT_TIMEOUT_SECONDS}] [--json] [-- <args…>]
      <blender> --background --factory-startup
                --python-expr <put blender/ on sys.path>   (unless --no-kit)
                --python <script.py> -- <args…>
      Blender's stdout/stderr stream through with a [blender] prefix and the
      child's exit code is propagated. With --json the stream goes to stderr
      and one JSON summary lands on stdout.

      Writing a script for this:
        * 'import kit' works — that is what --kit (the default) is for. Run
          'blender.mjs kit' for its API; it covers import, orientation,
          grounding, scale, decimation, welding, materials, bevel/array/boolean
          and export. --no-kit leaves sys.path untouched.
        * arguments arrive after a literal '--', so read them with
          sys.argv[sys.argv.index('--') + 1:] (or kit.script_args())
        * print a line per step. --background has no UI, no progress bar and
          no error dialog; the printed log is the only observability there is.
        * there is NO OpenGL context in --background, so there are no viewport
          overlays, no annotations and no OpenGL render. Workbench and EEVEE
          renders are what is available.
        * exit non-zero (sys.exit(1)) on refusal, after an ERROR: line on
          stderr. Blender exits 0 after an uncaught Python exception in some
          versions, so the wrapper also checks the files you claim to write.
        * blender/make_prop.py is a template to copy: a bevelled, arrayed,
          boolean-cut prop is the thing procedural three.js cannot build.

  kit [--json]
      Print blender/kit.py's API, one line per function, and how a script
      imports it. Needs no Blender.

  prep <in> <out.glb> [--yaw <deg>] [--height <m> | --longest <m> | --width <m>]
       [--decimate <ratio>] [--merge] [--thin <name,name>]
       [--timeout ${DEFAULT_TIMEOUT_SECONDS}] [--json]
      Everything an incoming model needs before it enters a scene, in one
      pass, via blender/prep_asset.py:
        import (.glb/.gltf/.fbx/.obj) -> optional merge of loose shells
        -> yaw -> bake rotation+scale into the vertices -> feet to y = 0 and
        centred in x/z -> normalize by ONE dimension -> optional decimate
        -> backface culling on (except --thin parts) -> export
      Then it inspects the output and prints the same checklist as 'convert'.
      --height/--longest/--width are mutually exclusive: one uniform scale
      cannot satisfy two of them, so two is refused before Blender starts.
      Pick the dimension that aligns this asset with its neighbours — a tree
      by crown width, a building by façade width, a character by height.
      --thin takes object-name patterns (substring or glob, case-insensitive)
      for leaves, flags and signs, which stay double-sided.

  render-views <glb> <out.png> [--size 512] [--timeout ${DEFAULT_TIMEOUT_SECONDS}] [--json]
      Six orthographic views on one 3x2 sheet, via blender/render_views.py:
      -Z front, +X right, +Z back, -X left, +Y top, iso. Tile names are glTF
      axes (Y up) and name the direction from the model's centre TO the camera.
      Four views cannot tell front from back on a symmetric silhouette, and a
      bounding box cannot tell orientation at all. Verifies the sheet is over
      ${MIN_SHEET_BYTES / 1024} KB — a headless Blender writes a small empty PNG and exits 0 —
      and reads the tile order back from the <out.png>.json sidecar.

  convert <fbx> <out.glb> [--yaw <deg>] [--texture-size 1024] [--double-sided]
          [--timeout ${DEFAULT_TIMEOUT_SECONDS}] [--json]
      FBX to GLB via blender/fbx_to_glb.py, then inspects the result and prints
      the checklist — triangles, bbox, doubleSided count, extensionsRequired,
      largest texture — so the conversion proves what it did. --yaw is baked
      into the vertices, not left on a node. Backface culling is turned on
      unless --double-sided.

  probe <glb|fbx> [--timeout ${DEFAULT_TIMEOUT_SECONDS}]
      What Blender sees after importing: objects with triangle counts and
      whether they sit in glTF_not_exported, armatures and bone counts, the
      world bbox in glTF axes, and image names and sizes. Prints the probe's
      JSON.

How the binary is found, in order (each step is reported by 'doctor'):
  1. --blender <path>
  2. $BLENDER_PATH
  3. 'blender' on $PATH
  4. platform install locations: macOS /Applications/Blender.app and
     ~/Applications/Blender.app, Windows %ProgramFiles%\\Blender Foundation\\
     Blender*\\blender.exe, Linux /usr/bin/blender, /snap/bin/blender,
     /opt/blender/blender
Each candidate is confirmed by running '--version' and parsing 'Blender X.Y.Z'.
$LUCID_BLENDER_APP_PATHS replaces step 4 with its own ${delimiter}-separated list and is
for tests: empty means "no platform locations at all".

Exit code 0 on success, 1 on failure with a one-line ERROR: on stderr.
'run' propagates Blender's exit code instead.`;

const COMMON_OPTIONS = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  blender: { type: "string" },
  timeout: { type: "string" },
};

const OPTIONS = {
  doctor: { strict: { type: "boolean" }, "no-gltf-probe": { type: "boolean" } },
  run: { kit: { type: "boolean" }, "no-kit": { type: "boolean" } },
  kit: {},
  prep: {
    yaw: { type: "string" },
    height: { type: "string" },
    longest: { type: "string" },
    width: { type: "string" },
    decimate: { type: "string" },
    merge: { type: "boolean" },
    thin: { type: "string" },
  },
  "render-views": { size: { type: "string" } },
  convert: {
    yaw: { type: "string" },
    "texture-size": { type: "string" },
    "double-sided": { type: "boolean" },
  },
  probe: {},
};

// ---------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------

class BlenderError extends Error {}

function fail(message) {
  throw new BlenderError(message);
}

function requirePositional(positionals, index, label) {
  const value = positionals[index];
  if (value === undefined || value === "") fail(`missing ${label}`);
  return value;
}

function num(value, label, { min = -Infinity, max = Infinity, integer = false, fallback } = {}) {
  if (value === undefined) {
    if (fallback === undefined) fail(`missing ${label}`);
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${label} must be a number, got '${value}'`);
  if (integer && !Number.isInteger(parsed)) fail(`${label} must be a whole number, got '${value}'`);
  if (parsed < min || parsed > max) fail(`${label} must be between ${min} and ${max}, got ${parsed}`);
  return parsed;
}

function existingFile(pathArg, label) {
  const abs = resolve(pathArg);
  if (!existsSync(abs)) fail(`${label} does not exist: ${pathArg}`);
  if (!statSync(abs).isFile()) fail(`${label} is not a file: ${pathArg}`);
  return abs;
}

function emit(values, payload, humanLines) {
  if (values.json) console.log(JSON.stringify(payload));
  else console.log(humanLines.join("\n"));
}

// ---------------------------------------------------------------------------
// Finding Blender
// ---------------------------------------------------------------------------

const VERSION_PATTERN = /Blender\s+(\d+\.\d+(?:\.\d+)?)/;

/** Ask a candidate what it is. A path that exists proves nothing: a stale
 *  symlink, a wrapper script and a half-installed app bundle all exist. */
function probeVersion(candidate) {
  const result = spawnSync(candidate, ["--version"], { encoding: "utf-8", timeout: 20_000 });
  if (result.error) return { ok: false, reason: result.error.message };
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const match = VERSION_PATTERN.exec(text);
  if (!match) {
    const firstLine = text.split("\n")[0]?.trim() ?? "";
    return { ok: false, reason: `--version did not print a Blender version (${JSON.stringify(firstLine.slice(0, 120))})` };
  }
  return { ok: true, version: match[1] };
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function pathCandidates() {
  const executable = process.platform === "win32" ? "blender.exe" : "blender";
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, executable))
    .filter(isFile);
}

/**
 * Where Blender installs itself when nobody put it on PATH — which is the
 * normal case on macOS and Windows, where the installer is a drag-and-drop
 * bundle or an MSI that does not touch PATH.
 *
 * `LUCID_BLENDER_APP_PATHS` replaces this list. It exists for the test that
 * asserts "nothing found": this machine has /Applications/Blender.app, so
 * without an override that test would pass for the wrong reason on a
 * developer's box and fail on CI.
 */
function platformCandidates() {
  const override = process.env.LUCID_BLENDER_APP_PATHS;
  if (override !== undefined) return override.split(delimiter).filter(Boolean);
  if (process.platform === "darwin") {
    return [
      "/Applications/Blender.app/Contents/MacOS/Blender",
      join(homedir(), "Applications/Blender.app/Contents/MacOS/Blender"),
    ];
  }
  if (process.platform === "win32") {
    const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
    const found = [];
    for (const root of roots) {
      const foundation = join(root, "Blender Foundation");
      if (!existsSync(foundation)) continue;
      // The installer creates one directory per minor version ("Blender 4.4").
      for (const entry of safeReaddir(foundation)) {
        found.push(join(foundation, entry, "blender.exe"));
      }
    }
    return found;
  }
  return ["/usr/bin/blender", "/snap/bin/blender", "/opt/blender/blender"];
}

/** Newest-looking install first, so a machine with two Blenders picks the
 *  later one rather than whichever the filesystem happened to list first. */
function safeReaddir(dir) {
  try {
    return readdirSync(dir).sort().reverse();
  } catch {
    return [];
  }
}

/**
 * Walk the resolution order and stop at the first candidate that answers
 * `--version` with a Blender version. Every step is recorded, including the
 * ones that were skipped, so `doctor` can show the whole search rather than a
 * bare "not found".
 */
function resolveBlender(flagPath) {
  const steps = [];
  const tryCandidate = (source, candidate) => {
    if (!candidate) return null;
    const expanded = isAbsolute(candidate) ? candidate : resolve(candidate);
    if (!isFile(expanded)) {
      steps.push({ source, candidate: expanded, status: "missing" });
      return null;
    }
    const probe = probeVersion(expanded);
    if (!probe.ok) {
      steps.push({ source, candidate: expanded, status: "not-blender", reason: probe.reason });
      return null;
    }
    steps.push({ source, candidate: expanded, status: "ok", version: probe.version });
    return { found: true, path: expanded, version: probe.version, source, steps };
  };

  if (flagPath) {
    const hit = tryCandidate("flag", flagPath);
    if (hit) return hit;
    // An explicit --blender that does not work is a refusal, not a reason to
    // silently render with some other Blender the machine happens to have.
    const last = steps[steps.length - 1];
    fail(`--blender ${flagPath} is not a working Blender (${last.status}${last.reason ? `: ${last.reason}` : ""})`);
  } else {
    steps.push({ source: "flag", candidate: null, status: "not-given" });
  }

  if (process.env.BLENDER_PATH) {
    const hit = tryCandidate("env", process.env.BLENDER_PATH);
    if (hit) return hit;
  } else {
    steps.push({ source: "env", candidate: null, status: "not-set" });
  }

  const onPath = pathCandidates();
  if (onPath.length === 0) steps.push({ source: "path", candidate: null, status: "not-on-path" });
  for (const candidate of onPath) {
    const hit = tryCandidate("path", candidate);
    if (hit) return hit;
  }

  const platform = platformCandidates();
  if (platform.length === 0) steps.push({ source: "platform", candidate: null, status: "no-candidates" });
  for (const candidate of platform) {
    const hit = tryCandidate("platform", candidate);
    if (hit) return hit;
  }

  return { found: false, path: null, version: null, source: null, steps };
}

function requireBlender(flagPath) {
  const found = resolveBlender(flagPath);
  if (!found.found) {
    const looked = found.steps
      .filter((step) => step.candidate)
      .map((step) => `  ${step.source}: ${step.candidate} (${step.status})`)
      .join("\n");
    fail(`no Blender found. Install it, or point --blender / $BLENDER_PATH at it.${looked ? `\nLooked at:\n${looked}` : ""}`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// The Python kit
// ---------------------------------------------------------------------------

const KIT_MODULE = join(PYTHON_DIR, "kit.py");

/**
 * The expression that makes `import kit` work inside an agent's script.
 *
 * Blender's embedded Python ignores $PYTHONPATH unless it is started with
 * `--python-use-system-env`, and that flag would also pull in the developer's
 * site-packages and user scripts — exactly what `--factory-startup` is here to
 * keep out. `--python-expr` runs before the `--python` script (Blender
 * executes them in command-line order) and touches nothing else.
 *
 * The path is embedded with JSON.stringify: its escaping of backslashes and
 * quotes is valid Python string syntax too, which matters on Windows.
 *
 * `dont_write_bytecode` is not a detail: without it the first `import kit`
 * drops a `__pycache__/` into the installed skill directory, which is a
 * directory the mode ships and never cleans up. Blender only honours
 * $PYTHONDONTWRITEBYTECODE under --python-use-system-env, so it is set here
 * instead, before any import can happen.
 */
function kitPathExpression() {
  return `import sys; sys.dont_write_bytecode = True; sys.path.insert(0, ${JSON.stringify(PYTHON_DIR)})`;
}

/**
 * Read kit.py's public API out of kit.py.
 *
 * Derived rather than transcribed: a hand-written copy of the function list in
 * this file would drift from the module the moment either side is edited, and
 * the whole value of `blender.mjs kit` is that what it prints is callable.
 * Names starting with `_` are internals and are not advertised.
 */
function readKitApi() {
  if (!existsSync(KIT_MODULE)) fail(`kit: missing ${KIT_MODULE}`);
  const lines = readFileSync(KIT_MODULE, "utf-8").split("\n");
  const functions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const signature = /^def ([a-z][A-Za-z0-9_]*)\((.*)\):\s*$/.exec(lines[index]);
    if (!signature) continue;
    const doc = /^\s*"""(.*?)(?:"""|$)/.exec(lines[index + 1] ?? "");
    functions.push({
      name: signature[1],
      signature: `${signature[1]}(${signature[2]})`,
      summary: (doc?.[1] ?? "").trim(),
    });
  }
  if (!functions.length) fail(`kit: found no functions in ${KIT_MODULE}`);
  return functions;
}

// ---------------------------------------------------------------------------
// Running Blender
// ---------------------------------------------------------------------------

/** Prefix whole lines, holding the tail until its newline arrives. */
function linePrefixer(prefix, write) {
  let pending = "";
  return {
    push(chunk) {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) write(`${prefix}${line}\n`);
    },
    flush() {
      if (pending) {
        write(`${prefix}${pending}\n`);
        pending = "";
      }
    },
  };
}

/**
 * Run one Python script under Blender.
 *
 * `--factory-startup` keeps a developer's own add-ons, themes and unit
 * settings out of the result: the same file must convert the same way on
 * every machine. `--background` is what makes it headless — and what removes
 * the OpenGL context, which is why the Python helpers render with Workbench.
 *
 * @param {object} options
 * @param {string} options.blender   absolute path to the binary
 * @param {string} options.script    absolute path to the .py
 * @param {string[]} options.args    passed after the literal `--`
 * @param {number} options.timeoutMs
 * @param {"stdout"|"stderr"} options.streamTo where Blender's output is echoed
 * @param {boolean} [options.kit] put `blender/` on sys.path so `import kit` works
 */
function runBlenderScript({ blender, script, args, timeoutMs, streamTo, kit = true }) {
  return new Promise((resolvePromise) => {
    const argv = [
      "--background",
      "--factory-startup",
      ...(kit ? ["--python-expr", kitPathExpression()] : []),
      "--python", script, "--", ...args,
    ];
    const started = Date.now();
    const child = spawn(blender, argv, { stdio: ["ignore", "pipe", "pipe"] });
    const collected = { stdout: "", stderr: "" };
    let timedOut = false;

    const toStdout = streamTo === "stdout"
      ? linePrefixer("[blender] ", (line) => process.stdout.write(line))
      : linePrefixer("[blender] ", (line) => process.stderr.write(line));
    const toStderr = linePrefixer("[blender] ", (line) => process.stderr.write(line));

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { collected.stdout += chunk; toStdout.push(chunk); });
    child.stderr.on("data", (chunk) => { collected.stderr += chunk; toStderr.push(chunk); });

    let killer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      process.stderr.write(`[blender] timed out after ${Math.round(timeoutMs / 1000)}s — sending SIGTERM\n`);
      child.kill("SIGTERM");
      killer = setTimeout(() => {
        process.stderr.write("[blender] still running — sending SIGKILL\n");
        child.kill("SIGKILL");
      }, KILL_GRACE_MS);
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      if (killer) clearTimeout(killer);
      toStdout.flush();
      toStderr.flush();
      resolvePromise({ code: 127, timedOut, spawnError: error.message, ...collected, durationMs: Date.now() - started });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (killer) clearTimeout(killer);
      toStdout.flush();
      toStderr.flush();
      resolvePromise({
        code: code === null ? (timedOut ? 124 : 1) : code,
        signal,
        timedOut,
        ...collected,
        durationMs: Date.now() - started,
      });
    });
  });
}

/** Pull a Python helper's one-line `summary {...}` out of its log. Absence is
 *  not fatal: the wrapper's own checks already decided the run succeeded. */
function parseHelperSummary(stdout, tag) {
  const marker = `[${tag}] summary `;
  const line = stdout.split("\n").filter((entry) => entry.includes(marker)).pop();
  if (!line) return null;
  try {
    return JSON.parse(line.slice(line.indexOf(marker) + marker.length));
  } catch {
    return null;
  }
}

/** Run a helper and refuse unless it exited 0. Used by every subcommand that
 *  is not the `run` passthrough, so a failed Python step never reaches the
 *  "did it write the file" check with a stale file from an earlier run. */
async function runHelper(blender, scriptName, args, timeoutMs, label) {
  const script = join(PYTHON_DIR, scriptName);
  if (!existsSync(script)) fail(`${label}: missing helper ${script}`);
  const result = await runBlenderScript({ blender: blender.path, script, args, timeoutMs, streamTo: "stderr" });
  if (result.spawnError) fail(`${label}: could not start ${blender.path} (${result.spawnError})`);
  if (result.timedOut) fail(`${label}: Blender did not finish within ${Math.round(timeoutMs / 1000)}s and was killed`);
  if (result.code !== 0) {
    const tail = `${result.stderr}`.trim().split("\n").slice(-6).join("\n");
    fail(`${label}: Blender exited ${result.code}${tail ? `\n${tail}` : ""}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// The checklist on a produced GLB
// ---------------------------------------------------------------------------

/**
 * What a subcommand that wrote a GLB has to be able to prove about it.
 *
 * `convert` and `prep` both hand a file to Blender and get one back, and the
 * only thing that distinguishes "it worked" from "it produced the wrong file"
 * is this list of measurements. One reader, one shape, one set of lines.
 */
function glbChecklist(absOut) {
  const report = inspectGlb(absOut);
  const largest = report.images.reduce((best, image) => {
    const edge = Math.max(image.width ?? 0, image.height ?? 0);
    return edge > (best ? Math.max(best.width ?? 0, best.height ?? 0) : 0) ? image : best;
  }, null);
  return {
    report,
    checklist: {
      triangles: report.triangles,
      vertices: report.vertices,
      bbox: report.bbox,
      size: report.size,
      longestAxis: report.longestAxis,
      materials: report.materials.count,
      doubleSidedMaterials: report.materials.doubleSided,
      extensionsRequired: report.extensionsRequired,
      largestTexture: largest ? `${largest.width}x${largest.height}` : "none",
    },
  };
}

function checklistLines({ report, checklist }) {
  return [
    `  triangles  ${report.triangles} (${report.vertices} verts)`,
    `  bbox       ${report.bbox ? `min [${report.bbox.min.join(", ")}] max [${report.bbox.max.join(", ")}]` : "unavailable"}`,
    `  size       ${report.size ? report.size.join(" x ") : "?"}  longest ${report.longestAxis ?? "?"}`,
    `  materials  ${report.materials.count}, doubleSided ${report.materials.doubleSided}`,
    `  required   ${report.extensionsRequired.length ? report.extensionsRequired.join(", ") : "none"}`,
    `  texture    ${checklist.largestTexture}`,
    ...(report.warnings.length
      ? report.warnings.map((warning) => `  ! ${warning.code}: ${warning.message}`)
      : ["  no warnings"]),
  ];
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

/** Is the gltf-transform CLI already on this machine? A miss is not a
 *  problem — `glb.mjs` fetches it with `npx --yes` on first use — but knowing
 *  it will take a download is worth one line in the report. */
function probeGltfTransform() {
  const result = spawnSync("npx", ["--no-install", "@gltf-transform/cli", "--version"], {
    encoding: "utf-8",
    timeout: GLTF_PROBE_TIMEOUT_MS,
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) {
    return { available: false, note: "not in the npx cache — it will be fetched on first use" };
  }
  return { available: true, version: (result.stdout ?? "").trim() || null };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    return 0;
  }
  const command = argv[0];
  if (!SUBCOMMANDS.includes(command)) {
    console.error(`ERROR: unknown subcommand '${command}'. Expected one of: ${SUBCOMMANDS.join(", ")}`);
    console.error(USAGE);
    return 1;
  }

  // A literal `--` separates our flags from the script's own arguments.
  // parseArgs would swallow the boundary, so it is split off first.
  let ours = argv.slice(1);
  let passthrough = [];
  const separator = ours.indexOf("--");
  if (separator !== -1) {
    passthrough = ours.slice(separator + 1);
    ours = ours.slice(0, separator);
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: ours,
      options: { ...COMMON_OPTIONS, ...OPTIONS[command] },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    fail(`${command}: ${error.message}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const timeoutMs = num(values.timeout, "--timeout", { min: 1, fallback: DEFAULT_TIMEOUT_SECONDS }) * 1000;

  switch (command) {
    case "doctor": {
      const blender = resolveBlender(values.blender);
      const gltfTransform = values["no-gltf-probe"]
        ? { available: null, note: "probe skipped (--no-gltf-probe)" }
        : probeGltfTransform();
      const payload = {
        ok: blender.found,
        command: "doctor",
        blender: {
          found: blender.found,
          path: blender.path,
          version: blender.version,
          source: blender.source,
          steps: blender.steps,
        },
        gltfTransform,
        node: process.version,
        platform: process.platform,
      };
      emit(values, payload, [
        blender.found
          ? `blender        ${blender.version} at ${blender.path} (found via ${blender.source})`
          : "blender        NOT FOUND",
        ...blender.steps.map((step) => `  ${step.source.padEnd(8)} ${step.candidate ?? "-"} (${step.status}${step.reason ? `: ${step.reason}` : ""})`),
        `gltf-transform ${gltfTransform.available === null ? gltfTransform.note : gltfTransform.available ? `cached${gltfTransform.version ? ` (${gltfTransform.version})` : ""}` : gltfTransform.note}`,
        `node           ${process.version} on ${process.platform}`,
        ...(blender.found ? [] : ["", "Install Blender, or point --blender / $BLENDER_PATH at an existing install."]),
      ]);
      if (values.strict && !blender.found) return 1;
      break;
    }

    case "run": {
      const scriptPath = existingFile(requirePositional(positionals, 0, "<script.py>"), "<script.py>");
      if (values.kit === true && values["no-kit"] === true) fail("run: --kit and --no-kit contradict each other");
      const withKit = values["no-kit"] !== true;
      const blender = requireBlender(values.blender);
      const result = await runBlenderScript({
        blender: blender.path,
        script: scriptPath,
        args: passthrough,
        timeoutMs,
        streamTo: values.json ? "stderr" : "stdout",
        kit: withKit,
      });
      if (result.spawnError) fail(`run: could not start ${blender.path} (${result.spawnError})`);
      if (values.json) {
        console.log(JSON.stringify({
          ok: result.code === 0 && !result.timedOut,
          command: "run",
          script: scriptPath,
          args: passthrough,
          kit: withKit ? PYTHON_DIR : null,
          blender: { path: blender.path, version: blender.version, source: blender.source },
          exitCode: result.code,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
          stdout: result.stdout,
          stderr: result.stderr,
        }));
      }
      if (result.timedOut) {
        console.error(`ERROR: run: Blender did not finish within ${Math.round(timeoutMs / 1000)}s and was killed`);
      }
      return result.code;
    }

    case "render-views": {
      const input = existingFile(requirePositional(positionals, 0, "<glb>"), "<glb>");
      const outPath = requirePositional(positionals, 1, "<out.png>");
      const size = num(values.size, "--size", { integer: true, min: 16, max: 4096, fallback: 512 });
      const blender = requireBlender(values.blender);
      const absOut = resolve(outPath);
      await runHelper(blender, "render_views.py", [input, absOut, String(size)], timeoutMs, "render-views");

      if (!existsSync(absOut)) fail(`render-views: Blender exited 0 but wrote no file at ${outPath}`);
      const bytes = statSync(absOut).size;
      if (bytes < MIN_SHEET_BYTES) {
        fail(`render-views: ${outPath} is only ${bytes} bytes. A headless Blender that framed nothing writes a near-empty PNG and still exits 0 — check the [blender] log above for the import and the mesh count.`);
      }
      const sidecarPath = `${absOut}.json`;
      let sidecar = null;
      if (existsSync(sidecarPath)) {
        try {
          sidecar = JSON.parse(readFileSync(sidecarPath, "utf-8"));
        } catch (error) {
          fail(`render-views: the sidecar ${sidecarPath} does not parse: ${error.message}`);
        }
      } else {
        fail(`render-views: no sidecar at ${sidecarPath} — the sheet exists but its tile order is unknown`);
      }
      const views = (sidecar.tiles ?? []).map((tile) => tile.name);
      const payload = {
        ok: true,
        command: "render-views",
        path: outPath,
        bytes,
        size,
        views,
        sidecar: sidecarPath,
        tiles: sidecar.tiles ?? [],
        meshObjects: sidecar.meshObjects ?? null,
        blender: { path: blender.path, version: blender.version },
      };
      emit(values, payload, [
        `${outPath}  ${(bytes / 1024).toFixed(1)} KB  ${sidecar.cols ?? "?"}x${sidecar.rows ?? "?"} sheet of ${size}px tiles`,
        `  views   ${views.join(" | ")}`,
        `  axes    ${sidecar.axes ?? "glTF (Y up)"}`,
        `  meshes  ${sidecar.meshObjects ?? "?"} rendered, ${sidecar.skippedNotExported ?? 0} skipped as glTF_not_exported`,
      ]);
      break;
    }

    case "convert": {
      const input = existingFile(requirePositional(positionals, 0, "<fbx>"), "<fbx>");
      const outPath = requirePositional(positionals, 1, "<out.glb>");
      const yaw = values.yaw === undefined ? null : num(values.yaw, "--yaw", { min: -360, max: 360 });
      const textureSize = num(values["texture-size"], "--texture-size", { integer: true, min: 1, max: 16384, fallback: 1024 });
      const doubleSided = values["double-sided"] === true;
      const blender = requireBlender(values.blender);
      const absOut = resolve(outPath);
      const helperRun = await runHelper(blender, "fbx_to_glb.py", [
        input, absOut,
        ...(yaw === null ? [] : ["--yaw", String(yaw)]),
        "--texture-size", String(textureSize),
        "--double-sided", doubleSided ? "1" : "0",
      ], timeoutMs, "convert");

      if (!existsSync(absOut)) fail(`convert: Blender exited 0 but wrote no file at ${outPath}`);
      // The helper's own summary carries what only it can know — which
      // importer ran, whether the yaw reached the vertices, which images it
      // shrank — and `yawBaked: false` is a real degradation the agent has to
      // see rather than a detail buried in the log.
      const helper = parseHelperSummary(helperRun.stdout, "fbx_to_glb");
      // The checklist is the point: a conversion that cannot say what it
      // produced is indistinguishable from one that produced the wrong thing.
      const measured = glbChecklist(absOut);
      const { report, checklist } = measured;
      const payload = {
        ok: true,
        command: "convert",
        in: input,
        out: outPath,
        bytes: report.bytes,
        yaw,
        textureSize,
        doubleSided,
        checklist,
        helper,
        warnings: report.warnings,
        blender: { path: blender.path, version: blender.version },
      };
      emit(values, payload, [
        `${outPath}  ${(report.bytes / 1024).toFixed(1)} KB`,
        ...(yaw !== null && helper && helper.yawBaked === false
          ? [`  ! the ${yaw} deg yaw was NOT baked into the vertices (parented or shared meshes); it stays on the node transform — see the [blender] log`]
          : []),
        ...checklistLines(measured),
      ]);
      break;
    }

    case "kit": {
      const functions = readKitApi();
      // Aligned, but capped: two long signatures must not push every summary
      // off the right of an 80-column terminal.
      const column = Math.min(Math.max(...functions.map((entry) => entry.signature.length)) + 2, 50);
      const payload = {
        ok: true,
        command: "kit",
        module: KIT_MODULE,
        importLine: "import kit",
        functions,
        note: "blender.mjs run puts this directory on sys.path (--kit, on by default); --no-kit turns that off",
      };
      emit(values, payload, [
        `kit.py  ${KIT_MODULE}`,
        "",
        "  In a script run by 'blender.mjs run', write:  import kit",
        "  sys.path already carries this directory. --no-kit turns that off.",
        "",
        ...functions.map((entry) => `  ${entry.signature.padEnd(column)} ${entry.summary}`),
        "",
        "  Measuring and placing (world_bbox, ground, normalize) speaks glTF axes",
        "  (Y up); building (array offset, cutter locations) speaks Blender axes",
        "  (Z up). Every log line names the space of the vector it prints.",
        `  Copy ${join(PYTHON_DIR, "make_prop.py")} to start a hard-surface prop.`,
      ]);
      break;
    }

    case "prep": {
      const input = existingFile(requirePositional(positionals, 0, "<in>"), "<in>");
      const outPath = requirePositional(positionals, 1, "<out.glb>");
      const yaw = values.yaw === undefined ? null : num(values.yaw, "--yaw", { min: -360, max: 360 });
      // Refused here, before Blender is started: the answer does not depend on
      // the model, and a two-minute import is a long way to go for a typo.
      const asked = PREP_DIMENSIONS.filter((name) => values[name] !== undefined);
      if (asked.length > 1) {
        fail(`prep: normalize by exactly one dimension — ${asked.map((name) => `--${name}`).join(" and ")} were given together, and one uniform scale cannot satisfy two of them. Pick the dimension that aligns this asset with its neighbours.`);
      }
      const dimension = asked[0] ?? null;
      let target = null;
      if (dimension !== null) {
        target = num(values[dimension], `--${dimension}`, { min: 0 });
        if (target === 0) fail(`prep: --${dimension} must be greater than 0 — a zero target scales the model out of existence`);
      }
      let decimate = null;
      if (values.decimate !== undefined) {
        // 0 would delete the mesh and anything over 1 is not a ratio; Blender's
        // DECIMATE clamps silently, which is how a bad ratio becomes a no-op.
        decimate = num(values.decimate, "--decimate", { min: 0, max: 1 });
        if (decimate === 0) fail("prep: --decimate must be inside (0, 1] — 0 collapses the mesh to nothing");
      }
      const thin = (values.thin ?? "").split(",").map((name) => name.trim()).filter(Boolean);
      const merge = values.merge === true;

      const blender = requireBlender(values.blender);
      const absOut = resolve(outPath);
      const helperRun = await runHelper(blender, "prep_asset.py", [
        input, absOut,
        ...(yaw === null ? [] : ["--yaw", String(yaw)]),
        ...(dimension === null ? [] : [`--${dimension}`, String(target)]),
        ...(decimate === null ? [] : ["--decimate", String(decimate)]),
        ...(merge ? ["--merge"] : []),
        ...(thin.length ? ["--thin", thin.join(",")] : []),
      ], timeoutMs, "prep");

      if (!existsSync(absOut)) fail(`prep: Blender exited 0 but wrote no file at ${outPath}`);
      const helper = parseHelperSummary(helperRun.stdout, "prep_asset");
      const measured = glbChecklist(absOut);
      const { report, checklist } = measured;
      const payload = {
        ok: true,
        command: "prep",
        in: input,
        out: outPath,
        bytes: report.bytes,
        yaw,
        normalize: dimension === null ? null : { dimension, target },
        decimate,
        merge,
        thin,
        checklist,
        helper,
        warnings: report.warnings,
        blender: { path: blender.path, version: blender.version },
      };
      emit(values, payload, [
        `${outPath}  ${(report.bytes / 1024).toFixed(1)} KB`,
        ...(helper && helper.before
          ? [`  was        ${helper.before.triangles} tris, ${helper.before.objects} object(s), size ${helper.before.size.map((value) => Number(value.toFixed(4))).join(" x ")}`]
          : []),
        ...checklistLines(measured),
        ...(dimension === null
          ? ["  ! no --height/--longest/--width: this model kept whatever scale it arrived with, which for an image-to-3D asset is a 1-unit longest edge, not a size."]
          : []),
        ...(yaw === null
          ? ["  ! no --yaw: orientation is whatever the file had. Render six views (blender.mjs render-views) before trusting it."]
          : []),
      ]);
      break;
    }

    case "probe": {
      const input = existingFile(requirePositional(positionals, 0, "<glb|fbx>"), "<glb|fbx>");
      const blender = requireBlender(values.blender);
      const result = await runHelper(blender, "probe.py", [input], timeoutMs, "probe");
      const marker = "LUCID_PROBE_JSON ";
      const line = result.stdout.split("\n").filter((entry) => entry.startsWith(marker)).pop();
      if (!line) fail("probe: Blender exited 0 but printed no probe report — check the [blender] log above");
      let report;
      try {
        report = JSON.parse(line.slice(marker.length));
      } catch (error) {
        fail(`probe: the report line does not parse: ${error.message}`);
      }
      report.blender = { path: blender.path, version: blender.version };
      console.log(values.json ? JSON.stringify(report) : JSON.stringify(report, null, 2));
      break;
    }

    default:
      fail(`unhandled subcommand '${command}'`);
  }
  return 0;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof BlenderError) {
      console.error(`ERROR: ${error.message}`);
    } else {
      console.error(`ERROR: unexpected failure: ${error?.message ?? error}`);
      if (error?.stack) console.error(error.stack);
    }
    process.exitCode = 1;
  }
}

export { BlenderError, resolveBlender, runBlenderScript };
