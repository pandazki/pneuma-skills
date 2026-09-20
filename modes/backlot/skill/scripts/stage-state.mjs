/**
 * Backlot stage state — ONE algorithm for two runtimes.
 *
 * A film moves through eight stages in a fixed order. Only approvals are
 * stored (`backlot.json` → `approvals[stage] = { at, hash }`); everything
 * else is DERIVED from the text files that define a stage, so the viewer
 * (browser, `domain.ts`) and the scripts (`backlot.mjs`, `previz.mjs`) can
 * never disagree about whether a stage is empty, drafted, approved or
 * changed since approval.
 *
 * Media never enters a hash. A media file's identity is the `{ file,
 * revision }` record the JSON beside it carries; that record is what the
 * script rewrites when the media changes, and that is what the hash sees.
 *
 * This module is pure: no `node:*` imports, no I/O. `backlot.mjs` reads the
 * project directory into a `texts` map; `domain.ts` builds the same map from
 * `ViewerFileContent` with the content-set prefix stripped.
 *
 * `texts` keys are project-relative paths:
 *   backlot.json, idea.md, screenplay.md,
 *   bible/characters/<id>/character.json, bible/sets/<id>/set.json,
 *   shots/<id>/shot.json, sound/sound.json, cut/edl.json
 */

export const STAGES = Object.freeze([
  "idea",
  "script",
  "bible",
  "boards",
  "previz",
  "takes",
  "sound",
  "cut",
]);

export const STAGE_STATUSES = Object.freeze(["empty", "draft", "approved", "changed"]);

/**
 * Which stage must be `approved` before a paid command may spend. A command
 * absent from this table (render, check, cut --reel, sheet, compare) needs
 * no approval at all.
 */
export const GATES = Object.freeze({
  "bible-image": "script",
  voice: "script",
  board: "bible",
  generate: "previz",
  vo: "takes",
  music: "takes",
  "cut-final": "sound",
});

