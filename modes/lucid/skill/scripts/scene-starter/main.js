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

// FIXED: antialias on, pixel ratio capped at 2. Uncapped devicePixelRatio on
// a 3x display triples the fill cost and is the most common reason a scene
// that "looks fine" reports 20 fps to the loop.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeceff3); // light neutral; change it freely

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(4.5, 3, 6.5);

// FIXED, and as early as possible: without this the viewer can only grab a
// canvas and hope, and every capture may come back black. Optional chaining
// keeps the page working when it is opened without the bridge.
window.lucid?.register({ renderer, scene, camera });

// FIXED, and the single most common reason a scene looks broken: PBR materials
// reflect the environment, and with `scene.environment` unset anything with
// metalness renders near-black on a light background. `studioEnv` lives in
// assets.js (with the full explanation) so a rewritten main.js keeps it.
scene.environment = studioEnv(renderer);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;

// A key light with a direction plus a little ambient fill. The environment map
// above does the soft work; this is what casts and shapes.
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(5, 8, 4);
scene.add(sun, new THREE.AmbientLight(0xffffff, 0.35));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0xd8dae0, roughness: 0.92, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// One placeholder so the page is never a blank screen — a blank capture tells
// the judge nothing. Replace it with the scene's real hero.
const placeholder = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.9, 0),
  new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.65, roughness: 0.25 }),
);
placeholder.position.y = 1;
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
});

// FIXED: render EVERY frame. `register` wrapped `renderer.render`, so the
// bridge counts the calls below and nothing else: fps is frames this renderer
// actually drew, and `ready` needs ten of them. An on-demand renderer
// therefore does not just report an odd fps — it never becomes ready, and the
// loop cannot capture it. If you need on-demand rendering later, tell the
// bridge about it first; do not just stop drawing.
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
