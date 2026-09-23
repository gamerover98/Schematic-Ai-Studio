/**
 * A banner's pattern layers, read out of and written into its block entity.
 *
 * The table of designs and the three spellings are
 * `shared/banner_patterns.ts`; this is the NBT half, which needs `parseSnbt`
 * and the tag shapes and so cannot live beside it.
 *
 * Electron-free, like the rest of the pipeline, so the suites reach every
 * spelling directly.
 *
 * ## Two ways of reading, on purpose
 *
 * Text a person or a model *wrote* is read strictly: an unknown design, a
 * colour that is not a dye, a layer with no colour -- each is refused by name,
 * because the alternative is a banner that came out different from what was
 * asked and says nothing.
 *
 * NBT that came out of a *file* is read leniently: a layer that cannot be read
 * is skipped and the rest are drawn. A file is not an instruction, and a banner
 * that vanished because one of its six layers named a datapack's design would
 * be a worse picture of it than one missing that layer.
 */

import { parseSnbt } from "../domain/snbt.js";
import {
  BANNER_COLORS,
  MAX_BANNER_LAYERS,
  bannerBlockColor,
  bannerPattern,
  dyeIndex,
  patternExistsIn,
  type BannerFormat,
  type DyeName,
} from "../../shared/banner_patterns.js";
import { paletteEntryCacheKey, type NbtCompound, type NbtTag, type PaletteEntry } from "./types.js";

/** One layer: a design, in a colour. `pattern` is the id without its namespace. */
export interface BannerLayer {
  readonly pattern: string;
  readonly color: DyeName;
}

/** What a banner's block entity says about how it looks. */
export interface BannerLook {
  /**
   * The cloth's own colour when the block entity carries it, which only a
   * legacy one does (`Base`). `null` everywhere else: from 1.13 the colour is
   * the block's name.
   */
  readonly base: DyeName | null;
  readonly layers: readonly BannerLayer[];
}

export class BannerPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BannerPatternError";
  }
}

const HINT = "list_banner_patterns names every design and colour.";

function listItems(tag: NbtTag): unknown[] | null {
  if (tag.type !== "list") return null;
  const inner = tag.value as { value?: unknown };
  return Array.isArray(inner?.value) ? inner.value : null;
}

function field(compound: NbtCompound, ...keys: string[]): NbtTag | undefined {
  for (const key of keys) {
    if (compound[key] !== undefined) return compound[key];
  }
  return undefined;
}

/** A colour from a tag: a dye's name, or a number in `numbering`. */
function colourOf(tag: NbtTag | undefined, inverted: boolean): DyeName | null {
  if (tag === undefined) return null;
  if (typeof tag.value === "string") {
    const index = dyeIndex(tag.value);
    return index === null ? null : BANNER_COLORS[index];
  }
  if (typeof tag.value === "number" && Number.isInteger(tag.value)) {
    const index = inverted ? 15 - tag.value : tag.value;
    return index >= 0 && index < 16 ? BANNER_COLORS[index] : null;
  }
  return null;
}

/**
 * The layers out of a list tag.
 *
 * `strict` throws on the first layer it cannot read; otherwise such a layer is
 * skipped. `inverted` is the legacy numbering, and only ever applies to a number
 * -- a name is a name in every era.
 */
function layersOf(tag: NbtTag, inverted: boolean, strict: boolean): BannerLayer[] {
  const items = listItems(tag);
  if (items === null) {
    if (strict) throw new BannerPatternError(`The banner patterns must be a list of layers. ${HINT}`);
    return [];
  }
  const layers: BannerLayer[] = [];
  items.forEach((item, index) => {
    const at = `Layer ${index + 1}`;
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      if (strict) throw new BannerPatternError(`${at} is not a {pattern, color} compound.`);
      return;
    }
    const compound = item as NbtCompound;
    const patternTag = field(compound, "pattern", "Pattern");
    const name = typeof patternTag?.value === "string" ? patternTag.value : null;
    const row = name === null ? null : bannerPattern(name);
    if (row === null) {
      if (strict) {
        throw new BannerPatternError(
          name === null
            ? `${at} names no pattern.`
            : `${at}'s pattern ${JSON.stringify(name)} is not a banner design. ${HINT}`,
        );
      }
      return;
    }
    const colour = colourOf(field(compound, "color", "Color"), inverted);
    if (colour === null) {
      if (strict) {
        throw new BannerPatternError(
          `${at} (${row.id}) has no colour this app can read; use a dye's name such as "orange". ${HINT}`,
        );
      }
      return;
    }
    layers.push({ pattern: row.id, color: colour });
  });
  if (strict && layers.length > MAX_BANNER_LAYERS) {
    throw new BannerPatternError(
      `${layers.length} layers is more than the ${MAX_BANNER_LAYERS} the game draws on a banner.`,
    );
  }
  return layers;
}

/**
 * Layers as a person or a model wrote them: the text of `banner_patterns=[...]`,
 * or of a `/give` or `/setblock` NBT list.
 *
 * Numbers are the modern numbering, which is the only one a command naming a
 * coloured banner block ever used -- see `splitBlockInput`.
 */
