/**
 * Which level of detail each part of the build is drawn at.
 *
 * For a document heavy enough to need them, main builds simpler versions of
 * the geometry beside the real one: level 1 per chunk, every complex block
 * drawn by a simplified shape; levels 2 and 3 per 64-block region, in blocks
 * two and four wide. This module decides where each one is shown, and the
 * rule is a screen-space error.
 *
 * Every level arrives with how far its surface may stray from the real one,
 * in blocks (`ChunkGeometry.lodError`), measured in main rather than guessed
 * here. A level is shown where that distance, projected at the *nearest*
 * point of what it covers, is smaller on screen than `lodPixels`. So nothing
 * changes up close, a camera inside a region always sees it in full, and
 * coming closer always brings the full mesh back.
 *
 * ## A change of level is crossed in time, with a dither
 *
 * When the level a chunk or a region should show changes, the two are drawn
 * together for `FADE_MS` and a 4x4 dither shares the pixels between them: the
 * finer one keeps a pixel where the dither's threshold is at or above `t`,
 * the coarser one where it is below, and `t` runs from one to the other. The
 * *same* `t` for both sides of a pair is what makes the two patterns exact
 * complements, so the crossing has no holes and draws no pixel twice -- which
 * is why a region crossing to level 2 hands its own `t` to every chunk in it.
 *
 * In time and not in distance, and that was measured. A band of distance in
 * which both levels are drawn is a band where a chunk costs both: a camera
 * stopped with a row of statue chunks inside it drew 10% more triangles than
 * with no levels at all. Crossed in a quarter of a second, a still camera
 * draws one level of everything.
 *
 * `HYSTERESIS` keeps a level until the error is a tenth past the threshold
 * and takes the next one only a tenth before it, so a camera resting at a
 * threshold does not cross back and forth.
 *
 * A plain module for `selection_drag.ts`'s reason: this runs from the
 * rendering steps, which the browser harness here does not run.
 */

import type { ChunkLayer } from "../../../shared/ipc.js";

/** A chunk's side in blocks: main's `CHUNK_SIZE`. */
export const CHUNK_SIZE = 16;
/** A region's side in chunks: main's `REGION_CHUNKS`. */
export const REGION_CHUNKS = 4;

/*
 * Main's key packing, from `chunkKey`/`chunkCoords`: three signed coordinates
 * biased into one number. Regions use the same packing with their own
 * coordinates, which is what lets a region key name the same place in both
 * processes. `tests/ui.ts` holds the two copies equal.
 */
const KEY_BIAS = 32768;
const KEY_SPAN = 65536;

export function packKey(x: number, y: number, z: number): number {
  return x + KEY_BIAS + KEY_SPAN * (y + KEY_BIAS + KEY_SPAN * (z + KEY_BIAS));
}

export function unpackKey(key: number): [number, number, number] {
  const x = (key % KEY_SPAN) - KEY_BIAS;
  const rest = Math.floor(key / KEY_SPAN);
  const y = (rest % KEY_SPAN) - KEY_BIAS;
  const z = Math.floor(rest / KEY_SPAN) - KEY_BIAS;
  return [x, y, z];
}

/** The region a chunk belongs to. Chunk coordinates may be negative. */
export function regionOfChunk(chunkKey: number): number {
  const [cx, cy, cz] = unpackKey(chunkKey);
  return packKey(
    Math.floor(cx / REGION_CHUNKS),
    Math.floor(cy / REGION_CHUNKS),
    Math.floor(cz / REGION_CHUNKS),
  );
}

/** How the viewer names a mesh: by layer *and* key, for `chunkMeshes`' reason. */
export function meshKey(layer: ChunkLayer, key: number): string {
  return `${layer}:${key}`;
}

/** A box in content coordinates, which is what the chunk geometry is in. */
export interface LodBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** What the selection needs to know about the camera. */
export interface LodView {
  /** The camera's `matrixWorldInverse.elements`: column-major, world to view. */
  readonly view: ArrayLike<number>;
  readonly perspective: boolean;
  /** Vertical field of view in degrees; read only for a perspective camera. */
  readonly fovDeg: number;
  /** Visible height in world units, `(top - bottom) / zoom`; orthographic only. */
  readonly orthoHeight: number;
  readonly near: number;
  /**
   * Pixels along the viewport's height, as drawn before any supersampling:
   * `renderScale` above 1 makes no pixel smaller to the eye.
   */
  readonly heightPx: number;
  /** Where the chunks' group stands: a content cell plus this is the world. */
  readonly offset: readonly [number, number, number];
}

