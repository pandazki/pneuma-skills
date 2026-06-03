export const meta = {
  name: 'cosmos-projection',
  description:
    'Project a codebase into a verified cosmos: parallel extract → merge cross-edges → adversarial verify → completeness loop. Returns nodes/edges/layers with a per-node trust verdict.',
  phases: [
    { title: 'Extract', detail: 'one subagent per partition, a fresh context each — reads the whole slice' },
    { title: 'Merge', detail: 'dedup nodes/layers + resolve edges that cross partition boundaries' },
    { title: 'Verify', detail: 'a skeptic re-reads each node’s cited sources and assigns trust' },
    { title: 'Complete', detail: 'a critic names under-covered regions → targeted re-extract, loop until dry' },
    { title: 'Perspectives', detail: 'propose variant walks per design lens → judge panel drops the ungrounded' },
  ],
}

/*
 * Cosmos projection workflow — the CC-native, Workflow-backed path for
 * `cosmos` mode (codebase domain). The session agent runs the cheap
 * deterministic survey (glob, count, read manifests, pick partitions +
 * vocabulary + a draft layer table), then hands the result here via
 * `args`. This script owns everything that a single context can't do
 * well: reading the whole repo (one fresh context per partition),
 * resolving cross-partition edges, and — the part cosmos never had —
 * verifying every node against its cited sources before it ships.
 *
 * It returns the assembled graph (nodes/edges/layers + per-node trust)
 * as data; the session agent writes cosmos.json, adds the tour, and
 * drives the viewer. Perspectives + the trust badge are a later step.
 *
 * args: {
 *   sourceRoot: string,                     // absolute path to the repo root
 *   language?: string,                      // user working language for prose (default English)
 *   partitions: Array<{                     // the survey's work-list
 *     id: string, label?: string,
 *     paths: string[],                      // sourceRoot-relative dirs/files this slice owns
 *     hint?: string                         // optional steer ("the contract layer", "HTTP + WS")
 *   }>,
 *   vocabulary?: { nodeTypes?: string[], edgeTypes?: string[] },
 *   layers?: Array<{ id, label, color?, description? }>,   // draft layer table from survey
 *   projectName?: string,
 *   maxCompletenessRounds?: number,         // default 2
 * }
 *
 * The SCHEMAS literal below is GENERATED from modes/cosmos/schema.ts
 * (the zod truth) — do not hand-edit. `__tests__/schema.test.ts`
 * compares it against `allJsonSchemas()`, so any zod change without a
 * regenerate turns the suite red. Regenerate with:
 *   bun modes/cosmos/scripts/gen-workflow-schemas.ts
 */

