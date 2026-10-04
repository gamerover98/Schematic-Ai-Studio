/**
 * Terrain written into a document: a surface from a noise, in layers.
 *
 * `shared/terrain.ts` decides the surface -- the y of each column's top block
 * -- and which layer a cell of the column is. This walks a set of cells once,
 * sorts them into the four layers, and writes each layer the way a fill
 * writes a mix (`writeMix`): shares met exactly, a banner's design kept, one
 * transaction. So a hill of `70%grass_block,30%moss_block` over dirt over
 * `#perlin{...}stone,andesite` is three fills and one undo step.
 *
 * The mode decides which of the layers are written and over what:
 *
 * - `set` writes all four: ground under the surface, empty space above it,
 *   over every cell that does not already hold its layer's block;
 * - `raise` writes the ground only into cells that are empty now;
 * - `dig` writes empty space only over cells that are not.
 *
 * Empty space is the document's own (`voidBlock`), as a break writes it.
 */

import { DEFAULT_DISTRIBUTION, type Distribution } from "../../shared/block_mix.js";
import type { Box } from "../../shared/regions.js";
import { terrainLayer, type TerrainLayer, type TerrainMode } from "../../shared/terrain.js";
import type { BannerLayer } from "../pipeline/banner_nbt.js";
import { matchesBlockPattern, type PaletteEntry } from "../pipeline/types.js";
import type { SchematicDocument } from "./document.js";
import type { TransactionScope } from "./history.js";
import { writeMix, type CellSet } from "./mix.js";

/** One layer's mix, checked and parsed: what `writeMix` takes. */
export interface LayerMix {
  readonly distribution: Distribution;
  readonly shares: readonly number[];
  readonly written: readonly PaletteEntry[];
  readonly layers: readonly (readonly BannerLayer[] | null)[];
}

export interface TerrainLayers {
  readonly surface: LayerMix;
  readonly subsoil: LayerMix;
  readonly rock: LayerMix;
  /** Blocks of subsoil under the surface block. */
  readonly subsoilDepth: number;
}

const LAYER_ORDER: readonly TerrainLayer[] = ["above", "surface", "subsoil", "rock"];

/**
 * A list of cells, packed as voxel indices, walked in the order they were
 * found. That order is `CellSet`'s contract, and it holds because the list is
 * never reordered.
 */
function indexCellSet(doc: SchematicDocument, indices: Int32Array): CellSet {
  const plane = doc.height * doc.length;
  return {
    count: indices.length,
    forEach(visit) {
      for (let i = 0; i < indices.length; i += 1) {
        const index = indices[i];
        const x = Math.floor(index / plane);
        const rest = index - x * plane;
        const y = Math.floor(rest / doc.length);
        visit(x, y, rest - y * doc.length);
      }
    },
  };
}

/**
 * The surface over a box's footprint, each column asked once.
 *
 * A set of cells visits a column once per layer of it, and a fractal noise is
 * a few microseconds a sample -- eight million of those is seconds -- so the
 * heights are kept per column, computed the first time a column is asked for.
 */
export function columnTops(bounds: Box, top: (x: number, z: number) => number): (x: number, z: number) => number {
  const w = bounds.maxX - bounds.minX + 1;
  const l = bounds.maxZ - bounds.minZ + 1;
  const kept = new Int32Array(w * l);
  const known = new Uint8Array(w * l);
  return (x, z) => {
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return top(x, z);
    const i = (x - bounds.minX) * l + (z - bounds.minZ);
    if (known[i] === 0) {
      kept[i] = top(x, z);
      known[i] = 1;
    }
    return kept[i];
  };
}

/**
 * Writes a terrain into `area`, every cell of which is inside the document.
 *
 * `bounds` holds every cell of `area`; it is what the heights are kept over.
 * `isEmpty` is the session's emptiness -- air, or the empty space block -- and
 * `empty` is what empty space is written as.
 */
export function writeTerrain(
  doc: SchematicDocument,
  tx: TransactionScope,
  area: CellSet,
  bounds: Box,
  top: (x: number, z: number) => number,
  layers: TerrainLayers | null,
  mode: TerrainMode,
  isEmpty: (entry: PaletteEntry) => boolean,
  empty: PaletteEntry,
): number {
  const tops = columnTops(bounds, top);
  const depth = layers?.subsoilDepth ?? 0;
  const wanted: Readonly<Record<TerrainLayer, boolean>> = {
    above: mode !== "raise",
    surface: mode !== "dig" && layers !== null,
    subsoil: mode !== "dig" && layers !== null,
    rock: mode !== "dig" && layers !== null,
  };

  // Two walks rather than growing arrays: the first counts, the second fills
  // lists of exactly that size. Eight million cells in growable lists of
  // numbers is a few hundred megabytes; as packed indices it is thirty-two.
  const counts: Record<TerrainLayer, number> = { above: 0, surface: 0, subsoil: 0, rock: 0 };
  area.forEach((x, y, z) => {
    const layer = terrainLayer(y, tops(x, z), depth);
    if (wanted[layer]) counts[layer] += 1;
  });
  const lists: Record<TerrainLayer, Int32Array> = {
    above: new Int32Array(counts.above),
    surface: new Int32Array(counts.surface),
    subsoil: new Int32Array(counts.subsoil),
    rock: new Int32Array(counts.rock),
  };
  const filled: Record<TerrainLayer, number> = { above: 0, surface: 0, subsoil: 0, rock: 0 };
  const plane = doc.height * doc.length;
  area.forEach((x, y, z) => {
    const layer = terrainLayer(y, tops(x, z), depth);
    if (!wanted[layer]) return;
    lists[layer][filled[layer]++] = x * plane + y * doc.length + z;
  });

  let changed = 0;
  for (const layer of LAYER_ORDER) {
    const cells = lists[layer];
    if (cells.length === 0) continue;
    if (layer === "above") {
      // Only over what is there: writing empty space into empty space would
      // intern nothing and change nothing, and the filter says so up front.
      changed += writeMix(doc, tx, indexCellSet(doc, cells), DEFAULT_DISTRIBUTION, [1], [empty], [null], (entry) => !isEmpty(entry));
      continue;
    }
    const mix = layers![layer];
    /*
     * A cell already holding a block of its layer is left as it is, which is
     * what makes a second touch of the brush change nothing. Writing it again
     * would not be the same block: the neighbour rules give grass its `snowy`
     * and a log its connections after the write, so the bare spelling reads
     * as different from what is there, and every touch would rewrite every
     * surface it crossed -- and re-share a mix over a different set of cells,
     * so the rock would shimmer from stone to andesite under the crosshair.
     */
    const kept = (entry: PaletteEntry): boolean => mix.written.some((block) => matchesBlockPattern(entry, block));
    changed += writeMix(
      doc,
      tx,
      indexCellSet(doc, cells),
      mix.distribution,
      mix.shares,
      mix.written,
      mix.layers,
      mode === "raise" ? isEmpty : (entry) => !kept(entry),
    );
  }
  return changed;
}