/**
 * How far in front of the camera the nearest point of a box is.
 *
 * View-space depth is linear in the point, so its minimum over a box is at a
 * corner. Never less than the near plane, which is also the answer for a
 * camera inside the box -- and the full mesh, as it should be.
 *
 * Depth along the view direction and not the distance to the camera: a
 * perspective camera's pixel covers `2 z tan(fov / 2) / H` at depth `z`, so
 * using the distance would call things at the edge of the screen smaller than
 * they are and choose a coarser level there than the error allows.
 */
export function nearestDepth(view: LodView, box: LodBox): number {
  const m = view.view;
  const [ox, oy, oz] = view.offset;
  let least = Infinity;
  for (let corner = 0; corner < 8; corner += 1) {
    const x = ((corner & 4) !== 0 ? box.maxX : box.minX) + ox;
    const y = ((corner & 2) !== 0 ? box.maxY : box.minY) + oy;
    const z = ((corner & 1) !== 0 ? box.maxZ : box.minZ) + oz;
    const depth = -(m[2] * x + m[6] * y + m[10] * z + m[14]);
    if (depth < least) least = depth;
  }
  return Math.max(view.near, least);
}

/** World units one pixel covers at that depth. */
export function worldPerPixel(view: LodView, depth: number): number {
  const height = Math.max(1, view.heightPx);
  if (!view.perspective) return view.orthoHeight / height;
  return (2 * depth * Math.tan((view.fovDeg * Math.PI) / 360)) / height;
}

/** How large an error of `blocks` looks, in pixels, at the nearest point of a box. */
export function errorPixels(view: LodView, box: LodBox, blocks: number): number {
  return blocks / worldPerPixel(view, nearestDepth(view, box));
}

/** How far past the threshold a level is kept, and how far before it a level is taken. */
export const HYSTERESIS = 0.1;

/** How long crossing from one level to the next takes, in milliseconds. */
export const FADE_MS = 250;

/**
 * Whether a level that errs by `errorPx` may be shown: a level already shown
 * is kept up to a tenth past the threshold, and one that is not is taken only
 * a tenth before it.
 */
export function allowed(errorPx: number, pixels: number, held: boolean): boolean {
  return errorPx <= pixels * (held ? 1 + HYSTERESIS : 1 - HYSTERESIS);
}

/** One chunk of the full mesh, and its level 1 if it has one. */
export interface LodChunk {
  readonly key: number;
  readonly box: LodBox;
  /** Level 1's error in blocks, or `null` where this chunk has none. */
  readonly shapes: number | null;
}

/** One region: its chunks, and the coarse levels held for it. */
export interface LodRegion {
  readonly key: number;
  /** The union of its chunks' boxes. */
  readonly box: LodBox;
  /** Each coarse level's error in blocks, or `null` where it is not held. */
  readonly lod2: number | null;
  readonly lod3: number | null;
  readonly chunks: readonly LodChunk[];
}

/** Which kinds of level the settings allow. */
export interface LodLevels {
  readonly shapes: boolean;
  readonly coarse: boolean;
}

/** What a region shows: its chunks (`0`), or a coarse level. */
export type RegionLevel = 0 | 2 | 3;
/** What a chunk shows: the full mesh (`0`), or level 1. */
export type ChunkLevel = 0 | 1;

/** The coarsest level a region may show, given the one it shows now. */
export function regionTarget(
  view: LodView,
  region: LodRegion,
  pixels: number,
  levels: LodLevels,
  current: RegionLevel,
): RegionLevel {
  const lod2 = levels.coarse ? region.lod2 : null;
  const lod3 = levels.coarse ? region.lod3 : null;
  if (lod2 === null && lod3 === null) return 0;
  const perPixel = worldPerPixel(view, nearestDepth(view, region.box));
  if (lod3 !== null && allowed(lod3 / perPixel, pixels, current === 3)) return 3;
  if (lod2 !== null && allowed(lod2 / perPixel, pixels, current >= 2)) return 2;
  return 0;
}

