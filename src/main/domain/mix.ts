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

import { quotas } from "../../shared/block_mix.js";

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
