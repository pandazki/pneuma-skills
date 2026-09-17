/**
 * main.js — the starter scene. Build ON TOP of this; the pieces below are
 * correctness anchors, not decoration. Each comment says what is fixed and
 * why, so you can tell a deliberate change from breaking the bridge.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// The loader that ships with every project. `studioEnv` is used below; the
// rest are imported ready for the commented example further down — that block
// is the shortest path from a GLB to a frame, and the reason a scene never has
// to be built out of primitives alone. `disposeModel` is in there too.
import { instance, loadModel, playClip, studioEnv, textureFrom } from "./assets.js";

// The look pass — tone mapping, bloom, fog, vignette — in one call. Read the
// header of look.js: this is the pass to do FIRST, on the blockout, before a
// single model lands. Light is the cheapest detail there is.
import { makeLook } from "./look.js";

// FIXED: antialias on, pixel ratio capped at 2. Uncapped devicePixelRatio on
// a 3x display triples the fill cost and is the most common reason a scene
// that "looks fine" reports 20 fps to the loop.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; // PCF (the default); PCFSoftShadowMap is gone since r186
document.body.appendChild(renderer.domElement);

// A low-key study by default — a dusk sky, fog of the same colour — because
// that is the look that reads rich with almost nothing in it. A daylight
// target changes these two colours and the exposure, not the recipe.
const SKY = 0x0b0d16;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(4.5, 3, 6.5);

// The look: ACES tone mapping at exposure 1, a little bloom that only the
// practicals (emissive, bright specular) cross, a soft vignette, no fog by
// default. Retune with look.set({...}); for a low-key target start from
// exposure ~0.9, fog near the far plane and bloom strength ~0.6.
const look = makeLook(renderer, scene, camera, {
  exposure: 1.0,
  bloom: { strength: 0.5, radius: 0.5, threshold: 0.9 },
  fog: { color: SKY, near: 14, far: 60 },
  vignette: 0.3,
});

// FIXED, and as early as possible: without this the viewer can only grab a
// canvas and hope, and every capture may come back black. Optional chaining
// keeps the page working when it is opened without the bridge. `render` is
// the look pass, so a capture draws the same chain the user sees.
window.lucid?.register({ renderer, scene, camera, render: look.render });

// FIXED, and the single most common reason a scene looks broken: PBR materials
// reflect the environment, and with `scene.environment` unset anything with
// metalness renders near-black on a light background. `studioEnv` lives in
// assets.js (with the full explanation) so a rewritten main.js keeps it.
scene.environment = studioEnv(renderer);
// The map is for the PBR response, not the exposure: at full strength it
// floods a low-key scene with grey studio light and the ground reads flat.
scene.environmentIntensity = 0.3;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;

// Key, fill, practical — and not much of any. A cool moonlit key that casts,
// a dim hemisphere fill so the darks are blue rather than black, and one warm
// practical: the light in the picture. The environment map above does the
// soft work; these are what shape.
const key = new THREE.DirectionalLight(0x9fb4ff, 1.1);
key.position.set(-6, 9, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0005;
key.shadow.camera.left = key.shadow.camera.bottom = -14;
key.shadow.camera.right = key.shadow.camera.top = 14;
scene.add(key, new THREE.HemisphereLight(0x33415c, SKY, 0.35));

const practical = new THREE.PointLight(0xffb46b, 14, 14, 2);
practical.position.set(1.6, 2.2, 1.2);
practical.castShadow = true;
scene.add(practical);
// The fixture itself: emissive, so bloom makes it a light and not a sphere.
const lantern = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb46b, emissiveIntensity: 6 }),
);
lantern.position.copy(practical.position);
scene.add(lantern);

// A glossy dark ground: the practical reflects in it, which is most of what
// "atmosphere" is. Roughness 0.3, and a normal map once you have one.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.3, metalness: 0.05 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// One placeholder so the page is never a blank screen — a blank capture tells
// the judge nothing. Replace it with the scene's real hero.
const placeholder = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.9, 0),
  new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.65, roughness: 0.25 }),
);
placeholder.position.y = 1;
placeholder.castShadow = true;
scene.add(placeholder);

// ── Loading a real model ───────────────────────────────────────────────────
// Uncomment and point at a GLB under scene/models/. loadModel measures the
// file (AI-generated GLBs arrive normalized to longest-edge 1.0, NOT to
// height), normalizes it by the one dimension you name, puts its feet on
// y = 0, and returns the animation clips. Delete the placeholder above once
// something real is in frame.
//
// const hero = await loadModel("./models/hero.glb", { height: 1.8 });
// scene.add(hero.root);
// console.log(hero.sourceSize, hero.rigged, hero.clips.map((c) => c.name));
//
// A crowd from one rigged model — SkeletonUtils clone, one mixer each, and a
// phase offset per copy, or all of them march in step:
//
// const clock = new THREE.Clock();
// const crowd = [[-2, 0, 1], [1.5, 0, -2]].map((position, i) => {
//   const walker = instance(hero, { position, yawDeg: 180, phase: i * 0.37 });
//   playClip(walker.mixer, hero.clips, "Walk");
//   scene.add(walker.root);
//   return walker;
// });
// …and inside the animation loop below:
//   const delta = clock.getDelta();
//   for (const walker of crowd) walker.mixer.update(delta);
//
// Textures: `textureFrom(url, { srgb: false })` for normal/roughness maps.
// ───────────────────────────────────────────────────────────────────────────

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  look.resize();
});

// FIXED: render EVERY frame. `register` wrapped `renderer.render`, so the
// bridge counts the draws the chain below makes: fps is frames this renderer
// actually drew (once per animation frame, however many passes), and `ready`
// needs ten of them. An on-demand renderer therefore does not just report an
// odd fps — it never becomes ready, and the loop cannot capture it. If you
// need on-demand rendering later, tell the bridge about it first.
renderer.setAnimationLoop(() => {
  controls.update();
  look.render();
});
