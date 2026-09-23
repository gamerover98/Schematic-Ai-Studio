/**
 * Putting a banner's patterns into the document, wherever a banner is placed.
 *
 * Placing is `setBlock`; the patterns are a block entity; and `setBlock` drops
 * the block entity of whatever it displaces. So the patterns are written
 * *after* the block, in the same transaction -- one Ctrl+Z takes back the
 * banner and its design together, and there is no moment at which the banner
 * exists without the design it was placed with.
 *
 * The checks come first and are separate, because every caller has something
 * to do between checking and writing: grow the document, merge a slab, place
 * the far half of a door. A refusal found after any of those would have to
 * unwind them.
 */

import { documentEra, documentVersionName, mcVersion } from "../../shared/mc_versions.js";
import {
  bannerBlockColor,
  bannerFormat,
  isBannerBlock,
  type BannerFormat,
  type DyeName,
} from "../../shared/banner_patterns.js";
import {
  BannerPatternError,
  bannerEntityId,
  missingLayers,
  readBanner,
  writeBanner,
  type BannerLayer,
} from "../pipeline/banner_nbt.js";
import { paletteEntryCacheKey, type BlockEntityRecord, type PaletteEntry } from "../pipeline/types.js";
import { getBlock, getBlockEntity, type Region, type SchematicDocument } from "./document.js";
import { type TransactionScope } from "./history.js";

/** Which spelling this document's banners are written in. */
export function bannerFormatOf(doc: SchematicDocument): BannerFormat {
  return bannerFormat(documentEra(doc.format, doc.dataVersion), doc.dataVersion);
}

/**
 * Refuses, by name, patterns that cannot go on this block in this document.
 *
 * A block that is not a banner is the first reason: the patterns would be a
 * block entity on a block that has none, which the game ignores and every
 * writer here would carry. The second is a design the schematic's version does
 * not have, or has no way to spell.
 */
export function checkBannerPatterns(
  doc: SchematicDocument,
  entry: PaletteEntry,
  layers: readonly BannerLayer[],
): void {
  if (!isBannerBlock(entry.namespacedName)) {
    throw new BannerPatternError(
      `${entry.namespacedName} is not a banner, so it cannot carry banner patterns.`,
    );
  }
  const era = documentEra(doc.format, doc.dataVersion);
  const missing = missingLayers(layers, bannerFormatOf(doc), era, doc.dataVersion);
  if (missing.length > 0) {
    const name = documentVersionName(doc.format, doc.dataVersion);
    const label = (name === null ? null : mcVersion(name)?.label) ?? "this schematic's version";
    const designs = [...new Set(missing.map((layer) => layer.pattern))].join(", ");
    throw new BannerPatternError(
      `${designs} cannot be made in Minecraft ${label}, which is what this schematic is for. ` +
        `list_banner_patterns says which version each design arrived in; or change the schematic's version.`,
    );
  }
}

/**
 * Writes the layers into every one of `cells` that now holds a banner of
 * `entry`'s name. Returns how many were written.
 *
 * By name rather than by state, because a placement may have been given a
 * direction on the way in. On a legacy document the cloth's colour lives in the
 * block entity, so a banner that already had one keeps it.
 */
export function stampBanner(
  doc: SchematicDocument,
  tx: TransactionScope,
  cells: Iterable<{ x: number; y: number; z: number }>,
  entry: PaletteEntry,
  layers: readonly BannerLayer[],
): number {
  const format = bannerFormatOf(doc);
  let written = 0;
  for (const { x, y, z } of cells) {
    if (getBlock(doc, x, y, z).namespacedName !== entry.namespacedName) continue;
    const existing = getBlockEntity(doc, x, y, z);
    const base = format === "legacy" && existing !== null ? readBanner(existing.nbt, format).base : null;
    tx.setBlockEntity(x, y, z, {
      id: existing?.id ?? bannerEntityId(format),
      pos: [x, y, z],
      nbt: writeBanner(existing?.nbt ?? {}, layers, format, base),
    });
    written += 1;
  }
  return written;
}

/** What a version change does to the banners in a document. */
export interface BannerRestatement {
  /** Per banner: its name in the target version, and the block entity it carries there. */
  readonly cells: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly name: string;
    readonly record: BlockEntityRecord;
  }>;
  /**
   * Coloured banners the target spells as white, by palette key. Only going
   * back past the Flattening, where one block held all sixteen colours.
   */
  readonly renames: ReadonlyMap<string, PaletteEntry>;
  /** Layers whose design the target does not have, which go. */
  readonly droppedLayers: number;
  readonly droppedDesigns: readonly string[];
}

