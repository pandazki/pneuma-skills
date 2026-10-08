import type { ViewerAddress, ViewerFileContent } from "../../core/types/viewer-contract.js";
import { parseProject, type BrandProject } from "./skill/scripts/model.js";
export { stages, emptyProject } from "./skill/scripts/model.js";
export type { BrandItem, BrandProject, BrandStage } from "./skill/scripts/model.js";

export interface ProjectState {
  project: BrandProject | null;
  error?: string;
  html: Record<string, string>;
}
export interface BrandStudio { byContentSet: Record<string, ProjectState> }

export function loadStudio(files: ReadonlyArray<ViewerFileContent>): BrandStudio {
  const byContentSet: Record<string, ProjectState> = Object.create(null);
  for (const file of files) {
    if (file.path !== "brand.json" && !file.path.endsWith("/brand.json")) continue;
    const prefix = file.path.slice(0, -"brand.json".length);
    const key = prefix.replace(/\/$/, "");
    try {
      const project = parseProject(file.content);
      const html: Record<string, string> = Object.create(null);
      for (const item of project.items) {
        if (item.kind !== "html" || !item.file) continue;
        const content = files.find((f) => f.path === prefix + item.file);
        if (content) html[item.file] = content.content;
      }
      byContentSet[key] = { project, html };
    } catch (error) {
      byContentSet[key] = { project: null, html: {}, error: `${file.path}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return { byContentSet };
}

export function saveStudio(): never {
  throw new Error("Brand content is authored through workspace files; the viewer does not write projects.");
}

export function resolveAddress(studio: BrandStudio, activeSet: string, address: ViewerAddress) {
  const contentSet = address.contentSet === undefined ? activeSet : address.contentSet;
  if (typeof contentSet !== "string" || !Object.hasOwn(studio.byContentSet, contentSet)) return { error: "Brand project not found" } as const;
  const state = studio.byContentSet[contentSet];
  if (!state.project) return { error: state.error ?? "Brand project is unavailable" } as const;
  const item = state.project.items.find((item) => item.id === address.item);
  if (!item) return { error: `Work not found: ${String(address.item ?? "")}` } as const;
  const region = address.region === undefined ? undefined : item.regions.find((r) => r.id === address.region);
  if (address.region !== undefined && !region) return { error: `Region not found: ${String(address.region)}` } as const;
  return { contentSet, state, item, region } as const;
}

export function contentUrl(contentSet: string, file: string, revision: number): string {
  return `/content/${[contentSet, file].filter(Boolean).join("/").split("/").map(encodeURIComponent).join("/")}?v=${revision}`;
}
