/**
 * The greybox lane's 3D half — an INSPECTION view, never the conditioning
 * truth.
 *
 * The model received `greybox/greybox.mp4`; this loads `greybox/scene.glb`,
 * the same scene the same render exported, so a person can walk around the
 * blocking without opening Blender. The lane says so in a caption, because a
 * 3D view that looks better than the render would otherwise quietly become
 * what everyone checks (invariant 1).
 *
 * Four things here are measured facts about the Blender kit's export, not
 * preferences (Blender 5.2.1, 2026-09-20):
 *
 * 1. `export_animation_mode="SCENE"` + `export_force_sampling=True` writes ONE
 *    ANIMATION PER ANIMATED OBJECT, named after the object. There is no single
 *    "the" clip — every clip plays on one mixer or half the scene stands still.
 * 2. Every channel is sampled on all N frames with glTF time = `frame / fps`,
 *    so FRAME 1 SITS AT `1/fps` and the clip ends at `frames / fps`. Shot time
 *    `t` therefore maps to `(1 + round(t × fps)) / fps`, clamped to the longest
 *    clip — the same 1-based arithmetic the frame readout uses.
 * 3. The camera's `TRACK_TO` constraint arrives BAKED as translation +
 *    rotation, and the glTF camera carries `yfov` and the render aspect. Shot
 *    camera mode renders through it and letterboxes to the shot aspect, so the
 *    framing is the MP4's framing.
 * 4. glTF carries transforms and the camera but NOT Workbench material-colour
 *    animation. The accent list in `scene.meta.json` is that one missing
 *    animation, and this lane replays it.
 *
 * three.js is dynamically imported: it is ~700 KB of viewer chrome that only
 * this lane needs, and the render lane must not pay for it.
 */

import { useEffect, useRef, useState } from "react";

import type * as ThreeT from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { SceneMeta } from "../domain.js";
import { fovForLens, lensAt } from "../domain.js";
import type { Clock } from "./usePlayhead.js";
import { fitBox } from "./player-model.js";

export interface GreyboxSceneProps {
  /** `/content/…/scene.glb?rev=<n>` — null when the shot has no GLB. */
  url: string | null;
  meta: SceneMeta | null;
  clock: Clock;
  /** `shot` renders through the exported camera; `free` orbits. */
  cameraMode: "shot" | "free";
  /** The shot's aspect, for the Shot-camera letterbox. */
  aspect: number;
  /** Reported so `get-player-state` can say whether the lane actually loaded. */
  onLoadedChange?: (loaded: boolean, error: string | null) => void;
}

/**
 * three's `PropertyBinding.sanitizeNodeName` strips `. [ ] : /` and turns
 * whitespace into underscores, so a Blender object called `Torus.001` is
 * `Torus001` by the time it is in the scene graph. `scene.meta.json` records
 * BLENDER's names, which is why a lookup has to try both.
 */
function sanitizeName(name: string): string {
  return name.replace(/\s/g, "_").replace(/[[\]./:]/g, "");
}

/**
 * Light grey to match the Workbench render's world.
 *
 * The light rig below is tuned to the SAME VALUES the Workbench render lands
 * on, measured off the seed shot's contact sheet (2026-09-20): floor ≈ #8a8a8e,
 * walls ≈ #a8a8ac, world ≈ #d9d9db. Three's default rig at 1.0 intensities
 * blew all three to near-white, which made the inspection view look like a
 * different scene from the clip the model received — exactly the confusion
 * invariant 1 exists to prevent. `LinearToneMapping` gives one exposure knob
 * to scale the whole rig without re-balancing the lights.
 */
const BACKGROUND = 0xd8d8da;
const EXPOSURE = 0.55;
const HEMI_INTENSITY = 0.85;
const KEY_INTENSITY = 1.05;
const FILL_INTENSITY = 0.35;
const LETTERBOX = "#09090b";
const CAMERA_PATH_COLOR = 0xf97316;
const TRAIL_COLOR = 0x3f3f46;