// pneuma:schemas:start
const SCHEMAS = {"cosmos":{"type":"object","properties":{"version":{"type":"string"},"kind":{"type":"string","enum":["codebase","knowledge","general"]},"project":{"type":"object","properties":{"name":{"type":"string"},"kind":{"type":"string"},"description":{"type":"string"},"analyzedAt":{"type":"string"},"source":{"type":"string"},"sourceRoot":{"description":"Absolute path to the source root; relative refs resolve against it.","type":"string"}},"required":["name"],"additionalProperties":false},"nodes":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","description":"Stable kebab-case id, short layer-hint prefix encouraged (c-eliot, fn-auth-login)."},"type":{"type":"string","description":"Open vocabulary for the content domain (file, character, claim, …). English kebab-case."},"name":{"type":"string","description":"Display noun the user reads."},"summary":{"type":"string","description":"One sentence, two at most."},"layerId":{"description":"Must reference a layers[].id.","type":"string"},"category":{"description":"Domain-agnostic chip-filter axis.","type":"string","enum":["code","config","docs","infra","data","domain","knowledge","other"]},"complexity":{"type":"string","enum":["simple","moderate","complex"]},"sources":{"description":"Pointers back to the artifacts that produced this node. Most real nodes have 1–3.","type":"array","items":{"oneOf":[{"type":"object","properties":{"kind":{"type":"string","const":"file"},"path":{"type":"string"},"range":{"minItems":2,"maxItems":2,"type":"array","items":{"type":"number"},"description":"Inclusive [start, end] line numbers."},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"url"},"url":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","url"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"passage"},"file":{"type":"string"},"locator":{"type":"string","description":"Required passage address — e.g. 'ch.3 ¶12', '§4.2', 'slide 7'."},"quote":{"description":"Lifted text the inference rests on (≤80 chars).","type":"string"},"label":{"type":"string"},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","file","locator"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"image"},"path":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"audio"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"video"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false}]}},"trust":{"description":"Verification verdict from the workflow's verify pass. Omit when unverified.","type":"string","enum":["verified","weak","unverifiable"]},"languageNotes":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}},"domainMeta":{"type":"object","properties":{"entities":{"type":"array","items":{"type":"string"}},"businessRules":{"type":"array","items":{"type":"string"}},"crossDomainInteractions":{"type":"array","items":{"type":"string"}},"entryPoint":{"type":"string"},"entryType":{"type":"string"}},"additionalProperties":false},"knowledgeMeta":{"type":"object","properties":{"wikilinks":{"type":"array","items":{"type":"string"}},"backlinks":{"type":"array","items":{"type":"string"}},"category":{"type":"string"},"content":{"type":"string"}},"additionalProperties":false},"meta":{"description":"Opaque agent bag; framework ignores it.","type":"object","propertyNames":{"type":"string"},"additionalProperties":{}}},"required":["id","type","name","summary"],"additionalProperties":false}},"edges":{"type":"array","items":{"type":"object","properties":{"source":{"type":"string","description":"Source node id."},"target":{"type":"string","description":"Target node id."},"type":{"type":"string","description":"Relationship verb (calls, imports, discovers, supports, …). Prefer specific over generic."},"direction":{"description":"Defaults to forward.","type":"string","enum":["forward","backward","bidirectional"]},"description":{"type":"string"},"weight":{"description":"Optional 0–1 emphasis.","type":"number"},"sources":{"type":"array","items":{"oneOf":[{"type":"object","properties":{"kind":{"type":"string","const":"file"},"path":{"type":"string"},"range":{"minItems":2,"maxItems":2,"type":"array","items":{"type":"number"},"description":"Inclusive [start, end] line numbers."},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"url"},"url":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","url"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"passage"},"file":{"type":"string"},"locator":{"type":"string","description":"Required passage address — e.g. 'ch.3 ¶12', '§4.2', 'slide 7'."},"quote":{"description":"Lifted text the inference rests on (≤80 chars).","type":"string"},"label":{"type":"string"},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","file","locator"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"image"},"path":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"audio"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"video"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false}]}}},"required":["source","target","type"],"additionalProperties":false}},"layers":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","description":"Stable id referenced by node.layerId."},"label":{"type":"string"},"color":{"description":"CSS color (hex / hsl).","type":"string"},"description":{"type":"string"}},"required":["id","label"],"additionalProperties":false}},"tour":{"type":"array","items":{"type":"object","properties":{"step":{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991},"nodeId":{"type":"string"},"narrative":{"type":"string"}},"required":["step","nodeId","narrative"],"additionalProperties":false}},"perspectives":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","description":"Stable id, prefix perspective-."},"name":{"type":"string","description":"The lens phrased as a noun, in user language."},"lens":{"type":"string","description":"Open vocabulary, English kebab-case (cybernetic-loop, tension, …)."},"insight":{"type":"string","description":"One-paragraph thesis."},"steps":{"minItems":1,"type":"array","items":{"type":"object","properties":{"focus":{"minItems":1,"type":"array","items":{"type":"string"},"description":"Node ids lit on this beat. First is the primary anchor."},"narrative":{"type":"string","description":"THIS step's paragraph — not the perspective's thesis."}},"required":["focus","narrative"],"additionalProperties":false}},"evidence":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}}},"required":["id","name","lens","insight","steps"],"additionalProperties":false}}},"required":["version","project","nodes","edges","layers"],"additionalProperties":false},"node":{"type":"object","properties":{"id":{"type":"string","description":"Stable kebab-case id, short layer-hint prefix encouraged (c-eliot, fn-auth-login)."},"type":{"type":"string","description":"Open vocabulary for the content domain (file, character, claim, …). English kebab-case."},"name":{"type":"string","description":"Display noun the user reads."},"summary":{"type":"string","description":"One sentence, two at most."},"layerId":{"description":"Must reference a layers[].id.","type":"string"},"category":{"description":"Domain-agnostic chip-filter axis.","type":"string","enum":["code","config","docs","infra","data","domain","knowledge","other"]},"complexity":{"type":"string","enum":["simple","moderate","complex"]},"sources":{"description":"Pointers back to the artifacts that produced this node. Most real nodes have 1–3.","type":"array","items":{"oneOf":[{"type":"object","properties":{"kind":{"type":"string","const":"file"},"path":{"type":"string"},"range":{"minItems":2,"maxItems":2,"type":"array","items":{"type":"number"},"description":"Inclusive [start, end] line numbers."},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"url"},"url":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","url"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"passage"},"file":{"type":"string"},"locator":{"type":"string","description":"Required passage address — e.g. 'ch.3 ¶12', '§4.2', 'slide 7'."},"quote":{"description":"Lifted text the inference rests on (≤80 chars).","type":"string"},"label":{"type":"string"},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","file","locator"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"image"},"path":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"audio"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"video"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false}]}},"trust":{"description":"Verification verdict from the workflow's verify pass. Omit when unverified.","type":"string","enum":["verified","weak","unverifiable"]},"languageNotes":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}},"domainMeta":{"type":"object","properties":{"entities":{"type":"array","items":{"type":"string"}},"businessRules":{"type":"array","items":{"type":"string"}},"crossDomainInteractions":{"type":"array","items":{"type":"string"}},"entryPoint":{"type":"string"},"entryType":{"type":"string"}},"additionalProperties":false},"knowledgeMeta":{"type":"object","properties":{"wikilinks":{"type":"array","items":{"type":"string"}},"backlinks":{"type":"array","items":{"type":"string"}},"category":{"type":"string"},"content":{"type":"string"}},"additionalProperties":false},"meta":{"description":"Opaque agent bag; framework ignores it.","type":"object","propertyNames":{"type":"string"},"additionalProperties":{}}},"required":["id","type","name","summary"],"additionalProperties":false},"edge":{"type":"object","properties":{"source":{"type":"string","description":"Source node id."},"target":{"type":"string","description":"Target node id."},"type":{"type":"string","description":"Relationship verb (calls, imports, discovers, supports, …). Prefer specific over generic."},"direction":{"description":"Defaults to forward.","type":"string","enum":["forward","backward","bidirectional"]},"description":{"type":"string"},"weight":{"description":"Optional 0–1 emphasis.","type":"number"},"sources":{"type":"array","items":{"oneOf":[{"type":"object","properties":{"kind":{"type":"string","const":"file"},"path":{"type":"string"},"range":{"minItems":2,"maxItems":2,"type":"array","items":{"type":"number"},"description":"Inclusive [start, end] line numbers."},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"url"},"url":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","url"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"passage"},"file":{"type":"string"},"locator":{"type":"string","description":"Required passage address — e.g. 'ch.3 ¶12', '§4.2', 'slide 7'."},"quote":{"description":"Lifted text the inference rests on (≤80 chars).","type":"string"},"label":{"type":"string"},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","file","locator"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"image"},"path":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"audio"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"video"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false}]}}},"required":["source","target","type"],"additionalProperties":false},"perspective":{"type":"object","properties":{"id":{"type":"string","description":"Stable id, prefix perspective-."},"name":{"type":"string","description":"The lens phrased as a noun, in user language."},"lens":{"type":"string","description":"Open vocabulary, English kebab-case (cybernetic-loop, tension, …)."},"insight":{"type":"string","description":"One-paragraph thesis."},"steps":{"minItems":1,"type":"array","items":{"type":"object","properties":{"focus":{"minItems":1,"type":"array","items":{"type":"string"},"description":"Node ids lit on this beat. First is the primary anchor."},"narrative":{"type":"string","description":"THIS step's paragraph — not the perspective's thesis."}},"required":["focus","narrative"],"additionalProperties":false}},"evidence":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}}},"required":["id","name","lens","insight","steps"],"additionalProperties":false},"partitionExtraction":{"type":"object","properties":{"nodes":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","description":"Stable kebab-case id, short layer-hint prefix encouraged (c-eliot, fn-auth-login)."},"type":{"type":"string","description":"Open vocabulary for the content domain (file, character, claim, …). English kebab-case."},"name":{"type":"string","description":"Display noun the user reads."},"summary":{"type":"string","description":"One sentence, two at most."},"layerId":{"description":"Must reference a layers[].id.","type":"string"},"category":{"description":"Domain-agnostic chip-filter axis.","type":"string","enum":["code","config","docs","infra","data","domain","knowledge","other"]},"complexity":{"type":"string","enum":["simple","moderate","complex"]},"sources":{"description":"Pointers back to the artifacts that produced this node. Most real nodes have 1–3.","type":"array","items":{"oneOf":[{"type":"object","properties":{"kind":{"type":"string","const":"file"},"path":{"type":"string"},"range":{"minItems":2,"maxItems":2,"type":"array","items":{"type":"number"},"description":"Inclusive [start, end] line numbers."},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"url"},"url":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","url"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"passage"},"file":{"type":"string"},"locator":{"type":"string","description":"Required passage address — e.g. 'ch.3 ¶12', '§4.2', 'slide 7'."},"quote":{"description":"Lifted text the inference rests on (≤80 chars).","type":"string"},"label":{"type":"string"},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","file","locator"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"image"},"path":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"audio"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"video"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false}]}},"trust":{"description":"Verification verdict from the workflow's verify pass. Omit when unverified.","type":"string","enum":["verified","weak","unverifiable"]},"languageNotes":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}},"domainMeta":{"type":"object","properties":{"entities":{"type":"array","items":{"type":"string"}},"businessRules":{"type":"array","items":{"type":"string"}},"crossDomainInteractions":{"type":"array","items":{"type":"string"}},"entryPoint":{"type":"string"},"entryType":{"type":"string"}},"additionalProperties":false},"knowledgeMeta":{"type":"object","properties":{"wikilinks":{"type":"array","items":{"type":"string"}},"backlinks":{"type":"array","items":{"type":"string"}},"category":{"type":"string"},"content":{"type":"string"}},"additionalProperties":false},"meta":{"description":"Opaque agent bag; framework ignores it.","type":"object","propertyNames":{"type":"string"},"additionalProperties":{}}},"required":["id","type","name","summary"],"additionalProperties":false}},"edges":{"type":"array","items":{"type":"object","properties":{"source":{"type":"string","description":"Source node id."},"target":{"type":"string","description":"Target node id."},"type":{"type":"string","description":"Relationship verb (calls, imports, discovers, supports, …). Prefer specific over generic."},"direction":{"description":"Defaults to forward.","type":"string","enum":["forward","backward","bidirectional"]},"description":{"type":"string"},"weight":{"description":"Optional 0–1 emphasis.","type":"number"},"sources":{"type":"array","items":{"oneOf":[{"type":"object","properties":{"kind":{"type":"string","const":"file"},"path":{"type":"string"},"range":{"minItems":2,"maxItems":2,"type":"array","items":{"type":"number"},"description":"Inclusive [start, end] line numbers."},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"url"},"url":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","url"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"passage"},"file":{"type":"string"},"locator":{"type":"string","description":"Required passage address — e.g. 'ch.3 ¶12', '§4.2', 'slide 7'."},"quote":{"description":"Lifted text the inference rests on (≤80 chars).","type":"string"},"label":{"type":"string"},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","file","locator"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"image"},"path":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"audio"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"video"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false}]}}},"required":["source","target","type"],"additionalProperties":false}},"layers":{"description":"Layers this partition discovered; merge phase reconciles.","type":"array","items":{"type":"object","properties":{"id":{"type":"string","description":"Stable id referenced by node.layerId."},"label":{"type":"string"},"color":{"description":"CSS color (hex / hsl).","type":"string"},"description":{"type":"string"}},"required":["id","label"],"additionalProperties":false}}},"required":["nodes","edges"],"additionalProperties":false},"crossEdges":{"type":"object","properties":{"edges":{"type":"array","items":{"type":"object","properties":{"source":{"type":"string","description":"Source node id."},"target":{"type":"string","description":"Target node id."},"type":{"type":"string","description":"Relationship verb (calls, imports, discovers, supports, …). Prefer specific over generic."},"direction":{"description":"Defaults to forward.","type":"string","enum":["forward","backward","bidirectional"]},"description":{"type":"string"},"weight":{"description":"Optional 0–1 emphasis.","type":"number"},"sources":{"type":"array","items":{"oneOf":[{"type":"object","properties":{"kind":{"type":"string","const":"file"},"path":{"type":"string"},"range":{"minItems":2,"maxItems":2,"type":"array","items":{"type":"number"},"description":"Inclusive [start, end] line numbers."},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"url"},"url":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","url"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"passage"},"file":{"type":"string"},"locator":{"type":"string","description":"Required passage address — e.g. 'ch.3 ¶12', '§4.2', 'slide 7'."},"quote":{"description":"Lifted text the inference rests on (≤80 chars).","type":"string"},"label":{"type":"string"},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","file","locator"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"image"},"path":{"type":"string"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"audio"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"video"},"path":{"type":"string"},"t":{"description":"Optional timestamp in seconds.","type":"number"},"label":{"type":"string"},"locator":{"type":"string","description":"Where-inside hint (\"p.23\", \"5:32\", \"figure 3\", \"ch.3 ¶12\", \"nav-header\")."},"excerpt":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration."},"caption":{"description":"Optional caption under the thumbnail.","type":"string"}},"required":["path"],"additionalProperties":false}},"required":["kind","path"],"additionalProperties":false}]}}},"required":["source","target","type"],"additionalProperties":false}}},"required":["edges"],"additionalProperties":false},"nodeVerdict":{"type":"object","properties":{"nodeId":{"type":"string"},"trust":{"type":"string","enum":["verified","weak","unverifiable"]},"reason":{"type":"string","description":"Why this verdict — what the source did or did not substantiate."},"issues":{"description":"Concrete problems: missing file, range without the claimed content, fabricated excerpt.","type":"array","items":{"type":"string"}}},"required":["nodeId","trust","reason"],"additionalProperties":false},"verificationBatch":{"type":"object","properties":{"verdicts":{"type":"array","items":{"type":"object","properties":{"nodeId":{"type":"string"},"trust":{"type":"string","enum":["verified","weak","unverifiable"]},"reason":{"type":"string","description":"Why this verdict — what the source did or did not substantiate."},"issues":{"description":"Concrete problems: missing file, range without the claimed content, fabricated excerpt.","type":"array","items":{"type":"string"}}},"required":["nodeId","trust","reason"],"additionalProperties":false}}},"required":["verdicts"],"additionalProperties":false},"completeness":{"type":"object","properties":{"gaps":{"type":"array","items":{"type":"object","properties":{"area":{"type":"string","description":"The under-covered partition / concern / entrypoint."},"why":{"type":"string","description":"What signal says it is under-covered."},"suggestedFocus":{"description":"Paths / symbols to re-extract.","type":"array","items":{"type":"string"}}},"required":["area","why"],"additionalProperties":false}}},"required":["gaps"],"additionalProperties":false},"perspectiveSet":{"type":"object","properties":{"perspectives":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","description":"Stable id, prefix perspective-."},"name":{"type":"string","description":"The lens phrased as a noun, in user language."},"lens":{"type":"string","description":"Open vocabulary, English kebab-case (cybernetic-loop, tension, …)."},"insight":{"type":"string","description":"One-paragraph thesis."},"steps":{"minItems":1,"type":"array","items":{"type":"object","properties":{"focus":{"minItems":1,"type":"array","items":{"type":"string"},"description":"Node ids lit on this beat. First is the primary anchor."},"narrative":{"type":"string","description":"THIS step's paragraph — not the perspective's thesis."}},"required":["focus","narrative"],"additionalProperties":false}},"evidence":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}}},"required":["id","name","lens","insight","steps"],"additionalProperties":false}}},"required":["perspectives"],"additionalProperties":false},"perspectiveJudgment":{"type":"object","properties":{"grounded":{"type":"boolean"},"reason":{"type":"string"},"weakSteps":{"description":"Indices of steps whose narrative just repeats the thesis or lacks concrete focus.","type":"array","items":{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991}}},"required":["grounded","reason"],"additionalProperties":false}}
// pneuma:schemas:end

