/**
 * A structural `.riv` decoder, kept as a test helper.
 *
 * Ported from the research prototype (`rivproto/decode.mjs`, validated against
 * the official `@rive-app/canvas` 2.43.1 runtime). Its key table is its own:
 * the type keys, property keys and property types below were copied out of
 * rive-runtime's generated headers (`include/rive/generated/**_base.hpp`,
 * commit 27e2adac, 2026-09-23), NOT out of `skill/scripts/rive.mjs`. That
 * independence is the whole point — a wrong key in the encoder fails
 * silently in every runtime (the property is skipped), so the test has to
 * read the file with a table the encoder did not write.
 *
 * Only the types and properties the sprite export can emit are listed, plus
 * their inherited fields. An unknown property key is a hard error rather than
 * a guess: the file carries no table of contents, so a key this reader does
 * not know leaves it unable to tell how many bytes to skip.
 */

/** typeKey → type name. */
export const RIVE_TYPES = new Map([
  [1, "Artboard"], [23, "Backboard"], [25, "KeyedObject"], [26, "KeyedProperty"],
  [31, "LinearAnimation"], [50, "KeyFrameId"], [53, "StateMachine"],
  [56, "StateMachineNumber"], [57, "StateMachineLayer"], [58, "StateMachineTrigger"],
  [61, "AnimationState"], [62, "AnyState"], [63, "EntryState"], [64, "ExitState"],
  [65, "StateTransition"], [68, "TransitionTriggerCondition"],
  [70, "TransitionNumberCondition"], [100, "Image"], [105, "ImageAsset"],
  [106, "FileAssetContents"], [147, "Solo"],
]);

/**
 * propertyKey → [name, kind]. Kinds: u = varuint (uint and id), f = float32,
 * s = string, y = bytes, b = one bool byte. Names carry the class that
 * declares the field, the way the runtime headers do.
 */
export const RIVE_PROPERTIES = new Map([
  [4, ["Component.name", "s"]], [5, ["Component.parentId", "u"]],
  [7, ["LayoutComponent.width", "f"]], [8, ["LayoutComponent.height", "f"]],
  [11, ["Artboard.originX", "f"]], [12, ["Artboard.originY", "f"]],
  [13, ["Node.x", "f"]], [14, ["Node.y", "f"]],
  [15, ["TransformComponent.rotation", "f"]], [16, ["TransformComponent.scaleX", "f"]],
  [17, ["TransformComponent.scaleY", "f"]], [18, ["WorldTransformComponent.opacity", "f"]],
  [23, ["Drawable.blendModeValue", "u"]], [51, ["KeyedObject.objectId", "u"]],
  [53, ["KeyedProperty.propertyKey", "u"]], [55, ["Animation.name", "s"]],
  [56, ["LinearAnimation.fps", "u"]], [57, ["LinearAnimation.duration", "u"]],
  [58, ["LinearAnimation.speed", "f"]], [59, ["LinearAnimation.loopValue", "u"]],
  [60, ["LinearAnimation.workStart", "u"]], [61, ["LinearAnimation.workEnd", "u"]],
  [62, ["LinearAnimation.enableWorkArea", "b"]], [67, ["KeyFrame.frame", "u"]],
  [68, ["InterpolatingKeyFrame.interpolationType", "u"]],
  [69, ["InterpolatingKeyFrame.interpolatorId", "u"]], [122, ["KeyFrameId.value", "u"]],
  [129, ["Drawable.drawableFlags", "u"]], [138, ["StateMachineComponent.name", "s"]],
  // StateMachineNumber.value and TransitionNumberCondition.value are
  // CoreDoubleType, which the runtime reads as a float32.
  [140, ["StateMachineNumber.value", "f"]],
  [149, ["AnimationState.animationId", "u"]], [151, ["StateTransition.stateToId", "u"]],
  [152, ["StateTransition.flags", "u"]], [155, ["TransitionInputCondition.inputId", "u"]],
  [156, ["TransitionValueCondition.opValue", "u"]], [157, ["TransitionNumberCondition.value", "f"]],
  [158, ["StateTransition.duration", "u"]], [160, ["StateTransition.exitTime", "u"]],
  [196, ["LayoutComponent.clip", "b"]], [203, ["Asset.name", "s"]],
  [204, ["FileAsset.assetId", "u"]], [206, ["Image.assetId", "u"]],
  [207, ["DrawableAsset.height", "f"]], [208, ["DrawableAsset.width", "f"]],
  [212, ["FileAssetContents.bytes", "y"]], [236, ["Artboard.defaultStateMachineId", "u"]],
  [292, ["AdvanceableState.speed", "f"]], [296, ["Solo.activeComponentId", "u"]],
  [349, ["StateTransition.interpolationType", "u"]], [350, ["StateTransition.interpolatorId", "u"]],
  [362, ["FileAsset.cdnBaseUrl", "s"]], [376, ["LinearAnimation.quantize", "b"]],
  [380, ["Image.originX", "f"]], [381, ["Image.originY", "f"]],
  [536, ["LayerState.flags", "u"]], [537, ["StateTransition.randomWeight", "u"]],
  [583, ["Artboard.viewModelId", "u"]], [911, ["FileAssetContents.signature", "y"]],
  [974, ["Image.fit", "u"]], [975, ["Image.alignmentX", "f"]], [976, ["Image.alignmentY", "f"]],
  [1073, ["ImageAsset.samplerFilter", "u"]], [1074, ["ImageAsset.samplerWrapX", "u"]],
  [1075, ["ImageAsset.samplerWrapY", "u"]], [1076, ["Image.samplerFilter", "u"]],
  [1077, ["Image.samplerWrapX", "u"]], [1078, ["Image.samplerWrapY", "u"]],
]);