/** The level a chunk may show, given the one it shows now. */
export function chunkTarget(
  view: LodView,
  chunk: LodChunk,
  pixels: number,
  levels: LodLevels,
  current: ChunkLevel,
): ChunkLevel {
  const shapes = levels.shapes ? chunk.shapes : null;
  if (shapes === null) return 0;
  return allowed(errorPixels(view, chunk.box, shapes), pixels, current === 1) ? 1 : 0;
}

/**
 * How one mesh is drawn: `null` in full, or as one side of a crossing -- the
 * finer side keeps the pixels whose threshold is at or above `t`, the coarser
 * side the ones below it.
 */
export type LodDraw = null | { readonly t: number; readonly coarse: boolean };

/** What was chosen, for the frame counter and the stutter report. */
export interface LodStats {
  /** Chunks drawn from the full mesh. */
  full: number;
  /** Chunks drawn at level 1. */
  shapes: number;
  /** Regions drawn at level 2 and level 3. */
  lod2: number;
  lod3: number;
  /** Meshes drawn as one side of a crossing. */
  fading: number;
}

/** A level, and the one it is being crossed from since `start`. */
interface Crossing<L extends number> {
  level: L;
  from: L;
  start: number;
}

/** How far a crossing has gone, 0 to 1; a settled level is 1. */
function progress<L extends number>(crossing: Crossing<L>, now: number): number {
  if (crossing.from === crossing.level) return 1;
  return Math.min(1, Math.max(0, (now - crossing.start) / FADE_MS));
}

/** Where a crossing is aimed now, starting from whichever level it mostly shows. */
function retarget<L extends number>(crossing: Crossing<L>, target: L, now: number): Crossing<L> {
  if (target === crossing.level) return crossing;
  const shown = progress(crossing, now) >= 0.5 ? crossing.level : crossing.from;
  return shown === target ? { level: target, from: target, start: now } : { level: target, from: shown, start: now };
}

/**
 * Chooses the levels frame by frame, and remembers what each region and chunk
 * shows so a change can be crossed rather than jumped.
 */
export class LodSelector {
  private readonly regions = new Map<number, Crossing<RegionLevel>>();
  private readonly chunks = new Map<number, Crossing<ChunkLevel>>();
  /** Whether a crossing is still running: the viewer keeps drawing until it ends. */
  fading = false;

  /** Forgets every level, so the next choice shows each one at once. */
  reset(): void {
    this.regions.clear();
    this.chunks.clear();
    this.fading = false;
  }

