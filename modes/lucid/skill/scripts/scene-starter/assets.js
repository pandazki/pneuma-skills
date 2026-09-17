/**
 * assets.js — the scene's loader: every model, texture and clone goes here.
 *
 * WHY this file ships with every project: a starter with no loader produces a
 * scene built entirely out of three.js primitives. The mode can generate a GLB
 * from an image and build one in Blender, and neither ever reaches the frame
 * unless loading a model is ONE call away in the file the agent edits.
 *
 * Every default below is a correctness anchor from `references/three-scene.md`
 * applied automatically, not advice you have to remember: bounds measured from
 * GEOMETRY through the bind matrix, exactly ONE dimension allowed to normalize
 * an asset, feet on y = 0, SkeletonUtils clones with a mixer each, root motion
 * stripped from walk cycles, and a compressed GLB reported as "run glb.mjs
 * unpack" rather than as an unexplained three.js throw. Each export says why.
 *
 * No framework, no build step: the three specifiers below are exactly the ones
 * index.html's importmap resolves out of scene/vendor/.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

/**
 * Loads in flight, ref-counted. The bridge's `ready` must stay false until
 * ALL of them finish; a plain setLoading(false) from whichever load returns
 * first would declare a half-built scene ready and hand the judge that frame.
 * Written only by beginLoad / endLoad.
 */
let inFlight = 0;
const beginLoad = () => {
  if (inFlight++ === 0) window.lucid?.setLoading(true);
};
const endLoad = () => {
  if (inFlight > 0 && --inFlight === 0) window.lucid?.setLoading(false);
};

/** Scratch objects. Every user is synchronous, so reuse is safe. */
const _matrix = new THREE.Matrix4();
const _box = new THREE.Box3();

/** Bones whose `.position` track is root motion rather than animation. */
const ROOT_BONE = /^(root|hips?|pelvis|armature|bip\d*|mixamorig[:_]?hips)$/i;

/** Stripped clips, cached per SOURCE clip so N instances share one. */
const strippedClips = new WeakMap();

/**
 * Phase offsets recorded by `instance` and consumed by the first `playClip`
 * on that mixer. A mixer with no actions has nowhere to put a phase —
 * `setTime` zeroes each action and replays the delta, so the offset has to be
 * applied again once an action exists. One-shot: a later crossfade keeps its
 * own timing.
 */
const pendingPhase = new WeakMap();

/**
 * Load one GLB/glTF, measured and normalized.
 *
 * Pass exactly one of `height` / `width` / `longest` (world units) or none to
 * keep the file's own scale. `thinNames` are substrings of object names that
 * legitimately need two-sided shading (leaves, flags, cloth, signs).
 *
 * @param {string} url - relative to the scene page, e.g. './models/hero.glb'.
 * @param {{height?:number,width?:number,longest?:number,ground?:boolean,
 *          yawDeg?:number,singleSided?:boolean,thinNames?:string[],
 *          onProgress?:(e:ProgressEvent)=>void}} [options]
 * @returns {Promise<{root:THREE.Object3D, clips:THREE.AnimationClip[],
 *          size:THREE.Vector3, bounds:THREE.Box3, rigged:boolean,
 *          scale:number, sourceSize:THREE.Vector3}>}
 *          `size` / `bounds` are the placed result; `sourceSize` is what the
 *          file actually contained (an AI-generated GLB usually arrives with
 *          its LONGEST edge at 1.0, not its height).
 * @example
 * const hero = await loadModel('./models/hero.glb', { height: 1.75, yawDeg: 180 });
 * scene.add(hero.root);
 */