// ── Small pure helpers ──────────────────────────────────────────────────────

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text) {
  if (typeof text !== "string") return null;
  try {
    const raw = JSON.parse(text);
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** JSON with object keys sorted at every depth, so key order never changes a hash. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** FNV-1a 32-bit over UTF-16 code units, as 8 lowercase hex digits. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function sortedKeys(texts, prefix, suffix) {
  return Object.keys(texts)
    .filter((k) => k.startsWith(prefix) && k.endsWith(suffix))
    .sort();
}

function shotPaths(texts) {
  return sortedKeys(texts, "shots/", "/shot.json");
}

function selectedTakeOf(shot) {
  const takes = Array.isArray(shot.takes) ? shot.takes.filter(isRecord) : [];
  return takes.find((t) => t.selected === true) ?? null;
}

function checksFor(shot, target) {
  const checks = Array.isArray(shot.checks) ? shot.checks.filter(isRecord) : [];
  return checks
    .filter((c) => c.target === target)
    .map((c) => ({ id: c.id ?? null, status: c.status ?? "unverified" }));
}

function mediaRef(record) {
  if (!isRecord(record)) return null;
  return { file: record.file ?? null, revision: record.revision ?? null };
}

// ── Stage projections ───────────────────────────────────────────────────────
//
// Each projection returns the list of `{ path, value }` inputs that DEFINE a
// stage, or an empty list when the stage has nothing yet. `value` is a
// string (markdown) or a plain JSON value (the projected part of a record).
// An unparsable JSON file is still an input — its raw text — so a broken file
// reads as `changed`, never as `approved`.

function textInput(texts, path) {
  const text = texts[path];
  if (typeof text !== "string" || text.trim().length === 0) return [];
  return [{ path, value: text }];
}

function jsonInputs(texts, paths, project) {
  return paths.map((path) => {
    const raw = parseJson(texts[path]);
    return { path, value: raw ? project(raw) : texts[path] };
  });
}

const PROJECTIONS = {
  idea(texts) {
    return textInput(texts, "idea.md");
  },

  script(texts) {
    const inputs = textInput(texts, "screenplay.md");
    const manifest = parseJson(texts["backlot.json"]);
    const scenes = manifest && Array.isArray(manifest.scenes) ? manifest.scenes : [];
    if (scenes.length > 0) {
      inputs.push({
        path: "backlot.json#scenes",
        value: scenes.filter(isRecord).map((s) => ({
          id: s.id ?? null,
          number: s.number ?? null,
          heading: s.heading ?? null,
          summary: s.summary ?? null,
        })),
      });
    }
    return inputs;
  },

  bible(texts) {
    const characters = jsonInputs(
      texts,
      sortedKeys(texts, "bible/characters/", "/character.json"),
      (c) => ({
        id: c.id ?? null,
        name: c.name ?? null,
        description: c.description ?? null,
        look: c.look ?? null,
        sheet: mediaRef(c.sheet),
        voice: isRecord(c.voice)
          ? {
              model: c.voice.model ?? null,
              voiceId: c.voice.voiceId ?? null,
              style: c.voice.style ?? null,
              sample: isRecord(c.voice.sample)
                ? { file: c.voice.sample.file ?? null, text: c.voice.sample.text ?? null }
                : null,
            }
          : null,
      }),
    );
    const sets = jsonInputs(texts, sortedKeys(texts, "bible/sets/", "/set.json"), (s) => ({
      id: s.id ?? null,
      name: s.name ?? null,
      description: s.description ?? null,
      look: s.look ?? null,
      concept: mediaRef(s.concept),
    }));
    return [...characters, ...sets];
  },

  boards(texts) {
    const paths = shotPaths(texts);
    if (paths.length === 0) return [];
    const inputs = [];
    const manifest = parseJson(texts["backlot.json"]);
    const order = manifest && Array.isArray(manifest.shots) ? manifest.shots : [];
    inputs.push({ path: "backlot.json#shots", value: order });
    inputs.push(
      ...jsonInputs(texts, paths, (s) => ({
        id: s.id ?? null,
        title: s.title ?? null,
        scene: s.scene ?? null,
        characters: Array.isArray(s.characters) ? s.characters : [],
        set: s.set ?? null,
        spec: s.spec ?? null,
        beats: Array.isArray(s.beats) ? s.beats : [],
        board: isRecord(s.board) ? mediaRef(s.board) : null,
      })),
    );
    return inputs;
  },

  previz(texts) {
    const paths = shotPaths(texts).filter((p) => {
      const s = parseJson(texts[p]);
      return s === null || (isRecord(s.greybox) && isRecord(s.greybox.final));
    });
    return jsonInputs(texts, paths, (s) => ({
      id: s.id ?? null,
      greyboxRevision: isRecord(s.greybox) && isRecord(s.greybox.final) ? s.greybox.final.revision ?? null : null,
      checks: checksFor(s, "greybox"),
    }));
  },

  takes(texts) {
    const paths = shotPaths(texts).filter((p) => {
      const s = parseJson(texts[p]);
      if (s === null) return true;
      const takes = Array.isArray(s.takes) ? s.takes.filter(isRecord) : [];
      return takes.some((t) => t.status === "done");
    });
    return jsonInputs(texts, paths, (s) => {
      const selected = selectedTakeOf(s);
      return {
        id: s.id ?? null,
        selected: selected ? selected.id ?? null : null,
        checks: selected ? checksFor(s, selected.id) : [],
      };
    });
  },

  sound(texts) {
    const inputs = [];
    const sound = parseJson(texts["sound/sound.json"]);
    if (typeof texts["sound/sound.json"] === "string") {
      inputs.push({
        path: "sound/sound.json",
        value: sound
          ? { music: isRecord(sound.music) ? { file: sound.music.file ?? null, seconds: sound.music.seconds ?? null } : null }
          : texts["sound/sound.json"],
      });
    }
    for (const path of shotPaths(texts)) {
      const s = parseJson(texts[path]);
      const lines = s && Array.isArray(s.lines) ? s.lines.filter(isRecord) : [];
      if (lines.length === 0) continue;
      inputs.push({
        path: `${path}#lines`,
        value: lines.map((l) => ({
          id: l.id ?? null,
          speaker: l.speaker ?? null,
          kind: l.kind ?? null,
          text: l.text ?? null,
          at: l.at ?? null,
          file: l.file ?? null,
        })),
      });
    }
    // Lines alone do not make a sound stage: they are script until a file
    // or a music record exists.
    const hasFile = inputs.some(
      (i) =>
        i.path === "sound/sound.json" ||
        (Array.isArray(i.value) && i.value.some((l) => typeof l.file === "string" && l.file.length > 0)),
    );
    return hasFile ? inputs : [];
  },

  cut(texts) {
    if (typeof texts["cut/edl.json"] !== "string") return [];
    return jsonInputs(texts, ["cut/edl.json"], (e) => e);
  },
};

// ── Public API ──────────────────────────────────────────────────────────────

export function isStage(value) {
  return typeof value === "string" && STAGES.includes(value);
}

/** The inputs that define `stage` right now; `[]` means the stage is empty. */
export function stageInputs(stage, texts) {
  const project = PROJECTIONS[stage];
  if (!project) throw new Error(`unknown stage "${stage}"`);
  return project(texts ?? {});
}

/** Content hash of a stage, or null when the stage is empty. */
export function hashStage(stage, texts) {
  const inputs = stageInputs(stage, texts);
  if (inputs.length === 0) return null;
  const canonical = inputs
    .map((i) => `${i.path}\u0000${typeof i.value === "string" ? i.value : stableStringify(i.value)}\u0000`)
    .join("");
  return fnv1a(canonical);
}

/**
 * `empty` — nothing defines the stage yet;
 * `draft` — inputs exist, no approval recorded;
 * `approved` — the recorded hash equals the current one;
 * `changed` — approved once, but the inputs moved since.
 *
 * An approval whose hash is missing or malformed counts as `changed`: the
 * creator approved *something*, and nobody can say it was this.
 */
export function stageStatus(stage, texts, approvals) {
  const hash = hashStage(stage, texts);
  const approval = isRecord(approvals) && isRecord(approvals[stage]) ? approvals[stage] : null;
  if (hash === null) return approval ? "changed" : "empty";
  if (!approval) return "draft";
  return approval.hash === hash ? "approved" : "changed";
}

/** Every stage's status, in stage order. */
export function stageStatuses(texts, approvals) {
  return STAGES.map((stage) => ({ stage, status: stageStatus(stage, texts, approvals) }));
}

/** The stage a paid `command` waits on, or null when it needs none. */
export function gateFor(command) {
  return Object.prototype.hasOwnProperty.call(GATES, command) ? GATES[command] : null;
}

/**
 * May `command` spend right now? `manifest` is the parsed `backlot.json`
 * (`gates`, `approvals`). Open gates satisfy everything; otherwise the
 * gating stage must be `approved` — `changed` is NOT approved, the creator
 * has not seen the current version.
 */
export function gateCheck(command, texts, manifest) {
  const stage = gateFor(command);
  if (stage === null) return { ok: true, stage: null, status: null, reason: null };
  const gates = isRecord(manifest) ? manifest.gates : undefined;
  if (gates === "open") return { ok: true, stage, status: null, reason: null };
  const status = stageStatus(stage, texts, isRecord(manifest) ? manifest.approvals : null);
  if (status === "approved") return { ok: true, stage, status, reason: null };
  const reason =
    status === "changed"
      ? `stage "${stage}" changed after it was approved; the creator has not seen the current version`
      : `stage "${stage}" is ${status}; it must be approved before "${command}" may spend`;
  return { ok: false, stage, status, reason };
}
