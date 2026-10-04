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
import { terrainLayer, type ErosionRule, type TerrainLayer, type TerrainMode } from "../../shared/terrain.js";
import type { BannerLayer } from "../pipeline/banner_nbt.js";
import { coversFace, occludesNeighbours } from "../pipeline/block_shapes.js";
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

/*
 * ---------------------------------------------------------------------------
 * Smoothing: WorldEdit's `//smooth`
 * ---------------------------------------------------------------------------
 *
 * `HeightMap`, `HeightMapFilter` and `GaussianKernel` from WorldEdit's
 * `math/convolution`, transcribed line for line and in Java's `float`
 * arithmetic (`Math.fround`), so a height that rounds one way there rounds the
 * same way here. `tests/session.ts` carries a separate port and requires the
 * same blocks.
 *
 * Three steps: a heightmap of the box -- per column, the highest cell that is
 * ground, else the box's floor -- filtered `iterations` times by a Gaussian of
 * radius 5 and sigma 1, then applied by *stretching* each column to its new
 * height rather than filling it: the top block is kept and moved, and every
 * cell below copies from the old column at the same proportion of its height.
 */

/** WorldEdit's `GaussianKernel(radius, sigma)`: a square, normalised to sum to one. */
export function gaussianKernel(radius: number, sigma: number): Float32Array {
  const diameter = radius * 2 + 1;
  const data = new Float32Array(diameter * diameter);
  const sigma22 = 2 * sigma * sigma;
  const constant = Math.PI * sigma22;
  let sum = 0;
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const value = Math.fround(Math.exp(-(x * x + y * y) / sigma22) / constant);
      data[(y + radius) * diameter + x + radius] = value;
      sum = Math.fround(sum + value);
    }
  }
  for (let i = 0; i < data.length; i += 1) data[i] = Math.fround(data[i] / sum);
  return data;
}

/** The kernel `//smooth` and the smooth brush use. */
const SMOOTH_KERNEL = gaussianKernel(5, 1.0);
const SMOOTH_KERNEL_SIZE = 11;

/**
 * `HeightMapFilter.filter` on whole heights: each column the kernel's
 * weighted sum of its neighbours plus a half, floored. A neighbour past the
 * edge of the map is read from the column itself, WorldEdit's own clamp.
 */
export function filterHeights(
  heights: Int32Array,
  width: number,
  length: number,
  kernel: Float32Array = SMOOTH_KERNEL,
  size: number = SMOOTH_KERNEL_SIZE,
): Int32Array {
  const floats = Float32Array.from(heights);
  const out = new Int32Array(heights.length);
  const origin = (size - 1) >> 1;
  let index = 0;
  for (let y = 0; y < length; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let z = 0;
      for (let ky = 0; ky < size; ky += 1) {
        let offsetY = y + ky - origin;
        if (offsetY < 0 || offsetY >= length) offsetY = y;
        offsetY *= width;
        const matrixOffset = ky * size;
        for (let kx = 0; kx < size; kx += 1) {
          const f = kernel[matrixOffset + kx];
          if (f === 0) continue;
          let offsetX = x + kx - origin;
          if (offsetX < 0 || offsetX >= width) offsetX = x;
          z = Math.fround(z + Math.fround(f * floats[offsetY + offsetX]));
        }
      }
      out[index++] = Math.floor(Math.fround(z + 0.5));
    }
  }
  return out;
}

/**
 * What a smoothing pass takes for ground: WorldEdit asks whether a block
 * blocks movement, and this app knows a block by the faces of its cell it
 * covers. So a block that fills its cell, or covers its floor or its ceiling
 * -- a slab, a staircase -- is ground; a flower, a torch or a fence standing on
 * the ground is not, and the ground under it is what is smoothed. Water and
 * lava are not, and neither is empty space whatever it is made of.
 */
export function groundFor(isEmpty: (entry: PaletteEntry) => boolean): (entry: PaletteEntry) => boolean {
  return (entry) =>
    !isEmpty(entry) &&
    !isLiquid(entry) &&
    (occludesNeighbours(entry) || coversFace(entry, "down") || coversFace(entry, "up"));
}

