/**
 * Copying a region out, and pasting it back somewhere else.
 *
 * The clipboard holds a *detached* snapshot: palette entries by value, not
 * palette indices. Indices only mean something relative to the document they
 * came from, and the whole point of a clipboard is to survive leaving that
 * document — copy from a castle, open a village, paste the tower. Storing
 * indices would paste the right numbers and the wrong blocks.
 *
 * ## Air is not stored, and not pasted
 *
 * A copied region is a box, and most of a box is air. Storing that air would
 * make every clipboard cost what its selection *spans* rather than what is in
 * it; pasting it would punch a rectangular hole in whatever the paste lands on,
 * so a house copied off flat ground would arrive having excavated a pit around
 * itself. Only the cells holding something are kept.
 *
 * `includeAir` still means what it says, and is reached the other way round: it
 * clears the destination box before writing. Same result for the case that
 * wants it — stamping a hollow room into solid rock — without storing a box of
 * nothing to get there.
 *
 * ## Out of bounds is clipped here, and decided one layer up
 *
 * `pasteClipboard` writes the part that fits and drops the rest, which is what
 * lets `moveRegion` and friends compose it without bounds arithmetic of their
 * own to get wrong. It is not what a user meets: `pasteSelection` grows the
 * document to hold the whole thing, or refuses by name with automatic resizing
 * off, so the clipping below is the floor rather than the policy.
 */

import {
  getBlock,
  normalizeRegion,
  type Region,
  type SchematicDocument,
} from "./document.js";
import type { TransactionScope } from "./history.js";
import type { BlockEntityRecord, PaletteEntry } from "../pipeline/types.js";
import { matchesBlockPattern, paletteEntryIsAir } from "../pipeline/types.js";
import { forEachUnionCell, unionBounds, type Box } from "../../shared/regions.js";

/** One cell of a copied region, offset from the region's own corner. */
interface ClipboardCell {
  dx: number;
  dy: number;
  dz: number;
  entry: PaletteEntry;
  entity: BlockEntityRecord | null;
}

export interface Clipboard {
  width: number;
  height: number;
  length: number;
  /** Non-air cells only; air is what a paste leaves alone. */
  cells: ClipboardCell[];
  /** How many blocks were taken, for the UI to report. */
  blocks: number;
  /**
   * The areas it was taken from, relative to its corner, when there were
   * several. `null` for one box, which is the whole of its own box.
   *
   * Only `includeAir` asks: it clears the destination before writing, and
   * clearing the whole bounding box would wipe the gap between two areas --
   * cells nobody selected, at the destination as at the source.
   */
  mask: Box[] | null;
}

export interface PasteOptions {
  /**
   * Write the copied air too, erasing whatever it lands on. Off by default —
   * see the note at the top.
   */
  includeAir?: boolean;
  /**
   * A cell holding this is left where it falls rather than written.
   *
   * The document's own empty space, for the case air alone cannot cover: with
   * `barrier` or `water` chosen as empty space, those cells are real palette
   * entries, so a copied region carries them and a paste stamps them over
   * whatever was standing there. WorldEdit spells the same wish `//paste -a`;
   * here air is skipped already and this is the half that was missing.
   *
   * A **pattern**, matched by `matchesBlockPattern` -- naming no state means
   * the block in any state. An exact comparison would skip neither spelling:
   * the modal's preset is a bare `minecraft:barrier` and a barrier out of a
   * file is `minecraft:barrier[waterlogged=false]`.
   *
   * It answers the opposite question to `includeAir` and the two are never
   * sent together: that one clears the destination box first, so a cell
   * skipped under it would come out as air rather than as what was there.
   */
  keepUnder?: PaletteEntry | null;
}

/** Snapshots a region, by value. */
export function copyRegion(doc: SchematicDocument, region: Region): Clipboard {
  return copyRegions(doc, [region]);
}

/**
 * Snapshots several areas as one, by value, from the corner of their bounds.
 *
 * The areas keep where they were relative to each other, so a paste puts them
 * down in the same arrangement, and a cell inside two of them is taken once.
 * The gap between them is **not** taken: nobody selected it, so a paste must
 * not carry it along -- the air in it is never stored anyway, and a block
 * standing in it is exactly what would turn up somewhere nobody asked for.
 */
