/**
 * Snapshot CLI entry: parse args and dispatch to push/pull/list.
 */

import { resolve } from "node:path";
import { push } from "./push.js";
import { pull } from "./pull.js";
import { getCredentials, listSnapshots } from "./r2.js";

function printUsage(): void {
  console.log(`Usage:
  bunx pneuma-skills snapshot push [--workspace .] [--mode doc|slide] [--include-skills]
  bunx pneuma-skills snapshot pull <url> [--workspace /tmp/pneuma-slide]
  bunx pneuma-skills snapshot list`);
}

function parseSnapshotArgs(args: string[]): {
  subcommand: string;
  workspace: string;
  mode?: string;
  url?: string;
  includeSkills: boolean;
} {
  const subcommand = args[0] ?? "";
  let workspace = process.cwd();
  let mode: string | undefined;
  let url: string | undefined;
  let includeSkills = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace" && i + 1 < args.length) {
      workspace = args[++i];
    } else if (arg === "--mode" && i + 1 < args.length) {
      mode = args[++i];
    } else if (arg === "--include-skills") {
      includeSkills = true;
    } else if (!arg.startsWith("--")) {
      url = arg;
    }
  }

  return { subcommand, workspace: resolve(workspace), mode, url, includeSkills };
}

export async function runSnapshot(args: string[]): Promise<void> {
  const { subcommand, workspace, mode, url, includeSkills } = parseSnapshotArgs(args);

  switch (subcommand) {
    case "push":
      await push(workspace, mode, includeSkills);
      break;

    case "pull":
      if (!url) {
        console.error("[snapshot] Missing URL argument.");
        printUsage();
        process.exit(1);
      }
      await pull(url, workspace);
      break;

    case "list": {
      const creds = await getCredentials();
      const snapshots = await listSnapshots(creds);
      if (snapshots.length === 0) {
        console.log("[snapshot] No snapshots found.");
      } else {
        console.log(`[snapshot] ${snapshots.length} snapshot(s):\n`);
        for (const s of snapshots) {
          const sizeMB = (s.size / 1024 / 1024).toFixed(2);
          const date = new Date(s.lastModified).toLocaleString();
          const pullUrl = `${creds.publicUrl}/${s.key}`;
          console.log(`  ${s.key}`);
          console.log(`    Size: ${sizeMB} MB | Uploaded: ${date}`);
          console.log(`    Pull: bunx pneuma-skills snapshot pull ${pullUrl} --workspace /tmp/pneuma-slide\n`);
        }
      }
      break;
    }

    default:
      printUsage();
      process.exit(1);
  }
}