/**
 * Decode a `.riv` buffer into its header and its flat object list.
 *
 * Each object is `{ type, typeKey, props }`, where `props` is keyed by the
 * short field name (`name`, `assetId`, `activeComponentId`, …) because no
 * object carries two fields of the same short name. Bytes stay a Buffer.
 */
export function decodeRiv(buffer) {
  const buf = Buffer.from(buffer);
  let o = 0;
  const varuint = () => {
    let result = 0n;
    let shift = 0n;
    let byte;
    do {
      if (o >= buf.length) throw new Error(`riv: varuint runs past the end at ${o}`);
      byte = buf[o++];
      result |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
    } while (byte & 0x80);
    return Number(result);
  };

  const fingerprint = buf.subarray(0, 4).toString("latin1");
  if (fingerprint !== "RIVE") throw new Error(`riv: fingerprint is '${fingerprint}', not RIVE`);
  o = 4;
  const major = varuint();
  const minor = varuint();
  const fileId = varuint();
  const toc = [];
  for (let key = varuint(); key !== 0; key = varuint()) toc.push(key);
  // Two bits per ToC entry, four entries per little-endian u32 — the runtime's
  // own reader (`RuntimeHeader::read`) resets at bit 8, and so does this one.
  // The sprite writer leaves the ToC empty (every property it writes is one
  // every runtime knows), so this only keeps the reader honest on other files.
  const tocKind = new Map();
  let bits = 0;
  let bit = 8;
  for (const key of toc) {
    if (bit === 8) {
      bits = buf.readUInt32LE(o);
      o += 4;
      bit = 0;
    }
    tocKind.set(key, ["u", "s", "f", "c"][(bits >> bit) & 3]);
    bit += 2;
  }

  const objects = [];
  while (o < buf.length) {
    const typeKey = varuint();
    const type = RIVE_TYPES.get(typeKey);
    if (!type) throw new Error(`riv: unknown type key ${typeKey} at object ${objects.length}`);
    const props = {};
    for (let key = varuint(); key !== 0; key = varuint()) {
      const known = RIVE_PROPERTIES.get(key);
      const kind = known?.[1] ?? tocKind.get(key);
      if (!kind) throw new Error(`riv: unknown property key ${key} on ${type} (object ${objects.length})`);
      const name = known ? known[0].split(".")[1] : String(key);
      let value;
      if (kind === "u") value = varuint();
      else if (kind === "f") {
        value = buf.readFloatLE(o);
        o += 4;
      } else if (kind === "c") {
        value = buf.readUInt32LE(o);
        o += 4;
      } else if (kind === "b") {
        value = buf[o++];
      } else {
        const length = varuint();
        const bytes = buf.subarray(o, o + length);
        if (bytes.length !== length) throw new Error(`riv: ${type}.${name} runs past the end`);
        o += length;
        value = kind === "s" ? bytes.toString("utf8") : Buffer.from(bytes);
      }
      props[name] = value;
    }
    objects.push({ type, typeKey, props });
  }
  return { fingerprint, major, minor, fileId, toc, objects };
}
