// modes/clipcraft/viewer/ClipCraftPreview.tsx
import { useEffect, useRef } from "react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { ClipCraftProvider, useClipCraft } from "./store/ClipCraftContext.js";
import { selectSortedScenes } from "./store/selectors.js";
import { ClipCraftLayout } from "./layout/ClipCraftLayout.js";

export default function ClipCraftPreview(props: ViewerPreviewProps) {
  return (
    <ClipCraftProvider files={props.files} imageVersion={props.imageVersion}>
      <ClipCraftInner {...props} />
    </ClipCraftProvider>
  );
}

/** Inner component that bridges pneuma's ViewerPreviewProps into the store. */
function ClipCraftInner({
  onSelect,
  actionRequest,
  onActionResult,
  navigateRequest,
  onNavigateComplete,
}: ViewerPreviewProps) {
  const { state, dispatch } = useClipCraft();

  // Handle agent action requests
  useEffect(() => {
    if (!actionRequest) return;
    const { requestId, actionId, params } = actionRequest;
    switch (actionId) {
      case "select-scene":
        if (params?.sceneId) {
          dispatch({ type: "SELECT_SCENE", sceneId: params.sceneId as string });
          onActionResult?.(requestId, { success: true });
        } else {
          onActionResult?.(requestId, { success: false, message: "Missing sceneId" });
        }
        break;
      case "play-preview":
        dispatch({ type: "PLAY" });
        onActionResult?.(requestId, { success: true });
        break;
      case "pause-preview":
        dispatch({ type: "PAUSE" });
        onActionResult?.(requestId, { success: true });
        break;
      case "set-aspect-ratio":
        onActionResult?.(requestId, { success: true, message: "Update project.json" });
        break;
      default:
        onActionResult?.(requestId, { success: false, message: `Unknown action: ${actionId}` });
    }
  }, [actionRequest, onActionResult, dispatch]);

  // Handle locator navigation
  useEffect(() => {
    if (navigateRequest?.data?.scene) {
      dispatch({ type: "SELECT_SCENE", sceneId: navigateRequest.data.scene as string });
      onNavigateComplete?.();
    }
  }, [navigateRequest, onNavigateComplete, dispatch]);

  // Handle scene selection -> send context to agent.
  // Use refs to avoid infinite loop: onSelect is recreated each render by the
  // upstream store, and calling it triggers a re-render, so it must NOT be a dep.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const lastNotifiedSceneRef = useRef<string | null>(null);

  const scenes = selectSortedScenes(state);

  useEffect(() => {
    if (!state.selectedSceneId) return;
    if (state.selectedSceneId === lastNotifiedSceneRef.current) return;
    lastNotifiedSceneRef.current = state.selectedSceneId;

    const scene = scenes.find((s) => s.id === state.selectedSceneId);
    if (scene) {
      onSelectRef.current?.({
        type: "scene",
        content: JSON.stringify(scene, null, 2),
        file: "storyboard.json",
        label: `Scene ${scenes.indexOf(scene) + 1}`,
      });
    }
  }, [state.selectedSceneId, scenes]);

  return <ClipCraftLayout />;
}
