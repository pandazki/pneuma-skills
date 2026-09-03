/**
 * Built-in style catalog for the picker cards.
 *
 * The authoritative RECIPES live in skill/references/styles.md (the agent
 * reads those); this module is the viewer-facing mirror: display names,
 * one-line pitches, and sample-still thumbnails baked into the bundle.
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
  /** One-line pitch: what this style teaches best. */
  pitch: string;
  narration: "voiceover" | "on-camera";
  thumb: string;
}

const thumb = (id: string): string => thumbs[`./style-thumbs/${id}.jpg`] ?? "";

export const STYLE_CARDS: StyleCard[] = [
  { id: "chalkboard", name: "黑板粉笔", nameEn: "Chalkboard", pitch: "过程与因果,一笔一画长出来", narration: "voiceover", thumb: thumb("chalkboard") },
  { id: "math-anim", name: "数学动画", nameEn: "Math animation", pitch: "数理之美,曲线与变换", narration: "voiceover", thumb: thumb("math-anim") },
  { id: "comic", name: "手绘漫画", nameEn: "Ink comic", pitch: "有角色有冲突的故事", narration: "on-camera", thumb: thumb("comic") },
  { id: "documentary", name: "纪录片", nameEn: "Documentary", pitch: "真实世界的宏大与细节", narration: "voiceover", thumb: thumb("documentary") },
  { id: "teacher", name: "真人讲师", nameEn: "On-camera teacher", pitch: "面对面把一件事讲透", narration: "on-camera", thumb: thumb("teacher") },
  { id: "storybook", name: "水彩绘本", nameEn: "Watercolor storybook", pitch: "温柔的入门与童话", narration: "voiceover", thumb: thumb("storybook") },
  { id: "pixel-quest", name: "像素游戏", nameEn: "Pixel quest", pitch: "把系统规则玩成游戏", narration: "voiceover", thumb: thumb("pixel-quest") },
  { id: "papercraft", name: "纸艺定格", nameEn: "Papercraft", pitch: "结构与组成,层层拼装", narration: "voiceover", thumb: thumb("papercraft") },
  { id: "holo-lab", name: "全息实验室", nameEn: "Holo lab", pitch: "科技、数据与系统", narration: "voiceover", thumb: thumb("holo-lab") },
  { id: "ink-wash", name: "水墨丹青", nameEn: "Ink wash", pitch: "哲思、诗意与传统文化", narration: "voiceover", thumb: thumb("ink-wash") },
  { id: "toy-bricks", name: "积木搭建", nameEn: "Toy bricks", pitch: "工程与结构,搭起来看", narration: "voiceover", thumb: thumb("toy-bricks") },
  { id: "flat-vector", name: "扁平矢量", nameEn: "Flat vector", pitch: "宇宙与生命的大问题", narration: "voiceover", thumb: thumb("flat-vector") },
  { id: "doodle-notes", name: "白板涂鸦", nameEn: "Doodle notes", pitch: "快节奏的直觉小抄", narration: "voiceover", thumb: thumb("doodle-notes") },
  { id: "clean-3d", name: "简约三维", nameEn: "Clean 3D", pitch: "仿真、演化与概率", narration: "voiceover", thumb: thumb("clean-3d") },
  { id: "isometric-tech", name: "等距信息图", nameEn: "Isometric infographic", pitch: "产业与基础设施如何运转", narration: "voiceover", thumb: thumb("isometric-tech") },
  { id: "vintage-collage", name: "复古拼贴", nameEn: "Vintage collage", pitch: "思想史与发明史", narration: "voiceover", thumb: thumb("vintage-collage") },
  { id: "clay-motion", name: "黏土定格", nameEn: "Claymation", pitch: "地球科学与趣味因果", narration: "voiceover", thumb: thumb("clay-motion") },
  { id: "anime-scenery", name: "动画电影", nameEn: "Anime film", pitch: "天文气象与浪漫惊叹", narration: "voiceover", thumb: thumb("anime-scenery") },
];
