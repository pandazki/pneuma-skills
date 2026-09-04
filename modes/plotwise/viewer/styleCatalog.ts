/**
 * Built-in style catalog for the picker cards.
 *
 * The authoritative ART DIRECTION lives in skill/references/styles.md —
 * recipe, graphic devices, narration mode, and the "best for / never for"
 * the agent recommends from. This module is the viewer-facing mirror and
 * carries only what a card renders: display name, one-line pitch, and the
 * sample-still thumbnail baked into the bundle. Each pitch is the short
 * form of that entry's "Best for", so the two move together.
 * Chinese display strings are fixed label maps, the sanctioned home for
 * user-facing Chinese in viewer code (wordtaste precedent).
 *
 * Thumbnails are stills from the real sample shoots (2026-09-01), so a
 * card shows what the style actually renders like — not concept art.
 */

// `import.meta.glob` is Vite's, rewritten at build time by static
// analysis — so the call must stay a plain call expression (a `typeof`
// guard defeats the rewrite and the browser sees no thumbnails). Under
// bun test (happy-dom component tests) the call throws instead, and the
// cards render with empty stills.
let thumbs: Record<string, string> = {};
try {
  thumbs = import.meta.glob("./style-thumbs/*.jpg", {
    eager: true,
    query: "?url",
    import: "default",
  }) as Record<string, string>;
} catch {
  thumbs = {};
}

export interface StyleCard {
  id: string;
  /** Display name (Chinese-first product surface). */
  name: string;
  nameEn: string;
  /** One-line pitch: what this style teaches best. Rendered on one
   * truncated line, so it stays under ~13 Chinese characters. */
  pitch: string;
  narration: "voiceover" | "on-camera";
  thumb: string;
}

const thumb = (id: string): string => thumbs[`./style-thumbs/${id}.jpg`] ?? "";

export const STYLE_CARDS: StyleCard[] = [
  { id: "chalkboard", name: "黑板粉笔", nameEn: "Chalkboard", pitch: "一步一步推出来的道理", narration: "voiceover", thumb: thumb("chalkboard") },
  { id: "math-anim", name: "数学动画", nameEn: "Math animation", pitch: "把变换画成看得见的曲线", narration: "voiceover", thumb: thumb("math-anim") },
  { id: "comic", name: "手绘漫画", nameEn: "Ink comic", pitch: "有人物、有输赢的故事", narration: "on-camera", thumb: thumb("comic") },
  { id: "documentary", name: "纪录片", nameEn: "Documentary", pitch: "真实的地方,真实的工序", narration: "voiceover", thumb: thumb("documentary") },
  { id: "teacher", name: "真人讲师", nameEn: "On-camera teacher", pitch: "面对面把关键那句讲透", narration: "on-camera", thumb: thumb("teacher") },
  { id: "storybook", name: "水彩绘本", nameEn: "Watercolor storybook", pitch: "孩子的第一堂,温柔开场", narration: "voiceover", thumb: thumb("storybook") },
  { id: "pixel-quest", name: "像素游戏", nameEn: "Pixel quest", pitch: "把规则和取舍玩一遍", narration: "voiceover", thumb: thumb("pixel-quest") },
  { id: "papercraft", name: "纸艺定格", nameEn: "Papercraft", pitch: "层层拆开,看清结构", narration: "voiceover", thumb: thumb("papercraft") },
  { id: "holo-lab", name: "全息实验室", nameEn: "Holo lab", pitch: "把看不见的系统立起来", narration: "voiceover", thumb: thumb("holo-lab") },
  { id: "ink-wash", name: "水墨丹青", nameEn: "Ink wash", pitch: "留白处的哲思与诗意", narration: "voiceover", thumb: thumb("ink-wash") },
  { id: "toy-bricks", name: "积木搭建", nameEn: "Toy bricks", pitch: "同一种零件,搭出承重", narration: "voiceover", thumb: thumb("toy-bricks") },
  { id: "flat-vector", name: "扁平矢量", nameEn: "Flat vector", pitch: "从宇宙一跳到细胞", narration: "voiceover", thumb: thumb("flat-vector") },
  { id: "doodle-notes", name: "白板涂鸦", nameEn: "Doodle notes", pitch: "一张纸讲清一个直觉", narration: "voiceover", thumb: thumb("doodle-notes") },
  { id: "clean-3d", name: "简约三维", nameEn: "Clean 3D", pitch: "一群个体跑出的规律", narration: "voiceover", thumb: thumb("clean-3d") },
  { id: "isometric-tech", name: "等距信息图", nameEn: "Isometric infographic", pitch: "俯瞰路线、环节与产能", narration: "voiceover", thumb: thumb("isometric-tech") },
  { id: "vintage-collage", name: "复古拼贴", nameEn: "Vintage collage", pitch: "旧纸上的发明与思想", narration: "voiceover", thumb: thumb("vintage-collage") },
  { id: "clay-motion", name: "黏土定格", nameEn: "Claymation", pitch: "捏一捏、切一刀看因果", narration: "voiceover", thumb: thumb("clay-motion") },
  { id: "anime-scenery", name: "动画电影", nameEn: "Anime film", pitch: "先被震住,再讲道理", narration: "voiceover", thumb: thumb("anime-scenery") },
];
