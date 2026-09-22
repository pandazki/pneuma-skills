/**
 * The arithmetic and parsing that sit around ffmpeg.
 *
 * Nothing here spawns anything: `media.mjs` takes plain data, so the two
 * things that are easy to get quietly wrong — the frame contract and reading
 * a probe — are pinned without a video file. Invariant 3 ("frame arithmetic
 * is exact") lives or dies here.
 */

import { describe, expect, test } from "bun:test";

import {
  evenlySpacedTimes,
  evenSize,
  firstFrameFrom,
  frameAtTime,
  framesForSpec,
  gridFor,
  lastFrameBefore,
  hasDrawtext,
  parseProbe,
  parseRange,
  parseRational,
  parseSceneCuts,
  parseTimeList,
  pngSize,
  previewSize,
  probeMismatches,
  snapSeconds,
  stamp,
  stripFrames,
  timeOfFrame,
} from "../skill/scripts/media.mjs";

describe("the frame contract", () => {
  test("frames = seconds x fps, numbered 1..N, frame 1 at t = 0", () => {
    expect(framesForSpec({ seconds: 8, fps: 24 })).toBe(192);
    expect(framesForSpec({ seconds: 4, fps: 30 })).toBe(120);
    expect(timeOfFrame(1, 24)).toBe(0);
    expect(timeOfFrame(192, 24)).toBeCloseTo(191 / 24, 10);
    expect(frameAtTime(0, 24, 192)).toBe(1);
    expect(frameAtTime(3.8, 24, 192)).toBe(1 + Math.round(3.8 * 24));
    // Never 0 and never N + 1, whatever it is asked for.
    expect(frameAtTime(-5, 24, 192)).toBe(1);
    expect(frameAtTime(1000, 24, 192)).toBe(192);
    expect(frameAtTime(8, 24, 192)).toBe(192);
  });

  test("a duration that is not a whole frame count is refused, not rounded in silence", () => {
    expect(() => framesForSpec({ seconds: 0, fps: 24 })).toThrow(/positive number/);
    expect(() => framesForSpec({ seconds: 8, fps: 0 })).toThrow(/positive number/);
  });

  test("a cut's edge frames come from the half-open range, not from rounding", () => {
    // `trim=start=a:end=b` keeps the frames whose timestamp is in [a, b), so
    // the LAST frame a trim of 0.4–1.6 shows is 39 (it starts at 1.5833) and
    // the first is 11 (0.4167). This is the frame a later shot has to open
    // on, so it is exact rather than nearly right.
    expect(lastFrameBefore(1.6, 24, 192)).toBe(39);
    expect(firstFrameFrom(0.4, 24, 192)).toBe(11);
    // A range that ends exactly on a frame boundary must NOT include the
    // frame that starts there.
    expect(lastFrameBefore(39 / 24, 24, 192)).toBe(39);
    expect(firstFrameFrom(10 / 24, 24, 192)).toBe(11);
    // "the end, minus one frame": an untrimmed shot hands over its last frame.
    expect(lastFrameBefore(8, 24, 192)).toBe(192);
    expect(lastFrameBefore(1, 24, 24)).toBe(24);
    // Clamped into the clip, whatever it is asked for.
    expect(lastFrameBefore(99, 24, 192)).toBe(192);
    expect(lastFrameBefore(0, 24, 192)).toBe(1);
    expect(firstFrameFrom(0, 24, 192)).toBe(1);
    expect(firstFrameFrom(99, 24, 192)).toBe(192);
  });

  test("snapSeconds rounds a reference segment to a whole number of frames", () => {
    expect(snapSeconds(7.93, 24)).toEqual({ frames: 190, seconds: 190 / 24 });
    expect(snapSeconds(8, 24)).toEqual({ frames: 192, seconds: 8 });
    // Never zero frames, however short the ask.
    expect(snapSeconds(0.001, 24).frames).toBe(1);
  });
});

