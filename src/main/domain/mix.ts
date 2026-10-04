/**
 * Which cell of an edit gets which block of a mix, with the shares met
 * **exactly**.
 *
 * Every cell is given a value by the distribution, the cells are ranked by it,
 * and the ranking is cut where the quotas say: the lowest 70% of the values are
 * stone, the rest andesite. So 70/30 over a thousand cells is 700 and 300,
 * which a per-cell threshold only approaches -- and it is the same answer
 * however lumpy the distribution is, which is what lets a noise that happens
 * to sit mostly above its midpoint still come out 70/30.
 *
 * Ranking eight million cells with a comparator sort is seconds. This is two
 * linear passes: the values are binned into a fine histogram, every bin that
 * lies wholly inside one entry's share of the ranking is decided by the bin
 * alone, and only the handful of cells in a bin a cut falls through are sorted.
 * Ties break on the cell's position in the walk, so the answer is a function
 * of the input and nothing else.
 */

import { cellValues, quotas, type Distribution } from "../../shared/block_mix.js";
import { forEachUnionCell, unionVolume, type Box } from "../../shared/regions.js";
import { forEachShapeCell, type ShapeCells } from "../../shared/shapes.js";
import type { BannerLayer } from "../pipeline/banner_nbt.js";
import { matchesBlockPattern, type PaletteEntry } from "../pipeline/types.js";
import { stampBanner } from "./banner_place.js";
import { voxelIndex, type SchematicDocument } from "./document.js";
import type { TransactionScope } from "./history.js";

const BINS = 65_536;

/**
 * For each value, the index of the share it falls in.
 *
 * `values` may hold any finite numbers; they are ranked, not read as
 * probabilities. At most 255 shares, which `MAX_MIX_ENTRIES` keeps well clear
 * of.
 */
export function assignByQuota(values: Float32Array | Float64Array, shares: readonly number[]): Uint8Array {
  const n = values.length;
  const out = new Uint8Array(n);
  if (n === 0 || shares.length <= 1) return out;

  const counts = quotas(shares, n);
  // The rank each entry's share ends at, exclusive.
  const ends: number[] = [];
  let running = 0;
  for (const count of counts) {
    running += count;
    ends.push(running);
  }
  const entryAtRank = (rank: number): number => {
    let entry = 0;
    while (entry < ends.length - 1 && rank >= ends[entry]) entry += 1;
    return entry;
  };

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const value = values[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min;
  const binOf = (value: number): number =>
    span <= 0 ? 0 : Math.min(BINS - 1, Math.floor(((value - min) / span) * BINS));

  const histogram = new Uint32Array(BINS);
  for (let i = 0; i < n; i += 1) histogram[binOf(values[i])] += 1;

  /*
   * Per bin: the entry every cell in it gets, or -1 when a cut falls inside it
   * and its cells have to be ranked one by one.
   */
  const decided = new Int16Array(BINS);
  const firstRank = new Uint32Array(BINS);
  let rank = 0;
  for (let bin = 0; bin < BINS; bin += 1) {
    firstRank[bin] = rank;
    const size = histogram[bin];
    if (size === 0) {
      decided[bin] = 0;
      continue;
    }
    const first = entryAtRank(rank);
    const last = entryAtRank(rank + size - 1);
    decided[bin] = first === last ? first : -1;
    rank += size;
  }

  const split = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const bin = binOf(values[i]);
    const entry = decided[bin];
    if (entry >= 0) {
      out[i] = entry;
    } else {
      let cells = split.get(bin);
      if (cells === undefined) {
        cells = [];
        split.set(bin, cells);
      }
      cells.push(i);
    }
  }
  for (const [bin, cells] of split) {
    cells.sort((a, b) => values[a] - values[b] || a - b);
    const start = firstRank[bin];
    cells.forEach((cell, offset) => {
      out[cell] = entryAtRank(start + offset);
    });
  }
  return out;
}

/**
 * A set of cells walked in a fixed order: the union of a selection's boxes,
 * or the cells of a shape (`shared/shapes.ts`).
 *
 * The order is the contract `writeMix` leans on -- it walks the set three
 * times and indexes each walk's answers by position in the next -- so a set
 * must visit the same cells in the same order every time it is asked.
 */
export interface CellSet {
  readonly count: number;
  forEach(visit: (x: number, y: number, z: number) => void): void;
}