export function GreyboxScene({
  url,
  meta,
  clock,
  cameraMode,
  aspect,
  onLoadedChange,
}: GreyboxSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // The render loop reads these through refs: it runs outside React and must
  // see the CURRENT mode without the whole scene being rebuilt on a toggle.
  const cameraModeRef = useRef(cameraMode);
  cameraModeRef.current = cameraMode;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const reportRef = useRef(onLoadedChange);
  reportRef.current = onLoadedChange;
  /** The live scene's own resize, so a camera-mode toggle can re-letterbox
   *  without rebuilding anything. Null until the GLB is up. */
  const resizeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const frame = frameRef.current;
    if (!host || !frame || !url) {
      setStatus("idle");
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | null = null;

    setStatus("loading");
    setError(null);
    reportRef.current?.(false, null);

    void (async () => {
      let THREE: typeof import("three");
      let GLTFLoader: typeof import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader;
      let OrbitControls: typeof import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
      try {
        [THREE, { GLTFLoader }, { OrbitControls }] = await Promise.all([
          import("three"),
          import("three/examples/jsm/loaders/GLTFLoader.js"),
          import("three/examples/jsm/controls/OrbitControls.js"),
        ]);
      } catch (e) {
        if (disposed) return;
        setStatus("error");
        const message = `three.js could not be loaded: ${String(e)}`;
        setError(message);
        reportRef.current?.(false, message);
        return;
      }
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.LinearToneMapping;
      renderer.toneMappingExposure = EXPOSURE;
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      frame.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(BACKGROUND);

      // Hemisphere fill + one key light, the Workbench studio look: enough
      // shape to read blocking, flat enough that nobody mistakes it for a
      // lighting pass.
      const hemi = new THREE.HemisphereLight(0xffffff, 0xb4b4ba, HEMI_INTENSITY);
      scene.add(hemi);
      const key = new THREE.DirectionalLight(0xffffff, KEY_INTENSITY);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -0.0008;
      scene.add(key);
      scene.add(key.target);
      // A weak opposite fill so a wall turned away from the key does not go
      // black — Workbench's studio light is four-sided and nearly flat.
      const fill = new THREE.DirectionalLight(0xffffff, FILL_INTENSITY);
      scene.add(fill);
      scene.add(fill.target);

      let gltf: GLTF;
      try {
        gltf = await new GLTFLoader().loadAsync(url);
      } catch (e) {
        if (!disposed) {
          setStatus("error");
          const message = `scene.glb could not be loaded: ${String(e)}`;
          setError(message);
          reportRef.current?.(false, message);
        }
        renderer.dispose();
        renderer.domElement.remove();
        return;
      }
      if (disposed) {
        renderer.dispose();
        renderer.domElement.remove();
        return;
      }

      const root = gltf.scene;
      scene.add(root);

      // ── Matte greybox materials ──────────────────────────────────────────
      //
      // The glTF materials carry Workbench's flat base colour and nothing
      // else. Replacing them with a matte standard material (same colour
      // value) is what makes this read as the same greybox as the render
      // instead of a shiny PBR version of it. One material per MESH, not
      // shared, so an accent can tint one object without tinting its
      // siblings.
      const baseColors = new Map<string, ThreeT.Color>();
      root.traverse((object) => {
        const mesh = object as ThreeT.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const color =
          source && "color" in source && source.color instanceof THREE.Color
            ? source.color.clone()
            : new THREE.Color(0xcccccc);
        const replacement = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.92,
          metalness: 0,
          side: THREE.FrontSide,
        });
        mesh.material = replacement;
        baseColors.set(mesh.uuid, color.clone());
      });

      // ── One mixer, every clip ────────────────────────────────────────────
      const mixer = new THREE.AnimationMixer(root);
      let clipEnd = 0;
      for (const clip of gltf.animations) {
        mixer.clipAction(clip).play();
        clipEnd = Math.max(clipEnd, clip.duration);
      }

      // ── The shot camera ──────────────────────────────────────────────────
      const metaNow = metaRef.current;
      const named = metaNow?.camera
        ? (root.getObjectByName(metaNow.camera) ?? root.getObjectByName(sanitizeName(metaNow.camera)))
        : null;
      let shotCamera: ThreeT.PerspectiveCamera | null = null;
      if (named instanceof THREE.PerspectiveCamera) shotCamera = named;
      if (!shotCamera) {
        for (const camera of gltf.cameras) {
          if (camera instanceof THREE.PerspectiveCamera) {
            shotCamera = camera;
            break;
          }
        }
      }

      // ── Bounds, grid, free camera ────────────────────────────────────────
      const bounds = new THREE.Box3().setFromObject(root);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 0.5 || 5;

      const gridSize = Math.ceil(Math.max(size.x, size.z) * 1.2);
      const grid = new THREE.GridHelper(gridSize, Math.max(4, gridSize), 0x8f8f96, 0xbcbcc2);
      grid.position.set(center.x, bounds.min.y + 0.004, center.z);
      const gridMaterial = grid.material as ThreeT.Material;
      gridMaterial.transparent = true;
      gridMaterial.opacity = 0.55;
      scene.add(grid);

      key.position.set(center.x + radius * 1.1, bounds.max.y + radius * 1.4, center.z + radius * 0.9);
      key.target.position.copy(center);
      fill.position.set(center.x - radius * 1.3, bounds.max.y + radius * 0.5, center.z - radius * 1.1);
      fill.target.position.copy(center);
      const shadow = key.shadow.camera;
      shadow.left = -radius * 1.6;
      shadow.right = radius * 1.6;
      shadow.top = radius * 1.6;
      shadow.bottom = -radius * 1.6;
      shadow.near = 0.1;
      shadow.far = radius * 6;
      shadow.updateProjectionMatrix();

      const freeCamera = new THREE.PerspectiveCamera(45, 1, 0.05, radius * 40);
      freeCamera.position.set(
        center.x + radius * 1.5,
        bounds.min.y + radius * 1.35,
        center.z + radius * 1.7,
      );
      const controls = new OrbitControls(freeCamera, renderer.domElement);
      controls.target.copy(center);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.update();

      // ── The camera path, the frustum gizmo and the floor trails ──────────
      //
      // Sampled ONCE, by stepping the mixer frame by frame and reading world
      // positions — the same evaluation the render loop uses, so the line the
      // user sees is the path the camera actually travels rather than an
      // interpolation of keyframes we guessed at.
      const fps = metaNow?.fps ?? clock.fps;
      const frames = metaNow?.frames ?? Math.round(clipEnd * fps);
      const sampleStep = Math.max(1, Math.ceil(frames / 400));
      const cameraPoints: ThreeT.Vector3[] = [];
      const subjectNodes = (metaNow?.subjects ?? [])
        .map(
          (name) => root.getObjectByName(name) ?? root.getObjectByName(sanitizeName(name)) ?? null,
        )
        .filter((n): n is ThreeT.Object3D => n !== null);
      const subjectPoints: ThreeT.Vector3[][] = subjectNodes.map(() => []);

      for (let frame = 1; frame <= frames; frame += sampleStep) {
        mixer.setTime(Math.min(frame / fps, clipEnd));
        root.updateMatrixWorld(true);
        if (shotCamera) cameraPoints.push(shotCamera.getWorldPosition(new THREE.Vector3()));
        subjectNodes.forEach((node, i) => {
          const p = node.getWorldPosition(new THREE.Vector3());
          // The subject's OWN height, lifted a hair — not the scene's bounding
          // minimum. A room's floor is a slab, so `bounds.min.y` is its
          // UNDERSIDE and a trail drawn there is invisible under the floor.
          subjectPoints[i].push(new THREE.Vector3(p.x, p.y + 0.03, p.z));
        });
      }

      const overlay = new THREE.Group();
      scene.add(overlay);

      if (cameraPoints.length > 1) {
        const geometry = new THREE.BufferGeometry().setFromPoints(cameraPoints);
        // Drawn THROUGH the geometry: the camera usually stands outside the
        // set looking in, and a path hidden by the wall it is behind answers
        // none of the questions this view exists for.
        const material = new THREE.LineBasicMaterial({
          color: CAMERA_PATH_COLOR,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        });
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 3;
        overlay.add(line);
        // Where the move starts and where it settles — a 3 m push-in is a
        // short line, and two ends make it readable as a move.
        const markerGeometry = new THREE.SphereGeometry(Math.max(0.04, radius * 0.012), 12, 8);
        const markerMaterial = new THREE.MeshBasicMaterial({
          color: CAMERA_PATH_COLOR,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        });
        for (const point of [cameraPoints[0], cameraPoints[cameraPoints.length - 1]]) {
          const marker = new THREE.Mesh(markerGeometry, markerMaterial);
          marker.position.copy(point);
          marker.renderOrder = 3;
          overlay.add(marker);
        }
      }
      for (const points of subjectPoints) {
        if (points.length < 2) continue;
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineDashedMaterial({
          color: TRAIL_COLOR,
          dashSize: 0.18,
          gapSize: 0.12,
        });
        const line = new THREE.Line(geometry, material);
        line.computeLineDistances();
        overlay.add(line);
      }

      // The gizmo is a SHORT copy of the shot camera — a CameraHelper on the
      // real one would draw its frustum out to zfar (1000 m in this export)
      // and swallow the room.
      let gizmo: ThreeT.CameraHelper | null = null;
      let gizmoCamera: ThreeT.PerspectiveCamera | null = null;
      if (shotCamera) {
        gizmoCamera = new THREE.PerspectiveCamera(
          shotCamera.fov,
          shotCamera.aspect,
          0.05,
          Math.max(0.6, radius * 0.22),
        );
        gizmo = new THREE.CameraHelper(gizmoCamera);
        const helperMaterial = gizmo.material as ThreeT.LineBasicMaterial;
        helperMaterial.color = new THREE.Color(CAMERA_PATH_COLOR);
        helperMaterial.vertexColors = false;
        helperMaterial.depthTest = false;
        helperMaterial.transparent = true;
        gizmo.renderOrder = 3;
        overlay.add(gizmo);
      }

      // ── Accents: the one animation glTF could not carry ──────────────────
      const accents = (metaNow?.accents ?? []).map((accent) => {
        const target = new THREE.Color().setRGB(
          accent.color[0],
          accent.color[1],
          accent.color[2],
          THREE.LinearSRGBColorSpace,
        );
        const meshes: ThreeT.Mesh[] = [];
        for (const name of accent.objects) {
          const node = root.getObjectByName(name) ?? root.getObjectByName(sanitizeName(name));
          node?.traverse((object) => {
            const mesh = object as ThreeT.Mesh;
            if (mesh.isMesh) meshes.push(mesh);
          });
        }
        return { ...accent, target, meshes };
      });

      const applyAccents = (t: number) => {
        for (const accent of accents) {
          const span = Math.max(accent.to - accent.from, 1e-4);
          const k = Math.min(Math.max((t - accent.from) / span, 0), 1);
          for (const mesh of accent.meshes) {
            const material = mesh.material as ThreeT.MeshStandardMaterial;
            const base = baseColors.get(mesh.uuid);
            if (!base || !material.isMeshStandardMaterial) continue;
            material.color.copy(base).lerp(accent.target, k);
            material.emissive.copy(accent.target).multiplyScalar(0.3 * k);
          }
        }
      };

      /**
       * The lens: the SECOND animation glTF could not carry.
       *
       * Without this a dolly zoom reads as a plain dolly in the 3D lane —
       * the camera would travel and the framing would not fight back, which
       * is the whole point of the move. The curve is keyed on every frame,
       * so the value is stepped, never interpolated. An empty track means the
       * lens never moved and the exported camera's own fov stands.
       */
      const lensKeys = metaNow?.cameraLens ?? [];
      const lensWidth = metaNow?.width ?? 0;
      const lensHeight = metaNow?.height ?? 0;
      let lastLensMm = -1;
      const applyLens = (frameNumber: number) => {
        if (lensKeys.length === 0 || !shotCamera) return;
        const mm = lensAt(lensKeys, frameNumber);
        if (mm === null || mm === lastLensMm) return;
        lastLensMm = mm;
        const fov = fovForLens(mm, lensWidth, lensHeight);
        shotCamera.fov = fov;
        shotCamera.updateProjectionMatrix();
        // The gizmo is a short copy of the same camera; a frustum drawn at
        // the wrong angle would misreport what the shot camera can see.
        if (gizmoCamera) {
          gizmoCamera.fov = fov;
          gizmoCamera.updateProjectionMatrix();
        }
      };
      applyLens(1);

      // ── Size, letterbox and the loop ─────────────────────────────────────
      const resize = () => {
        const box = host.getBoundingClientRect();
        const shotMode = cameraModeRef.current === "shot";
        const fit = shotMode
          ? fitBox(box.width, box.height, aspectRef.current)
          : { width: Math.round(box.width), height: Math.round(box.height) };
        if (fit.width < 2 || fit.height < 2) return;
        frame.style.width = `${fit.width}px`;
        frame.style.height = `${fit.height}px`;
        renderer.setSize(fit.width, fit.height, false);
        const laneAspect = fit.width / fit.height;
        freeCamera.aspect = laneAspect;
        freeCamera.updateProjectionMatrix();
        if (shotCamera) {
          // In shot mode the frame IS the shot aspect, so this is the
          // exporter's own number; in free mode the gizmo keeps the shot
          // aspect while the orbit camera takes the pane's.
          shotCamera.aspect = shotMode ? laneAspect : aspectRef.current;
          shotCamera.updateProjectionMatrix();
        }
      };
      resize();
      resizeRef.current = resize;
      const observer = new ResizeObserver(resize);
      observer.observe(host);

      let raf = 0;
      let lastMixerTime = -1;
      const render = () => {
        raf = requestAnimationFrame(render);
        const t = clock.getTime();
        // Frame 1 at 1/fps — the exporter's grid, not ours.
        const mixerTime = Math.min((1 + Math.round(t * fps)) / fps, clipEnd);
        if (mixerTime !== lastMixerTime) {
          mixer.setTime(mixerTime);
          applyAccents(t);
          applyLens(1 + Math.round(t * fps));
          lastMixerTime = mixerTime;
        }
        const free = cameraModeRef.current === "free";
        overlay.visible = free;
        grid.visible = free;
        if (free) {
          controls.update();
          if (gizmo && gizmoCamera && shotCamera) {
            shotCamera.getWorldPosition(gizmoCamera.position);
            shotCamera.getWorldQuaternion(gizmoCamera.quaternion);
            gizmoCamera.updateMatrixWorld(true);
            gizmoCamera.updateProjectionMatrix();
            gizmo.update();
          }
        }
        renderer.render(scene, free || !shotCamera ? freeCamera : shotCamera);
      };
      raf = requestAnimationFrame(render);

      setStatus("ready");
      reportRef.current?.(true, null);

      cleanup = () => {
        cancelAnimationFrame(raf);
        resizeRef.current = null;
        observer.disconnect();
        controls.dispose();
        mixer.stopAllAction();
        // Every buffer and material this lane created, including the ones
        // GLTFLoader made: a shot switch must not leak a scene's worth of
        // GPU memory per visit.
        scene.traverse((object) => {
          const mesh = object as ThreeT.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const material = (mesh as unknown as { material?: ThreeT.Material | ThreeT.Material[] })
            .material;
          for (const m of Array.isArray(material) ? material : material ? [material] : []) {
            for (const value of Object.values(m)) {
              if (value && typeof value === "object" && "isTexture" in value) {
                (value as ThreeT.Texture).dispose();
              }
            }
            m.dispose();
          }
        });
        gizmo?.dispose();
        grid.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
      reportRef.current?.(false, null);
    };
    // `cameraMode` and `aspect` are deliberately absent: they are read through
    // refs so toggling the camera does not reload the GLB.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, clock, meta]);

  // A camera-mode toggle changes the letterbox but not the host's size, so
  // the ResizeObserver never fires — the scene's own resize is called here.
  useEffect(() => {
    resizeRef.current?.();
  }, [cameraMode, aspect]);

  return (
    <div
      ref={hostRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: LETTERBOX }}
    >
      <div ref={frameRef} className="relative" />
      {status !== "ready" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
          <p className="text-[11px] leading-relaxed text-cc-muted">
            {status === "error"
              ? (error ?? "The scene could not be loaded.")
              : url
                ? "Loading scene.glb…"
                : "No scene.glb was exported for this greybox."}
          </p>
        </div>
      ) : null}
      {/* Readable over a light-grey scene: the caption is the one thing in
          this lane that must never be missed. */}
      <p className="pointer-events-none absolute bottom-1.5 left-2 max-w-[calc(100%-1rem)] truncate rounded bg-black/45 px-1.5 py-0.5 text-[10px] leading-tight text-white/85">
        Inspection view — the model received the Render, not this.
      </p>
    </div>
  );
}

export default GreyboxScene;
