/**
 * What a set of cells is made of, with a block of two cells counted once.
 *
 * The materials list said a bed was two beds. That is true of the file -- a
 * foot and a head, two palette entries, two cells -- and false of the build,
 * and the list is read as a statement about the build: "how many beds are in
 * this house". The same for a door, a sunflower, an extended piston and its
 * head.
 *
 * So a far half (`nearOf` in `shared/two_part.ts`) is not counted when the
 * near half it belongs with is one step back, is the same block, and is
 * inside the cells being counted. The near half's entry carries the far one
 * as `pair`, so a replace or a highlight of the slot reaches both cells.
 *
 * **Inside the cells being counted** is the half that is easy to leave out. A
 * selection that holds a bed's head and not its foot holds half a bed, and
 * saying "one red bed, foot" about it would offer a replace that finds
 * nothing in the box. A far half whose partner is outside, or missing, or a
 * different block, is counted as what it is.
 *
 * ## What it costs
 *
 * Whether an entry is a far half is decided once per palette entry, so a cell
 * that is not one costs a read of a byte -- and with no far half anywhere in
 * the document the whole-document count is the counts the document already
 * keeps, with no walk at all. That is the ordinary case, and it is why the
 * whole document is not counted by walking its box: on a 256x96x256 that walk
 * is 52 ms, asked for on every edit.
 */

import type { PaletteCount } from "../../shared/ipc.js";
import { boxContains, forEachUnionCell, type Box } from "../../shared/regions.js";
import { nearKey, nearOf } from "../../shared/two_part.js";
import { paletteEntryCacheKey } from "../pipeline/types.js";
import type { SchematicDocument } from "./document.js";

export interface MaterialTally {
  /** Most common first, air left out: `DocumentState.palette`'s rule. */
  palette: PaletteCount[];
  air: number;
  /** Cells of the document that were counted. */
  walked: number;
}

/**
 * Counts the union of `boxes`, each assumed already cut to the document, or
 * the whole document when `boxes` is `null`.
 */
export function countMaterials(doc: SchematicDocument, boxes: readonly Box[] | null): MaterialTally {
  const entries = doc.palette;
  const isFar = new Uint8Array(entries.length);
  const farStep: (readonly [number, number, number])[] = [];
  const farKey: string[] = [];
  const nearKeys: (string | null)[] = entries.map((entry) => nearKey(entry));
  let anyFar = false;
  entries.forEach((entry, index) => {
    const near = nearOf(entry);
    if (near === null) return;
    isFar[index] = 1;
    farStep[index] = near.step;
    farKey[index] = near.key;
    anyFar = true;
  });

  const { width, height, length, voxels } = doc;
  const plane = height * length;
  /** `near` index -> `far` index -> how many of those pairs were absorbed. */
  const pairs = new Map<number, Map<number, number>>();
  let counts: Int32Array;
  let walked: number;

  /**
   * The far half at `x/y/z`, counted with its near half if that is where it
   * should be. `within` is the question "is that cell being counted".
   */
  const absorbed = (
    index: number,
    x: number,
    y: number,
    z: number,
    within: (x: number, y: number, z: number) => boolean,
  ): boolean => {
    const step = farStep[index];
    const nx = x + step[0];
    const ny = y + step[1];
    const nz = z + step[2];
    if (nx < 0 || ny < 0 || nz < 0 || nx >= width || ny >= height || nz >= length) return false;
    if (!within(nx, ny, nz)) return false;
    const near = voxels[nx * plane + ny * length + nz];
    if (nearKeys[near] !== farKey[index]) return false;
    let byFar = pairs.get(near);
    if (byFar === undefined) pairs.set(near, (byFar = new Map()));
    byFar.set(index, (byFar.get(index) ?? 0) + 1);
    return true;
  };

  if (boxes === null) {
    counts = Int32Array.from(doc.counts);
    walked = voxels.length;
    const present = anyFar && entries.some((_, index) => isFar[index] === 1 && (doc.counts[index] ?? 0) > 0);
    if (present) {
      const everywhere = (): boolean => true;
      for (let at = 0; at < voxels.length; at += 1) {
        const index = voxels[at];
        if (isFar[index] !== 1) continue;
        const x = Math.floor(at / plane);
        const rest = at - x * plane;
        const y = Math.floor(rest / length);
        const z = rest - y * length;
        if (absorbed(index, x, y, z, everywhere)) counts[index] -= 1;
      }
    }
  } else {
    counts = new Int32Array(entries.length);
    walked = 0;
    const inUnion = (x: number, y: number, z: number): boolean => boxes.some((box) => boxContains(box, x, y, z));
    forEachUnionCell(boxes, (x, y, z) => {
      const index = voxels[x * plane + y * length + z];
      walked += 1;
      if (index < 0 || index >= counts.length) return;
      if (isFar[index] === 1 && absorbed(index, x, y, z, inUnion)) return;
      counts[index] += 1;
    });
  }

  const histogram = new Map<string, number>();
  const pairKeys = new Map<string, Set<string>>();
  entries.forEach((entry, index) => {
    if ((counts[index] ?? 0) <= 0) return;
    const key = paletteEntryCacheKey(entry);
    histogram.set(key, (histogram.get(key) ?? 0) + counts[index]);
    const byFar = pairs.get(index);
    if (byFar === undefined) return;
    let keys = pairKeys.get(key);
    if (keys === undefined) pairKeys.set(key, (keys = new Set()));
    for (const far of byFar.keys()) keys.add(paletteEntryCacheKey(entries[far]));
  });

  let air = 0;
  for (const [key, count] of histogram) if (key.startsWith("minecraft:air")) air += count;
  return { palette: listMaterials(histogram, pairKeys), air, walked };
}

/**
 * Every block in a histogram, most common first, air left out.
 *
 * It was capped at 64, silently, while the panel showing it capped at 8 and
 * said "…and N more" -- so past 64 distinct states that sentence *understated*
 * the palette, which is worse than either cap alone. A schematic's materials
 * list is one of the few things worth being complete: it is how you find the
 * one stray block you did not mean to place.
 */
export function listMaterials(
  histogram: ReadonlyMap<string, number>,
  pairs: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): PaletteCount[] {
  return [...histogram.entries()]
    .filter(([block]) => !block.startsWith("minecraft:air"))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([block, count]) => {
      const pair = pairs.get(block);
      return pair === undefined || pair.size === 0 ? { block, count } : { block, count, pair: [...pair].sort() };
    });
}