// args may arrive as an object or, depending on how the call is
// serialized, as a JSON string — normalize both.
let A = args
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch { A = {} }
}
A = A || {}
log(`cosmos-projection: args is ${typeof args}; sourceRoot=${A.sourceRoot ? 'set' : 'MISSING'}; partitions=${Array.isArray(A.partitions) ? A.partitions.length : 0}`)

const sourceRoot = A.sourceRoot
const language = A.language || 'English'
const partitions = Array.isArray(A.partitions) ? A.partitions : []
const vocabulary = A.vocabulary || {}
const draftLayers = Array.isArray(A.layers) ? A.layers : []
const projectName = A.projectName || 'this codebase'
const maxRounds = Number.isInteger(A.maxCompletenessRounds) ? A.maxCompletenessRounds : 2
const withPerspectives = A.withPerspectives !== false

if (!sourceRoot) throw new Error('cosmos-projection: args.sourceRoot is required')
if (!partitions.length) throw new Error('cosmos-projection: args.partitions[] is required — run the survey first')

// ── Shared prompt fragments ──────────────────────────────────────────

const VOCAB = [
  vocabulary.nodeTypes?.length ? `Node types to prefer: ${vocabulary.nodeTypes.join(', ')}.` : '',
  vocabulary.edgeTypes?.length ? `Edge verbs to prefer: ${vocabulary.edgeTypes.join(', ')}.` : '',
].filter(Boolean).join(' ')