/** The union of `regions`, overlaps once. */
export function regionCellSet(regions: readonly Box[]): CellSet {
  return { count: unionVolume(regions), forEach: (visit) => forEachUnionCell(regions, visit) };
}

/** The cells of a shape. */
export function shapeCellSet(cells: ShapeCells): CellSet {
  return { count: cells.count, forEach: (visit) => forEachShapeCell(cells, visit) };
}

/**
 * Which of the cells an edit may write, decided by what is in them.
 *
 * A list is `replace`'s `from`: patterns, a bare name the block in any state.
 * A function is anything else -- a shape drawn only into empty space, or only
 * over what is already there -- and is asked once per palette entry, like the
 * list.
 */
export type CellFilter = readonly PaletteEntry[] | ((entry: PaletteEntry) => boolean);

/**
 * Writes a mix into a set of cells -- the union of `regions`, or a shape --
 * or into the ones of them that `filter` takes.
 *
 * Three walks over the same cells in the same order, which is
 * `CellSet`'s contract: the first decides which cells are candidates
 * and gives each a value, `assignByQuota` shares them out exactly, and the
 * last writes. The candidates are decided **before** anything is written,
 * because afterwards a replaced cell is indistinguishable from one that
 * already held the block it was replaced with -- and the palette grows under
 * the writes, which `replaceAny` already knows about.
 *
 * A banner entry is stamped on every cell it was given, including one that
 * already held that state and so was not counted as changed: it was asked for
 * with this design.
 */
export function writeMix(
  doc: SchematicDocument,
  tx: TransactionScope,
  where: readonly Box[] | CellSet,
  distribution: Distribution,
  shares: readonly number[],
  written: readonly PaletteEntry[],
  layers: readonly (readonly BannerLayer[] | null)[],
  filter: CellFilter | null,
): number {
  const cells = isCellSet(where) ? where : regionCellSet(where);
  const forEachCell = (visit: (x: number, y: number, z: number) => void): void => cells.forEach(visit);
  /*
   * Decided once over the palette, read per cell -- `replaceAny`'s trade. A
   * miss interns nothing, so asking to replace a block the schematic does not
   * hold leaves no palette entry behind.
   */
  const takes =
    filter === null
      ? null
      : typeof filter === "function"
        ? filter
        : (entry: PaletteEntry): boolean => filter.some((pattern) => matchesBlockPattern(entry, pattern));
  const wanted = takes === null ? null : Uint8Array.from(doc.palette, (entry) => (takes(entry) ? 1 : 0));
  if (wanted !== null && !wanted.includes(1)) return 0;

  const total = cells.count;
  const candidate = wanted === null ? null : new Uint8Array(total);
  let candidates = total;
  if (wanted !== null && candidate !== null) {
    candidates = 0;
    let at = 0;
    forEachCell((x, y, z) => {
      if (wanted[doc.voxels[voxelIndex(doc, x, y, z)]] === 1) {
        candidate[at] = 1;
        candidates += 1;
      }
      at += 1;
    });
  }
  if (candidates === 0) return 0;

  let choice: Uint8Array;
  if (written.length === 1) {
    choice = new Uint8Array(candidates);
  } else {
    const valueAt = cellValues(distribution);
    const values = new Float32Array(candidates);
    let at = 0;
    let k = 0;
    forEachCell((x, y, z) => {
      if (candidate === null || candidate[at] === 1) {
        values[k] = valueAt(x, y, z);
        k += 1;
      }
      at += 1;
    });
    choice = assignByQuota(values, shares);
  }

  const banners = layers.map((own) => (own === null ? null : ([] as { x: number; y: number; z: number }[])));
  let changed = 0;
  let at = 0;
  let k = 0;
  forEachCell((x, y, z) => {
    if (candidate === null || candidate[at] === 1) {
      const entry = choice[k];
      if (tx.setBlock(x, y, z, written[entry])) changed += 1;
      banners[entry]?.push({ x, y, z });
      k += 1;
    }
    at += 1;
  });
  banners.forEach((cells, index) => {
    const own = layers[index];
    if (cells !== null && own !== null) stampBanner(doc, tx, cells, written[index], own);
  });
  return changed;
}

function isCellSet(where: readonly Box[] | CellSet): where is CellSet {
  return !Array.isArray(where);
}
