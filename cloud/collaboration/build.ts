import { cpSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildCollaborationAssets } from "../../snapshot/collaboration-build.js";
import webcraftManifest from "../../modes/webcraft/manifest.js";
import { buildCollaborationFrameScript } from "../../modes/webcraft/viewer/collaboration-frame.js";

// The legacy lab bridge is an explicit compatibility input, separate from the
// catalog's ordinary mode viewers and publication page runtimes.
const result = await buildCollaborationAssets({ projectRoot: resolve(import.meta.dir, "../.."),
  legacyFrame: { mode: webcraftManifest.name, version: webcraftManifest.version, script: buildCollaborationFrameScript() } });
const directory = join(import.meta.dir, "dist");
rmSync(directory, { recursive: true, force: true });
cpSync(result.directory, directory, { recursive: true });
console.log(`Built cloud collaboration assets in ${directory} (${result.catalog.modes.length} supported modes)`);
