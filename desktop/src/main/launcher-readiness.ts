import { StringDecoder } from "node:string_decoder";

/** The CLI's ready marker is a line protocol, independent of stdout chunk boundaries. */
export function createLauncherReadyParser(): (chunk: Buffer) => string | undefined {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  return (chunk) => {
    pending += decoder.write(chunk);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    // A noisy child must not grow the readiness parser without a bound.
    if (pending.length > 65536) pending = pending.slice(-65536);
    for (const line of lines) {
      const clean = line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
      // Stable marker, localized legacy marker, then the session marker.
      const match = clean.match(/Marketplace\s+→\s+(https?:\/\/\S+)/)
        || clean.match(/→\s+(https?:\/\/\S+)/)
        || clean.match(/\[pneuma\] ready\s+(https?:\/\/\S+)/);
      if (match) return match[1].replace("0.0.0.0", "localhost");
    }
    return undefined;
  };
}
