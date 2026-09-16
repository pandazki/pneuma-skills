/**
 * main.js — the starter scene. Build ON TOP of this; the pieces below are
 * correctness anchors, not decoration. Each comment says what is fixed and
 * why, so you can tell a deliberate change from breaking the bridge.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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

/**
 * A studio environment map drawn in a canvas — no HDR file to ship.
 *
 * WHY this exists: PBR materials reflect the environment. With no
 * `scene.environment`, anything with metalness renders near-black on a light
 * background and the judge will (correctly) call the materials fake.
 * WHY the gradient has a dark bottom: a uniformly bright environment washes
 * metals out into flat grey — the contrast between a bright top and a dark
 * floor is what reads as a reflection.
 * WHY no tone mapping: ACES on a light background crushes the whites into
 * grey. Leave `renderer.toneMapping` alone unless the target is genuinely a
 * dark, high-dynamic-range scene.
 */
function studioEnv(renderer) {
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

  // A soft white ellipse: the "softbox" whose reflection gives glossy
  // surfaces a highlight with a shape instead of a flat sheen.
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
