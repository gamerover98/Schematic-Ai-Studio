/**
 * Several boxes treated as one set of cells.
 *
 * A selection may be more than one box, and the boxes may overlap. Every
 * operation on them means the **union**: a cell inside two boxes is filled,
 * counted and copied once. Writing that rule at each call site is how one of
 * them comes to count the overlap twice, so it is here, once.
 *
 * In `shared/` because both halves ask: main to edit the cells, the renderer to
 * say how many there are.
 *
 * The boxes are inclusive on both corners and assumed ordered (`min <= max`);
 * `orderBox` is there for a caller that cannot promise it.
 */

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/**
 * How many boxes one request may name.
 *
 * Not a design limit: `unionVolume` compresses coordinates, which is `(2n)^3`
 * cells to visit, and at this many that is two million -- a few milliseconds.
 * Ten times as many would be two billion.
 */
export const MAX_BOXES = 64;

export function orderBox(box: Box): Box {
  return {
    minX: Math.min(box.minX, box.maxX),
    minY: Math.min(box.minY, box.maxY),
    minZ: Math.min(box.minZ, box.maxZ),
    maxX: Math.max(box.minX, box.maxX),
    maxY: Math.max(box.minY, box.maxY),
    maxZ: Math.max(box.minZ, box.maxZ),
  };
}

export function boxVolume(box: Box): number {
  return (box.maxX - box.minX + 1) * (box.maxY - box.minY + 1) * (box.maxZ - box.minZ + 1);
}

export function boxContains(box: Box, x: number, y: number, z: number): boolean {
  return (
    x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && z >= box.minZ && z <= box.maxZ
  );
}

/** The smallest box holding every one of `boxes`. `null` for none. */
export function unionBounds(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const out = { ...boxes[0] };
  for (const box of boxes) {
    out.minX = Math.min(out.minX, box.minX);
    out.minY = Math.min(out.minY, box.minY);
    out.minZ = Math.min(out.minZ, box.minZ);
    out.maxX = Math.max(out.maxX, box.maxX);
    out.maxY = Math.max(out.maxY, box.maxY);
    out.maxZ = Math.max(out.maxZ, box.maxZ);
  }
  return out;
}

/**
 * How many distinct cells the boxes cover, overlaps counted once.
 *
 * Exact, by coordinate compression: every face of every box cuts each axis, the
 * slabs between the cuts are either wholly inside a box or wholly outside it,
 * and their volumes add up. Summing `boxVolume` would count a cell in two
 * boxes twice, which is precisely what a selection of overlapping areas has.
 */
export function unionVolume(boxes: readonly Box[]): number {
  if (boxes.length === 0) return 0;
  if (boxes.length === 1) return boxVolume(boxes[0]);
  const cuts = (lo: (b: Box) => number, hi: (b: Box) => number): number[] =>
    [...new Set(boxes.flatMap((b) => [lo(b), hi(b) + 1]))].sort((a, b) => a - b);
  const xs = cuts((b) => b.minX, (b) => b.maxX);
  const ys = cuts((b) => b.minY, (b) => b.maxY);
  const zs = cuts((b) => b.minZ, (b) => b.maxZ);
  let total = 0;
  for (let i = 0; i + 1 < xs.length; i += 1) {
    for (let j = 0; j + 1 < ys.length; j += 1) {
      for (let k = 0; k + 1 < zs.length; k += 1) {
        const x = xs[i];
        const y = ys[j];
        const z = zs[k];
        if (boxes.some((box) => boxContains(box, x, y, z))) {
          total += (xs[i + 1] - x) * (ys[j + 1] - y) * (zs[k + 1] - z);
        }
      }
    }
  }
  return total;
}

/**
 * Every cell of the union, once each, in a fixed order.
 *
 * Box by box, x then y then z inside each, and a cell an earlier box already
 * covered is skipped. The order is part of the contract: callers walk it twice
 * -- once to decide, once to write -- and index the first walk's answers by
 * position in the second.
 *
 * No bitmap over the bounding box, which is the obvious way to deduplicate and
 * the wrong one here: two small areas far apart have a bounding box of
 * hundreds of millions of cells.
 */
export function forEachUnionCell(
  boxes: readonly Box[],
  visit: (x: number, y: number, z: number) => void,
): void {
  for (let b = 0; b < boxes.length; b += 1) {
    const box = boxes[b];
    for (let x = box.minX; x <= box.maxX; x += 1) {
      for (let y = box.minY; y <= box.maxY; y += 1) {
        for (let z = box.minZ; z <= box.maxZ; z += 1) {
          let seen = false;
          for (let e = 0; e < b; e += 1) {
            if (boxContains(boxes[e], x, y, z)) {
              seen = true;
              break;
            }
          }
          if (!seen) visit(x, y, z);
        }
      }
    }
  }
}