const RULES = `
Discipline (cosmos projection):
- Prose fields (name, summary) in ${language}; the type system stays English kebab-case (node.type, edge.type, layer.id, ids).
- Node ids are stable kebab-case with a short layer hint (ct-mode-manifest, fn-auth-login, svc-ws-bridge). Reuse the obvious id if a node recurs.
- summary is ONE sentence (two max). Node only what the user would click on: a module, a contract, a service, a load-bearing function or class. A leaf with one caller and no callees is a TAG on its caller, not its own node. Prefer one node that abstracts a small file over five nodes for its internals — aim for the projection a reader needs, not an exhaustive symbol dump.
- Every node MUST cite real sources: sources:[{kind:"file", path:"<relative-to-sourceRoot>", range?:[start,end]}]. Paths are relative to the repo root, NEVER absolute, NEVER invented. Prefer a range over citing a 2000-line file bare.
- Edges use specific verbs (calls/imports/implements/depends_on/produces) over generic relates_to. source/target are node ids you emit.
- Assign each node a layerId from the layer table below when one fits.`

const LAYER_TABLE = draftLayers.length
  ? `Draft layer table (use these ids; propose new layers only if a concern genuinely isn't covered):\n${draftLayers.map(l => `  - ${l.id}: ${l.label || ''}`).join('\n')}`
  : `No draft layers given — propose a coherent 3–6 layer table by architectural concern (e.g. api / service / data / ui / config) and assign every node a layerId.`