export async function loadModel(url, options = {}) {
  const {
    height, width, longest,
    ground = true,
    yawDeg = 0,
    singleSided = true,
    thinNames = [],
    onProgress,
  } = options;

  const given = [["height", height], ["width", width], ["longest", longest]]
    .filter(([, value]) => value !== undefined && value !== null);
  if (given.length > 1) {
    throw new Error(
      `loadModel(${url}): normalize by ONE dimension, got ${given.map(([k]) => k).join(" + ")}. ` +
      "Pick the dimension that aligns this asset with its neighbours (crown width for a tree, " +
      "facade width for a building, eye height for a character).",
    );
  }

  beginLoad();
  let gltf;
  try {
    // No setMeshoptDecoder / setDRACOLoader on purpose: the scene vendors six
    // three.js files and nothing else, and `glb.mjs unpack` removes the
    // compression up front. decoderError below turns the resulting three.js
    // throw into that instruction instead of a puzzle.
    gltf = await new GLTFLoader().loadAsync(url, onProgress);
  } catch (error) {
    throw decoderError(url, error);
  } finally {
    endLoad();
  }

  const root = gltf.scene;
  if (!root.name) root.name = url.split("/").pop().replace(/\.(glb|gltf)$/i, "");

  const raw = measure(root);
  root.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  // Measured AGAIN after the yaw: a 90° turn swaps which extent is "width",
  // and normalizing against the pre-yaw box would scale by the wrong one.
  const turned = measure(root);

  const size = turned.box.getSize(new THREE.Vector3());
  let scale = 1;
  if (height !== undefined && height !== null) scale = height / size.y;
  else if (width !== undefined && width !== null) scale = width / size.x;
  else if (longest !== undefined && longest !== null) scale = longest / Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`loadModel(${url}): measured an empty bounding box (${size.toArray().join(" x ")}) — nothing to scale.`);
  }
  root.scale.setScalar(scale);

  // Object3D composes T · R · S, so the translation below is applied last and
  // in world units: scale the measured box, then push its floor to y = 0.
  const center = turned.box.getCenter(new THREE.Vector3());
  if (ground) {
    root.position.set(-center.x * scale, -turned.box.min.y * scale, -center.z * scale);
  }

  if (singleSided) applySides(root, thinNames);

  return {
    root,
    clips: gltf.animations || [],
    size: size.multiplyScalar(scale),
    bounds: measure(root).box,
    rigged: turned.rigged,
    scale,
    sourceSize: raw.box.getSize(new THREE.Vector3()),
  };
}

/**
 * Place one copy of a loaded model. The clone keeps the normalization
 * `loadModel` baked in; `position` / `yawDeg` / `scale` are applied to a
 * wrapper around it, so grounding survives placement.
 *
 * @param {{root:THREE.Object3D, rigged:boolean}} model - a `loadModel` result.
 * @param {{position?:number[], yawDeg?:number, scale?:number, phase?:number}} [options]
 *        `scale` multiplies the normalized size; `phase` (seconds) offsets this
 *        copy's animation clock so a crowd is not one parade.
 * @returns {{root:THREE.Group, mixer:THREE.AnimationMixer}} add `root` to the
 *        scene and call `mixer.update(delta)` every frame.
 * @example
 * const walker = instance(hero, { position: [2, 0, -1], yawDeg: -30, phase: 0.6 });
 * scene.add(walker.root);
 */
export function instance(model, options = {}) {
  const { position = [0, 0, 0], yawDeg = 0, scale = 1, phase = 0 } = options;
  // SkeletonUtils.clone rebuilds the skeleton; Object3D.clone SHARES it, and
  // every copy of a rigged model then plays the same pose in lock-step.
  const copy = model.rigged ? cloneSkinned(model.root) : model.root.clone();

  const root = new THREE.Group();
  root.name = `${model.root.name || "model"}-instance`;
  root.add(copy);
  root.position.set(position[0] || 0, position[1] || 0, position[2] || 0);
  root.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  root.scale.setScalar(scale);

  // One mixer per instance: a shared mixer is the other half of the parade.
  const mixer = new THREE.AnimationMixer(copy);
  if (phase) pendingPhase.set(mixer, phase);
  return { root, mixer };
}

/**
 * Start a clip on one instance's mixer.
 *
 * @param {THREE.AnimationMixer} mixer - from `instance`.
 * @param {THREE.AnimationClip[]} clips - from `loadModel`.
 * @param {string|number} which - clip name, or index into `clips`.
 * @param {{stripRootMotion?:boolean, loop?:boolean}} [options]
 * @returns {THREE.AnimationAction}
 * @example
 * playClip(walker.mixer, hero.clips, 'Walk');
 * playClip(walker.mixer, hero.clips, 0, { loop: false });
 */
