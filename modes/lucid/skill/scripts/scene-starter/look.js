/**
 * look.js — the look pass: tone mapping, exposure, bloom on the practicals,
 * fog and a vignette, in one call.
 *
 * Light is the cheapest detail there is. A dark scene with three warm lights
 * reads richer than a bright one with a hundred meshes: darkness hides
 * polygons, light sells materials, and bloom is what makes a lantern a light
 * source instead of a yellow sphere. Do this pass BEFORE any model lands, on
 * the blockout, and judge the picture from there.
 *
 *   const look = makeLook(renderer, scene, camera, {
 *     exposure: 1.0,
 *     bloom: { strength: 0.45, radius: 0.5, threshold: 0.85 },
 *     fog: { color: 0x0b0d16, near: 14, far: 60 },   // null for none
 *     vignette: 0.3,                                  // 0 for none
 *   });
 *   window.lucid?.register({ renderer, scene, camera, render: look.render });
 *   renderer.setAnimationLoop(() => { controls.update(); look.render(); });
 *
 * `look.render()` draws the whole chain — hand it to the bridge as `render`
 * so a capture goes through the same passes the user sees; `passesPerFrame`
 * then reads above 1, which is the chain, not a bug. `look.resize()` on a
 * window resize. `look.set({ exposure, bloom, vignette })` retunes at
 * runtime. Bloom's `threshold` is in LINEAR light after exposure: 0.85 keeps
 * it to emissive and specular hits; lower it and every pale wall glows.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/** Darkens toward the corners, in linear light, before the output pass. */
const VignetteShader = {
  name: "VignetteShader",
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5)) * 1.4142;
      float falloff = 1.0 - amount * smoothstep(0.45, 1.05, d);
      gl_FragColor = vec4(color.rgb * falloff, color.a);
    }
  `,
};

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {{ exposure?: number, bloom?: { strength?: number, radius?: number, threshold?: number } | null,
 *           fog?: { color?: number, near?: number, far?: number } | null, vignette?: number }} [options]
 */
export function makeLook(renderer, scene, camera, options = {}) {
  const settings = {
    exposure: options.exposure ?? 1.0,
    bloom: options.bloom === null ? null : { strength: 0.45, radius: 0.5, threshold: 0.85, ...(options.bloom ?? {}) },
    vignette: options.vignette ?? 0.3,
  };

  // ACES is the filmic curve that keeps a warm lantern from clipping to
  // white; the output pass below applies it, reading these two fields.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = settings.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  if (options.fog) {
    const fog = options.fog;
    scene.fog = new THREE.Fog(fog.color ?? 0x0b0d16, fog.near ?? 14, fog.far ?? 60);
  }

  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));

  let bloomPass = null;
  if (settings.bloom) {
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, Math.floor(size.x / 2)), Math.max(1, Math.floor(size.y / 2))),
      settings.bloom.strength,
      settings.bloom.radius,
      settings.bloom.threshold,
    );
    composer.addPass(bloomPass);
  }

  const vignettePass = new ShaderPass(VignetteShader);
  vignettePass.uniforms.amount.value = settings.vignette;
  vignettePass.enabled = settings.vignette > 0;
  composer.addPass(vignettePass);

  // Tone mapping + sRGB happen here, once, at the end of the chain.
  composer.addPass(new OutputPass());

  return {
    composer,
    /** Draw the frame through the whole chain. Give this to the bridge. */
    render() {
      composer.render();
    },
    /** Call from the window's resize handler after renderer.setSize. */
    resize() {
      const next = renderer.getSize(new THREE.Vector2());
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(next.x, next.y);
      if (bloomPass) bloomPass.setSize(Math.max(1, Math.floor(next.x / 2)), Math.max(1, Math.floor(next.y / 2)));
    },
    /** Retune at runtime; unspecified fields keep their values. */
    set(next = {}) {
      if (next.exposure !== undefined) renderer.toneMappingExposure = settings.exposure = next.exposure;
      if (next.bloom && bloomPass) {
        if (next.bloom.strength !== undefined) bloomPass.strength = next.bloom.strength;
        if (next.bloom.radius !== undefined) bloomPass.radius = next.bloom.radius;
        if (next.bloom.threshold !== undefined) bloomPass.threshold = next.bloom.threshold;
      }
      if (next.vignette !== undefined) {
        vignettePass.uniforms.amount.value = settings.vignette = next.vignette;
        vignettePass.enabled = next.vignette > 0;
      }
    },
  };
}
