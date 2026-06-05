// src/hooks/useViewerProps.tsx
//
// Shared viewer-mounting hooks used by BOTH the live session shell (App.tsx)
// and the hosted read-only player (PlayerApp.tsx). Keeping these in one place is
// what lets the player be "the same code in a different state": identical source
// instantiation + prop assembly, with readonly driven by replayMode.

import { useEffect, useState } from "react";
import { useStore } from "../store.js";
import type { SelectionType } from "../types.js";
import type { ViewerPreviewProps } from "../../core/types/viewer-contract.js";
import type { Source, FileChannel } from "../../core/types/source.js";
import { SourceRegistry } from "../../core/source-registry.js";
import { BUILT_IN_PROVIDERS } from "../../core/sources/index.js";
import { BrowserFileChannel } from "../runtime/file-channel.js";

/**
 * Instantiate sources AND the FileChannel for the current mode. Rebuilds
 * (destroying the old set) whenever the active mode changes. Sources and the
 * FileChannel never outlive their mode.
 */
export function useSourceInstances(): {
  sources: Record<string, Source<unknown>>;
  channel: FileChannel;
} {
  const manifest = useStore((s) => s.modeManifest);
  const [state, setState] = useState<{
    sources: Record<string, Source<unknown>>;
    channel: FileChannel;
  }>(() => ({ sources: {}, channel: new BrowserFileChannel() }));

  useEffect(() => {
    if (!manifest) {
      setState({ sources: {}, channel: new BrowserFileChannel() });
      return;
    }
    const channel = new BrowserFileChannel();
    const registry = new SourceRegistry();
    for (const provider of BUILT_IN_PROVIDERS) registry.register(provider);
    const ctx = {
      workspace: "",
      log: (msg: string) => {
        console.debug("[source]", msg);
      },
      signal: new AbortController().signal,
      files: channel,
    };
    let built: Record<string, Source<unknown>> = {};
    try {
      const effective = SourceRegistry.effectiveSources(manifest);
      built = registry.instantiateAll(effective, ctx);
    } catch (err) {
      console.warn(
        `[source-registry] Mode "${manifest.name}" sources unavailable — viewer will render with no sources. Cause:`,
        err,
      );
    }
    setState({ sources: built, channel });
    return () => {
      registry.destroyAll(built);
      (channel as BrowserFileChannel).destroy();
    };
  }, [manifest]);

  return state;
}

/** Build the ViewerPreviewProps from store state. `prefs` is shared with the
 *  shell's content-set auto-selection so we don't double-fetch locale/theme. */
export function useViewerProps(prefs: { theme: "light" | "dark"; locale: string }): ViewerPreviewProps {
  const { sources, channel: fileChannel } = useSourceInstances();
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const previewMode = useStore((s) => s.previewMode);
  const imageTick = useStore((s) => s.imageTick);
  const initParams = useStore((s) => s.initParams);
  const activeFile = useStore((s) => s.activeFile);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const setViewportRange = useStore((s) => s.setViewportRange);
  const workspaceItems = useStore((s) => s.workspaceItems);
  const actionRequest = useStore((s) => s.actionRequest);
  const setActionRequest = useStore((s) => s.setActionRequest);
  const navigateRequest = useStore((s) => s.navigateRequest);
  const setNavigateRequest = useStore((s) => s.setNavigateRequest);
  const replayMode = useStore((s) => s.replayMode);
  const commands = useStore((s) => s.modeCommands);
  // Backward-compat snapshot for pre-2.29 viewers (e.g. external modes that
  // still read `props.files.find(...)`). New viewers consume `sources`.
  const filesCompat = useStore((s) => s.files);

  return {
    sources,
    fileChannel,
    files: filesCompat,
    activeFile,
    selection: selection
      ? {
        type: selection.type,
        content: selection.content,
        level: selection.level,
        file: selection.file,
        tag: selection.tag,
        classes: selection.classes,
        selector: selection.selector,
        thumbnail: selection.thumbnail,
        label: selection.label,
        nearbyText: selection.nearbyText,
        accessibility: selection.accessibility,
      }
      : null,
    onSelect: (sel) => {
      if (!sel) {
        setSelection(null);
        return;
      }
      const file = sel.file || "";
      setSelection({
        type: sel.type as SelectionType,
        content: sel.content,
        level: sel.level,
        file,
        tag: sel.tag,
        classes: sel.classes,
        selector: sel.selector,
        address: sel.address,
        thumbnail: sel.thumbnail,
        label: sel.label,
        nearbyText: sel.nearbyText,
        accessibility: sel.accessibility,
      });
    },
    mode: previewMode,
    imageVersion: imageTick,
    initParams,
    onActiveFileChange: setActiveFile,
    onViewportChange: setViewportRange,
    workspaceItems,
    actionRequest: actionRequest?.actionId === "capture" ? null : actionRequest,
    onActionResult: (requestId, result) => {
      import("../ws.js").then(({ sendViewerActionResponse }) => {
        sendViewerActionResponse(requestId, result);
      });
      setActionRequest(null);
    },
    onNotifyAgent: (notification) => {
      useStore.getState().addPendingNotification(notification);
    },
    navigateRequest,
    onNavigateComplete: () => setNavigateRequest(null),
    commands,
    readonly: replayMode,
    theme: prefs.theme,
    locale: prefs.locale,
  };
}
