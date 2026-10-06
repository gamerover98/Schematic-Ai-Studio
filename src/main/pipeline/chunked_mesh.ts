/**
 * Meshing a document one chunk at a time, and re-meshing only what changed.
 *
 * Rebuilding the whole structure after every edit is what the app did, and it
 * is fine at the size of a house — measured, 167 ms — and slow at the size of a
 * castle: 1.5 s for a 256x64x256, of which culling alone is 1.1 s. Placing one
 * block should not cost that.
 *
 * The structure is cut into 16-block cubes, each meshed independently and
 * cached. A rebuild re-meshes only the chunks whose contents moved and
 * concatenates the rest.
 *
 * ## Which chunks are dirty is *observed*, not announced
 *
 * The cache keeps a snapshot of the voxel grid and diffs it. No caller has to
 * remember to report an edit, which matters because there are several ways to
 * make one — the panel, the crosshair, the agent's tools, an undo — and a
 * notification missed at any of them would render a stale chunk with no clue
 * as to why. Comparing two typed arrays of four million entries costs a few
 * milliseconds; being wrong costs a bug nobody can reproduce.
 *
 * ## A changed block dirties its neighbours' chunks too
 *
 * Whether a face is drawn depends on the block next to it, so a block on a
 * chunk boundary changes what the chunk across that boundary should draw.
 * Every changed voxel therefore dirties its own chunk and those of its six
 * face-neighbours.
 *
 * ## What invalidates everything
 *
 * The atlas changing (cached UVs address the old layout), the void block
 * changing (`fillVoid` rewrites the palette under the same indices), and the
 * caller's own `ChunkHint.key` changing. The palette *growing* does not: it is
 * append-only, so an index cached earlier still means the same block.
 *
 * ## A resize does not, when the caller says where the content went
 *
 * It used to: a resize renumbers every index, so the cache threw everything
 * away -- five seconds on a 256x96x256 terrain, and seventeen on a field of
 * copper golem statues, for one block placed past the edge. That is the
 * ordinary way of building in creative mode.
 *
 * Chunks are cut and meshed in **content** coordinates: the document's own
 * minus `ChunkHint.frame`, the sum of every resize's shift. Content does not
 * move when the box grows, on either side, so a chunk meshed before the growth
 * is still right after it, and the viewport places the whole set at `frame`.
 * What a resize does change is re-meshed: the chunks across the box's old and
 * new faces, and whatever the overlap compares different. Without a hint the
 * cache knows nothing about where the content went, and a resize meshes
 * everything as it always did.
 *
 * ## Where the changed cells come from
 *
 * Observed, as above, unless the caller already knows: `ChunkHint.changed` is
 * the list of cells whose block or light moved since the cache was built, and
 * with it the full comparison is skipped. `preview.ts` builds it from the
 * document's own record of writes (`takeVoxelChanges`) and the cells `relight`
 * changed, both of which are exact. A list that is not exact is the one way to
 * break this, which is why `null` -- compare everything -- is always allowed.
 *
 * That third one is the odd member and is worth reading twice, because it is
 * the only invalidator that is not a fact about the document. `fillVoid` hands
 * this function a structure whose palette has been rewritten -- index 0 is
 * water rather than air -- over the document's own voxels, which have not
 * moved. Every empty cell in the schematic changes appearance while all three
 * grids compare equal, so the cache carried every chunk forward and the answer
 * shipped was a correct one to the wrong question. See `voidDigest`.
 */

import type { BakedFace, MeshBuffers, StructureData } from "./types.js";
import type { LightGrid } from "./lighting.js";
import type { LodFaces, Shading } from "./mesher.js";
import { buildMesh, culledFaces } from "./mesher.js";
import {
  buildRegionMeshes,
  COARSE_ERROR,
  coarseEntries,
  REGION_CHUNKS,
  solidEntries,
  staleRegions,
  type CoarseInputs,
  type RegionMeshes,
} from "./coarse_mesh.js";
import { lodShapeFor } from "./block_shapes.js";
import type { MeshLod } from "../../shared/ipc.js";
import { signDigest, type SignText } from "./sign_text.js";
import type { ModelBaker } from "./model_baker.js";
import { paletteEntryCacheKey } from "./types.js";
import type { UVRect } from "./types.js";

export const CHUNK_SIZE = 16;

/**
 * One chunk's geometry, split by what it is.
 *
 * `solid` is the schematic: pickable, drawn as it always was. `filler` is
 * the void block standing in for empty space, and it is a separate set of
 * buffers rather than a third index range beside `opaqueIndices` for two
 * reasons that arrive together. Its opacity is a **material** property, so a
 * material of its own was required anyway; and a material of its own means an
 * *object* of its own in the viewer, which is what keeps it out of the
 * raycaster -- `Mesh.raycast` tests a whole geometry and knows nothing about
 * draw groups, so an index range could never have bought that.
 *
 * `filler` is empty for every document until somebody chooses a void block,
 * which is the default.
 */
/** A box in world units, or `null` for geometry with no vertices in it. */
export interface MeshBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface ChunkLayers {
  readonly solid: MeshBuffers;
  readonly filler: MeshBuffers;
  /**
   * The chunk for the middle distance: `solid` with every block that has a
   * stand-in drawn by it (`lodShapeFor`), or `null` when that would save too
   * little to be worth a second copy of the chunk -- see `LOD1_WORTH` -- or
   * when nobody asked for it, which `lod1Asked` tells apart.
   */
  readonly lod1: LodMesh | null;
  /**
   * Whether level 1 was asked for when this chunk was meshed. Only then does
   * `lod1: null` mean "none worth having"; otherwise it means "not looked
   * for", and turning level 1 on has to look.
   */
  readonly lod1Asked: boolean;
  /**
   * The solid layer's box, computed once when the chunk is meshed.
   *
   * The fourth thing to ride with a chunk, after its voxels, its light and its
   * sign text, and for the same arithmetic: the viewport's caption wants the
   * geometry's extent, and walking every vertex of every chunk to find it cost
   * **39 ms of a 207 ms edit** on a dense 128x32x128 -- on every placed block,
   * over chunks that had not moved. A chunk carried forward by reference
   * carries its box with it and the union is O(chunks).
   */
  readonly bounds: MeshBounds | null;
}