/** Water and lava: what WorldEdit's and VoxelSniper's `isLiquid` mean here. */
export function isLiquid(entry: PaletteEntry): boolean {
  const name = entry.namespacedName;
  return (
    name === "minecraft:water" ||
    name === "minecraft:lava" ||
    name === "minecraft:flowing_water" ||
    name === "minecraft:flowing_lava"
  );
}

/**
 * Smooths the ground inside `box`, which is inside the document, the way
 * `//smooth` smooths a cuboid selection.
 *
 * `isGround` is what the heightmap looks for: WorldEdit asks whether a block
 * blocks movement, and the caller decides what that is here. `columns`, when
 * given, says which columns are written -- the heightmap is always the whole
 * box, so a disc-shaped brush reads its square and writes its disc.
 */
export function smoothHeights(
  doc: SchematicDocument,
  tx: TransactionScope,
  box: Box,
  iterations: number,
  isGround: (entry: PaletteEntry) => boolean,
  empty: PaletteEntry,
  columns: ((x: number, z: number) => boolean) | null = null,
): number {
  const width = box.maxX - box.minX + 1;
  const length = box.maxZ - box.minZ + 1;
  const originY = box.minY;
  const maxY = box.maxY;
  const ground = Uint8Array.from(doc.palette, (entry) => (isGround(entry) ? 1 : 0));
  const plane = doc.height * doc.length;
  const indexAt = (x: number, y: number, z: number): number => doc.voxels[x * plane + y * doc.length + z];

  // The heightmap: `getHighestTerrainBlock`, from the top down, else the floor.
  const data = new Int32Array(width * length);
  for (let z = 0; z < length; z += 1) {
    for (let x = 0; x < width; x += 1) {
      let found = originY;
      for (let y = maxY; y >= originY; y -= 1) {
        if (ground[indexAt(x + box.minX, y, z + box.minZ)] === 1) {
          found = y;
          break;
        }
      }
      data[z * width + x] = found;
    }
  }
  let next: Int32Array = data;
  for (let i = 0; i < iterations; i += 1) next = filterHeights(next, width, length);

  let changed = 0;
  const column = new Int32Array(maxY - originY + 1);
  const set = (x: number, y: number, z: number, entry: PaletteEntry): void => {
    if (tx.setBlock(x, y, z, entry)) changed += 1;
  };
  for (let z = 0; z < length; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const xr = x + box.minX;
      const zr = z + box.minZ;
      if (columns !== null && !columns(xr, zr)) continue;
      const index = z * width + x;
      const curHeight = data[index];
      const newHeight = Math.min(maxY, next[index]);
      if (newHeight === curHeight) continue;
      // The column as it was: every read below is of the old column, which is
      // also what WorldEdit's loop order reads, top down growing and bottom up
      // shrinking.
      for (let y = originY; y <= maxY; y += 1) column[y - originY] = indexAt(xr, y, zr);
      const old = (y: number): PaletteEntry => doc.palette[column[y - originY]];
      const scale = (curHeight - originY) / (newHeight - originY);
      if (newHeight > curHeight) {
        const existing = old(curHeight);
        if (isLiquid(existing)) continue;
        set(xr, newHeight, zr, existing);
        for (let y = newHeight - 1 - originY; y >= 0; y -= 1) {
          set(xr, originY + y, zr, old(originY + Math.floor(y * scale)));
        }
      } else {
        for (let y = 0; y < newHeight - originY; y += 1) {
          set(xr, originY + y, zr, old(originY + Math.floor(y * scale)));
        }
        set(xr, newHeight, zr, old(curHeight));
        for (let y = newHeight + 1; y <= curHeight; y += 1) set(xr, y, zr, empty);
      }
    }
  }
  return changed;
}

/*
 * ---------------------------------------------------------------------------
 * Erosion: VoxelSniper's erode brush
 * ---------------------------------------------------------------------------
 *
 * `ErodeBrush` from VoxelSniper-Reimagined. Each pass reads the state the
 * pass before it left and writes a new one (its `BlockChangeTracker`), so the
 * order cells are visited in decides nothing. A cell is *open* when it is
 * empty or a liquid; erosion opens a solid cell with enough open neighbours,
 * the fill closes an open one with enough solid neighbours, taking the
 * commonest of them.
 *
 * The commonest is counted by the whole block, state and all, which is
 * FastAsyncVoxelSniper's copy; VoxelSniper-Reimagined counts by material and
 * writes its default state, which would stand every log it copies upright.
 * A tie goes to the last of the tied blocks in the order they were first met
 * (+z, -z, +y, -y, +x, -x) -- the Java walks a `HashMap`, whose order is no
 * order at all, so any fixed choice is as faithful as another.
 */
