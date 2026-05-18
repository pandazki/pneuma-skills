/**
 * Version Compatibility — match a semver range against a concrete runtime version.
 *
 * Used by the launcher to mark modes as compatible / drifted / incompatible
 * against the running pneuma-skills version. Lean implementation; no npm
 * semver dependency. Handles the dialect Pneuma authors actually use:
 *
 *   - exact:     "3.8.0"
 *   - caret:     "^3.8.0"   = >=3.8.0 <4.0.0
 *   - tilde:     "~3.8.0"   = >=3.8.0 <3.9.0
 *   - ranges:    ">=3.8.0", ">=3.8.0 <4.0.0", ">3.7.0", "<=3.8.0"
 *   - wildcard:  "*"  or  "x"
 *
 * Pre-release tags (e.g. "3.8.0-rc.1") are accepted as the runtime version
 * but treated leniently — we strip the suffix before comparing. Authors
 * who care about pre-release pinning should be explicit in their range.
 *
 * Classification levels feed the UI:
 *
 *   - "match"         → mode's declared range admits the runtime version
 *   - "minor-drift"   → same major, runtime > declared minor (likely fine,
 *                       worth a soft warning when authoring)
 *   - "major-drift"   → different major (likely broken, hard warning)
 *   - "unknown"       → no declared range (or unparseable) — render normally
 *
 * Keep the public surface narrow: `checkCompat(declared, runtime)` returns
 * a `CompatResult` the API and UI both consume.
 */

export type CompatLevel = "match" | "minor-drift" | "major-drift" | "unknown";

export interface CompatResult {
  level: CompatLevel;
  /** The declared range as written in manifest.ts (e.g. `"^3.8.0"`). */
  declared: string | null;
  /** The running pneuma-skills version (e.g. `"3.8.0"`). */
  runtime: string;
  /** Human-readable explanation when level !== "match" / "unknown". */
  reason?: string;
}

interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

interface Clause {
  op: ">" | ">=" | "<" | "<=" | "=";
  version: Version;
}

/**
 * Public entry point. Returns a structured compat result so callers can
 * render the right UI variant + tooltip text without re-parsing.
 */
export function checkCompat(
  declared: string | null | undefined,
  runtime: string,
): CompatResult {
  const runtimeV = parseVersion(runtime);
  if (!runtimeV) {
    return { level: "unknown", declared: declared ?? null, runtime };
  }

  if (!declared) {
    return { level: "unknown", declared: null, runtime };
  }

  const clauses = parseRange(declared);
  if (!clauses) {
    // Unparseable range — don't pretend to know
    return { level: "unknown", declared, runtime };
  }

  if (clauses.length === 0) {
    // Wildcard — always matches
    return { level: "match", declared, runtime };
  }

  const allMatch = clauses.every((c) => satisfiesClause(runtimeV, c));
  if (allMatch) {
    return { level: "match", declared, runtime };
  }

  // Not a match — classify the drift by looking at the *lower bound* of
  // the range. That's what the author was targeting; the runtime either
  // shares a major with it (minor drift) or doesn't (major drift).
  const lowerBound = inferLowerBound(clauses);
  if (lowerBound && lowerBound.major === runtimeV.major) {
    return {
      level: "minor-drift",
      declared,
      runtime,
      reason: `Targets ${declared}, running ${runtime} — same major, minor/patch drift.`,
    };
  }
  return {
    level: "major-drift",
    declared,
    runtime,
    reason: `Targets ${declared}, running ${runtime} — different major version, likely incompatible.`,
  };
}

// ── Parsing ─────────────────────────────────────────────────────────────────

function parseVersion(raw: string): Version | null {
  // Tolerate "v3.8.0" and similar prefixes.
  const stripped = raw.trim().replace(/^v/i, "");
  const m = stripped.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

/**
 * Parse a range string into a list of clauses. All clauses must hold
 * (logical AND). Returns:
 *   - `[]` for an unconditional wildcard
 *   - non-empty array for a concrete range
 *   - `null` when the input is unparseable
 */
function parseRange(raw: string): Clause[] | null {
  const r = raw.trim();
  if (r === "*" || r.toLowerCase() === "x") return [];

  // Caret: ^A.B.C → >=A.B.C <(A+1).0.0
  if (r.startsWith("^")) {
    const v = parseVersion(r.slice(1));
    if (!v) return null;
    return [
      { op: ">=", version: v },
      { op: "<", version: { major: v.major + 1, minor: 0, patch: 0, prerelease: null } },
    ];
  }

  // Tilde: ~A.B.C → >=A.B.C <A.(B+1).0
  if (r.startsWith("~")) {
    const v = parseVersion(r.slice(1));
    if (!v) return null;
    return [
      { op: ">=", version: v },
      { op: "<", version: { major: v.major, minor: v.minor + 1, patch: 0, prerelease: null } },
    ];
  }

  // Compound: split by whitespace, each part is a clause
  const parts = r.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return null;

  const out: Clause[] = [];
  for (const part of parts) {
    const m = part.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
    if (!m) return null;
    const op = (m[1] || "=") as Clause["op"];
    const v = parseVersion(m[2]);
    if (!v) return null;
    out.push({ op, version: v });
  }
  return out;
}

// ── Satisfaction check ──────────────────────────────────────────────────────

function compareVersions(a: Version, b: Version): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  // Treat pre-release as < the same M.m.p without pre-release (npm semver
  // convention). Don't go deeper — we're not adjudicating rc.1 vs rc.2.
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  return 0;
}

function satisfiesClause(runtime: Version, clause: Clause): boolean {
  const cmp = compareVersions(runtime, clause.version);
  switch (clause.op) {
    case "=":  return cmp === 0;
    case ">":  return cmp > 0;
    case ">=": return cmp >= 0;
    case "<":  return cmp < 0;
    case "<=": return cmp <= 0;
  }
}

/**
 * Best effort at recovering the "intended target" of the range — used to
 * classify drift severity. For `^3.8.0` or `>=3.8.0 <4.0.0` the lower
 * bound is `3.8.0`. For a bare `<4.0.0` (no lower bound) we hand back the
 * first parsed version, which may not be a meaningful "target" but at
 * least lets the UI render a comparison.
 */
function inferLowerBound(clauses: Clause[]): Version | null {
  for (const c of clauses) {
    if (c.op === ">=" || c.op === ">" || c.op === "=") return c.version;
  }
  return clauses[0]?.version ?? null;
}
