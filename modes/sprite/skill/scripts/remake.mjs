/**
 * remake.mjs — what a character's other looks and other movements ask the
 * models for (0.6.0): a variant's edit, a restyled clip, a storyboard clip,
 * the motion library's driving clips.
 *
 * Pure: no files, no network. `sprite-project.mjs` prints and records the
 * text; the agent makes the paid call with the shared scripts.
 *
 * The four share one idea: the expensive, hard part — who the character is,
 * or how it moves — already exists, and the model is asked to keep it and
 * change one thing. A variant keeps the person and changes the outfit; a
 * restyle keeps the movement and changes the look; a transfer keeps the
 * character and takes the movement from a clip; a storyboard pins the beats.
 */

/** The version of the text below; any change to a sentence bumps it. */
export const REMAKE_PROMPT_BUILDER = "remake-prompt/1";

const closed = (text) => {
  const t = String(text ?? "").trim();
  return /[.!?]["')\]]?$/.test(t) ? t : `${t}.`;
};

/**
 * The edit that turns one of the original character's references into the
 * variant's: the same person, the same picture layout, one change. Sent to
 * the edit model (Sunburst) with the original reference attached.
 *
 * `what` names the reference: "turnaround" (three views), "directions" (a
 * facing sheet), "portrait", or anything else as a plain noun.
 */
export function variantEditPrompt({ character, note, what = "turnaround" }) {
  const change = String(note ?? "").trim();
  if (!change) throw new Error("--variant: say what changes (\"a purple witch outfit with a pointed hat\")");
  const layout = {
    turnaround: "the same three views side by side, in the same order, the same poses and the same size",
    directions: "the same grid of facings, every copy in the same cell, facing the same way, in the same pose and at the same size",
    portrait: "the same head-and-shoulders framing and pose",
  }[what] ?? "the same composition, pose and framing";
  const text = [];
  text.push(`Edit the attached image. It is ${character?.name ? `${character.name}'s ` : "a character's "}${what === "directions" ? "facing sheet" : what}: keep ${layout}.`);
  text.push("Keep the same character — face, eyes, hair, skin, body proportions and height — and the same art style, line weight, shading and lighting.");
  text.push(`Change only this: ${closed(change)}`);
  text.push("Everything the change does not touch stays exactly as it is. A flat solid pure white background, no text, no labels.");
  return { prompt: text.join(" "), builder: REMAKE_PROMPT_BUILDER };
}

/**
 * A restyled clip: the same movement, a new look. Seedance's reference
 * endpoint, `@Video1` the original clip, `@Image1` the new look (the
 * variant's facing sheet or turnaround). The clip keeps every frame's
 * framing, so a pack restyled this way cuts on the same grid.
 */
export function restylePrompt({ character, note, grid = null }) {
  const change = String(note ?? "").trim();
  const text = [];
  text.push("Redraw @Video1 with a new look and keep its movement exactly: every pose, every step, the timing, the framing, the camera and the position of everything in the frame stay as they are, frame for frame.");
  if (grid) {
    text.push(`@Video1 is a ${grid.cols} by ${grid.rows} grid of copies of one character on a green background; keep every copy in its cell, facing the way it faces.`);
  }
  text.push(`The new look is @Image1${character?.name ? ` — ${character.name}` : ""}: match its design, colours, costume and art style exactly${change ? `; ${change.replace(/[.]+$/, "")}` : ""}.`);
  if (character?.style) text.push(closed(character.style));
  text.push("The background stays a flat solid pure chroma-key green fill, evenly lit: no floor, no shadows, no effects, no green light on the character. Camera completely locked. Crisp, clean frames with no motion blur.");
  return { prompt: text.join(" "), builder: REMAKE_PROMPT_BUILDER };
}

/**
 * A storyboard clip: the character performs timed beats, the keyframes the
 * user approved pinned as references. `@Image1` is the character (its
 * turnaround), `@Image2…` the keyframes in beat order.
 */
export function storyboardPrompt({ character, beats, duration }) {
  if (!Array.isArray(beats) || !beats.length) throw new Error("the storyboard has no beats (set-storyboard --beat \"0:…\")");
  let image = 1;
  const keyed = beats.map((b) => ({ ...b, ref: b.keyframe ? ++image : null }));
  const text = [];
  text.push(`2D game sprite animation, one continuous ${duration ? `${duration}-second ` : ""}take of @Image1, the character — keep their face, proportions, palette and costume exactly.`);
  if (character?.style) text.push(closed(character.style));
  text.push("The beats, in order:");
  for (const b of keyed) {
    text.push(`at ${b.at}s — ${closed(b.text).replace(/[.]$/, "")}${b.ref ? `, matching the pose in @Image${b.ref}` : ""}.`);
  }
  text.push("The camera is locked off: no pan, no tilt, no zoom, no cut. The whole character and everything they hold stays inside the frame with margin. The background is a flat solid pure chroma-key green fill, evenly lit: no floor, no shadow, no effects detached from the character. Crisp, clean frames with no motion blur.");
  return { prompt: text.join(" "), builder: REMAKE_PROMPT_BUILDER, attach: ["@Image1 = the turnaround", ...keyed.filter((b) => b.ref).map((b) => `@Image${b.ref} = the keyframe at ${b.at}s`)] };
}

/** What a motion-transfer clip is asked for, beside the character's image. */
export function transferPrompt({ character }) {
  const text = [];
  text.push(`The character in the image${character?.name ? `, ${character.name},` : ""} performs the movement of the reference video, keeping their exact design, costume, colours and proportions.`);
  text.push("The background stays a flat solid pure chroma-key green fill: no floor, no shadow. Camera locked, whole body in frame.");
  return { prompt: text.join(" "), builder: REMAKE_PROMPT_BUILDER };
}

/**
 * The motion library: performances a character can borrow (0.6.0). Each
 * entry is a RECIPE for a driving clip — a realistic performer, whole body,
 * locked camera, plain studio — that Seedance shoots once per workspace
 * (`motion-library/<id>.mp4`, ≈ $1 at 480p) and every character reuses:
 * Kling Motion Control reads a realistic performer best (its own input
 * rule), so the library is filmed, not drawn. Measured 2026-10-30: the
 * `victory-dance` recipe below drove Pip (a chibi girl) through every beat
 * on chroma green in one Kling v3 Standard take ($0.60, 287 s).
 */
const PERFORMER = "A realistic video of a young adult performer in a plain white t-shirt, black jogger pants and white sneakers";
const STAGE = "Their entire body from head to feet is always fully visible and centred in the frame with margin above the head and below the feet. Fixed camera on a tripod, completely locked: no pan, no tilt, no zoom, no cut. Plain light-grey studio wall and floor, soft even lighting, no other people, no objects.";

export const MOTION_LIBRARY = [
  { id: "victory-dance", label: "Victory dance", category: "emote", action: "performing a cheerful energetic victory dance in place: pumps both fists in the air, two quick side steps left and right, a little hop with a spin of the arms, then ends in a confident pose with one fist raised" },
  { id: "hip-hop", label: "Hip-hop groove", category: "dance", action: "dancing a bouncy hip-hop groove in place: knees bouncing on the beat, shoulders rolling, arms swinging in rhythm, a quick body wave, staying on the spot" },
  { id: "wave-hello", label: "Wave hello", category: "emote", action: "standing in place and waving hello with the right hand, big and friendly, then a small bow and back to a relaxed stance" },
  { id: "sword-combo", label: "Sword combo", category: "combat", action: "holding an imaginary two-handed sword: a ready stance, a rising slash, a horizontal slash and a downward strike, then back to the ready stance, staying on the spot" },
  { id: "punch-combo", label: "Punch combo", category: "combat", action: "in a boxing stance: a left jab, a right cross, a left hook, then back to guard, staying on the spot" },
  { id: "spell-cast", label: "Spell cast", category: "combat", action: "casting a spell: draws both hands in to the chest, raises them overhead gathering energy, then thrusts both palms forward and holds, then relaxes, staying on the spot" },
  { id: "hit-react", label: "Hit reaction", category: "combat", action: "standing in a ready stance, then reacting to a hit to the chest: jolts backward half a step, recovers and returns to the ready stance" },
  { id: "jump-cheer", label: "Jump for joy", category: "emote", action: "jumping straight up for joy twice with both arms raised, landing on the same spot, then a happy little clap" },
  { id: "sneak", label: "Sneak", category: "locomotion", action: "sneaking in place on tiptoe: crouched low, knees bent, arms held close, lifting the feet carefully in a slow steady rhythm without travelling" },
  { id: "idle-stretch", label: "Stretch", category: "emote", action: "standing relaxed, then stretching both arms high overhead with a yawn, then rolling the shoulders and settling back to a relaxed stance" },
];

/** The library entry by id, or null. */
export function libraryEntry(id) {
  return MOTION_LIBRARY.find((e) => e.id === id) ?? null;
}

/** The text-to-video prompt that films a library entry's driving clip. */
export function libraryClipPrompt(entry) {
  if (!entry?.action) throw new Error("not a library entry");
  return `${PERFORMER} ${entry.action}. ${STAGE}`;
}