export function copyRegions(doc: SchematicDocument, regions: readonly Region[]): Clipboard {
  const bounds = unionBounds(regions);
  if (bounds === null) {
    return { width: 1, height: 1, length: 1, cells: [], blocks: 0, mask: null };
  }
  const cells: ClipboardCell[] = [];
  forEachUnionCell(regions, (x, y, z) => {
    const entry = getBlock(doc, x, y, z);
    const entity = doc.blockEntities.get(`${x},${y},${z}`) ?? null;
    if (paletteEntryIsAir(entry) && entity === null) {
      // Air with nothing attached carries no information a paste could
      // use, and keeping it would make every clipboard the size of its
      // bounding box rather than of the thing in it.
      return;
    }
    cells.push({
      dx: x - bounds.minX,
      dy: y - bounds.minY,
      dz: z - bounds.minZ,
      // Copied by value rather than by reference. Nothing in the app
      // mutates a palette entry in place today — an edit interns a new one
      // — so this is not fixing a live bug; it is severing the last thread
      // between a clipboard and a document it is expected to outlive, so
      // that holding one cannot keep the other's palette alive or expose it
      // to a future edit that does mutate.
      entry: { namespacedName: entry.namespacedName, properties: { ...entry.properties } },
      entity: entity === null ? null : { ...entity, nbt: structuredClone(entity.nbt) },
    });
  });

  return {
    width: bounds.maxX - bounds.minX + 1,
    height: bounds.maxY - bounds.minY + 1,
    length: bounds.maxZ - bounds.minZ + 1,
    cells,
    blocks: cells.filter((cell) => !paletteEntryIsAir(cell.entry)).length,
    mask:
      regions.length < 2
        ? null
        : regions.map((box) => ({
            minX: box.minX - bounds.minX,
            minY: box.minY - bounds.minY,
            minZ: box.minZ - bounds.minZ,
            maxX: box.maxX - bounds.minX,
            maxY: box.maxY - bounds.minY,
            maxZ: box.maxZ - bounds.minZ,
          })),
  };
}

/**
 * Writes a clipboard with its corner at `at`, and reports what landed.
 *
 * Takes a `TransactionScope` rather than opening one, for the same reason
 * `transform.ts` does: the UI wants one undo step per paste, and the agent
 * wants its whole request to be one — so the caller decides.
 */
export function pasteClipboard(
  doc: SchematicDocument,
  tx: TransactionScope,
  clipboard: Clipboard,
  at: { x: number; y: number; z: number },
  options: PasteOptions = {},
): number {
  let changed = 0;

  // `includeAir` is served by clearing the destination box first, rather than
  // by having stored the air. The copy keeps only the cells that hold
  // something, so a mostly-empty selection costs what is in it instead of what
  // it spans — and clearing first reaches the same result for the one case that
  // wants it, stamping a hollow room into solid rock.
  if (options.includeAir) {
    // The areas it came from, not their bounds: the gap between two areas was
    // never selected, so clearing it here would wipe cells nobody pointed at.
    const boxes = clipboard.mask ?? [
      { minX: 0, minY: 0, minZ: 0, maxX: clipboard.width - 1, maxY: clipboard.height - 1, maxZ: clipboard.length - 1 },
    ];
    for (const box of boxes) {
      changed += tx.fill(
        normalizeRegion(doc, {
          minX: at.x + box.minX,
          minY: at.y + box.minY,
          minZ: at.z + box.minZ,
          maxX: at.x + box.maxX,
          maxY: at.y + box.maxY,
          maxZ: at.z + box.maxZ,
        }),
        { namespacedName: "minecraft:air", properties: {} },
      );
    }
  }

  const keepUnder = options.keepUnder ?? null;
  for (const cell of clipboard.cells) {
    if (keepUnder !== null && matchesBlockPattern(cell.entry, keepUnder)) continue;
    const x = at.x + cell.dx;
    const y = at.y + cell.dy;
    const z = at.z + cell.dz;
    // `setBlock` refuses out-of-bounds writes and reports it, which is exactly
    // the clipping this wants — no bounds arithmetic of its own to get wrong.
    if (tx.setBlock(x, y, z, cell.entry)) {
      changed += 1;
    }
    if (cell.entity !== null && x >= 0 && y >= 0 && z >= 0 && x < doc.width && y < doc.height && z < doc.length) {
      tx.setBlockEntity(x, y, z, { ...cell.entity, pos: [x, y, z] });
    }
  }
  return changed;
}
