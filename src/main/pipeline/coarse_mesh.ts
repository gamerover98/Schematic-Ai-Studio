/**
 * The far distance: a region of the document drawn as blocks two and four
 * times the size.
 *
 * Past a few hundred blocks a block is a pixel or two across, and drawing each
 * of its faces costs what it costs up close. So every 64-block region of the
 * document -- four chunks a side -- gets two more meshes beside its chunks:
 * `lod2`, cut into cells two blocks wide, and `lod3`, four. The viewport shows
 * one of them in place of the region's sixty-four chunk meshes once the camera
 * is far enough that the difference is under the quality setting's threshold
 * (`renderer/lib/lod.ts`). One mesh for the whole region is also sixty-four
 * times fewer draw calls, which at that distance is most of the cost.
 *
 * ## A coarse cell is full when its blocks fill a quarter of its face
 *
 * Each palette entry weighs what its shape fills of the cell, four times over
 * and capped at one: a full cube or a slab weighs one, a glass pane a half, a
 * carpet a quarter, a flower nothing. A cell two blocks wide is full at a
 * weight of one -- any whole block in it -- and a cell four wide at four,
 * which is a quarter of a slab of its face.
 *
 * "Any block" at both sizes is the rule that opens no holes, and at four it
 * turns a lone block into a cube four blocks across. A quarter of the face
 * keeps every wall, floor and roof one block thick, and lets a lone post or a
 * field of flowers go, which at the distance a four-block cell is drawn from
 * is what a pixel does with them anyway.
 *
 * ## Each face wears the block it shows
 *
 * A coarse cell is drawn as a cube, and each of its six faces takes the block
 * most of the *outermost occupied layer* on that side: the top of a cell of
 * grass over dirt is grass, its sides are the grass block's sides, and the
 * ground does not turn brown from a distance because dirt outnumbers grass
 * inside the cell. Where a face is hidden is decided the way the mesher
 * decides it: by an opaque face next to it, or by the same see-through block.
 *
 * ## Each face is as bright as the faces it stands for
 *
 * The open cells in the layer just outside the face, averaged, sky and block
 * apart -- and the corner occlusion the blocks behind them would have had, by
 * the mesher's own formula, averaged too. Flat across the face, because a
 * coarse face is a few pixels; matched in the mean, because a level that is
 * brighter or darker than the one it replaces is seen at any distance, and no
 * pixel threshold hides it. The sky half still dims with the hour in the
 * shader.
 *
 * The void is the chunks' alone and is never drawn here: a coarse cell of it
 * would be a cube of water four blocks across over every gap in the build.
 */

import { occludesNeighbours, placedExtent, shapeFor } from "./block_shapes.js";
import type { LightGrid } from "./lighting.js";
import { cornerOcclusion, MAX_LIGHT, OCCLUSION_LEVELS } from "./lighting.js";
import type { BakedBlock, ModelBaker } from "./model_baker.js";
import type { BakedFace, MeshBuffers, PaletteEntry, StructureData, UVRect } from "./types.js";
import { paletteEntryIsAir } from "./types.js";

/**
 * How many chunks a region is along one side.
 *
 * A number rather than `REGION_SIZE / CHUNK_SIZE`: `chunked_mesh.ts` imports
 * this module, and reading its constant back at load time would be a cycle.
 * `tests/chunks.ts` holds the two to each other.
 */
export const REGION_CHUNKS = 4;

/** A region's side in blocks. */
export const REGION_SIZE = REGION_CHUNKS * 16;

/** The two coarse levels: a cell two blocks wide (`lod2`) and four (`lod3`). */
export const COARSE_FACTORS = [2, 4] as const;

/**
 * How far each coarse level may differ from the blocks, in blocks: what the
 * viewer turns into pixels to decide where it may be shown.
 *
 * The cell's whole width, and not only how far its surface strays -- that
 * would be `factor - 1`, and it was, and it was measured to be wrong. A cell
 * is one cube wearing one texture in place of eight or sixty-four blocks, so
 * what it looks like can differ anywhere inside it: on rolling grass at a
 * block and a half per pixel, level 2 at "one block" came out greener than
 * the ground, the dirt on the sides of every step gone, in a third of the
 * pixels -- a change anybody would see. At the cell's width a coarse cell is
 * shown only once it is a pixel or two across, where the eye sees colour and
 * nothing finer.
 */
