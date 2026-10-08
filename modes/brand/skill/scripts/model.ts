import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Use a stable alphanumeric ID");
export const relativePath = z.string().min(1).refine(
  (p) => !/[\\\x00-\x1f?#:%]/.test(p) && !p.startsWith("/") &&
    p.split("/").every((part) => part !== ".." && part !== "." && part !== ""),
  "Use a project-relative path without traversal, URL syntax, or empty segments",
);
export const stages = ["references", "identity", "assets", "applications"] as const;
const region = z.object({
  id, label: z.string().min(1), x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1),
}).refine((r) => r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001, "Region must fit inside the image");

export const itemSchema = z.object({
  id, title: z.string().min(1), stage: z.enum(stages), kind: z.enum(["image", "html"]),
  status: z.enum(["planned", "generating", "ready", "failed"]),
  file: relativePath.optional(), description: z.string().default(""),
  prompt: z.string().optional(), error: z.string().optional(),
  referenceIds: z.array(id).default([]), regions: z.array(region).default([]),
  contexts: z.array(id).default([]),
  width: z.number().int().min(240).max(4096).default(390),
  height: z.number().int().min(240).max(4096).default(844),
}).superRefine((item, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (item.status === "ready" && !item.file) fail("Ready work requires a file");
  if (item.status === "failed" && !item.error?.trim()) fail("Failed work requires an error explanation");
  if (item.file && !(item.kind === "html" ? /\.html?$/i : /\.(png|jpe?g|webp|gif|svg|avif)$/i).test(item.file)) fail("File extension does not match work kind");
  if (item.kind === "html" && item.regions.length) fail("Regions are supported on images only");
  if (new Set(item.regions.map((r) => r.id)).size !== item.regions.length) fail("Region IDs must be unique within a work");
});

export const projectSchema = z.object({
  version: z.literal(1), title: z.string().min(1), description: z.string().default(""),
  brief: z.object({ audience: z.string(), promise: z.string(), personality: z.array(z.string()), rules: z.array(z.string()) }),
  palette: z.array(z.object({ name: z.string(), value: z.string().regex(/^#[0-9a-fA-F]{6}$/) })),
  contexts: z.array(z.object({ id, title: z.string().min(1), purpose: z.string(), guidance: z.string() })).default([]),
  items: z.array(itemSchema),
}).superRefine((project, ctx) => {
  const ids = new Set<string>();
  const contexts = new Set(project.contexts.map((c) => c.id));
  if (contexts.size !== project.contexts.length) ctx.addIssue({ code: "custom", message: "Duplicate application context ID" });
  project.items.forEach((item, index) => {
    if (ids.has(item.id)) ctx.addIssue({ code: "custom", path: ["items", index, "id"], message: "Duplicate item ID" });
    ids.add(item.id);
    for (const context of item.contexts) if (!contexts.has(context)) ctx.addIssue({ code: "custom", path: ["items", index, "contexts"], message: `Unknown application context: ${context}` });
  });
  project.items.forEach((item, index) => item.referenceIds.forEach((ref) => {
    if (!ids.has(ref) || ref === item.id) ctx.addIssue({ code: "custom", path: ["items", index, "referenceIds"], message: `Invalid reference: ${ref}` });
  }));
});

export type BrandItem = z.infer<typeof itemSchema>;
export type BrandProject = z.infer<typeof projectSchema>;
export type BrandStage = typeof stages[number];

export function parseProject(raw: string): BrandProject {
  return projectSchema.parse(JSON.parse(raw));
}

export function emptyProject(): BrandProject {
  return { version: 1, title: "New brand", description: "Define your brand, then make it tangible.",
    brief: { audience: "", promise: "", personality: [], rules: [] }, palette: [], contexts: [], items: [] };
}