function extractPrompt(p) {
  return `You are projecting ONE slice of a codebase at ${sourceRoot} into cosmos nodes + edges.

Slice "${p.id}"${p.label ? ` (${p.label})` : ''} owns these paths (relative to the repo root):
${(p.paths || []).map(x => `  - ${x}`).join('\n')}
${p.hint ? `\nFocus hint: ${p.hint}` : ''}

Read the files in this slice thoroughly (Glob/Grep/Read under those paths). The projection's quality is gated by how much you actually read — you have a fresh context, so read the whole slice, not a sample.

Extract the meaningful nodes (modules, contracts, services, key functions/classes, config surfaces) and the edges between them. Include edges to nodes OUTSIDE this slice when you can name them by a stable id (the merge step reconciles them).

${VOCAB}
${LAYER_TABLE}
${RULES}

Return {nodes, edges, layers?} for THIS slice only.`
}

function crossEdgePrompt(nodeIndex) {
  return `Below is the full node index of a cosmos assembled from several codebase slices projected independently. Each was blind to the others, so edges that cross slice boundaries are likely MISSING.

Node index (id — type — name — layer):
${nodeIndex}

Identify edges that cross between slices and aren't obvious within a single slice: a service calling a data-layer function, a route mounting a handler, a contract consumed by a viewer. Use specific verbs. Only emit edges whose source AND target are ids in the index above. Do not duplicate trivial within-file edges.

Return {edges}.`
}