/**
 * Every banner restated for another version: its patterns in the target's
 * spelling, and its colour wherever the target keeps it.
 *
 * The Flattening moved a banner's colour from `Base` into the block's name, and
 * 1.20.5 renamed every part of a layer. A version change that left the block
 * entity alone would leave every banner in the build blank in the game it was
 * converted for -- drawn correctly here, because the reader takes all three
 * spellings, which is exactly why nothing would have looked wrong.
 *
 * So, in the three directions:
 *
 * - **flat to flat across 1.20.5**: the list is rewritten, and nothing else;
 * - **flat to legacy**: `magenta_banner` becomes `white_banner` with `Base`
 *   carrying magenta -- the Flattening run backwards, and the difference
 *   between converting a banner and destroying it, since `magenta_banner` does
 *   not exist before 1.13. A coloured banner with no block entity gets one,
 *   because without `Base` a legacy banner is black;
 * - **legacy to flat**: `Base` becomes the name and leaves the block entity.
 *
 * A design the target does not have is removed and **counted**, so the caller
 * can refuse first, the way a block that does not exist is.
 */
export function restateBanners(
  doc: SchematicDocument,
  target: { era: "legacy" | "flat"; dataVersion: number | null },
): BannerRestatement {
  const from = bannerFormatOf(doc);
  const to = bannerFormat(target.era, target.dataVersion);
  const toLegacy = to === "legacy";
  const fromLegacy = from === "legacy";

  const renamed = (name: string, colour: DyeName): string => {
    const own = bannerBlockColor(name);
    if (own === null) return name;
    const recoloured = (to: DyeName) =>
      name.replace(new RegExp(`:${own}_((?:wall_)?banner)$`), `:${to}_$1`);
    if (toLegacy && !fromLegacy) return recoloured("white");
    if (fromLegacy && !toLegacy) return recoloured(colour);
    return name;
  };

  const renames = new Map<string, PaletteEntry>();
  const colouredIndex = new Uint8Array(doc.palette.length);
  if (toLegacy && !fromLegacy) {
    doc.palette.forEach((entry, index) => {
      const colour = bannerBlockColor(entry.namespacedName);
      if (!isBannerBlock(entry.namespacedName) || colour === null || colour === "white") return;
      renames.set(paletteEntryCacheKey(entry), {
        namespacedName: renamed(entry.namespacedName, colour),
        properties: entry.properties,
      });
      colouredIndex[index] = 1;
    });
  }

  const cells: Array<BannerRestatement["cells"][number]> = [];
  const dropped: string[] = [];
  const covered = new Set<string>();
  for (const record of doc.blockEntities.values()) {
    const [x, y, z] = record.pos;
    if (x < 0 || y < 0 || z < 0 || x >= doc.width || y >= doc.height || z >= doc.length) continue;
    const entry = getBlock(doc, x, y, z);
    if (!isBannerBlock(entry.namespacedName)) continue;
    covered.add(`${x},${y},${z}`);
    const look = readBanner(record.nbt, from);
    const colour = look.base ?? bannerBlockColor(entry.namespacedName) ?? "white";
    const keep = look.layers.filter(
      (layer) => missingLayers([layer], to, target.era, target.dataVersion).length === 0,
    );
    for (const layer of look.layers) if (!keep.includes(layer)) dropped.push(layer.pattern);
    const name = renamed(entry.namespacedName, colour);
    const nbt = writeBanner(record.nbt, keep, to, colour);
    const id = fromLegacy === toLegacy ? record.id : bannerEntityId(to);
    if (name === entry.namespacedName && id === record.id && JSON.stringify(nbt) === JSON.stringify(record.nbt)) {
      continue;
    }
    cells.push({ x, y, z, name, record: { id, pos: [x, y, z], nbt } });
  }

  // The coloured banners that had nothing saying what they look like: going
  // back past the Flattening, their colour needs a `Base` to live in.
  if (renames.size > 0) {
    for (let x = 0; x < doc.width; x += 1) {
      for (let y = 0; y < doc.height; y += 1) {
        for (let z = 0; z < doc.length; z += 1) {
          const index = doc.voxels[x * doc.height * doc.length + y * doc.length + z];
          if (colouredIndex[index] !== 1 || covered.has(`${x},${y},${z}`)) continue;
          const entry = doc.palette[index];
          const colour = bannerBlockColor(entry.namespacedName) ?? "white";
          cells.push({
            x,
            y,
            z,
            name: renamed(entry.namespacedName, colour),
            record: { id: bannerEntityId(to), pos: [x, y, z], nbt: writeBanner({}, [], to, colour) },
          });
        }
      }
    }
  }

  return {
    cells,
    renames,
    droppedLayers: dropped.length,
    droppedDesigns: [...new Set(dropped)].sort(),
  };
}

/** Every cell of a region, for the callers that stamp a fill. */
export function* regionCells(region: Region): Generator<{ x: number; y: number; z: number }> {
  for (let x = region.minX; x <= region.maxX; x += 1) {
    for (let y = region.minY; y <= region.maxY; y += 1) {
      for (let z = region.minZ; z <= region.maxZ; z += 1) {
        yield { x, y, z };
      }
    }
  }
}