  /**
   * Every mesh to draw at `now`, and how; anything absent from `out` is
   * hidden. The void layer is not this module's: it is drawn as it always was.
   */
  choose(
    view: LodView,
    regions: Iterable<LodRegion>,
    pixels: number,
    levels: LodLevels,
    now: number,
    out: Map<string, LodDraw>,
  ): LodStats {
    out.clear();
    this.fading = false;
    const stats: LodStats = { full: 0, shapes: 0, lod2: 0, lod3: 0, fading: 0 };
    const draw = (layer: ChunkLayer, key: number, how: LodDraw) => {
      out.set(meshKey(layer, key), how);
      if (how !== null) stats.fading += 1;
      if (layer === "solid") stats.full += 1;
      else if (layer === "lod1") stats.shapes += 1;
      else if (layer === "lod2") stats.lod2 += 1;
      else if (layer === "lod3") stats.lod3 += 1;
    };
    const seenRegions = new Set<number>();
    const seenChunks = new Set<number>();
    for (const region of regions) {
      seenRegions.add(region.key);
      const holds = (level: RegionLevel): boolean =>
        level === 0 || (levels.coarse && (level === 2 ? region.lod2 : region.lod3) !== null);
      let crossing = this.regions.get(region.key);
      // A level whose mesh has gone -- an edit took it down -- cannot be
      // crossed from or held: the region settles at once on what it has.
      if (crossing !== undefined && (!holds(crossing.level) || !holds(crossing.from))) {
        const level = holds(crossing.level) ? crossing.level : 0;
        crossing = { level, from: level, start: now };
      }
      const target = regionTarget(view, region, pixels, levels, crossing?.level ?? 0);
      crossing = crossing === undefined ? { level: target, from: target, start: now } : retarget(crossing, target, now);
      let t = progress(crossing, now);
      if (t >= 1 && crossing.from !== crossing.level) {
        crossing = { level: crossing.level, from: crossing.level, start: crossing.start };
      }
      this.regions.set(region.key, crossing);
      if (t < 1) this.fading = true;

      if (crossing.from === crossing.level) {
        if (crossing.level === 3) {
          draw("lod3", region.key, null);
          continue;
        }
        if (crossing.level === 2) {
          draw("lod2", region.key, null);
          continue;
        }
        t = 1;
      }
      /*
       * A crossing between a coarse level and something finer: the coarse
       * mesh on one side, and on the other either level 2 or the region's
       * chunks, each at the level it settles on -- two dithers on one mesh
       * would be one too many, so a chunk does not cross while its region
       * does.
       */
      let chunksSide: LodDraw = null;
      if (crossing.from !== crossing.level) {
        const coarse = Math.max(crossing.from, crossing.level) as RegionLevel;
        const fine = Math.min(crossing.from, crossing.level) as RegionLevel;
        const tCoarse = crossing.level === coarse ? t : 1 - t;
        draw(coarse === 3 ? "lod3" : "lod2", region.key, { t: tCoarse, coarse: true });
        if (fine === 2) {
          draw("lod2", region.key, { t: tCoarse, coarse: false });
          continue;
        }
        chunksSide = { t: tCoarse, coarse: false };
      }
      for (const chunk of region.chunks) {
        seenChunks.add(chunk.key);
        const holdsShapes = levels.shapes && chunk.shapes !== null;
        let own = this.chunks.get(chunk.key);
        if (own !== undefined && !holdsShapes && (own.level === 1 || own.from === 1)) {
          own = { level: 0, from: 0, start: now };
        }
        const aim = chunkTarget(view, chunk, pixels, levels, own?.level ?? 0);
        if (chunksSide !== null) {
          // Settled at once while its region crosses; see above.
          own = { level: aim, from: aim, start: now };
          this.chunks.set(chunk.key, own);
          draw(aim === 1 ? "lod1" : "solid", chunk.key, chunksSide);
          continue;
        }
        own = own === undefined ? { level: aim, from: aim, start: now } : retarget(own, aim, now);
        const u = progress(own, now);
        if (u >= 1 && own.from !== own.level) own = { level: own.level, from: own.level, start: own.start };
        this.chunks.set(chunk.key, own);
        if (own.from === own.level) {
          draw(own.level === 1 ? "lod1" : "solid", chunk.key, null);
          continue;
        }
        this.fading = true;
        const tShapes = own.level === 1 ? u : 1 - u;
        draw("lod1", chunk.key, { t: tShapes, coarse: true });
        draw("solid", chunk.key, { t: tShapes, coarse: false });
      }
    }
    // What is no longer there is forgotten, so a key reused later starts afresh.
    for (const key of this.regions.keys()) if (!seenRegions.has(key)) this.regions.delete(key);
    for (const key of this.chunks.keys()) if (!seenChunks.has(key)) this.chunks.delete(key);
    return stats;
  }
}

/**
 * The thresholds of a 4x4 ordered dither, row by row, in sixteenths offset
 * by half of one so that none is exactly 0 or 1: `t = 0` then keeps every
 * pixel of the fine side and `t = 1` every pixel of the coarse one.
 */
export const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (rank) => (rank + 0.5) / 16,
);

/** Whether a pixel is drawn by the side of a crossing that `draw` names. */
export function keepsPixel(draw: LodDraw, x: number, y: number): boolean {
  if (draw === null) return true;
  const threshold = BAYER_4X4[(y & 3) * 4 + (x & 3)];
  return draw.coarse ? threshold < draw.t : threshold >= draw.t;
}
