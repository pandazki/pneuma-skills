import { resolve, relative } from "node:path";
import { realpath } from "node:fs/promises";
import { parseProject } from "./model.js";

export async function readProject(directory: string) {
  const root = await realpath(resolve(directory));
  const manifest = await realpath(resolve(root, "brand.json"));
  if (relative(root, manifest).startsWith("..")) throw new Error("brand.json escapes its project");
  const project = parseProject(await Bun.file(manifest).text());
  for (const item of project.items) {
    if (item.status !== "ready" || !item.file) continue;
    const path = await realpath(resolve(root, item.file));
    const rel = relative(root, path);
    if (rel === ".." || rel.startsWith("../")) throw new Error(`${item.id}: artifact escapes its project`);
    if (!(await Bun.file(path).exists())) throw new Error(`${item.id}: missing file ${item.file}`);
  }
  return { project, root };
}

if (import.meta.main) {
  try {
    const { project } = await readProject(process.argv[2] ?? ".");
    console.log(`Valid brand: ${project.title}; ${project.items.length} works; ${project.contexts.length} application contexts.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