function verifyPrompt(p, nodes) {
  return `You are a SKEPTIC verifying part of a cosmos projection against the real source at ${sourceRoot}.

For each node below, READ its cited sources (paths are relative to the repo root) and decide whether the source substantiates the node's summary. Try to REFUTE — default to a lower trust when unsure. Specifically:
- "verified": the cited file/range exists and clearly substantiates name + summary.
- "weak": sourced, but the cited material only partially supports the claim, the range is too broad to trust, or the summary overreaches.
- "unverifiable": the cited path doesn't exist, the range doesn't contain the claimed content, or there is no citable source at all (a pure inference).

Nodes:
${nodes.map(n => `- ${n.id} [${n.type}] "${n.name}": ${n.summary}\n    sources: ${JSON.stringify(n.sources || [])}`).join('\n')}

Return {verdicts:[{nodeId, trust, reason, issues?}]} with one verdict per node above.`
}

function completenessPrompt(nodeIndex, partitionsDesc) {
  return `A cosmos has been projected from this codebase at ${sourceRoot}. Your job is to find what the projection MISSED — be a completeness critic, not a cheerleader.

Partitions that were projected:
${partitionsDesc}

Current node index (id — type — name):
${nodeIndex}

Look for under-coverage: a partition with suspiciously few nodes for its size; a concern named in README/manifests with no representation; an entrypoint (bin/*, index.ts, server bootstrap) that isn't reachable in the graph; a whole subsystem absent. For each real gap, give a concrete area and suggestedFocus (paths/symbols to re-extract). If coverage looks genuinely complete, return an empty gaps array — that is the signal to stop.

Return {gaps:[{area, why, suggestedFocus?}]}.`
}