export function parseBannerLayers(text: string): BannerLayer[] {
  let tag: NbtTag;
  try {
    tag = parseSnbt(text);
  } catch (err) {
    throw new BannerPatternError(
      `The banner patterns could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return layersOf(tag, false, true);
}

/**
 * Layers as JSON -- `[{pattern: "mojang", color: "orange"}]` -- which is how a
 * tool's arguments arrive. Read exactly as strictly as the text form, because it
 * is the same instruction in a different envelope.
 */
export function bannerLayersFrom(value: unknown): BannerLayer[] {
  if (!Array.isArray(value)) {
    throw new BannerPatternError(`patterns must be a list of {pattern, color}. ${HINT}`);
  }
  const items = value.map((item): NbtCompound => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return {};
    const out: NbtCompound = {};
    for (const [key, raw] of Object.entries(item as Record<string, unknown>)) {
      if (typeof raw === "string") out[key] = { type: "string", value: raw };
      else if (typeof raw === "number") out[key] = { type: "int", value: raw };
    }
    return out;
  });
  return layersOf({ type: "list", value: { type: "compound", value: items } }, false, true);
}

/**
 * What a banner's block entity says, in whichever spelling it uses.
 *
 * All three are read whatever the document's format, because a file does not
 * always match its own label -- a tool that wrote `patterns` into a 1.20.4
 * schematic still drew a banner somebody wants to see. Only the *numbering* of
 * a number follows the format, since nothing in the tag says which it is.
 */
export function readBanner(nbt: NbtCompound, format: BannerFormat): BannerLook {
  const inverted = format === "legacy";
  const list = field(nbt, "patterns", "Patterns");
  const layers = list === undefined ? [] : layersOf(list, inverted, false);
  const base = format === "legacy" ? colourOf(nbt.Base, true) : null;
  return { base, layers: layers.slice(0, MAX_BANNER_LAYERS) };
}

const string = (value: string): NbtTag => ({ type: "string", value });
const int = (value: number): NbtTag => ({ type: "int", value });

function compoundList(items: NbtCompound[]): NbtTag {
  return items.length === 0
    ? { type: "list", value: { type: "end", value: [] } }
    : { type: "list", value: { type: "compound", value: items } };
}

/**
 * The block entity with these layers in it, in the document's spelling.
 *
 * Everything else the block entity carried stays -- a `CustomName`, a
 * datapack's own keys -- and the *other* spellings of the list are removed, so a
 * banner never carries two lists that disagree about how it looks.
 *
 * `base` is the legacy cloth colour. It is written only for `legacy`, where it
 * is required: a pre-Flattening banner with no `Base` is black.
 *
 * Refuses a layer the format has no spelling for -- `flow` and `guster` have no
 * code -- rather than dropping it; callers check `missingLayers` first.
 */
export function writeBanner(
  nbt: NbtCompound,
  layers: readonly BannerLayer[],
  format: BannerFormat,
  base: DyeName | null,
): NbtCompound {
  const out: NbtCompound = {};
  for (const [key, value] of Object.entries(nbt)) {
    if (key === "patterns" || key === "Patterns" || key === "Base") continue;
    out[key] = value;
  }
  if (format === "named") {
    if (layers.length > 0) {
      out.patterns = compoundList(
        layers.map((layer) => ({
          pattern: string(`minecraft:${layer.pattern}`),
          color: string(layer.color),
        })),
      );
    }
    return out;
  }
  const inverted = format === "legacy";
  if (layers.length > 0) {
    out.Patterns = compoundList(
      layers.map((layer) => {
        const code = bannerPattern(layer.pattern)?.code ?? null;
        if (code === null) {
          throw new BannerPatternError(
            `${layer.pattern} has no spelling before 1.20.5, so it cannot be written into this schematic.`,
          );
        }
        const index = dyeIndex(layer.color) ?? 0;
        return { Pattern: string(code), Color: int(inverted ? 15 - index : index) };
      }),
    );
  }
  if (inverted) {
    const index = dyeIndex(base ?? "white") ?? 0;
    out.Base = int(15 - index);
  }
  return out;
}

/**
 * The layers a document of this version and format cannot hold.
 *
 * Two reasons, and they are one question: the design did not exist yet, or the
 * spelling the format uses has no name for it.
 */
export function missingLayers(
  layers: readonly BannerLayer[],
  format: BannerFormat,
  era: "legacy" | "flat",
  dataVersion: number | null,
): BannerLayer[] {
  return layers.filter((layer) => {
    const row = bannerPattern(layer.pattern);
    if (row === null) return true;
    if (format !== "named" && row.code === null) return true;
    return !patternExistsIn(row, era, dataVersion);
  });
}

/** The block entity id a new banner record is written under. */
export function bannerEntityId(format: BannerFormat): string {
  // MCEdit drops the namespace on the way out, and 1.8 to 1.10 know the
  // block entity only as `Banner`; a bare `banner` is nothing to them.
  return format === "legacy" ? "minecraft:Banner" : "minecraft:banner";
}

/**
 * A patterned banner as the spelling that places it again.
 *
 * What `inspect_block` hands a model, so the banner it is looking at can be
 * copied with `set_block` as it stands. The legacy `Base` is not in it -- a
 * block named like this *is* its colour -- so a legacy banner is spelled with
 * the colour its `Base` gives.
 */
export function bannerBlockData(entry: PaletteEntry, look: BannerLook): string {
  const name =
    look.base !== null && bannerBlockColor(entry.namespacedName) === "white"
      ? entry.namespacedName.replace(/white_((?:wall_)?banner)$/, `${look.base}_$1`)
      : entry.namespacedName;
  const key = paletteEntryCacheKey({ namespacedName: name, properties: entry.properties });
  if (look.layers.length === 0) return key;
  const list = `banner_patterns=[${look.layers
    .map((layer) => `{pattern:"${layer.pattern}",color:"${layer.color}"}`)
    .join(",")}]`;
  return key.endsWith("]") ? `${key.slice(0, -1)},${list}]` : `${key}[${list}]`;
}