export function erodeCells(
  doc: SchematicDocument,
  tx: TransactionScope,
  bounds: Box,
  inside: (x: number, y: number, z: number) => boolean,
  rule: ErosionRule,
  isOpen: (entry: PaletteEntry) => boolean,
  empty: PaletteEntry,
): number {
  // A working copy of the bounds and a block round them, which is what a
  // cell at the edge reads. Outside the document is open: there is nothing.
  const W = bounds.maxX - bounds.minX + 3;
  const H = bounds.maxY - bounds.minY + 3;
  const L = bounds.maxZ - bounds.minZ + 3;
  const HL = H * L;
  const OPEN = -1;
  let cur = new Int32Array(W * HL);
  const plane = doc.height * doc.length;
  for (let i = 0; i < W; i += 1) {
    const x = bounds.minX - 1 + i;
    for (let j = 0; j < H; j += 1) {
      const y = bounds.minY - 1 + j;
      for (let k = 0; k < L; k += 1) {
        const z = bounds.minZ - 1 + k;
        const inDoc = x >= 0 && y >= 0 && z >= 0 && x < doc.width && y < doc.height && z < doc.length;
        cur[i * HL + j * L + k] = inDoc ? doc.voxels[x * plane + y * doc.length + z] : OPEN;
      }
    }
  }
  const original = cur.slice();
  const open = Uint8Array.from(doc.palette, (entry) => (isOpen(entry) ? 1 : 0));
  const isOpenAt = (value: number): boolean => value === OPEN || open[value] === 1;

  // The cells the brush acts on, as indices into the working copy.
  const cells: number[] = [];
  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
      for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
        if (inside(x, y, z)) cells.push((x - bounds.minX + 1) * HL + (y - bounds.minY + 1) * L + (z - bounds.minZ + 1));
      }
    }
  }
  const FACES = [1, -1, L, -L, HL, -HL];

  for (let pass = 0; pass < rule.erosionRecursion; pass += 1) {
    const next = cur.slice();
    for (const cell of cells) {
      if (isOpenAt(cur[cell])) continue;
      let count = 0;
      for (const face of FACES) if (isOpenAt(cur[cell + face])) count += 1;
      if (count >= rule.erosionFaces) next[cell] = OPEN;
    }
    cur = next;
  }
  const kinds: number[] = [];
  const tally: number[] = [];
  for (let pass = 0; pass < rule.fillRecursion; pass += 1) {
    const next = cur.slice();
    for (const cell of cells) {
      if (!isOpenAt(cur[cell])) continue;
      let count = 0;
      kinds.length = 0;
      tally.length = 0;
      for (const face of FACES) {
        const value = cur[cell + face];
        if (isOpenAt(value)) continue;
        count += 1;
        const seen = kinds.indexOf(value);
        if (seen === -1) {
          kinds.push(value);
          tally.push(1);
        } else {
          tally[seen] += 1;
        }
      }
      let chosen = OPEN;
      let amount = 0;
      for (let i = 0; i < kinds.length; i += 1) {
        if (amount <= tally[i]) {
          chosen = kinds[i];
          amount = tally[i];
        }
      }
      if (count >= rule.fillFaces) next[cell] = chosen;
    }
    cur = next;
  }

  let changed = 0;
  for (const cell of cells) {
    if (cur[cell] === original[cell]) continue;
    const i = Math.floor(cell / HL);
    const j = Math.floor((cell - i * HL) / L);
    const k = cell - i * HL - j * L;
    const entry = cur[cell] === OPEN ? empty : doc.palette[cur[cell]];
    if (tx.setBlock(bounds.minX - 1 + i, bounds.minY - 1 + j, bounds.minZ - 1 + k, entry)) changed += 1;
  }
  return changed;
}