function gapExtractPrompt(gap) {
  return `Fill a coverage gap in a codebase cosmos at ${sourceRoot}.

Gap: ${gap.area}
Why it matters: ${gap.why}
Re-extract these paths/symbols (relative to the repo root):
${(gap.suggestedFocus || []).map(x => `  - ${x}`).join('\n')}

Read them and emit the missing nodes + edges. Reuse existing ids when an edge points at an already-known node.

${VOCAB}
${LAYER_TABLE}
${RULES}

Return {nodes, edges, layers?}.`
}

// ── Orchestration ────────────────────────────────────────────────────

const nodeById = new Map()
const partitionOfNode = new Map()
const layerById = new Map()
const edgeKeys = new Set()
const edges = []

for (const l of draftLayers) if (l?.id) layerById.set(l.id, l)

function addNode(n, partId) {
  if (!n || typeof n.id !== 'string') return false
  if (nodeById.has(n.id)) return false
  nodeById.set(n.id, n)
  partitionOfNode.set(n.id, partId)
  return true
}
function addLayer(l) {
  if (l?.id && !layerById.has(l.id)) layerById.set(l.id, l)
}
function addEdge(e) {
  if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') return
  const key = `${e.source}|${e.target}|${e.type}`
  if (edgeKeys.has(key)) return
  edgeKeys.add(key)
  edges.push(e)
}

// Phase 1 — parallel extraction (barrier: merge needs all slices).
phase('Extract')
const slices = await parallel(
  partitions.map((p, i) => () =>
    agent(extractPrompt(p), {
      schema: SCHEMAS.partitionExtraction,
      phase: 'Extract',
      label: `extract:${p.id || i}`,
    }).then((r) => ({ partition: p, ...r })),
  ),
)
for (const slice of slices.filter(Boolean)) {
  for (const l of slice.layers || []) addLayer(l)
  for (const n of slice.nodes || []) addNode(n, slice.partition.id)
  for (const e of slice.edges || []) addEdge(e)
}
log(`extracted ${nodeById.size} nodes, ${edges.length} edges from ${partitions.length} partitions`)

// Phase 2 — merge: resolve cross-partition edges.
phase('Merge')
const nodeIndex = () =>
  [...nodeById.values()].map((n) => `${n.id} — ${n.type} — ${n.name} — ${n.layerId || '?'}`).join('\n')
const cross = await agent(crossEdgePrompt(nodeIndex()), {
  schema: SCHEMAS.crossEdges,
  phase: 'Merge',
  label: 'cross-edges',
}).catch(() => ({ edges: [] }))
for (const e of cross.edges || []) addEdge(e)

// Phase 3 — adversarial verify, batched by partition.
phase('Verify')
async function verifyNodes(nodeList, labelTag) {
  if (!nodeList.length) return
  const batch = await agent(verifyPrompt({ id: labelTag }, nodeList), {
    schema: SCHEMAS.verificationBatch,
    phase: 'Verify',
    label: `verify:${labelTag}`,
  }).catch(() => ({ verdicts: [] }))
  for (const v of batch.verdicts || []) {
    const n = nodeById.get(v.nodeId)
    if (n) n.trust = v.trust
  }
}
await parallel(
  partitions.map((p, i) => () =>
    verifyNodes(
      [...nodeById.values()].filter((n) => partitionOfNode.get(n.id) === p.id),
      p.id || String(i),
    ),
  ),
)

// Phase 4 — completeness loop (loop-until-dry, capped).
let round = 0
while (round < maxRounds) {
  phase('Complete')
  const partitionsDesc = partitions.map((p) => `  - ${p.id}: ${(p.paths || []).join(', ')}`).join('\n')
  const crit = await agent(completenessPrompt(nodeIndex(), partitionsDesc), {
    schema: SCHEMAS.completeness,
    phase: 'Complete',
    label: `critic:round-${round + 1}`,
  }).catch(() => ({ gaps: [] }))
  const gaps = (crit.gaps || []).filter((g) => (g.suggestedFocus || []).length)
  if (!gaps.length) {
    log(`completeness round ${round + 1}: no actionable gaps — converged`)
    break
  }
  const fills = await parallel(
    gaps.map((g, i) => () =>
      agent(gapExtractPrompt(g), {
        schema: SCHEMAS.partitionExtraction,
        phase: 'Complete',
        label: `fill:${round + 1}.${i}`,
      }).then((r) => ({ gap: g, ...r })),
    ),
  )
  const fresh = []
  for (const slice of fills.filter(Boolean)) {
    for (const l of slice.layers || []) addLayer(l)
    for (const n of slice.nodes || []) {
      if (addNode(n, `gap-${round + 1}`)) fresh.push(n)
    }
    for (const e of slice.edges || []) addEdge(e)
  }
  log(`completeness round ${round + 1}: ${gaps.length} gaps → +${fresh.length} new nodes`)
  if (!fresh.length) break
  await verifyNodes(fresh, `gap-${round + 1}`)
  round++
}

