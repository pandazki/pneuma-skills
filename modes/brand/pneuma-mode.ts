import type { ModeDefinition } from "../../core/types/mode-definition.js";
import manifest from "./manifest.js";
import { loadStudio, emptyProject } from "./domain.js";
import BrandPreview from "./viewer/BrandPreview.js";

const mode: ModeDefinition = {
  manifest,
  viewer: {
    PreviewComponent: BrandPreview, updateStrategy: "incremental",
    actions: manifest.viewerApi?.actions,
    extractContext(selection) {
      if (!selection) return "";
      return ["Mode: brand", `Address: ${JSON.stringify(selection.address)}`, `Work: ${selection.label ?? ""}`, `File: ${selection.file ?? ""}`, selection.content].join("\n");
    },
    workspace: {
      ...manifest.viewerApi!.workspace!, topBarNavigation: false,
      resolveContentSets(files) {
        return Object.entries(loadStudio(files).byContentSet).filter(([prefix]) => prefix !== "").map(([prefix, state]) => ({ prefix, label: state.project?.title ?? prefix, traits: {} }));
      },
      resolveItems(files) {
        const studio = loadStudio(files);
        const state = studio.byContentSet[""] ?? Object.values(studio.byContentSet)[0];
        return state?.project?.items.map((item, index) => ({ path: item.file ?? `brand.json#${item.id}`, label: item.title, index, metadata: { item: item.id } })) ?? [];
      },
      createEmpty(files) {
        const used = new Set(Object.keys(loadStudio(files).byContentSet));
        let n = 1;
        while (used.has(`brand-${n}`)) n++;
        return [{ path: `brand-${n}/brand.json`, content: JSON.stringify(emptyProject(), null, 2) + "\n" }];
      },
    },
  },
};
export default mode;
