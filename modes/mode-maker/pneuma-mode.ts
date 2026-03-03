/**
 * Mode Maker — ModeDefinition binding manifest + viewer.
 *
 * The workspace is a Mode package being developed.
 * extractContext outputs the mode development status so the Agent
 * always knows what's done and what's missing.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import ModeMakerPreview from "./viewer/ModeMakerPreview.js";
import modeMakerManifest from "./manifest.js";
import { parseManifestTs } from "../../core/utils/manifest-parser.js";
import { classifyFile } from "./viewer/utils/file-classifier.js";

const modeMakerMode: ModeDefinition = {
  manifest: modeMakerManifest,

  viewer: {
    PreviewComponent: ModeMakerPreview,

    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: true },

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      // Parse manifest to get mode identity
      const manifestFile = files.find((f) => f.path === "manifest.ts" || f.path === "manifest.js");
      const parsed = manifestFile ? parseManifestTs(manifestFile.content) : null;

      const modeName = parsed?.displayName || parsed?.name || "Unknown";
      const modeId = parsed?.name || "unknown";

      // Check completeness
      const hasManifest = files.some((f) => classifyFile(f.path) === "manifest");
      const hasModeDef = files.some((f) => classifyFile(f.path) === "mode-def");
      const hasViewer = files.some((f) => classifyFile(f.path) === "viewer");
      const hasSkill = files.some((f) => f.path === "skill/SKILL.md");
      const hasSeed = files.some((f) => classifyFile(f.path) === "seed");

      const components = [
        { name: "manifest.ts", done: hasManifest },
        { name: "pneuma-mode.ts", done: hasModeDef },
        { name: "viewer component", done: hasViewer },
        { name: "skill/SKILL.md", done: hasSkill },
        { name: "seed content", done: hasSeed },
      ];
      const doneCount = components.filter((c) => c.done).length;

      const activeFile = selection?.file || "";
      const attrs = [`mode="mode-maker"`];
      if (activeFile) attrs.push(`file="${activeFile}"`);

      const lines: string[] = [];
      lines.push(`Developing mode: "${modeName}" (${modeId})`);
      lines.push(`Status: ${doneCount}/${components.length} components`);
      for (const c of components) {
        lines.push(`  - ${c.name}: ${c.done ? "done" : "missing"}`);
      }

      if (selection && selection.type !== "viewing" && selection.content) {
        lines.push(`Selected: ${selection.type} "${selection.content}"`);
      }

      return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default modeMakerMode;