describe("even dimensions", () => {
  test("yuv420p needs even sizes, and a preview is half of one", () => {
    expect(evenSize(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(evenSize(1281, 719)).toEqual({ width: 1280, height: 718 });
    expect(previewSize(1280, 720)).toEqual({ width: 640, height: 360 });
    // Blender truncates `x * percentage / 100`, and so does this, so the two
    // agree on what a 50 % render of an odd size comes out as.
    expect(previewSize(1281, 719)).toEqual({ width: 640, height: 358 });
    expect(evenSize(1, 1)).toEqual({ width: 2, height: 2 });
  });
});

describe("reading a probe", () => {
  const streams = (extra: Record<string, unknown> = {}) => ({
    streams: [
      { codec_type: "audio", codec_name: "aac" },
      {
        codec_type: "video",
        codec_name: "h264",
        pix_fmt: "yuv420p",
        width: 1280,
        height: 720,
        avg_frame_rate: "24/1",
        r_frame_rate: "24/1",
        nb_read_frames: "192",
        ...extra,
      },
    ],
    format: { duration: "8.005000", size: "970103" },
  });

  test("takes the counted frame count and derives seconds from it, not from the container", () => {
    const probe = parseProbe(streams());
    expect(probe).toEqual({
      codec: "h264",
      pixFmt: "yuv420p",
      width: 1280,
      height: 720,
      fps: 24,
      frames: 192,
      seconds: 8,
      bytes: 970103,
    });
    // The container says 8.005 s; the frames say 8.000 s, and the frames are
    // what `render` has to match.
    expect(probe?.seconds).not.toBe(8.005);
  });

  test("falls back to nb_frames, then reports honestly when neither is there", () => {
    expect(parseProbe(streams({ nb_read_frames: "N/A", nb_frames: "150" }))?.frames).toBe(150);
    const unknown = parseProbe(streams({ nb_read_frames: "N/A", nb_frames: "N/A" }));
    expect(unknown?.frames).toBeNull();
    expect(unknown?.seconds).toBe(8.005);
  });

  test("a file with no video stream is null, never a zero-frame success", () => {
    expect(parseProbe({ streams: [{ codec_type: "audio" }] })).toBeNull();
    expect(parseProbe({})).toBeNull();
  });

  test("frame rates arrive as rationals, including the unusable ones", () => {
    expect(parseRational("24/1")).toBe(24);
    expect(parseRational("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseRational("0/0")).toBeNull();
    expect(parseRational("")).toBeNull();
    expect(parseRational(24)).toBe(24);
  });

  test("probeMismatches names every disagreement with the spec", () => {
    const probe = parseProbe(streams());
    expect(probeMismatches(probe, { frames: 192, fps: 24, width: 1280, height: 720 })).toEqual([]);
    expect(probeMismatches(probe, { frames: 191, fps: 24, width: 1280, height: 720 })).toEqual([
      "frames: expected 191, ffprobe counted 192",
    ]);
    expect(probeMismatches(probe, { frames: 190, fps: 25, width: 640, height: 360 })).toHaveLength(4);
    expect(probeMismatches(null, { frames: 1 })).toEqual(["the encoded file carries no video stream"]);
  });
});

describe("cuts", () => {
  test("pulls pts_time out of showinfo and drops the free first frame", () => {
    const stderr = [
      "[Parsed_showinfo_1 @ 0x1] config in time_base: 1/24",
      "[Parsed_showinfo_1 @ 0x1] n:0 pts:0 pts_time:0 duration:1 pos:0 fmt:yuv420p",
      "[Parsed_showinfo_1 @ 0x1] n:1 pts:33 pts_time:1.375 duration:1 pos:9 fmt:yuv420p",
      "[Parsed_showinfo_1 @ 0x1] n:2 pts:96 pts_time:4 duration:1 pos:11 fmt:yuv420p",
      "frame=   3 fps=0.0 q=-0.0 Lsize=N/A",
    ].join("\n");
    expect(parseSceneCuts(stderr)).toEqual([1.375, 4]);
    expect(parseSceneCuts("")).toEqual([]);
  });
});

describe("sheet arithmetic", () => {
  test("--at and --strip refuse what they cannot honour, naming the flag", () => {
    expect(parseTimeList("0.5,3.8, 7 ")).toEqual([0.5, 3.8, 7]);
    expect(() => parseTimeList("", "--at")).toThrow(/--at needs at least one/);
    expect(() => parseTimeList("0.5,later", "--at")).toThrow(/--at: "later"/);
    expect(parseRange("0.5,3.8", "--strip")).toEqual([0.5, 3.8]);
    expect(() => parseRange("1,2,3", "--strip")).toThrow(/exactly two/);
    expect(() => parseRange("3,1", "--strip")).toThrow(/3 is after 1/);
  });

  test("evenly spaced times include the first and the last frame", () => {
    const times = evenlySpacedTimes({ frames: 192, fps: 24, count: 6 });
    expect(times).toHaveLength(6);
    expect(times[0]).toBe(0);
    expect(times[5]).toBeCloseTo(191 / 24, 4);
    expect(evenlySpacedTimes({ frames: 1, fps: 24, count: 6 })).toEqual([0]);
  });

  test("a strip is every consecutive frame, and a range too long is refused rather than thinned", () => {
    expect(stripFrames(1, 1.25, 24, 192)).toEqual([25, 26, 27, 28, 29, 30, 31]);
    expect(stripFrames(0, 0, 24, 192)).toEqual([1]);
    expect(() => stripFrames(0, 8, 24, 192)).toThrow(/192 frames at 24 fps \(limit 48\)/);
  });

  test("the grid wastes no cell it can avoid, and breaks ties wide", () => {
    expect(gridFor(6)).toEqual({ cols: 3, rows: 2 });
    expect(gridFor(1)).toEqual({ cols: 1, rows: 1 });
    // 5x4 would leave two black rectangles in a picture somebody is about to
    // judge a render by; 6x3 is exact.
    expect(gridFor(18)).toEqual({ cols: 6, rows: 3 });
    expect(gridFor(48)).toEqual({ cols: 6, rows: 8 });
    expect(gridFor(9)).toEqual({ cols: 3, rows: 3 });
    expect(gridFor(5)).toEqual({ cols: 3, rows: 2 });
    for (let n = 1; n <= 48; n += 1) {
      const { cols, rows } = gridFor(n);
      expect(cols * rows).toBeGreaterThanOrEqual(n);
      expect(cols).toBeLessThanOrEqual(6);
    }
  });

  test("timestamps are labelled mm:ss.mmm", () => {
    expect(stamp(0)).toBe("00:00.000");
    expect(stamp(3.8)).toBe("00:03.800");
    expect(stamp(75.5)).toBe("01:15.500");
  });
});

describe("what ffmpeg can do", () => {
  test("drawtext is detected from the filter listing, not assumed", () => {
    const withIt = " T.. drawbox           V->V       Draw a colored box on the input video.\n TS. drawtext          V->V       Draw text on top of video frames.\n";
    const withoutIt = " T.. drawbox           V->V       Draw a colored box on the input video.\n";
    expect(hasDrawtext(withIt)).toBe(true);
    expect(hasDrawtext(withoutIt)).toBe(false);
    expect(hasDrawtext("")).toBe(false);
  });
});

describe("pngSize", () => {
  test("reads IHDR without decoding, and refuses anything that is not a PNG", () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write("IHDR", 12, "latin1");
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(360, 20);
    expect(pngSize(png)).toEqual({ width: 640, height: 360 });
    expect(pngSize(Buffer.from("not a png at all really"))).toBeNull();
    expect(pngSize(Buffer.alloc(4))).toBeNull();
  });
});