export const COARSE_ERROR = { lod2: 2, lod3: 4 } as const;

/** Direction slots, in this order everywhere below. */
const DIRECTION_NAMES = ["north", "south", "east", "west", "up", "down"] as const;
const STEP: readonly (readonly [number, number, number])[] = [
  [0, 0, -1],
  [0, 0, 1],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
];
const OPPOSITE = [1, 0, 3, 2, 5, 4] as const;

/** One face a coarse cell can wear: the texture and the four UVs it is read with. */
export interface CoarseFace {
  readonly textureKey: string;
  /** Tile-relative, in `boxFaceGeometry`'s corner order for this direction. */
  readonly uvs: Float32Array;
  readonly translucent: boolean;
  /** Whether the face hides a coarse neighbour's face against it. */
  readonly opaque: boolean;
}

/** What one palette entry contributes to a coarse cell. */
export interface CoarseEntry {
  /** What its shape fills of the cell, four times over, capped at one. */
  readonly weight: number;
  /** The face it shows on each side, by direction slot; `null` for none. */
  readonly faces: readonly (CoarseFace | null)[];
}

const NOTHING: CoarseEntry = { weight: 0, faces: [null, null, null, null, null, null] };

/** The area of a quad, from its first three corners: it is a parallelogram. */
function faceArea(face: BakedFace): number {
  const p = face.positions;
  const ax = p[3] - p[0];
  const ay = p[4] - p[1];
  const az = p[5] - p[2];
  const bx = p[9] - p[0];
  const by = p[10] - p[1];
  const bz = p[11] - p[2];
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/**
 * The face of a baked block that stands for one side of it: the side itself
 * for a full cube, and otherwise the largest face that looks that way -- or,
 * for a shape with nothing facing that way at all, its largest face.
 */
function sideOf(baked: BakedBlock, slot: number): BakedFace | null {
  if (baked.isFullCube) return baked.faces[DIRECTION_NAMES[slot]] ?? null;
  const [dx, dy, dz] = STEP[slot];
  let best: BakedFace | null = null;
  let bestArea = 0;
  let any: BakedFace | null = null;
  let anyArea = 0;
  for (const face of baked.extraFaces) {
    const area = faceArea(face);
    if (area > anyArea) {
      any = face;
      anyArea = area;
    }
    const along = face.normal[0] * dx + face.normal[1] * dy + face.normal[2] * dz;
    if (along > 0.7 && area > bestArea) {
      best = face;
      bestArea = area;
    }
  }
  return best ?? any;
}

/** How much of a cell a shape fills, four times over and capped at one. */
function weightOf(entry: PaletteEntry): number {
  const shape = shapeFor(entry);
  if (shape.kind === "cube") return 1;
  if (shape.kind === "cross") return 0;
  let filled = 0;
  for (const part of shape.boxes) {
    const [x0, y0, z0, x1, y1, z1] = placedExtent(part);
    filled += Math.max(0, x1 - x0) * Math.max(0, y1 - y0) * Math.max(0, z1 - z0);
  }
  return Math.min(1, (4 * filled) / 4096);
}

/**
 * What every palette entry contributes, worked out once per build.
 *
 * `voidIndices` weigh nothing: the void is drawn by the chunks at every
 * distance, and a cell of it is empty space as far as the build goes.
 */
export async function coarseEntries(
  struct: StructureData,
  baker: ModelBaker,
  voidIndices: ReadonlySet<number> | null,
): Promise<CoarseEntry[]> {
  const out: CoarseEntry[] = [];
  for (let index = 0; index < struct.palette.length; index += 1) {
    const entry = struct.palette[index];
    if (paletteEntryIsAir(entry) || voidIndices?.has(index) === true) {
      out.push(NOTHING);
      continue;
    }
    const weight = weightOf(entry);
    if (weight === 0) {
      out.push(NOTHING);
      continue;
    }
    const baked = await baker.bakeBlockstate(entry);
    const faces: (CoarseFace | null)[] = [];
    for (let slot = 0; slot < 6; slot += 1) {
      const side = sideOf(baked, slot);
      faces.push(
        side === null
          ? null
          : {
              textureKey: side.textureKey,
              uvs: side.uvs,
              translucent: baker.isTextureTranslucent(side.textureKey),
              opaque: baker.isTextureOpaque(side.textureKey),
            },
      );
    }
    out.push({ weight, faces });
  }
  return out;
}

/**
 * The cells around a region, read out of the document once.
 *
 * Four blocks of margin on every side, because a four-block cell at the
 * region's edge is hidden or not by the cell across the edge. Out of the box
 * is `-1`, which every lookup below reads as empty.
 */
interface Neighbourhood {
  /** Palette indices, `-1` outside the document; x-major like the document. */
  readonly cells: Int32Array;
  /** Side of the cube `cells` covers, in blocks. */
  readonly side: number;
  /** Content coordinates of `cells[0]`. */
  readonly origin: readonly [number, number, number];
}

const MARGIN = 4;

function neighbourhood(
  struct: StructureData,
  frame: readonly [number, number, number],
  region: readonly [number, number, number],
): Neighbourhood {
  const width = struct.bounds.maxX - struct.bounds.minX + 1;
  const height = struct.bounds.maxY - struct.bounds.minY + 1;
  const length = struct.bounds.maxZ - struct.bounds.minZ + 1;
  const plane = height * length;
  const side = REGION_SIZE + 2 * MARGIN;
  const origin: [number, number, number] = [
    region[0] * REGION_SIZE - MARGIN,
    region[1] * REGION_SIZE - MARGIN,
    region[2] * REGION_SIZE - MARGIN,
  ];
  const cells = new Int32Array(side * side * side).fill(-1);
  // The document cells this cube reaches, as a z-run per (x, y): one `set`
  // each rather than a lookup per cell.
  const z0 = Math.max(0, origin[2] + frame[2]);
  const z1 = Math.min(length, origin[2] + frame[2] + side);
  if (z1 <= z0) return { cells, side, origin };
  for (let i = 0; i < side; i += 1) {
    const x = origin[0] + i + frame[0];
    if (x < 0 || x >= width) continue;
    for (let j = 0; j < side; j += 1) {
      const y = origin[1] + j + frame[1];
      if (y < 0 || y >= height) continue;
      const from = x * plane + y * length;
      const at = (i * side + j) * side + (z0 - origin[2] - frame[2]);
      cells.set(struct.voxels.subarray(from + z0, from + z1), at);
    }
  }
  return { cells, side, origin };
}

/**
 * One coarse level of one region, with a cell of margin all round.
 *
 * `dominant` is the entry with the most weight in the cell, `reps` the entry
 * each face wears (slot-major: `reps[slot * count + cell]`), `-1` for none.
 */
interface CoarseGrid {
  readonly factor: number;
  /** Cells along one side, margin included. */
  readonly side: number;
  /** Content coordinates of cell 0's corner, in blocks. */
  readonly origin: readonly [number, number, number];
  readonly weight: Float32Array;
  readonly dominant: Int32Array;
  readonly reps: Int32Array;
}

/** The entry with the most weight among `n` candidates, ties to the first seen. */
function heaviest(
  indices: ArrayLike<number>,
  weights: ArrayLike<number>,
  n: number,
): number {
  let best = -1;
  let bestWeight = 0;
  for (let i = 0; i < n; i += 1) {
    const candidate = indices[i];
    if (candidate < 0 || weights[i] <= 0) continue;
    let sum = 0;
    for (let j = 0; j < n; j += 1) {
      if (indices[j] === candidate) sum += weights[j];
    }
    if (sum > bestWeight) {
      best = candidate;
      bestWeight = sum;
    }
  }
  return best;
}

/**
 * The two-block grid, from the blocks: two cells of margin, so the four-block
 * grid built from it has one.
 */
function fineToCoarse(around: Neighbourhood, entries: readonly CoarseEntry[]): CoarseGrid {
  const factor = 2;
  const side = around.side / factor;
  const count = side * side * side;
  const weight = new Float32Array(count);
  const dominant = new Int32Array(count).fill(-1);
  const reps = new Int32Array(count * 6).fill(-1);
  const blocks = around.side;
  const ids = new Int32Array(8);
  const masses = new Float32Array(8);
  const layerIds = new Int32Array(4);
  const layerMasses = new Float32Array(4);
  for (let i = 0; i < side; i += 1) {
    for (let j = 0; j < side; j += 1) {
      for (let k = 0; k < side; k += 1) {
        // The eight blocks, bit 2 = x, bit 1 = y, bit 0 = z.
        let total = 0;
        let uniform = true;
        for (let corner = 0; corner < 8; corner += 1) {
          const x = i * 2 + (corner >> 2);
          const y = j * 2 + ((corner >> 1) & 1);
          const z = k * 2 + (corner & 1);
          const id = around.cells[(x * blocks + y) * blocks + z];
          ids[corner] = id;
          const mass = id < 0 ? 0 : (entries[id]?.weight ?? 0);
          masses[corner] = mass;
          total += mass;
          if (id !== ids[0]) uniform = false;
        }
        const cell = (i * side + j) * side + k;
        weight[cell] = total;
        if (total <= 0) continue;
        if (uniform) {
          dominant[cell] = ids[0];
          for (let slot = 0; slot < 6; slot += 1) reps[slot * count + cell] = ids[0];
          continue;
        }
        dominant[cell] = heaviest(ids, masses, 8);
        for (let slot = 0; slot < 6; slot += 1) {
          // The layer of four on that side first, then the one behind it.
          const axisBit = AXIS_BIT[slot];
          for (let pass = 0; pass < 2; pass += 1) {
            const take = OUTWARD[slot] ? 1 - pass : pass;
            let n = 0;
            for (let corner = 0; corner < 8; corner += 1) {
              if (((corner & axisBit) !== 0 ? 1 : 0) !== take) continue;
              layerIds[n] = ids[corner];
              layerMasses[n] = masses[corner];
              n += 1;
            }
            const pick = heaviest(layerIds, layerMasses, 4);
            if (pick >= 0) {
              reps[slot * count + cell] = pick;
              break;
            }
          }
        }
      }
    }
  }
  return {
    factor,
    side,
    origin: around.origin,
    weight,
    dominant,
    reps,
  };
}

/**
 * For each direction slot, the bit of a corner index (bit 2 = x, bit 1 = y,
 * bit 0 = z) that says which layer of the cell it is in, and whether that
 * direction looks towards the layer with the bit set.
 */
const AXIS_BIT = [1, 1, 4, 4, 2, 2] as const;
const OUTWARD = [false, true, true, false, true, false] as const;

/**
 * The four-block grid, from the two-block one: each cell is eight of those,
 * one cell of margin all round.
 */
function halve(grid: CoarseGrid): CoarseGrid {
  const side = grid.side / 2;
  const count = side * side * side;
  const below = grid.side;
  const belowCount = below * below * below;
  const weight = new Float32Array(count);
  const dominant = new Int32Array(count).fill(-1);
  const reps = new Int32Array(count * 6).fill(-1);
  const ids = new Int32Array(8);
  const masses = new Float32Array(8);
  const layerIds = new Int32Array(4);
  const layerMasses = new Float32Array(4);
  const subcells = new Int32Array(8);
  for (let i = 0; i < side; i += 1) {
    for (let j = 0; j < side; j += 1) {
      for (let k = 0; k < side; k += 1) {
        let total = 0;
        for (let corner = 0; corner < 8; corner += 1) {
          const sub =
            ((i * 2 + (corner >> 2)) * below + (j * 2 + ((corner >> 1) & 1))) * below +
            (k * 2 + (corner & 1));
          subcells[corner] = sub;
          ids[corner] = grid.dominant[sub];
          masses[corner] = grid.weight[sub];
          total += grid.weight[sub];
        }
        const cell = (i * side + j) * side + k;
        weight[cell] = total;
        if (total <= 0) continue;
        dominant[cell] = heaviest(ids, masses, 8);
        for (let slot = 0; slot < 6; slot += 1) {
          const axisBit = AXIS_BIT[slot];
          for (let pass = 0; pass < 2; pass += 1) {
            const take = OUTWARD[slot] ? 1 - pass : pass;
            let n = 0;
            for (let corner = 0; corner < 8; corner += 1) {
              if (((corner & axisBit) !== 0 ? 1 : 0) !== take) continue;
              layerIds[n] = grid.reps[slot * belowCount + subcells[corner]];
              layerMasses[n] = masses[corner];
              n += 1;
            }
            const pick = heaviest(layerIds, layerMasses, 4);
            if (pick >= 0) {
              reps[slot * count + cell] = pick;
              break;
            }
          }
        }
      }
    }
  }
  return {
    factor: grid.factor * 2,
    side,
    origin: grid.origin,
    weight,
    dominant,
    reps,
  };
}

/**
 * A face's four corners, in `boxFaceGeometry`'s order for that direction --
 * the order the entry's UVs were made for, so the picture lands the right way
 * up on the bigger face.
 */
function put(out: Float32Array, at: number, x: number, y: number, z: number): void {
  out[at] = x;
  out[at + 1] = y;
  out[at + 2] = z;
}

function writeCorners(
  out: Float32Array,
  at: number,
  slot: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  switch (slot) {
    case 0: // north
      put(out, at + 0 * 3, x0, y0, z0);
      put(out, at + 1 * 3, x1, y0, z0);
      put(out, at + 2 * 3, x1, y1, z0);
      put(out, at + 3 * 3, x0, y1, z0);
      return;
    case 1: // south
      put(out, at + 0 * 3, x1, y0, z1);
      put(out, at + 1 * 3, x0, y0, z1);
      put(out, at + 2 * 3, x0, y1, z1);
      put(out, at + 3 * 3, x1, y1, z1);
      return;
    case 2: // east
      put(out, at + 0 * 3, x1, y0, z0);
      put(out, at + 1 * 3, x1, y0, z1);
      put(out, at + 2 * 3, x1, y1, z1);
      put(out, at + 3 * 3, x1, y1, z0);
      return;
    case 3: // west
      put(out, at + 0 * 3, x0, y0, z1);
      put(out, at + 1 * 3, x0, y0, z0);
      put(out, at + 2 * 3, x0, y1, z0);
      put(out, at + 3 * 3, x0, y1, z1);
      return;
    case 4: // up
      put(out, at + 0 * 3, x0, y1, z0);
      put(out, at + 1 * 3, x1, y1, z0);
      put(out, at + 2 * 3, x1, y1, z1);
      put(out, at + 3 * 3, x0, y1, z1);
      return;
    default: // down
      put(out, at + 0 * 3, x0, y0, z1);
      put(out, at + 1 * 3, x1, y0, z1);
      put(out, at + 2 * 3, x1, y0, z0);
      put(out, at + 3 * 3, x0, y0, z0);
  }
}

/** What `buildCoarseMesh` reads besides the structure. */
export interface CoarseInputs {
  readonly struct: StructureData;
  readonly entries: readonly CoarseEntry[];
  readonly atlasUv: Record<string, UVRect>;
  readonly light: LightGrid | null;
  /** `occludesNeighbours` per palette entry: which cells light cannot be read from. */
  readonly solid: readonly boolean[];
  /** Whether the chunks were meshed with corner occlusion; `Shading.occlusion`. */
  readonly occlusion: boolean;
  /** A document cell is its content cell plus this; see `ChunkHint.frame`. */
  readonly frame: readonly [number, number, number];
}

/** The two coarse meshes of one region; either may be empty. */
export interface RegionMeshes {
  readonly lod2: MeshBuffers;
  readonly lod3: MeshBuffers;
}

/** `occludesNeighbours` for every palette entry, once per build. */
export function solidEntries(struct: StructureData): boolean[] {
  return struct.palette.map((entry) => !paletteEntryIsAir(entry) && occludesNeighbours(entry));
}

/**
 * Meshes one region at both coarse levels.
 *
 * Positions are in content coordinates, like the chunks', so a resize that
 * moves the content leaves them right and the viewport places the lot at
 * `MeshPayload.frame`.
 */
export function buildRegionMeshes(
  inputs: CoarseInputs,
  region: readonly [number, number, number],
): RegionMeshes {
  const around = neighbourhood(inputs.struct, inputs.frame, region);
  const two = fineToCoarse(around, inputs.entries);
  const four = halve(two);
  return {
    lod2: meshLevel(inputs, two),
    lod3: meshLevel(inputs, four),
  };
}

/** A cell is full at a quarter of its face's worth of blocks; see the header. */
function fullAt(factor: number): number {
  return (factor * factor) / 4;
}

function meshLevel(inputs: CoarseInputs, grid: CoarseGrid): MeshBuffers {
  const { factor, side } = grid;
  const count = side * side * side;
  const threshold = fullAt(factor);
  const margin = MARGIN / factor;
  const core = REGION_SIZE / factor;
  const { struct, entries, atlasUv, light, solid, frame, occlusion } = inputs;
  const width = struct.bounds.maxX - struct.bounds.minX + 1;
  const height = struct.bounds.maxY - struct.bounds.minY + 1;
  const length = struct.bounds.maxZ - struct.bounds.minZ + 1;
  const plane = height * length;
  /** Whether a cell, in content coordinates, hides what is flush against it. */
  const solidAt = (x: number, y: number, z: number): boolean => {
    const docX = x + frame[0];
    const docY = y + frame[1];
    const docZ = z + frame[2];
    if (docX < 0 || docY < 0 || docZ < 0 || docX >= width || docY >= height || docZ >= length) {
      return false;
    }
    return solid[struct.voxels[docX * plane + docY * length + docZ]] === true;
  };

  // First pass: which faces are drawn. Four numbers each: cell, slot, entry,
  // translucent.
  const drawn: number[] = [];
  let translucentFaces = 0;
  for (let i = margin; i < margin + core; i += 1) {
    for (let j = margin; j < margin + core; j += 1) {
      for (let k = margin; k < margin + core; k += 1) {
        const cell = (i * side + j) * side + k;
        if (grid.weight[cell] < threshold) continue;
        for (let slot = 0; slot < 6; slot += 1) {
          const wears = grid.reps[slot * count + cell];
          if (wears < 0) continue;
          const face = entries[wears]?.faces[slot] ?? null;
          if (face === null || atlasUv[face.textureKey] === undefined) continue;
          const [di, dj, dk] = STEP[slot];
          const next = ((i + di) * side + (j + dj)) * side + (k + dk);
          if (grid.weight[next] >= threshold) {
            const facing = grid.reps[OPPOSITE[slot] * count + next];
            const against = facing < 0 ? null : (entries[facing]?.faces[OPPOSITE[slot]] ?? null);
            // Hidden by an opaque face, or by the same see-through block.
            if (against !== null && (against.opaque || facing === wears)) continue;
          }
          drawn.push(cell, slot, wears, face.translucent ? 1 : 0);
          if (face.translucent) translucentFaces += 1;
        }
      }
    }
  }
  const total = drawn.length / 4;
  if (total === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      indices: new Uint32Array(0),
      light: new Float32Array(0),
      opaqueIndices: 0,
    };
  }

  const positions = new Float32Array(total * 12);
  const normals = new Float32Array(total * 12);
  const uvs = new Float32Array(total * 8);
  const lit = new Float32Array(total * 12);
  const indices = new Uint32Array(total * 6);
  let opaqueAt = 0;
  let translucentAt = (total - translucentFaces) * 6;
  const quad = [0, 2, 1, 0, 3, 2] as const;

  for (let n = 0; n < total; n += 1) {
    const cell = drawn[n * 4];
    const slot = drawn[n * 4 + 1];
    const face = entries[drawn[n * 4 + 2]].faces[slot]!;
    const translucent = drawn[n * 4 + 3] === 1;
    const k = cell % side;
    const j = Math.floor(cell / side) % side;
    const i = Math.floor(cell / (side * side));
    // The cell's corner in content coordinates.
    const x0 = grid.origin[0] + i * factor;
    const y0 = grid.origin[1] + j * factor;
    const z0 = grid.origin[2] + k * factor;
    writeCorners(positions, n * 12, slot, x0, y0, z0, x0 + factor, y0 + factor, z0 + factor);
    const [dx, dy, dz] = STEP[slot];
    for (let v = 0; v < 4; v += 1) {
      normals[n * 12 + v * 3] = dx;
      normals[n * 12 + v * 3 + 1] = dy;
      normals[n * 12 + v * 3 + 2] = dz;
    }
    const [u0, v0, u1, v1] = atlasUv[face.textureKey];
    for (let v = 0; v < 4; v += 1) {
      uvs[n * 8 + v * 2] = u0 + (u1 - u0) * face.uvs[v * 2];
      uvs[n * 8 + v * 2 + 1] = v0 + (v1 - v0) * face.uvs[v * 2 + 1];
    }

    /*
     * The layer just outside the face, one step out along the normal and the
     * cell's extent across it: each open cell there is what lights the fine
     * face behind it, so the coarse face takes their mean. Out of the box is
     * open sky, which is what lights the outside of a build.
     *
     * And where a fine face does stand right behind an open cell, the corner
     * occlusion it would carry -- the three cells about each corner, in that
     * same layer -- so the coarse face is as dark in a crevice as the faces it
     * replaces. An open cell with nothing right behind lights a face deeper
     * in, whose corners this cannot see: it counts as unoccluded.
     */
    const ax = dx > 0 ? x0 + factor : dx < 0 ? x0 - 1 : x0;
    const ay = dy > 0 ? y0 + factor : dy < 0 ? y0 - 1 : y0;
    const az = dz > 0 ? z0 + factor : dz < 0 ? z0 - 1 : z0;
    const bx = dx !== 0 ? ax : x0 + factor - 1;
    const by = dy !== 0 ? ay : y0 + factor - 1;
    const bz = dz !== 0 ? az : z0 + factor - 1;
    // The two axes across the face, as unit steps.
    const across1: readonly [number, number, number] = dx !== 0 ? [0, 1, 0] : [1, 0, 0];
    const across2: readonly [number, number, number] = dz !== 0 ? [0, 1, 0] : [0, 0, 1];
    let blockSum = 0;
    let skySum = 0;
    let open = 0;
    let shadeSum = 0;
    for (let x = ax; x <= bx; x += 1) {
      for (let y = ay; y <= by; y += 1) {
        for (let z = az; z <= bz; z += 1) {
          if (solidAt(x, y, z)) continue;
          open += 1;
          if (light === null) {
            skySum += MAX_LIGHT;
          } else {
            const docX = x + frame[0];
            const docY = y + frame[1];
            const docZ = z + frame[2];
            if (docX < 0 || docY < 0 || docZ < 0 || docX >= width || docY >= height || docZ >= length) {
              skySum += MAX_LIGHT;
            } else {
              const at = docX * plane + docY * length + docZ;
              blockSum += light.block[at];
              skySum += light.sky[at];
            }
          }
          if (!occlusion || !solidAt(x - dx, y - dy, z - dz)) {
            shadeSum += 1;
            continue;
          }
          let corners = 0;
          for (const s1 of [-1, 1]) {
            for (const s2 of [-1, 1]) {
              const ux = across1[0] * s1;
              const uy = across1[1] * s1;
              const uz = across1[2] * s1;
              const vx = across2[0] * s2;
              const vy = across2[1] * s2;
              const vz = across2[2] * s2;
              corners +=
                OCCLUSION_LEVELS[
                  cornerOcclusion(
                    solidAt(x + ux, y + uy, z + uz),
                    solidAt(x + vx, y + vy, z + vz),
                    solidAt(x + ux + vx, y + uy + vy, z + uz + vz),
                  )
                ];
            }
          }
          shadeSum += corners / 4;
        }
      }
    }
    // Buried on that side: nothing to read, so read it as daylight rather
    // than as a black face, as the chunks do for a face with no open cell.
    const block = open === 0 ? 0 : blockSum / open;
    const sky = open === 0 ? MAX_LIGHT : skySum / open;
    const shade = open === 0 ? 1 : shadeSum / open;
    for (let v = 0; v < 4; v += 1) {
      lit[n * 12 + v * 3] = block / MAX_LIGHT;
      lit[n * 12 + v * 3 + 1] = sky / MAX_LIGHT;
      lit[n * 12 + v * 3 + 2] = shade;
    }
    const base = n * 4;
    if (translucent) {
      for (const q of quad) indices[translucentAt++] = base + q;
    } else {
      for (const q of quad) indices[opaqueAt++] = base + q;
    }
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    light: lit,
    opaqueIndices: (total - translucentFaces) * 6,
  };
}

/**
 * The regions a set of re-meshed chunks makes stale: each chunk's own, and the
 * one across any region face the chunk lies against.
 *
 * Across, because a coarse cell at a region's edge is hidden or not by the
 * cell beyond it and lit by the blocks beyond it, and both of those are in the
 * chunk on the far side. Only face neighbours: nothing here reads a cell
 * diagonally.
 */
export function staleRegions(dirtyChunks: Iterable<readonly [number, number, number]>): Set<string> {
  const out = new Set<string>();
  for (const [cx, cy, cz] of dirtyChunks) {
    const chunk = [cx, cy, cz];
    const region = chunk.map((c) => Math.floor(c / REGION_CHUNKS));
    out.add(region.join(","));
    for (let axis = 0; axis < 3; axis += 1) {
      const within = ((chunk[axis] % REGION_CHUNKS) + REGION_CHUNKS) % REGION_CHUNKS;
      if (within === 0 || within === REGION_CHUNKS - 1) {
        const across = [...region];
        across[axis] += within === 0 ? -1 : 1;
        out.add(across.join(","));
      }
    }
  }
  return out;
}
