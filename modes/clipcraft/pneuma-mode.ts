// modes/clipcraft/pneuma-mode.ts
import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import ClipCraftPreview from "./viewer/ClipCraftPreview.js";
import clipcraftManifest from "./manifest.js";
import type { Storyboard, ProjectConfig } from "./types.js";

function parseJSON<T>(files: ViewerFileContent[], filename: string): T | null {
  const file = files.find(
    (f) => f.path === filename || f.path.endsWith(`/${filename}`),
  );
  if (!file) return null;
  try {
    return JSON.parse(file.content) as T;
  } catch {
    return null;
  }
}

const clipcraftMode: ModeDefinition = {
  manifest: clipcraftManifest,

  viewer: {
    PreviewComponent: ClipCraftPreview,

    workspace: {
      type: "single",
      multiFile: true,
      ordered: true,
      hasActiveFile: false,
    },

    actions: clipcraftManifest.viewerApi?.actions,

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const storyboard = parseJSON<Storyboard>(files, "storyboard.json");
      const project = parseJSON<ProjectConfig>(files, "project.json");

      // Collect asset inventory from files
      const assetGroups: Record<string, string[]> = {
        images: [], clips: [], reference: [], audio: [], bgm: [],
      };
      for (const f of files) {
        for (const key of Object.keys(assetGroups)) {
          if (f.path.startsWith(`assets/${key}/`) && !f.path.endsWith(".gitkeep")) {
            assetGroups[key].push(f.path);
          }
        }
      }
      const assetLines: string[] = [];
      for (const [group, paths] of Object.entries(assetGroups)) {
        if (paths.length > 0) {
          assetLines.push(`  ${group}: ${paths.map((p) => p.split("/").pop()).join(", ")}`);
        }
      }

      // Scene selected — include scene detail + available assets
      if (selection?.type === "scene" && selection.content) {
        const lines: string[] = [`Selected scene:\n${selection.content}`];
        if (assetLines.length > 0) {
          lines.push(`\nAvailable assets:\n${assetLines.join("\n")}`);
        }
        return `<viewer-context mode="clipcraft" file="storyboard.json">\n${lines.join("\n")}\n</viewer-context>`;
      }

      // Command — user clicked a viewer command button
      if (selection?.type === "command") {
        const lines: string[] = [`Command: ${selection.content}`];
        if (storyboard) {
          lines.push(`Scenes: ${storyboard.scenes.length}`);
          const captions = storyboard.scenes.filter((s) => s.caption).length;
          lines.push(`Scenes with captions: ${captions}/${storyboard.scenes.length}`);
        }
        if (assetLines.length > 0) {
          lines.push(`\nAvailable assets:\n${assetLines.join("\n")}`);
        }
        return `<viewer-context mode="clipcraft">\n${lines.join("\n")}\n</viewer-context>`;
      }

      // No selection — project overview with asset inventory
      if (storyboard) {
        const lines: string[] = [];
        if (project) lines.push(`Project: "${project.title}" (${project.aspectRatio})`);
        lines.push(`Scenes: ${storyboard.scenes.length}`);

        const ready = storyboard.scenes.filter((s) => s.visual?.status === "ready").length;
        const generating = storyboard.scenes.filter((s) => s.visual?.status === "generating").length;
        const pending = storyboard.scenes.filter((s) => !s.visual || s.visual.status === "pending").length;
        const errored = storyboard.scenes.filter((s) => s.visual?.status === "error").length;

        if (ready) lines.push(`Ready: ${ready}`);
        if (generating) lines.push(`Generating: ${generating}`);
        if (pending) lines.push(`Pending: ${pending}`);
        if (errored) lines.push(`Errors: ${errored}`);

        if (storyboard.bgm) lines.push(`BGM: "${storyboard.bgm.title}"`);
        if (storyboard.characterRefs.length) {
          lines.push(`Characters: ${storyboard.characterRefs.map((c) => c.name).join(", ")}`);
        }

        const totalDur = storyboard.scenes.reduce((s, sc) => s + sc.duration, 0);
        lines.push(`Total duration: ${totalDur.toFixed(1)}s`);

        if (assetLines.length > 0) {
          lines.push(`\nAvailable assets:\n${assetLines.join("\n")}`);
        }

        return `<viewer-context mode="clipcraft">\n${lines.join("\n")}\n</viewer-context>`;
      }

      return "";
    },

    updateStrategy: "full-reload",

    locatorDescription:
      'Navigate to scene: data=\'{"scene":"scene-001"}\'. Auto-play from scene: data=\'{"scene":"scene-001","autoplay":true}\'.',
  },
};

export default clipcraftMode;