// ── Assemble ─────────────────────────────────────────────────────────

const nodes = [...nodeById.values()]
const nodeIds = new Set(nodeById.keys())
const liveEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
// Keep only layers actually referenced (plus any draft layer the agent kept using).
const usedLayerIds = new Set(nodes.map((n) => n.layerId).filter(Boolean))
const layers = [...layerById.values()].filter((l) => usedLayerIds.has(l.id))

const trustCounts = nodes.reduce((acc, n) => {
  const k = n.trust || 'unrated'
  acc[k] = (acc[k] || 0) + 1
  return acc
}, {})

log(
  `assembled: ${nodes.length} nodes / ${liveEdges.length} edges / ${layers.length} layers — ` +
    `trust ${JSON.stringify(trustCounts)}`,
)

// Phase 5 — perspectives: propose variant walks per lens, judge each,
// keep only the grounded ones (the SKILL's grounded-or-delete rule,
// mechanized as a judge panel).
function perspectivesPrompt(idx, edgeIdx) {
  return `You are naming the variant ways to READ a finished cosmos — a graph projected from the codebase at ${sourceRoot}.

A perspective is a *walk* framed by one design lens ("where does the system hold a feedback loop?", "where do two abstractions collide?"), NOT a tag. Each must be grounded: every step's focus[] names concrete node ids from the index, and each step's narrative is its OWN paragraph (what the reader sees on THIS beat) — never a repeat of the thesis.

Lenses worth recognizing (open vocabulary — invent one if none fit): orthogonality, cybernetic-loop, entropy-gradient, self-similarity, causal-chain, tension, convergence-point, layered-translation, hidden-hand, paradigm-shift.

Node index (id — type — name — layer):
${idx}

Edges (source -verb-> target):
${edgeIdx}

Propose ONLY the perspectives whose lens genuinely fits THIS graph — 0 to 5, and fewer sharp ones beat many vague ones. Each: {id:"perspective-<slug>", name (prose in ${language}), lens (English kebab-case), insight (one paragraph), steps:[{focus:[real node ids], narrative}]}. If no lens earns a grounded walk, return an empty array.

Return {perspectives}.`
}

function judgePerspectivePrompt(p, idx) {
  return `You are a SKEPTIC judging whether a cosmos perspective is GROUNDED or just a slogan wearing a node-list. Default to grounded:false when unsure.

It is grounded only if: every step's focus[] names node ids that exist in the index below; each step's narrative is its own paragraph (not a restatement of the insight); and the lens describes a real through-line in the graph, not a vibe.

Node index (id — type — name — layer):
${idx}

Perspective under review:
${JSON.stringify(p, null, 2)}

Flag the indices of any steps whose narrative just restates the thesis or whose focus ids don't exist / don't fit. Return {grounded, reason, weakSteps?}.`
}

let perspectives = []
if (withPerspectives && nodes.length >= 15) {
  phase('Perspectives')
  const edgeIdx = liveEdges.slice(0, 400).map((e) => `${e.source} -${e.type}-> ${e.target}`).join('\n')
  const gen = await agent(perspectivesPrompt(nodeIndex(), edgeIdx), {
    schema: SCHEMAS.perspectiveSet,
    phase: 'Perspectives',
    label: 'propose',
  }).catch(() => ({ perspectives: [] }))
  const candidates = (gen.perspectives || []).slice(0, 6)
  const judged = await parallel(
    candidates.map((p, i) => () =>
      agent(judgePerspectivePrompt(p, nodeIndex()), {
        schema: SCHEMAS.perspectiveJudgment,
        phase: 'Perspectives',
        label: `judge:${p.id || i}`,
      })
        .then((v) => ({ p, grounded: !!v?.grounded }))
        .catch(() => ({ p, grounded: false })),
    ),
  )
  perspectives = judged.filter((x) => x.grounded).map((x) => x.p)
  log(`perspectives: ${candidates.length} proposed → ${perspectives.length} grounded`)
}

return {
  version: '0.1.0',
  kind: 'codebase',
  project: { name: projectName, kind: 'codebase', sourceRoot },
  nodes,
  edges: liveEdges,
  layers,
  ...(perspectives.length ? { perspectives } : {}),
  stats: {
    trust: trustCounts,
    droppedEdges: edges.length - liveEdges.length,
    completenessRounds: round,
    perspectives: perspectives.length,
  },
}
