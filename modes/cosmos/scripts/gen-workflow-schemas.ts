/**
 * Regenerate the inlined SCHEMAS literal in
 * `references/projection.workflow.js` from the zod truth in
 * `../schema.ts`.
 *
 * The projection workflow runs as sandboxed plain JS — it cannot import
 * schema.ts — so the JSON Schemas must live in the file as a literal.
 * This script keeps that literal in lockstep with zod; the sync test in
 * `__tests__/schema.test.ts` fails if the file drifts from what this
 * would produce.
 *
 *   bun modes/cosmos/scripts/gen-workflow-schemas.ts
 */

import { join } from "node:path";
import { allJsonSchemas } from "../schema.ts";

const WORKFLOW = join(import.meta.dir, "..", "skill", "references", "projection.workflow.js");
const START = "// pneuma:schemas:start";
const END = "// pneuma:schemas:end";

// Compact (not pretty): this file is copied into every cosmos session's
// skill dir, so keep the inlined literal small. The sync test parses it
// regardless of formatting.
const json = JSON.stringify(allJsonSchemas());
const block = `${START}\nconst SCHEMAS = ${json}\n${END}`;

const src = await Bun.file(WORKFLOW).text();
const startIdx = src.indexOf(START);
const endIdx = src.indexOf(END);
if (startIdx === -1 || endIdx === -1) {
  throw new Error(`gen-workflow-schemas: markers not found in ${WORKFLOW}`);
}
const next = src.slice(0, startIdx) + block + src.slice(endIdx + END.length);
await Bun.write(WORKFLOW, next);
console.log(`Injected ${Object.keys(allJsonSchemas()).length} schemas (${json.length} bytes) into ${WORKFLOW}`);