export function playClip(mixer, clips, which, options = {}) {
  const { stripRootMotion = true, loop = true } = options;
  const clip = typeof which === "number" ? (clips || [])[which] : THREE.AnimationClip.findByName(clips || [], which);
  if (!clip) {
    const names = (clips || []).map((c, i) => `${i}:${c.name}`).join(", ") || "none";
    throw new Error(`playClip: no clip ${JSON.stringify(which)} — this model has [${names}]`);
  }

  const action = mixer.clipAction(stripRootMotion ? withoutRootMotion(clip, mixer.getRoot()) : clip);
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  action.reset().play();

  const phase = pendingPhase.get(mixer);
  if (phase) {
    pendingPhase.delete(mixer);
    mixer.setTime(phase % (clip.duration || 1));
  }
  return action;
}

/**
 * Free a loaded model's GPU memory. Call it on the root `loadModel` returned —
 * NEVER on an `instance` root: clones share geometries, materials and
 * textures with the original, and disposing them empties every other copy.
 * Drop an instance with `root.removeFromParent()` alone.
 *
 * @param {THREE.Object3D} root
 * @returns {{geometries:number, materials:number, textures:number}}
 * @example
 * scene.remove(hero.root);
 * disposeModel(hero.root);
 */
export function disposeModel(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of materialsOf(node)) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value && value.isTexture) textures.add(value);
    }
  }
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  root.removeFromParent();
  return { geometries: geometries.size, materials: materials.size, textures: textures.size };
}

/**
 * Load one texture with its colour space set correctly. Albedo / emissive maps
 * hold sRGB colour; normal, roughness, metalness, AO and displacement maps hold
 * DATA — reading those through the sRGB curve bends every value and the surface
 * comes out subtly wrong with nothing to point at.
 *
 * @param {string} url
 * @param {{repeat?:number[], srgb?:boolean, anisotropy?:number}} [options]
 * @returns {Promise<THREE.Texture>}
 * @example
 * const albedo = await textureFrom('./textures/stone.png', { repeat: [4, 4] });
 * const normal = await textureFrom('./textures/stone-normal.png', { srgb: false });
 */
export async function textureFrom(url, options = {}) {
  const { repeat = [1, 1], srgb = true, anisotropy = 8 } = options;
  beginLoad();
  let texture;
  try {
    texture = await new THREE.TextureLoader().loadAsync(url);
  } finally {
    endLoad();
  }
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = anisotropy;
  return texture;
}

/**
 * A studio environment map drawn in a canvas — no HDR file to ship.
 *
 * WHY it is not optional: PBR materials reflect the environment. With
 * `scene.environment` unset, anything with metalness renders near-black on a
 * light background and reads as a broken model.
 * WHY the gradient needs a dark bottom: a uniformly bright map reflects only
 * brightness, and metal goes flat grey — the contrast between a bright top and
 * a dark floor is what reads as a reflection.
 * WHY no tone mapping here: ACES on a light background crushes the whites to
 * grey. Leave `renderer.toneMapping` alone unless the target really is a dark,
 * high-dynamic-range scene.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @returns {THREE.Texture} assign it to `scene.environment`.
 * @example
 * scene.environment = studioEnv(renderer);
 * scene.environmentIntensity = 0.7;
 */
export function studioEnv(renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  const sky = ctx.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, "#ffffff"); // overhead
  sky.addColorStop(0.55, "#9a948c"); // warm grey horizon
  sky.addColorStop(1, "#0d0d0f"); // near-black floor
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 128, 128);

  // A soft white ellipse: the "softbox" whose reflection gives glossy surfaces
  // a highlight with a shape instead of a flat sheen.
  ctx.save();
  ctx.translate(64, 34);
  ctx.scale(1, 0.55);
  const softbox = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
  softbox.addColorStop(0, "rgba(255,255,255,1)");
  softbox.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = softbox;
  ctx.beginPath();
  ctx.arc(0, 0, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const equirect = new THREE.CanvasTexture(canvas);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(equirect).texture;
  equirect.dispose(); // the intermediates are not needed once PMREM has run
  pmrem.dispose();
  return environment;
}

// ── internals ──────────────────────────────────────────────────────────────

const materialsOf = (node) => (Array.isArray(node.material) ? node.material : node.material ? [node.material] : []);

