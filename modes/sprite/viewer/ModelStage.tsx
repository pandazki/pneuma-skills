/**
 * The 3D model on the stage (0.6.0): the character's rigged GLB, turned by
 * dragging, playing one of its animation clips.
 *
 * Each animation file is a whole rigged character carrying one clip (that is
 * how Meshy delivers them), so switching animation loads that file and
 * plays its clip, and the previous file is released with its stage. three.js
 * is imported on demand — a character with no model never pays for it.
 *
 * `preserveDrawingBuffer` is on so the `capture` action can read the canvas
 * the person is looking at.
 */

import { useEffect, useRef, useState } from "react";

import type { SpriteStrings } from "./strings.js";

export interface ModelStageProps {
  /** The URL of the GLB to show (the rigged model, or one animation file). */
  url: string;
  /** Buttons above the canvas: the model and each animation. */
  options: Array<{ id: string; label: string; url: string }>;
  selected: string;
  onSelect: (id: string) => void;
  theme: "light" | "dark";
  onCanvas: (canvas: HTMLCanvasElement | null) => void;
  t: SpriteStrings;
}

export function ModelStage(props: ModelStageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const { url, theme, onCanvas } = props;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let disposed = false;
    let raf = 0;
    let cleanup: (() => void) | null = null;
    setState("loading");
    (async () => {
      const THREE = await import("three");
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      box.appendChild(renderer.domElement);
      renderer.domElement.className = "block h-full w-full";
      onCanvas(renderer.domElement);
      const scene = new THREE.Scene();
      // Everything made from here on is released by this, whenever the
      // stage goes — mid-load included: a GLB that lands after the stage
      // closed must not keep a WebGL context alive.
      const disposables: Array<() => void> = [];
      cleanup = () => {
        for (const dispose of disposables.splice(0)) dispose();
        scene.traverse((object) => {
          const mesh = object as unknown as { geometry?: { dispose(): void }; material?: unknown };
          mesh.geometry?.dispose();
          const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
          for (const material of materials as Array<Record<string, unknown> & { dispose(): void }>) {
            for (const value of Object.values(material)) {
              if (value && typeof value === "object" && "isTexture" in value) (value as unknown as { dispose(): void }).dispose();
            }
            material.dispose();
          }
        });
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        onCanvas(null);
      };
      const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
      scene.add(new THREE.HemisphereLight(0xffffff, theme === "dark" ? 0x30303a : 0xcfc6bb, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.8);
      key.position.set(2, 4, 3);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xffb070, 0.8);
      rim.position.set(-3, 2, -2);
      scene.add(rim);
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(0.6, 48),
        new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.12 }),
      );
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false;
      disposables.push(() => controls.dispose());
      const clock = new THREE.Clock();
      let mixer: InstanceType<typeof THREE.AnimationMixer> | null = null;

      const resize = () => {
        const w = Math.max(1, box.clientWidth);
        const h = Math.max(1, box.clientHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(box);
      disposables.push(() => observer.disconnect());
      resize();

      try {
        const gltf = await new GLTFLoader().loadAsync(url);
        if (disposed) return;
        const model = gltf.scene;
        // Stand it on the ground, centred, and frame it whole.
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const centre = bounds.getCenter(new THREE.Vector3());
        model.position.x -= centre.x;
        model.position.z -= centre.z;
        model.position.y -= bounds.min.y;
        scene.add(model);
        const height = Math.max(size.y, 0.001);
        ground.scale.setScalar(Math.max(size.x, size.z, height * 0.6));
        camera.position.set(height * 1.2, height * 0.75, height * 2.6);
        controls.target.set(0, height * 0.5, 0);
        controls.update();
        if (gltf.animations.length) {
          mixer = new THREE.AnimationMixer(model);
          mixer.clipAction(gltf.animations[0]).play();
        }
        setState("ready");
      } catch {
        if (!disposed) setState("failed");
      }

      const tick = () => {
        raf = requestAnimationFrame(tick);
        mixer?.update(clock.getDelta());
        controls.update();
        renderer.render(scene, camera);
      };
      if (!disposed) tick();
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, [url, theme, onCanvas]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={boxRef} className="absolute inset-0" />
      <div className="pointer-events-auto absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-cc-border bg-cc-surface/80 p-1 backdrop-blur" title={props.t.model3dTitle}>
        {props.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => props.onSelect(option.id)}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
              option.id === props.selected
                ? "bg-cc-primary/20 text-cc-primary"
                : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {state !== "ready" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-cc-muted">
          {state === "loading" ? props.t.modelLoading : props.t.modelFailed}
        </div>
      ) : null}
    </div>
  );
}