/** A level-of-detail mesh, and how far it strays from the full one, in blocks. */
export interface LodMesh {
  readonly buffers: MeshBuffers;
  readonly error: number;
}

/** The box of one chunk's geometry, walked once, when it is built. */
function boundsOf(buffers: MeshBuffers): MeshBounds | null {
  if (buffers.positions.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < buffers.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = buffers.positions[i + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

export interface ChunkMeshCache {
  width: number;
  height: number;
  length: number;
  /**
   * The content offset the chunks were meshed at: a document cell is its
   * content cell plus this. See "A resize does not" above.
   */
  frame: readonly [number, number, number];
  /** The caller's `ChunkHint.key` when the chunks were meshed. */
  key: string;
  /** The light the chunks were meshed with, for `relight` to start from. */
  lightGrid: LightGrid | null;
  /** The `VoxelChanges` epoch the caller took when it built this; see `takeVoxelChanges`. */
  epoch: number | null;
  /** Bumped by the caller whenever the atlas is rebuilt; see the note above. */
  atlasVersion: number;
  /** The grid as it was when the cached chunks were built. */
  voxels: Int32Array;
  /**
   * The light as it was, for the same reason: a torch changes what a chunk
   * looks like fifteen blocks away without changing a single voxel there.
   *
   * Diffed exactly like the voxels are, which keeps the rule the same one --
   * dirtiness is *observed*, not announced. A caller that had to remember to
   * say "and light spread this far" would forget, and the chunk that stayed
   * dark would be a bug nobody could reproduce.
   */
  light: Uint8Array;
  /**
   * What each sign said, by flat voxel index, as `signDigest` renders it.
   *
   * The same rule again, and the third thing it has caught: a sign's text is
   * neither a voxel nor a photon, so retyping one moved nothing either array
   * compares and the chunk stayed as it was -- the old words on screen and the
   * new ones in the file. Digests rather than the text because this is only
   * ever compared, and a map with one entry per sign is nothing beside a grid
   * with one per cell.
   */
  signs: Map<number, string>;
  /**
   * The composed cloth each patterned banner wears, by flat voxel index.
   *
   * The signs' rule a fourth time: a banner's design is a block entity,
   * so repainting one moves no voxel and no light, and without this the chunk
   * would go on showing the old design. The texture key *is* the digest --
   * `ModelBaker.bannerCloth` builds it from everything that went into the
   * pixels.
   */
  banners: Map<number, string>;
  /**
   * What the void block was, as `voidDigest` renders it.
   *
   * The three grids above are the document; this is not. It is the one input
   * to a chunk's appearance that arrives beside the structure rather than in
   * it, and the reason it needs recording is that `fillVoid` expresses itself
   * as a *palette* rewrite -- which the voxel diff, being about indices, is
   * blind to by construction.
   */
  voidKey: string;
  /** Chunk key -> that chunk's geometry, in both layers. */
  chunks: Map<number, ChunkLayers>;
  /**
   * Region key -> its two coarse meshes, for the far distance; see
   * `coarse_mesh.ts`. Keyed like the chunks, on region coordinates.
   */
  regions: Map<number, RegionMeshes>;
  /**
   * The regions still to be built, or rebuilt because something in them
   * changed. Never built by the call of an edit: the viewer shows the chunks
   * there meanwhile, which is always right, and asks again once the edits
   * stop. See `LodRequest.budgetMs`.
   */
  pendingRegions: Set<number>;
  /** Chunks whose level 1 was turned on after they were meshed; see `lod1Asked`. */
  pendingShapes: Set<number>;
  /** Whether the regions were being kept when this was built. */
  coarseKept: boolean;
}

export interface ChunkedMeshResult {
  /**
   * The box the solid geometry occupies, unioned from the chunks' own.
   *
   * This replaced a `buffers` field holding the whole fused mesh, whose only
   * consumer asked it `indices.length === 0` -- a question `pieces.length ===
   * 0` answers for nothing, because `pieces` only ever receives chunks that
   * have indices. See `concatChunks`, which survives for the tests.
   */
  bounds: MeshBounds;
  /**
   * The same geometry, still separated by chunk.
   *
   * The renderer draws one mesh per chunk rather than one fused mesh, so it
   * gets per-chunk frustum culling for nothing, and a later change can send
   * only the chunks that moved.
   */
  pieces: MeshBuffers[];
  /**
   * The chunk key of each entry in `pieces`, in the same order.
   *
   * Carried so a payload can name what it is replacing. Without it the only
   * thing a caller can do with a changed chunk is send every chunk, which is
   * what an edit used to cost.
   */
  pieceKeys: number[];
  /**
   * The void layer, in the same shape and deliberately not folded into
   * `pieces`.
   *
   * `buffers` above and `boundsOf(pieces)` downstream both stay about the
   * *schematic*: the void fills the whole document, so folding it in would
   * make an empty document's bounds the whole box and stop
   * `EmptyPreviewError` ever firing -- which is the check that keeps the
   * viewport from showing the ghost of a build that has been deleted.
   */
  voidPieces: MeshBuffers[];
  voidPieceKeys: number[];
  /**
   * The levels of detail, when `ChunkHint.lod` asked for them and the document
   * is heavy enough to need them: `lod1` keyed by chunk, `lod2` and `lod3` by
   * region. Empty meshes are left out, as chunks are.
   */
  lodPieces: LodPiece[];
  /** Where the levels of detail stand; see `MeshLod`. */
  lod: MeshLod;
  cache: ChunkMeshCache;
  /** How many chunks had to be re-meshed, and how many there are. */
  rebuilt: number;
  total: number;
  /** How many regions' coarse meshes were rebuilt. */
  rebuiltRegions: number;
}

/** One level-of-detail mesh and what it stands for. */
export interface LodPiece {
  readonly layer: "lod1" | "lod2" | "lod3";
  /** A chunk key for `lod1`, a region key -- the same packing -- for the others. */
  readonly key: number;
  readonly buffers: MeshBuffers;
  /** How far it strays from the full mesh, in blocks; see `ChunkGeometry.lodError`. */
  readonly error: number;
}

/**
 * Which levels of detail the window asked for, and how much time this call
 * may spend on them.
 *
 * The window asks because only the window can draw them: a level sent to a
 * viewer that cannot choose between levels is drawn on top of the full mesh,
 * and that is exactly how this feature first reached the screen.
 */
export interface LodRequest {
  /** Level 1, for chunks with complex blocks. Built with the chunk, cheaply. */
  readonly shapes: boolean;
  /** Levels 2 and 3, for regions. Built only from `budgetMs`. */
  readonly coarse: boolean;
  /**
   * Only for a document whose full mesh has at least this many triangles, or
   * `null` for any document. A small build is cheap to draw and has to look
   * exactly as it is, so in `auto` it gets none.
   */
  readonly autoTriangles: number | null;
  /**
   * How long this call may spend building regions, in milliseconds. Zero is
   * what an edit's own call passes -- placing a block must not wait for a
   * region -- and `Infinity` builds every one, for the suites and the bench.
   */
  readonly budgetMs: number;
}

/**
 * How much smaller a chunk's `lod1` has to be than the chunk to be kept.
 *
 * A chunk with one statue in a field of stone saves forty faces out of
 * thousands, and a second copy of it would cost more memory and upload than
 * the faces it saves; a field of statues saves two thirds.
 */
export const LOD1_WORTH = 0.8;

/**
 * What a caller knows that the structure does not say.
 *
 * Optional, and without it the cache behaves as it always did: everything
 * observed, and a resize meshing everything.
 */
export interface ChunkHint {
  /**
   * Where the content sits in the grid: a document cell is its content cell
   * plus this. `SchematicDocument.frame`.
   */
  frame: readonly [number, number, number];
  /**
   * The cells (flat indices in the current grid) whose block or light may
   * have changed since `cache` was built, or `null` to compare everything.
   *
   * Only honoured when the grid has the same shape and frame as the cache's;
   * a resize always compares.
   */
  changed: Iterable<number> | null;
  /**
   * Anything else the geometry depends on that the structure does not carry,
   * such as whether markers are hidden. A different key meshes everything.
   */
  key?: string;
  /** Recorded on the cache for the caller; see `ChunkMeshCache.epoch`. */
  epoch?: number | null;
  /**
   * The levels of detail to build beside the chunks, or `null` for none.
   * Changing it re-meshes no chunk: it is not part of `key`.
   */
  lod?: LodRequest | null;
  /** Told after each chunk meshed; see `services/progress.ts`. */
  progress?: { report(phase: "meshing", done: number, total: number): void } | null;
}

/** The bias that lets a chunk coordinate be negative inside a packed key. */
const KEY_BIAS = 32768;
const KEY_SPAN = 65536;

/**
 * Chunk coordinates packed into one number, so the maps can key on a
 * primitive.
 *
 * Content coordinates can be negative -- the box grows below the origin and
 * the content stays put -- so each axis is biased. Sixteen bits an axis is
 * half a million blocks either way, and the whole key stays well inside a
 * double's integers.
 */
export function chunkKey(cx: number, cy: number, cz: number): number {
  return cx + KEY_BIAS + KEY_SPAN * (cy + KEY_BIAS + KEY_SPAN * (cz + KEY_BIAS));
}

export function chunkCoords(key: number): [number, number, number] {
  const cx = (key % KEY_SPAN) - KEY_BIAS;
  const rest = Math.floor(key / KEY_SPAN);
  const cy = (rest % KEY_SPAN) - KEY_BIAS;
  const cz = Math.floor(rest / KEY_SPAN) - KEY_BIAS;
  return [cx, cy, cz];
}

/** The chunks a box of `size` cells covers, in content coordinates, at `frame`. */
interface ChunkRange {
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
}

function chunkRange(
  size: readonly [number, number, number],
  frame: readonly [number, number, number],
): ChunkRange {
  return {
    from: [0, 1, 2].map((axis) => Math.floor(-frame[axis] / CHUNK_SIZE)) as [number, number, number],
    to: [0, 1, 2].map((axis) => Math.floor((size[axis] - 1 - frame[axis]) / CHUNK_SIZE)) as [
      number,
      number,
      number,
    ],
  };
}

function inRange(range: ChunkRange, cx: number, cy: number, cz: number): boolean {
  return (
    cx >= range.from[0] &&
    cx <= range.to[0] &&
    cy >= range.from[1] &&
    cy <= range.to[1] &&
    cz >= range.from[2] &&
    cz <= range.to[2]
  );
}

function emptyBuffers(): MeshBuffers {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    indices: new Uint32Array(0),
    light: new Float32Array(0),
    opaqueIndices: 0,
  };
}

/**
 * Joins chunk geometry into one mesh.
 *
 * Indices are per-chunk — each chunk numbers its vertices from zero — so they
 * are shifted by the running vertex count as they are copied. That shift is the
 * only per-element work here; everything else is `set`, which is a memcpy.
 *
 * **Nothing in the app calls this, and that is the point.** It used to run on
 * every build, and its result had exactly one consumer: `preview.ts` asking
 * `buffers.indices.length === 0`. Since `ordered` only ever receives pieces
 * that already have indices, that question is `pieces.length === 0` — so the
 * whole fusion was provably redundant. Measured on a dense 128x32x128, it was
 * **155 ms of a 207 ms edit**, allocating and copying about 264 MB per placed
 * block to answer *is it empty*.
 *
 * It stays exported because `tests/chunks.ts` needs it: the property that
 * whole suite rests on is that an incrementally updated mesh is byte-identical
 * to one built from scratch, and comparing them means fusing them. Doing that
 * in the test rather than in the pipeline is the right way round -- the fusing
 * is what the check is *about*.
 */
export function concatChunks(pieces: readonly MeshBuffers[]): MeshBuffers {
  let positionCount = 0;
  let uvCount = 0;
  let indexCount = 0;
  for (const piece of pieces) {
    positionCount += piece.positions.length;
    uvCount += piece.uvs.length;
    indexCount += piece.indices.length;
  }
  if (indexCount === 0) {
    return emptyBuffers();
  }

  const positions = new Float32Array(positionCount);
  const normals = new Float32Array(positionCount);
  const uvs = new Float32Array(uvCount);
  const light = new Float32Array(positionCount);
  const indices = new Uint32Array(indexCount);

  /*
   * The vertices concatenate straight through; the indices do not.
   *
   * Every piece keeps its opaque indices in front of its translucent ones, and
   * the joined buffer has to hold the same shape — all the opaque ones, then
   * all the translucent ones — or the single number that says where the split
   * is would be a lie about the middle of the array. So the indices are copied
   * in two passes over the same pieces.
   */
  let opaqueTotal = 0;
  for (const piece of pieces) opaqueTotal += piece.opaqueIndices;

  let positionAt = 0;
  let uvAt = 0;
  let opaqueAt = 0;
  let translucentAt = opaqueTotal;
  let vertexBase = 0;
  for (const piece of pieces) {
    positions.set(piece.positions, positionAt);
    normals.set(piece.normals, positionAt);
    light.set(piece.light, positionAt);
    uvs.set(piece.uvs, uvAt);
    for (let i = 0; i < piece.indices.length; i += 1) {
      const shifted = piece.indices[i] + vertexBase;
      if (i < piece.opaqueIndices) {
        indices[opaqueAt] = shifted;
        opaqueAt += 1;
      } else {
        indices[translucentAt] = shifted;
        translucentAt += 1;
      }
    }
    positionAt += piece.positions.length;
    uvAt += piece.uvs.length;
    vertexBase += piece.positions.length / 3;
  }
  return { positions, normals, uvs, indices, light, opaqueIndices: opaqueTotal };
}

/**
 * The chunks a changed voxel invalidates: every chunk within one cell of it.
 *
 * Its own, and its face-neighbours' -- a face is drawn or culled by the block
 * across it -- and the diagonal ones too, which is the half that was missing.
 * Occlusion and smooth lighting read the cells at a face's corners, which are
 * diagonal to the cell the face is on, so a block placed on a chunk's edge
 * changes the shading of faces in the chunk across that edge, a chunk that
 * shares no face with it. Only the face-neighbours were marked, and those
 * faces kept their old shading until something else touched their chunk.
 * `tests/chunks.ts` compares light in every vertex, which is what saw it.
 *
 * `x/y/z` are document coordinates and `frame` turns them into content ones,
 * which is what the chunks are cut in.
 */
function markDirty(
  dirty: Set<number>,
  x: number,
  y: number,
  z: number,
  frame: readonly [number, number, number],
  range: ChunkRange,
): void {
  const cx0 = Math.floor((x - 1 - frame[0]) / CHUNK_SIZE);
  const cx1 = Math.floor((x + 1 - frame[0]) / CHUNK_SIZE);
  const cy0 = Math.floor((y - 1 - frame[1]) / CHUNK_SIZE);
  const cy1 = Math.floor((y + 1 - frame[1]) / CHUNK_SIZE);
  const cz0 = Math.floor((z - 1 - frame[2]) / CHUNK_SIZE);
  const cz1 = Math.floor((z + 1 - frame[2]) / CHUNK_SIZE);
  for (let cx = cx0; cx <= cx1; cx += 1) {
    for (let cy = cy0; cy <= cy1; cy += 1) {
      for (let cz = cz0; cz <= cz1; cz += 1) {
        if (inRange(range, cx, cy, cz)) dirty.add(chunkKey(cx, cy, cz));
      }
    }
  }
}

/**
 * What the void block is doing to this structure, as one comparable string.
 *
 * Derived from the two arguments the mesher already receives rather than
 * taken as a third, so it cannot drift from what was actually drawn: it names
 * every palette index `fillVoid` marked **and what that index now holds**.
 * Both halves are load-bearing and neither is enough on its own.
 *
 * The indices alone would miss a swap -- water and lava are both written over
 * index 0, so the set is `{0}` either way and two entirely different documents
 * would compare equal. The entries alone would miss a cell that a *break* had
 * filled with the void block for real, which is void by the same rule and gets
 * an index of its own.
 *
 * It is a handful of entries at most, so this costs nothing beside the grids
 * next to it.
 */
function voidDigest(struct: StructureData, voidIndices: ReadonlySet<number> | null): string {
  if (voidIndices === null || voidIndices.size === 0) return "";
  return [...voidIndices]
    .sort((a, b) => a - b)
    .map((index) => {
      const entry = struct.palette[index];
      return entry === undefined ? String(index) : index + "=" + paletteEntryCacheKey(entry);
    })
    .join(",");
}

/**
 * A chunk's faces for the middle distance: the solid faces with the runs that
 * belong to blocks with a stand-in left out, and the stand-ins in their place
 * -- or `null` when the stand-ins save too little to be worth a second copy of
 * the chunk (`LOD1_WORTH`), which includes a chunk with none.
 */
function middleDistanceFaces(
  faces: readonly BakedFace[],
  lod: LodFaces,
  solidCount: number,
): BakedFace[] | null {
  if (lod.skip.length === 0) return null;
  let skipped = 0;
  for (let i = 0; i < lod.skip.length; i += 2) skipped += lod.skip[i + 1] - lod.skip[i];
  if (solidCount - skipped + lod.simple.length > LOD1_WORTH * solidCount) return null;
  const out: BakedFace[] = [];
  let run = 0;
  for (let i = 0; i < faces.length; i += 1) {
    while (run < lod.skip.length && i >= lod.skip[run + 1]) run += 2;
    if (run < lod.skip.length && i >= lod.skip[run]) continue;
    if (faces[i].voidFill === true) continue;
    out.push(faces[i]);
  }
  for (const face of lod.simple) out.push(face);
  return out;
}

/** Whether a chunk holds any cell whose palette index `wanted` marks. */
function chunkHolds(
  struct: StructureData,
  chunk: readonly [number, number, number],
  frame: readonly [number, number, number],
  wanted: readonly boolean[],
): boolean {
  if (!wanted.some(Boolean)) return false;
  const width = struct.bounds.maxX - struct.bounds.minX + 1;
  const height = struct.bounds.maxY - struct.bounds.minY + 1;
  const length = struct.bounds.maxZ - struct.bounds.minZ + 1;
  const x0 = Math.max(0, chunk[0] * CHUNK_SIZE + frame[0]);
  const y0 = Math.max(0, chunk[1] * CHUNK_SIZE + frame[1]);
  const z0 = Math.max(0, chunk[2] * CHUNK_SIZE + frame[2]);
  const x1 = Math.min(width, chunk[0] * CHUNK_SIZE + CHUNK_SIZE + frame[0]);
  const y1 = Math.min(height, chunk[1] * CHUNK_SIZE + CHUNK_SIZE + frame[1]);
  const z1 = Math.min(length, chunk[2] * CHUNK_SIZE + CHUNK_SIZE + frame[2]);
  for (let x = x0; x < x1; x += 1) {
    for (let y = y0; y < y1; y += 1) {
      const row = x * height * length + y * length;
      for (let z = z0; z < z1; z += 1) {
        if (wanted[struct.voxels[row + z]] === true) return true;
      }
    }
  }
  return false;
}

export function createChunkMeshCache(): ChunkMeshCache {
  return {
    width: -1,
    height: -1,
    length: -1,
    frame: [0, 0, 0],
    key: "",
    lightGrid: null,
    epoch: null,
    atlasVersion: -1,
    voxels: new Int32Array(0),
    light: new Uint8Array(0),
    signs: new Map(),
    banners: new Map(),
    voidKey: "",
    chunks: new Map(),
    regions: new Map(),
    pendingRegions: new Set(),
    pendingShapes: new Set(),
    coarseKept: false,
  };
}

/**
 * The two light grids packed into one byte per cell, for diffing.
 *
 * Sky in the high nibble and block in the low one. A single array to compare
 * rather than two, and the comparison is the whole reason it exists -- the
 * values themselves are read from the `LightGrid` where they are separate.
 */
function packLight(lighting: LightGrid | null, cells: number): Uint8Array {
  const packed = new Uint8Array(cells);
  if (lighting === null) return packed;
  for (let i = 0; i < cells; i += 1) {
    packed[i] = (lighting.sky[i] << 4) | lighting.block[i];
  }
  return packed;
}

/**
 * Meshes the structure, reusing whatever the cache still holds good.
 *
 * The returned cache replaces the one passed in. Passing a fresh cache — or one
 * whose dimensions or atlas version no longer match — meshes everything, which
 * is also what happens the first time.
 */
export async function buildChunkedMesh(
  struct: StructureData,
  baker: ModelBaker,
  atlasUv: Record<string, UVRect>,
  atlasVersion: number,
  cache: ChunkMeshCache,
  shading: Shading | null = null,
  signs: ReadonlyMap<number, SignText> | null = null,
  /** Palette entries that are the void block; see `culledFaces`. */
  voidIndices: ReadonlySet<number> | null = null,
  /** The patterned banners' cloth keys, by flat index; see `culledFaces`. */
  banners: ReadonlyMap<number, string> | null = null,
  /** Where the time went, by step, added to; see `DocumentPreviewResult.timings`. */
  timings: Record<string, number> | null = null,
  /** What the caller knows about what changed; see `ChunkHint`. */
  hint: ChunkHint | null = null,
): Promise<ChunkedMeshResult> {
  let at = performance.now();
  const lap = (name: string): void => {
    if (timings === null) return;
    const now = performance.now();
    timings[name] = (timings[name] ?? 0) + (now - at);
    at = now;
  };
  const width = struct.bounds.maxX - struct.bounds.minX + 1;
  const height = struct.bounds.maxY - struct.bounds.minY + 1;
  const length = struct.bounds.maxZ - struct.bounds.minZ + 1;
  const frame = hint?.frame ?? ([0, 0, 0] as const);
  const range = chunkRange([width, height, length], frame);
  const plane = height * length;

  const voidKey = voidDigest(struct, voidIndices);
  const key = hint?.key ?? "";
  const request = hint?.lod ?? null;
  const askShapes = request !== null && request.shapes;
  const sameInputs =
    cache.width >= 0 &&
    cache.atlasVersion === atlasVersion &&
    cache.voidKey === voidKey &&
    cache.key === key;
  const sameShape =
    cache.width === width &&
    cache.height === height &&
    cache.length === length &&
    cache.frame[0] === frame[0] &&
    cache.frame[1] === frame[1] &&
    cache.frame[2] === frame[2] &&
    cache.voxels.length === struct.voxels.length;
  /*
   * Four ways to find the dirty chunks, from cheapest to most thorough:
   * - `listed`: the caller says which cells changed;
   * - `diff`: same shape, compare every cell, as this always did;
   * - `moved`: the box was resized and the caller said where the content went;
   * - `all`: anything else, the first build included.
   */
  const mode: "listed" | "diff" | "moved" | "all" = !sameInputs
    ? "all"
    : sameShape
      ? hint?.changed !== null && hint?.changed !== undefined
        ? "listed"
        : "diff"
      : hint !== null
        ? "moved"
        : "all";

  const lighting = shading?.light ?? null;
  const packedAt = (index: number): number =>
    lighting === null ? 0 : (lighting.sky[index] << 4) | lighting.block[index];
  /*
   * A growth the caller can list: the box only got bigger, there is no void
   * block (which would fill the new cells with geometry), and the caller says
   * which cells changed, counting a new cell as changed wherever it is not
   * plain air lit as though it were outside the box.
   *
   * That counting is the whole trick. To the mesher, a cell outside the grid
   * and an air cell with no block light and full sky are the same neighbour:
   * nothing to cull against, nothing to occlude, the same light to read. So
   * the old snapshot is carried into the new grid with every new cell set to
   * exactly that, and the listed cells are compared against it like any other
   * edit -- and the column of chunks along the old face, which a growth used
   * to re-mesh in full, is re-meshed only where something across it changed.
   */
  const shiftNow = [0, 1, 2].map((axis) => frame[axis] - cache.frame[axis]);
  const listedGrowth =
    mode === "moved" &&
    hint?.changed !== null &&
    hint?.changed !== undefined &&
    voidKey === "" &&
    shiftNow.every((step) => step >= 0) &&
    cache.width + shiftNow[0] <= width &&
    cache.height + shiftNow[1] <= height &&
    cache.length + shiftNow[2] <= length;
  // What `packedAt` gives an air cell lit as though it were outside the box.
  const OUTSIDE_LIGHT = lighting === null ? 0 : 15 << 4;
  const carry = (): { voxels: Int32Array; light: Uint8Array } => {
    const voxels = new Int32Array(width * height * length);
    const lit = new Uint8Array(width * height * length).fill(OUTSIDE_LIGHT);
    const oldPlane = cache.height * cache.length;
    for (let ox = 0; ox < cache.width; ox += 1) {
      for (let oy = 0; oy < cache.height; oy += 1) {
        const from = ox * oldPlane + oy * cache.length;
        const to = (ox + shiftNow[0]) * plane + (oy + shiftNow[1]) * length + shiftNow[2];
        voxels.set(cache.voxels.subarray(from, from + cache.length), to);
        lit.set(cache.light.subarray(from, from + cache.length), to);
      }
    }
    return { voxels, light: lit };
  };
  const carried = listedGrowth ? carry() : null;
  // Packed in full only when something compares in full; a listed change
  // updates the cache's own copy cell by cell.
  const light =
    mode === "listed"
      ? cache.light
      : carried !== null
        ? carried.light
        : packLight(lighting, struct.voxels.length);
  const snapshot =
    mode === "listed"
      ? cache.voxels
      : carried !== null
        ? carried.voxels
        : Int32Array.from(struct.voxels);

  const dirty = new Set<number>();
  const markCell = (index: number): void => {
    const x = Math.floor(index / plane);
    const rest = index - x * plane;
    markDirty(dirty, x, Math.floor(rest / length), rest % length, frame, range);
  };
  const markAll = (): void => {
    for (let cz = range.from[2]; cz <= range.to[2]; cz += 1) {
      for (let cy = range.from[1]; cy <= range.to[1]; cy += 1) {
        for (let cx = range.from[0]; cx <= range.to[0]; cx += 1) dirty.add(chunkKey(cx, cy, cz));
      }
    }
  };

  if (mode === "all") {
    markAll();
  } else if (mode === "listed" || listedGrowth) {
    const current = struct.voxels;
    for (const index of hint!.changed!) {
      if (index < 0 || index >= current.length) continue;
      const packed = packedAt(index);
      if (snapshot[index] === current[index] && light[index] === packed) continue;
      snapshot[index] = current[index];
      light[index] = packed;
      markCell(index);
    }
  } else if (mode === "diff") {
    const previous = cache.voxels;
    const current = struct.voxels;
    const wasLit = cache.light;
    for (let i = 0; i < current.length; i += 1) {
      if (current[i] !== previous[i] || light[i] !== wasLit[i]) markCell(i);
    }
  } else {
    /*
     * The box was resized. Content coordinates did not move, so a cell of the
     * old grid that is still in the box is compared with the cell the same
     * content now occupies, and the chunks across each face that moved are
     * re-meshed whatever they compare: a cell there either is new, has lost a
     * neighbour, or has gained one, and its faces, occlusion and light
     * sampling all read the neighbours.
     */
    const was = [cache.width, cache.height, cache.length] as const;
    const now = [width, height, length] as const;
    const shift = [0, 1, 2].map((axis) => frame[axis] - cache.frame[axis]);
    for (let axis = 0; axis < 3; axis += 1) {
      for (const side of [0, 1] as const) {
        // Content coordinates of the face's cells, old and new.
        const oldFace = side === 0 ? -cache.frame[axis] : was[axis] - 1 - cache.frame[axis];
        const newFace = side === 0 ? -frame[axis] : now[axis] - 1 - frame[axis];
        if (oldFace === newFace) continue;
        const lo = Math.floor((Math.min(oldFace, newFace) - 1) / CHUNK_SIZE);
        const hi = Math.floor((Math.max(oldFace, newFace) + 1) / CHUNK_SIZE);
        for (let cz = range.from[2]; cz <= range.to[2]; cz += 1) {
          for (let cy = range.from[1]; cy <= range.to[1]; cy += 1) {
            for (let cx = range.from[0]; cx <= range.to[0]; cx += 1) {
              const along = axis === 0 ? cx : axis === 1 ? cy : cz;
              if (along >= lo && along <= hi) dirty.add(chunkKey(cx, cy, cz));
            }
          }
        }
      }
    }
    const previous = cache.voxels;
    const wasLit = cache.light;
    const oldPlane = cache.height * cache.length;
    const current = struct.voxels;
    for (let x = 0; x < width; x += 1) {
      const ox = x - shift[0];
      if (ox < 0 || ox >= cache.width) continue;
      for (let y = 0; y < height; y += 1) {
        const oy = y - shift[1];
        if (oy < 0 || oy >= cache.height) continue;
        let index = x * plane + y * length;
        let oldIndex = ox * oldPlane + oy * cache.length - shift[2];
        for (let z = 0; z < length; z += 1, index += 1, oldIndex += 1) {
          const oz = z - shift[2];
          if (oz < 0 || oz >= cache.length) continue;
          if (current[index] !== previous[oldIndex] || light[index] !== wasLit[oldIndex]) {
            markDirty(dirty, x, y, z, frame, range);
          }
        }
      }
    }
  }
  lap("diff");

  /*
   * The signs, diffed the same way and marking only their own chunk.
   *
   * `markDirty` spreads to the face-neighbours because light does; text does
   * not leave the block it is written on, so spreading here would re-mesh six
   * chunks to redraw one word.
   *
   * After a resize the cache's maps are keyed by the old grid's indices, so
   * they are carried into the new one first: the same content cell, the new
   * index, and a sign that fell outside the box simply gone.
   */
  const carriedMap = (before: ReadonlyMap<number, string>): ReadonlyMap<number, string> => {
    if (mode !== "moved") return before;
    const moved = new Map<number, string>();
    const oldPlane = cache.height * cache.length;
    for (const [at, value] of before) {
      const ox = Math.floor(at / oldPlane);
      const rest = at - ox * oldPlane;
      const x = ox + frame[0] - cache.frame[0];
      const y = Math.floor(rest / cache.length) + frame[1] - cache.frame[1];
      const z = (rest % cache.length) + frame[2] - cache.frame[2];
      if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= length) continue;
      moved.set(x * plane + y * length + z, value);
    }
    return moved;
  };
  const written = new Map<number, string>();
  if (signs !== null) {
    for (const [at, text] of signs) written.set(at, signDigest(text));
  }
  const painted = new Map<number, string>(banners ?? []);
  const markOwnChunk = (before: ReadonlyMap<number, string>, after: ReadonlyMap<number, string>): void => {
    for (const at of new Set([...after.keys(), ...before.keys()])) {
      if (after.get(at) === before.get(at)) continue;
      const x = Math.floor(at / plane);
      const rest = at - x * plane;
      const cx = Math.floor((x - frame[0]) / CHUNK_SIZE);
      const cy = Math.floor((Math.floor(rest / length) - frame[1]) / CHUNK_SIZE);
      const cz = Math.floor(((rest % length) - frame[2]) / CHUNK_SIZE);
      if (inRange(range, cx, cy, cz)) dirty.add(chunkKey(cx, cy, cz));
    }
  };
  if (mode !== "all") {
    markOwnChunk(carriedMap(cache.signs), written);
    // A banner's cloth hangs into the cell below or above, but it is emitted
    // by the banner's own cell, so its own chunk is the one that redraws it.
    markOwnChunk(carriedMap(cache.banners), painted);
  }

  const chunks = new Map<number, ChunkLayers>();
  if (mode !== "all") {
    for (const [at, layers] of cache.chunks) {
      const [cx, cy, cz] = chunkCoords(at);
      // A chunk the box no longer reaches is gone; one it still reaches is kept.
      if (inRange(range, cx, cy, cz)) chunks.set(at, layers);
    }
  }

  /** Meshes one chunk, both layers, and level 1 when asked for. */
  const meshChunk = async (dirtyKey: number, withShapes: boolean): Promise<ChunkLayers> => {
    const [cx, cy, cz] = chunkCoords(dirtyKey);
    const lod: LodFaces | undefined = withShapes ? { skip: [], simple: [], error: 0 } : undefined;
    // The chunk's cells, back in document coordinates for the culling pass.
    const faces = await culledFaces(
      struct,
      baker,
      {
        minX: cx * CHUNK_SIZE + frame[0],
        minY: cy * CHUNK_SIZE + frame[1],
        minZ: cz * CHUNK_SIZE + frame[2],
        maxX: cx * CHUNK_SIZE + CHUNK_SIZE - 1 + frame[0],
        maxY: cy * CHUNK_SIZE + CHUNK_SIZE - 1 + frame[1],
        maxZ: cz * CHUNK_SIZE + CHUNK_SIZE - 1 + frame[2],
      },
      shading,
      signs ?? undefined,
      voidIndices ?? undefined,
      banners ?? undefined,
      lod,
    );
    /*
     * Partitioned here rather than meshed twice.
     *
     * Culling has to be *one* pass over the real structure: the void block's
     * face at a wall and the wall's own face are the same plane, and only a
     * pass that can see both removes one of them. Two passes would draw both
     * and z-fight along every surface of the build.
     */
    const solidFaces = faces.filter((face) => face.voidFill !== true);
    const voidFaces = voidIndices === null ? [] : faces.filter((face) => face.voidFill === true);
    // Positions in content coordinates, so a resize that moves the content
    // leaves this geometry right; the viewport adds `frame` back.
    const solid = buildMesh(solidFaces, atlasUv, (name) => baker.isTextureTranslucent(name), frame);
    const lod1Faces = lod === undefined ? null : middleDistanceFaces(faces, lod, solidFaces.length);
    return {
      solid,
      filler: buildMesh(voidFaces, atlasUv, (name) => baker.isTextureTranslucent(name), frame),
      lod1:
        lod1Faces === null || lod === undefined
          ? null
          : {
              buffers: buildMesh(lod1Faces, atlasUv, (name) => baker.isTextureTranslucent(name), frame),
              error: lod.error,
            },
      lod1Asked: withShapes,
      // Walked here, where the chunk is already being built, so a chunk carried
      // forward by reference carries its box with it.
      bounds: boundsOf(solid),
    };
  };

  /*
   * The chunks an edit touched, in full and nothing else. Their level 1 is
   * queued below rather than built here: on a field of statues it is half as
   * many faces again, and placing a block must cost what the block costs.
   */
  const progress = hint?.progress ?? null;
  let meshed = 0;
  for (const dirtyKey of dirty) {
    progress?.report("meshing", meshed++, dirty.size);
    const layers = await meshChunk(dirtyKey, false);
    if (layers.solid.indices.length === 0 && layers.filler.indices.length === 0) {
      // An all-air chunk holds nothing; dropping it keeps the concatenation
      // short rather than walking thousands of empty entries.
      chunks.delete(dirtyKey);
    } else {
      chunks.set(dirtyKey, layers);
    }
  }

  lap("mesh chunks");

  /*
   * Whether the document needs levels of detail at all: in `auto`, only when
   * its full mesh reaches the threshold. Counted over the chunks rather than
   * guessed from the volume, because the cost is in triangles -- a field of
   * statues is a small box and millions of them, a flat world a huge box and
   * few.
   */
  let triangles = 0;
  for (const layers of chunks.values()) triangles += layers.solid.indices.length / 3;
  const wanted =
    request !== null && (request.autoTriangles === null || triangles >= request.autoTriangles);

  /*
   * Level 1 of every chunk meshed without it: the ones an edit just touched,
   * and all of them the first time it is asked for. Those that hold no block
   * with a stand-in are settled by looking; the rest are queued and re-meshed
   * from the budget below, one at a time, keeping the full layers they had.
   * Meanwhile the viewer has no level 1 for them and draws them in full,
   * which is always right.
   */
  const pendingShapes = new Set<number>();
  if (wanted && askShapes) {
    let standIn: boolean[] | null = null;
    for (const [at, layers] of chunks) {
      if (layers.lod1Asked) continue;
      if (cache.pendingShapes.has(at)) {
        pendingShapes.add(at);
        continue;
      }
      standIn ??= struct.palette.map((entry) => lodShapeFor(entry) !== null);
      if (chunkHolds(struct, chunkCoords(at), frame, standIn)) pendingShapes.add(at);
      else chunks.set(at, { ...layers, lod1Asked: true });
    }
  }

  /*
   * The regions, for the far distance. Every one a re-meshed chunk can have
   * changed -- its own and the one across any region face it lies on, see
   * `staleRegions` -- is taken down now and queued, so the viewer shows the
   * chunks there until it is built again. Never built by an edit's own call.
   */
  const keepCoarse = wanted && request.coarse;
  const regions = new Map<number, RegionMeshes>();
  const pendingRegions = new Set<number>();
  let rebuiltRegions = 0;
  if (keepCoarse) {
    const occupied = new Set<number>();
    for (const at of chunks.keys()) {
      const [cx, cy, cz] = chunkCoords(at);
      occupied.add(
        chunkKey(Math.floor(cx / REGION_CHUNKS), Math.floor(cy / REGION_CHUNKS), Math.floor(cz / REGION_CHUNKS)),
      );
    }
    if (mode === "all" || !cache.coarseKept) {
      for (const at of occupied) pendingRegions.add(at);
    } else {
      /*
       * A stale region keeps the meshes it had until the rebuilt ones land.
       * A coarse level is shown only where a cell is a pixel or two across,
       * so an edit inside it is below a pixel there -- and taking the old
       * mesh down would drop the region to its full chunks and back again,
       * two changes on screen for one that cannot be seen. A full rebuild
       * (`mode === "all"`) is different: the atlas or the lighting moved, and
       * the old meshes are wrong, so they go.
       */
      const stale = staleRegions([...dirty].map((at) => chunkCoords(at)));
      for (const [at, meshes] of cache.regions) {
        if (occupied.has(at)) regions.set(at, meshes);
      }
      for (const at of cache.pendingRegions) if (occupied.has(at)) pendingRegions.add(at);
      for (const name of stale) {
        const [rx, ry, rz] = name.split(",").map(Number);
        const at = chunkKey(rx, ry, rz);
        if (occupied.has(at)) pendingRegions.add(at);
      }
    }
  }

  /*
   * The budget: what this call may spend on the queues. A deadline checked
   * before each piece, so one piece may run past it -- a region is ~10 ms --
   * and nothing else does.
   */
  const deadline = performance.now() + (request?.budgetMs ?? 0);
  // The regions first: ~10 ms each, and each one takes a whole region's
  // sixty-four draw calls down to one.
  if (keepCoarse && pendingRegions.size > 0 && performance.now() < deadline) {
    let inputs: CoarseInputs | null = null;
    for (const at of [...pendingRegions].sort((a, b) => a - b)) {
      if (performance.now() >= deadline) break;
      inputs ??= {
        struct,
        entries: await coarseEntries(struct, baker, voidIndices),
        atlasUv,
        light: lighting,
        solid: solidEntries(struct),
        frame,
        occlusion: shading !== null && shading.occlusion,
      };
      const built = buildRegionMeshes(inputs, chunkCoords(at));
      pendingRegions.delete(at);
      rebuiltRegions += 1;
      // Replacing whatever stood in for it meanwhile, or taking it down.
      if (built.lod2.indices.length > 0 || built.lod3.indices.length > 0) regions.set(at, built);
      else regions.delete(at);
    }
  }
  for (const at of [...pendingShapes].sort((a, b) => a - b)) {
    if (performance.now() >= deadline) break;
    const layers = chunks.get(at);
    pendingShapes.delete(at);
    if (layers === undefined) continue;
    const remeshed = await meshChunk(at, true);
    // The full layers it had, not the new ones: they are the same bytes, and
    // new arrays would be sent again for nothing.
    chunks.set(at, { ...layers, lod1: remeshed.lod1, lod1Asked: true });
  }
  lap("levels of detail");
  // Concatenated in a fixed chunk order so the same document always produces
  // the same bytes, however it was reached — which is what makes an
  // incremental build comparable to a rebuilt-from-scratch one.
  const ordered: MeshBuffers[] = [];
  const orderedKeys: number[] = [];
  const orderedVoid: MeshBuffers[] = [];
  const orderedVoidKeys: number[] = [];
  const lodPieces: LodPiece[] = [];
  for (let cz = range.from[2]; cz <= range.to[2]; cz += 1) {
    for (let cy = range.from[1]; cy <= range.to[1]; cy += 1) {
      for (let cx = range.from[0]; cx <= range.to[0]; cx += 1) {
        const at = chunkKey(cx, cy, cz);
        const piece = chunks.get(at);
        if (piece === undefined) continue;
        if (piece.solid.indices.length > 0) {
          ordered.push(piece.solid);
          orderedKeys.push(at);
        }
        if (piece.filler.indices.length > 0) {
          orderedVoid.push(piece.filler);
          orderedVoidKeys.push(at);
        }
        if (wanted && askShapes && piece.lod1 !== null && piece.lod1.buffers.indices.length > 0) {
          lodPieces.push({ layer: "lod1", key: at, buffers: piece.lod1.buffers, error: piece.lod1.error });
        }
      }
    }
  }
  // The regions in key order, which is a fixed order for the same reason the
  // chunks are walked in one: the same document, the same bytes.
  for (const [at, meshes] of [...regions].sort((a, b) => a[0] - b[0])) {
    if (meshes.lod2.indices.length > 0) {
      lodPieces.push({ layer: "lod2", key: at, buffers: meshes.lod2, error: COARSE_ERROR.lod2 });
    }
    if (meshes.lod3.indices.length > 0) {
      lodPieces.push({ layer: "lod3", key: at, buffers: meshes.lod3, error: COARSE_ERROR.lod3 });
    }
  }
  const lod: MeshLod = {
    state:
      request === null
        ? "off"
        : !wanted
          ? "below"
          : pendingRegions.size > 0 || pendingShapes.size > 0
            ? "pending"
            : "ready",
    triangles,
  };

  /*
   * The union, over chunks rather than over vertices.
   *
   * `Infinity` for an empty build, which is what the caller's `isFinite` guard
   * already reads as \"nothing here\" -- there is no box for geometry with no
   * vertices, and inventing one at the origin would frame a document that has
   * nothing in it as though it had something at (0, 0, 0).
   */
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const key of orderedKeys) {
    const box = chunks.get(key)?.bounds;
    if (box === undefined || box === null) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      if (box.min[axis] < min[axis]) min[axis] = box.min[axis];
      if (box.max[axis] > max[axis]) max[axis] = box.max[axis];
    }
  }

  lap("assemble");
  return {
    bounds: { min, max },
    pieces: ordered,
    pieceKeys: orderedKeys,
    voidPieces: orderedVoid,
    voidPieceKeys: orderedVoidKeys,
    lodPieces,
    lod,
    cache: {
      width,
      height,
      length,
      frame: [frame[0], frame[1], frame[2]],
      key,
      lightGrid: lighting,
      epoch: hint?.epoch ?? null,
      atlasVersion,
      // A copy, not the document's own array: the document keeps mutating it,
      // and a shared reference would compare equal to itself and see no change.
      voxels: snapshot,
      light,
      signs: written,
      banners: painted,
      voidKey,
      chunks,
      regions,
      pendingRegions,
      pendingShapes,
      coarseKept: keepCoarse,
    },
    rebuilt: dirty.size,
    rebuiltRegions,
    total:
      (range.to[0] - range.from[0] + 1) *
      (range.to[1] - range.from[1] + 1) *
      (range.to[2] - range.from[2] + 1),
  };
}
