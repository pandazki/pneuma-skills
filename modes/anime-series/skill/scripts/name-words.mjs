/**
 * Words the "who does this shot name" check (`series-state.mjs`
 * `expectedIn`) needs beyond the bible's own names. Pure data, no logic.
 *
 * Why this is data, not code: the words are in the languages shot text is
 * written in, and the repository keeps source identifiers and comments in
 * English, so the non-English words live here, as values.
 *
 *   LEADER_WORDS        a group with a `leader` is also named by its role
 *                       word ("the leader", 头目)
 *   CHARACTER_COMPOUNDS ordinary words that contain a one-character name
 *                       without meaning the character: for 光, "the cold
 *                       blue light of the screens" (冷蓝光) is not 光.
 *                       Keyed by the character; an entity's own `notNames`
 *                       add to these.
 */

export const LEADER_WORDS = Object.freeze(["leader", "头目"]);

export const CHARACTER_COMPOUNDS = Object.freeze({
  光: Object.freeze(["灯光", "阳光", "月光", "星光", "蓝光", "冷光", "荧光", "反光", "目光", "屏幕光", "光线", "光芒", "光晕"]),
});