/**
 * World-space bounds of the model AS AUTHORED, plus whether it is skinned.
 *
 * `Box3.setFromObject` cannot be used here: for a SkinnedMesh it falls through
 * to `SkinnedMesh.computeBoundingBox()`, which walks the vertices through the
 * CURRENT bone matrices and caches the answer forever. Before the first
 * `skeleton.update()` those matrices are meaningless, so a character can be
 * scaled until only its shoes are in frame — with a clean console.
 *
 * The bind pose is recovered from the geometry instead: a vertex lands at
 * `matrixWorld · bindMatrixInverse · boneMatrix · bindMatrix · v`, and in the
 * bind pose every `boneMatrix` is the identity. `bindMatrixInverse` is only
 * correct after `updateMatrixWorld` — that is the method SkinnedMesh
 * overrides, and the reason it is called here rather than `updateWorldMatrix`.
 */
function measure(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let rigged = false;
  root.traverse((node) => {
    const geometry = node.geometry;
    if (!node.isMesh || !geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    _matrix.copy(node.matrixWorld);
    if (node.isSkinnedMesh) {
      rigged = true;
      _matrix.multiply(node.bindMatrixInverse).multiply(node.bindMatrix);
    }
    box.union(_box.copy(geometry.boundingBox).applyMatrix4(_matrix));
  });
  return { box, rigged };
}

/**
 * FrontSide everywhere except objects whose name contains a `thinNames` entry.
 * `double-sided-all` is a Blender export default (see `glb.mjs inspect`): it
 * shades every face twice for nothing. Only genuinely thin surfaces — leaves,
 * flags, cloth, signage — disappear when they are single-sided.
 */
function applySides(root, thinNames) {
  const thin = thinNames.map((name) => String(name).toLowerCase()).filter(Boolean);
  root.traverse((node) => {
    if (!node.isMesh) return;
    const name = String(node.name || "").toLowerCase();
    const isThin = thin.some((needle) => name.includes(needle));
    for (const material of materialsOf(node)) {
      material.side = isThin ? THREE.DoubleSide : THREE.FrontSide;
      material.needsUpdate = true;
    }
  });
}

/**
 * The clip without its root-motion translation. A walk cycle carries the hips
 * forward — 1.3 units on a 1-unit person — and a looping mixer snaps that back
 * to the origin at every cycle. Gameplay code should move the character; the
 * clip should only animate it.
 *
 * Only applied to RIGGED models: on a model with no bones the position tracks
 * are the animation, and stripping them would leave a still object.
 */
function withoutRootMotion(clip, mixerRoot) {
  const cached = strippedClips.get(clip);
  if (cached) return cached;

  const rootBones = new Set();
  let hasBones = false;
  mixerRoot.traverse((node) => {
    if (!node.isBone) return;
    hasBones = true;
    if (!node.parent || !node.parent.isBone) rootBones.add(node.name);
  });

  let result = clip;
  if (hasBones) {
    const tracks = clip.tracks.filter((track) => {
      const cut = track.name.lastIndexOf(".");
      if (cut < 0 || track.name.slice(cut + 1) !== "position") return true;
      const node = track.name.slice(0, cut).split("/").pop();
      return !(rootBones.has(node) || ROOT_BONE.test(node));
    });
    // The tracks themselves are shared, not copied: they are read-only during
    // playback, and cloning them per instance would duplicate the keyframes.
    if (tracks.length !== clip.tracks.length) {
      result = new THREE.AnimationClip(`${clip.name} (no root motion)`, clip.duration, tracks, clip.blendMode);
    }
  }
  strippedClips.set(clip, result);
  return result;
}

/**
 * Name the real fix for a compressed GLB. Three.js throws
 * "setMeshoptDecoder must be called before loading compressed files" /
 * "No DRACOLoader instance provided" — true, and useless here, because the
 * scene deliberately vendors no decoders.
 */
function decoderError(url, error) {
  const message = String((error && error.message) || error);
  if (/meshopt/i.test(message) || /draco/i.test(message)) {
    const kind = /meshopt/i.test(message) ? "meshopt" : "draco";
    return new Error(
      `loadModel(${url}): this file is ${kind}-compressed and the scene ships no decoder. ` +
      `Run 'glb.mjs unpack ${url} <out.glb>' and load the unpacked file. (${message})`,
    );
  }
  return new Error(`loadModel(${url}): ${message}`);
}
