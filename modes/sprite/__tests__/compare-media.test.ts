import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mediaTierEnabled,
  announceMediaTierSkip,
} from "../../../core/__tests__/test-tier";
import { probeGifDelays } from "../skill/scripts/gif-frames.mjs";
import {
  loadFinalArtifact,
  compareFinalArtifacts,
  type CompareCodecs,
} from "../skill/scripts/compare.mjs";
const enabled = mediaTierEnabled("sprite");
announceMediaTierSkip("sprite", "final artifact decoder integration");
const hasFfmpeg = enabled &&
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (enabled && !hasFfmpeg) {
  console.warn("(skip) modes/sprite final artifact decoder integration: ffmpeg/ffprobe not on PATH");
}
function ffmpeg(args: string[]) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], {
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw Error(`ffmpeg failed: ${result.error?.message ?? result.stderr?.toString() ?? "unknown error"}`);
  }
  return result.stdout;
}
test.skipIf(!hasFfmpeg)(
  "real PNG and GIF decode bind pixels and exact GIF timing",
  () => {
    const root = mkdtempSync(join(tmpdir(), "sprite-compare-media-"));
    try {
      const png = join(root, "still.png"),
        gif = join(root, "motion.gif");
      ffmpeg(["-f", "lavfi", "-i", "color=red:s=16x16", "-frames:v", "1", png]);
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=red:s=16x16:r=10:d=0.3",
        "-loop",
        "0",
        gif,
      ]);
      const codecs: CompareCodecs = {
        readRgba: (path) => {
          const bytes = readFileSync(path);
          return {
            width: bytes.readUInt32BE(16),
            height: bytes.readUInt32BE(20),
            data: ffmpeg([
              "-i",
              path,
              "-frames:v",
              "1",
              "-f",
              "rawvideo",
              "-pix_fmt",
              "rgba",
              "-",
            ]),
          };
        },
        writeRgbaPng: () => {
          throw Error("not used");
        },
        decodeGifFrames: (path, out) => {
          const delays = probeGifDelays(path);
          ffmpeg([
            "-i",
            path,
            "-fps_mode",
            "passthrough",
            "-pix_fmt",
            "rgba",
            "-start_number",
            "0",
            join(out, "%02d.png"),
          ]);
          return {
            delaysMs: delays.delaysMs,
            warnings: delays.unreadable.length ? ["inferred"] : [],
          };
        },
      };
      const a = loadFinalArtifact(png, codecs),
        b = loadFinalArtifact(gif, codecs);
      expect(a.frames).toHaveLength(1);
      expect(b.frames).toHaveLength(3);
      expect(b.durationsMs).toEqual([100, 100, 100]);
      expect(b.loop).toEqual({ plays: "infinite" });
      expect(compareFinalArtifacts(b, b).status).toBe("identical");
      expect(b.pixelSha256).toHaveLength(64);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
