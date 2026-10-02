/**
 * Ported from `app/preview.py` (`build_preview`, `PreviewOptions`,
 * `PreviewPayload`) plus `component.py:419-434`'s `_cached_preview`.
 *
 * Two things from the Python version deliberately do not survive
 * (ARCHITECTURE.md §3 "Viewer lifecycle"):
 *
 * 1. **base64.** `preview.py:88-89` encoded the GLB so it could be embedded in
 *    the viewer HTML that Streamlit injected into an iframe. The renderer here
 *    receives the raw bytes over IPC.
 * 2. **The temp directory.** `preview.py:69-87` wrote the schem and the
 *    resource pack to a `TemporaryDirectory` only because `load_structure` and
 *    `ModelBaker` take paths, not bytes. The Electron flow already has real
 *    paths (the file picker returns one), so the round-trip through disk is
 *    gone; callers that only hold bytes write them once, up front.
 *
 * `PreviewPayload.to_viewer_params` is gone entirely -- that dict existed to
 * be JSON-embedded in the viewer template. Its fields are now the typed
 * `PreviewSuccess` in `shared/ipc.ts`.
 */

import { createHash } from "crypto";
import { readFile } from "fs/promises";

import {
  DEFAULT_BIOME_COLOR,
  DEFAULT_WATER_COLOR,
  type PreviewSettings,
} from "../../shared/settings.js";
import {
  appendTiles,
  buildAtlas,
  packAtlas,
  tilePixels,
  type GrowableAtlas,
} from "../pipeline/atlas.js";
import type {
  AtlasAnimation,
  AtlasPatch,
  ChunkGeometry,
  ChunkLayer,
  MeshAtlas,
  MeshPayload,
} from "../../shared/ipc.js";
import { loadStructure } from "../pipeline/loader.js";
import type { SchematicFormat } from "../pipeline/loader_formats.js";
import { buildMesh, culledFaces } from "../pipeline/mesher.js";
import { isSignBlock, readSignText, signColour, type SignText } from "../pipeline/sign_text.js";
import { ModelBaker, type TextureAnimation } from "../pipeline/model_baker.js";
import { normalizePalette } from "../pipeline/translate.js";
import {
  paletteEntryCacheKey,
  matchesBlockPattern,
  paletteEntryIsAir,
  type MeshBuffers,
  type PaletteEntry,
  type StructureData,
} from "../pipeline/types.js";
import { parsePaletteEntry } from "../pipeline/loader_formats.js";
import {
  getBlock,
  takeVoxelChanges,
  toStructureData,
  type SchematicDocument,
} from "../domain/document.js";
import { readBanner } from "../pipeline/banner_nbt.js";
import { DYE_COLOURS } from "../pipeline/block_shapes.js";
import { bannerBlockColor, bannerFormat, isBannerBlock } from "../../shared/banner_patterns.js";
import { documentEra } from "../../shared/mc_versions.js";
import { breathe } from "./breathing.js";
import {
  buildChunkedMesh,
  createChunkMeshCache,
  type ChunkMeshCache,
  type MeshBounds,
} from "../pipeline/chunked_mesh.js";
import { carryLight, computeLight, relight, type LightGrid } from "../pipeline/lighting.js";

/** preview.py:66-67 -- "50 MB is generous for a .schem file". */
export const MAX_SCHEM_BYTES = 50 * 1024 * 1024;

export class PreviewTooLargeError extends Error {
  constructor() {
    super("Schematic too large to preview (over 50 MB)");
    this.name = "PreviewTooLargeError";
  }
}

/**
 * The schematic decoded, but produced no drawable geometry.
 *
 * This used to be the quietest failure in the app: `mesher.ts` drops faces it
 * cannot resolve (an unknown face name, a texture missing from the atlas), and
 * when *every* face drops, `gltf_builder.ts` still emits a structurally valid
 * GLB with zero primitives and a zero bounding box. The renderer parsed it
 * without complaint and drew nothing, so a schematic full of blocks the
 * resource pack could not texture was indistinguishable from a dead button.
 */
export class EmptyPreviewError extends Error {
  constructor(readonly blockCount: number) {
    super(
      blockCount === 0
        ? "The schematic contains no blocks other than air"
        : `The schematic decoded to ${blockCount} block(s) but produced no visible geometry ` +
          `— none of its blocks could be matched to a model in the resource pack`,
    );
    this.name = "EmptyPreviewError";
  }
}

export interface PreviewResult {
  mesh: MeshPayload;
  center: [number, number, number];
  size: [number, number, number];
}

/**
 * The bounding box of some geometry, as `meshToGlb` used to report it.
 *
 * Midpoint and extent, which is what the viewer frames on. Computed here now
 * that nothing builds a container to ask.
 */
function boundsOf(pieces: readonly MeshBuffers[]): {
  center: [number, number, number];
  size: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const piece of pieces) {
    for (let i = 0; i < piece.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = piece.positions[i + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }
  return extentOf({ min, max });
}

/**
 * A box as midpoint and extent, which is what the viewer's caption reads.
 *
 * Split out of `boundsOf` because the chunked path no longer walks vertices
 * to find the box -- every chunk carries its own and the union is O(chunks) --
 * while the single-mesh preview path still has one mesh and nothing cheaper to
 * ask. Two ways to the box, one way to the sentence about it.
 *
 * `Infinity` means there were no vertices at all, which is a document with
 * nothing in it: a zero box at the origin says so without claiming there is
 * something there.
 */
function extentOf(box: MeshBounds): {
  center: [number, number, number];
  size: [number, number, number];
} {
  const { min, max } = box;
  if (!Number.isFinite(min[0])) {
    return { center: [0, 0, 0], size: [0, 0, 0] };
  }
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

/**
 * Where each moving texture's tile sits in the atlas, and its frames.
 *
 * The position is read back out of the UV rect rather than returned by the
 * packer, because the rect is the only thing that survives into the payload and
 * two sources for one number is how they come to disagree. It is exact: the
 * rect is the tile inset half a pixel at each edge, so the tile spans
 * `(u1 - u0) * width + 1` pixels starting at `u0 * width - 0.5`.
 *
 * A texture whose frames are not the size of its tile is skipped rather than
 * resized. That happens only past `MAX_TILE` — a 512px animated sheet in some
 * pack — and leaving it on frame 0 is what the app did before any of this.
 */
export function atlasAnimations(
  atlas: ReturnType<typeof buildAtlas>,
  animations: Readonly<Record<string, TextureAnimation>>,
  only: ReadonlySet<string> | null = null,
): AtlasAnimation[] {
  const out: AtlasAnimation[] = [];
  const { width, height } = atlas.image;
  for (const [key, animation] of Object.entries(animations)) {
    if (only !== null && !only.has(key)) continue;
    const rect = atlas.uvRects[key];
    if (rect === undefined) continue;
    const size = Math.round((rect[2] - rect[0]) * width) + 1;
    if (animation.frames.some((frame) => frame.width !== size || frame.height !== size)) continue;
    const bytes = size * size * 4;
    const frames = new Uint8Array(bytes * animation.frames.length);
    animation.frames.forEach((frame, index) => frames.set(frame.data, index * bytes));
    out.push({
      x: Math.round(rect[0] * width - 0.5),
      y: Math.round(rect[1] * height - 0.5),
      size,
      frames,
      frameCount: animation.frames.length,
      frameTime: animation.frameTime,
    });
  }
  return out;
}

/**
 * An atlas as it stands, and what it has had added since it was packed.
 *
 * What `shipMesh` decides from: the whole sheet for a renderer that holds
 * another layout, the tiles added since its version for one that holds this
 * one, and nothing for one that is up to date. Built here and sent from
 * there, because only the session knows what the renderer holds -- and
 * building the payload's atlas eagerly copied every animation frame on every
 * mesh request, sent or not.
 */
export interface AtlasSource {
  readonly atlas: GrowableAtlas;
  /** The texture count: grows with every tile added. */
  readonly version: number;
  /** Which packing; see `MeshAtlas.layout`. */
  readonly layout: number;
  /** The version the layout was packed at. A renderer behind it needs the sheet. */
  readonly layoutSince: number;
  /** Tiles added to this layout after it was packed, and the version each one made. */
  readonly added: readonly { key: string; at: number }[];
  readonly animations: Readonly<Record<string, TextureAnimation>>;
}

/** The whole sheet, for a renderer holding nothing or another layout. */
export function fullAtlas(source: AtlasSource): MeshAtlas {
  return {
    width: source.atlas.image.width,
    height: source.atlas.image.height,
    pixels: source.atlas.image.data,
    version: source.version,
    layout: source.layout,
    animations: atlasAnimations(source.atlas, source.animations),
  };
}

/**
 * What to send a renderer that says it holds `version` of `layout`: the sheet,
 * the tiles added since, or nothing at all.
 */
export function atlasFor(
  source: AtlasSource,
  held: { version: number | null; layout: number | null },
): { atlas: MeshAtlas | null; patch: AtlasPatch | null } {
  if (held.layout !== source.layout || held.version === null || held.version < source.layoutSince) {
    return { atlas: fullAtlas(source), patch: null };
  }
  if (held.version >= source.version) return { atlas: null, patch: null };
  const keys = source.added.filter((entry) => entry.at > held.version!).map((entry) => entry.key);
  const tiles = keys.flatMap((key) => {
    const tile = tilePixels(source.atlas, key);
    return tile === null ? [] : [tile];
  });
  return {
    atlas: null,
    patch: {
      layout: source.layout,
      version: source.version,
      tiles,
      animations: atlasAnimations(source.atlas, source.animations, new Set(keys)),
    },
  };
}

/** Geometry, in the shape the renderer draws from; the atlas is `atlasFor`'s. */
function toMeshPayload(
  pieces: readonly MeshBuffers[],
  keys: readonly number[],
  source: AtlasSource,
  voidPieces: readonly MeshBuffers[] = [],
  voidKeys: readonly number[] = [],
  frame: readonly [number, number, number] = [0, 0, 0],
): MeshPayload {
  const geometry = (
    buffers: readonly MeshBuffers[],
    from: readonly number[],
    layer: ChunkLayer,
  ): ChunkGeometry[] =>
    buffers.map((piece, index) => ({
      key: from[index] ?? 0,
      layer,
      positions: piece.positions,
      normals: piece.normals,
      uvs: piece.uvs,
      indices: piece.indices,
      light: piece.light,
      opaqueIndices: piece.opaqueIndices,
    }));
  return {
    chunks: [
      ...geometry(pieces, keys, "solid"),
      ...geometry(voidPieces, voidKeys, "void"),
    ],
    // A whole payload says what exists by listing it; there is nothing left
    // over to take down, and no token because nothing here is incremental.
    dropped: [],
    partial: false,
    token: "",
    atlas: null,
    atlasVersion: source.version,
    atlasLayout: source.layout,
    atlasPatch: null,
    frame: [frame[0], frame[1], frame[2]],
  };
}

/**
 * `@st.cache_data` replacement. Kept for the reason the decorator was there in
 * the first place -- meshing a large schematic is seconds of CPU, and
 * "Re-render" exists precisely to re-run it with the same input.
 *
 * Note the cache key covers only what actually changes the GLB: the schematic
 * bytes and the resource pack. The lighting/camera fields of `PreviewSettings`
 * are consumed by the *viewer*, not the mesher, so including them would
 * needlessly evict on every slider move -- which is also why they are returned
 * alongside the cached GLB rather than baked into it.
 */
const CACHE_LIMIT = 8;

/**
 * Field separator for the cache key, so that two different field splits cannot
 * hash the same ("ab" + "c" must not collide with "a" + "bc").
 *
 * It used to be a literal NUL byte, which works but made git classify this
 * source file as **binary** -- no diffs, no merges, no review on it. A newline
 * separates just as unambiguously here: every field is a hex colour or a
 * filesystem path, and none of them can contain one.
 */
const SEPARATOR = "\n";
type CachedPreview = PreviewResult & {
  format: SchematicFormat;
  unmappedLegacyIds: readonly string[];
};
const cache = new Map<string, CachedPreview>();

function cacheKey(
  schemBytes: Uint8Array,
  resourcePackPath: string | null,
  fallbackResourcePackPath: string | null,
  biomeColor: string,
  waterColor: string,
  showMarkers: boolean,
  voidBlock: string,
): string {
  const hash = createHash("sha256");
  hash.update(schemBytes);
  // The tints are baked into the atlas, so they change the GLB — unlike the
  // rest of PreviewSettings, which the viewer applies without a rebuild.
  hash.update(biomeColor);
  hash.update(SEPARATOR);
  hash.update(waterColor);
  hash.update(SEPARATOR);
  // Same class of input as the tints: it changes the mesh and nothing else in
  // this key would notice, so a preview cached with markers shown would be
  // handed back to a caller that asked for them hidden.
  hash.update(showMarkers ? "markers" : "no-markers");
  hash.update(voidBlock);
  hash.update(SEPARATOR);
  // The pack paths, not their bytes: the bundled pack is 17 MB and hashing it
  // on every preview would cost more than the mesh build this cache exists to
  // avoid. Paths are stable identifiers here — the bundled one ships with the
  // app, and a user-picked one changing underneath us mid-session is not a case
  // worth paying that price for.
  hash.update(resourcePackPath ?? "");
  hash.update(SEPARATOR);
  hash.update(fallbackResourcePackPath ?? "");
  return hash.digest("hex");
}

/**
 * Model bakers, kept alive across previews.
 *
 * `ModelBaker.create` opens the resource pack -- 17 MB of zip for the bundled
 * one -- and everything it accumulates afterwards (baked blockstates, decoded
 * textures) is a pure function of the pack and the two tints. So a baker can be
 * reused by any preview that agrees on those four things, which during an
 * editing session means all of them.
 *
 * That is what takes the pack read out of the edit loop: with the baker cached,
 * re-previewing after a change is culling, atlas and mesh, and no I/O at all.
 *
 * The texture set only ever grows, so the atlas is memoised against its size --
 * a count that changes exactly when a block the pack had not been asked for
 * before shows up.
 */
interface CachedBaker {
  baker: ModelBaker;
  atlas: GrowableAtlas | null;
  atlasTextureCount: number;
  /** Which packing this is, and the count it was packed at; see `AtlasSource`. */
  layout: number;
  layoutSince: number;
  added: { key: string; at: number }[];
}

const BAKER_CACHE_LIMIT = 3;
const bakers = new Map<string, CachedBaker>();

function bakerKey(
  resourcePackPath: string | null,
  fallbackResourcePackPath: string | null,
  biomeColor: string,
  waterColor: string,
): string {
  return [resourcePackPath ?? "", fallbackResourcePackPath ?? "", biomeColor, waterColor].join(
    SEPARATOR,
  );
}

async function cachedBaker(
  resourcePackPath: string | null,
  fallbackResourcePackPath: string | null,
  biomeColor: string,
  waterColor: string,
): Promise<CachedBaker> {
  const key = bakerKey(resourcePackPath, fallbackResourcePackPath, biomeColor, waterColor);
  const hit = bakers.get(key);
  if (hit) {
    bakers.delete(key);
    bakers.set(key, hit);
    return hit;
  }
  const entry: CachedBaker = {
    baker: await ModelBaker.create(
      resourcePackPath,
      fallbackResourcePackPath,
      biomeColor,
      waterColor,
    ),
    atlas: null,
    atlasTextureCount: -1,
    layout: 0,
    layoutSince: 0,
    added: [],
  };
  bakers.set(key, entry);
  while (bakers.size > BAKER_CACHE_LIMIT) {
    const oldest = bakers.keys().next();
    if (oldest.done) break;
    bakers.delete(oldest.value);
  }
  return entry;
}

/**
 * How much empty sheet a packing keeps for tiles that arrive later.
 *
 * Measured against what arrives in practice after the warm-up has decoded
 * every block's first state: the other states (a lit furnace, an upper half),
 * the letters on signs, banner designs and tints -- small tiles, and few of
 * them. A sixth of the sheet is thousands of letters. Past it the sheet is
 * packed again, which is what every arrival used to cost.
 */
const ATLAS_RESERVE = 0.15;

/** Layouts packed in this process, so each one is told apart from the last. */
let layouts = 0;

/**
 * The atlas for whatever the baker has decoded so far, grown only when that
 * grew.
 *
 * The texture count is the atlas's version. A new texture goes into the
 * sheet's reserve and leaves every other tile where it was, so the layout --
 * which is what `chunked_mesh.ts` keys its UVs on -- does not move; only when
 * the reserve is full is the sheet packed again, as a new layout.
 */
function cachedAtlas(entry: CachedBaker): AtlasSource {
  const textures = entry.baker.textures;
  const count = Object.keys(textures).length;
  if (entry.atlas !== null && entry.atlasTextureCount !== count) {
    const fresh = Object.keys(textures).filter((key) => !entry.atlas!.layout.placed.has(key));
    if (appendTiles(entry.atlas, textures, fresh)) {
      for (const key of fresh.sort()) entry.added.push({ key, at: count });
      entry.atlasTextureCount = count;
    } else {
      entry.atlas = null;
    }
  }
  if (entry.atlas === null) {
    entry.atlas = packAtlas(textures, undefined, undefined, ATLAS_RESERVE);
    entry.atlasTextureCount = count;
    entry.layout = ++layouts;
    entry.layoutSince = count;
    entry.added = [];
    atlasBuilds += 1;
  }
  return {
    atlas: entry.atlas,
    version: entry.atlasTextureCount,
    layout: entry.layout,
    layoutSince: entry.layoutSince,
    added: entry.added,
    animations: entry.baker.animations,
  };
}

/**
 * How many times an atlas has been packed, for the life of the process.
 *
 * A counter exists because the cost of getting this wrong is invisible and
 * enormous. Packing is O(every texture decoded so far), and the texture set
 * grows as blocks are asked for -- so a loop that meshes nine hundred blocks
 * one at a time packs the atlas nine hundred times, over an ever-larger set,
 * and takes 39 seconds to do 1 second of work. Nothing about that reads as a
 * defect from the outside: it is the right picture, slowly.
 *
 * `tests/services.ts` reads this and requires a warm-up to pack **once**.
 */
let atlasBuilds = 0;

export function atlasBuildCount(): number {
  return atlasBuilds;
}

export function clearBakerCache(): void {
  bakers.clear();
}

export interface BuildPreviewOptions {
  /** Whether barriers and structure voids are drawn. Default true. */
  showMarkers?: boolean;
  schemPath: string;
  resourcePackPath: string | null;
  /**
   * The bundled pack, used for any texture the user's pack does not provide (or
   * for everything, when they have not picked one). Resolved by the caller —
   * `services/resources.ts`'s `defaultResourcePackPath` — so this module stays
   * free of Electron imports and testable headlessly.
   */
  fallbackResourcePackPath?: string | null;
  /**
   * The vendored pre-1.13 block table, needed only to read legacy MCEdit
   * `.schematic` files. Resolved by the caller for the same reason as the
   * pack paths above: this module imports no Electron.
   */
  legacyBlocksPath?: string | null;
  /** `#rrggbb`; see `PreviewSettings.biomeColor`. */
  biomeColor?: string;
  /** `#rrggbb`; see `PreviewSettings.waterColor`. */
  waterColor?: string;
}

export interface BuildPreviewOutcome extends PreviewResult {
  cached: boolean;
  format: SchematicFormat;
  /** MCEdit only: `id:meta` pairs with no entry in the flattening table. */
  unmappedLegacyIds: readonly string[];
}

/**
 * Which palette entries some cell holds.
 *
 * A document keeps its counts as it is edited (`SchematicDocument.counts`),
 * so the answer is one array read per entry. A file being previewed has no
 * counts and is walked once.
 */
type Presence = (index: number) => boolean;

function presenceOf(structure: StructureData): Presence {
  const present = new Set(structure.voxels);
  return (index) => present.has(index);
}

function documentPresence(doc: SchematicDocument): Presence {
  return (index) => (doc.counts[index] ?? 0) > 0;
}

/** Non-air voxels, used to tell "empty schematic" from "nothing was drawable". */
function countSolidBlocks(structure: StructureData): number {
  const airIndices = new Set<number>();
  structure.palette.forEach((entry, index) => {
    // `paletteEntryIsAir` rather than a literal: it also covers `cave_air` and
    // `void_air`, which a schematic cut out of a cave is full of.
    if (paletteEntryIsAir(entry)) {
      airIndices.add(index);
    }
  });
  let count = 0;
  for (const index of structure.voxels) {
    if (!airIndices.has(index)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Names palette entries that are present in the voxels but contributed no
 * geometry at all.
 *
 * Two places drop faces without a word: `mesher.ts` skips a face whose name the
 * baked block does not carry, and `buildMesh` skips one whose texture never
 * made it into the atlas. Until now the only alarm was `EmptyPreviewError`, and
 * only when *everything* fell -- so "the walls of my house are missing" left no
 * trace anywhere. This is that trace.
 */
async function warnAboutBlocksWithNoGeometry(
  structure: StructureData,
  baker: ModelBaker,
  atlasUvKeys: ReadonlySet<string>,
  present: Presence,
): Promise<void> {
  const silent: string[] = [];
  for (const [index, entry] of structure.palette.entries()) {
    if (!present(index) || paletteEntryIsAir(entry)) {
      continue;
    }
    const baked = await baker.bakeBlockstate(entry);
    const keys = [
      ...(baked.isFullCube ? Object.values(baked.faces) : []),
      ...baked.extraFaces,
    ].map((face) => face.textureKey);
    // Not "did this block end up on screen" — a block can legitimately have
    // every face culled by its neighbours. The question is whether it *could*
    // have drawn anything: no faces to emit, or no texture for any of them.
    if (keys.length === 0 || keys.every((key) => !atlasUvKeys.has(key))) {
      silent.push(paletteEntryCacheKey(entry));
    }
  }
  if (silent.length > 0) {
    console.warn(
      `[preview] ${silent.length} block type(s) present in the schematic can draw ` +
        `nothing and are invisible in the preview: ${silent.join(", ")}`,
    );
  }
}

export async function buildPreview(options: BuildPreviewOptions): Promise<BuildPreviewOutcome> {
  const schemBytes = await readFile(options.schemPath);
  if (schemBytes.length > MAX_SCHEM_BYTES) {
    throw new PreviewTooLargeError();
  }
  const fallbackResourcePackPath = options.fallbackResourcePackPath ?? null;

  const biomeColor = options.biomeColor ?? DEFAULT_BIOME_COLOR;
  const waterColor = options.waterColor ?? DEFAULT_WATER_COLOR;
  const showMarkers = options.showMarkers !== false;
  const key = cacheKey(
    schemBytes,
    options.resourcePackPath,
    fallbackResourcePackPath,
    biomeColor,
    waterColor,
    showMarkers,
    // This path draws a *file* and never a document, so there is no editing
    // session for a void block to belong to.
    "",
  );
  const hit = cache.get(key);
  if (hit) {
    // Refresh recency (Map preserves insertion order, so re-insert = MRU).
    cache.delete(key);
    cache.set(key, hit);
    return { ...hit, cached: true };
  }

  // preview.py:80-87, same call order, same arguments.
  const structure = await loadStructure(options.schemPath, {
    legacyBlocksPath: options.legacyBlocksPath ?? null,
  });
  // `normalizePalette`'s translator is the still-open `pymctranslate` DI seam
  // (RULEBOOK.md DEV-014's note / translate.ts's TODO(port)). `undefined` is
  // its documented identity behavior, which is also what Python's
  // `normalize_palette` did whenever PyMCTranslate wasn't installed.
  const normalized = showMarkers
    ? normalizePalette(structure, undefined)
    : hideMarkers(normalizePalette(structure, undefined));

  const cached = await cachedBaker(
    options.resourcePackPath,
    fallbackResourcePackPath,
    biomeColor,
    waterColor,
  );
  const baker = cached.baker;
  const faces = await culledFaces(normalized, baker);
  // After culling, not before: `culledFaces` is what asks the baker for each
  // blockstate, so the texture set is only complete once it has run.
  const source = cachedAtlas(cached);
  const atlas = source.atlas;
  const mesh = buildMesh(faces, atlas.uvRects, (key) => baker.isTextureTranslucent(key));
  await warnAboutBlocksWithNoGeometry(
    normalized,
    baker,
    new Set(Object.keys(atlas.uvRects)),
    presenceOf(normalized),
  );
  if (mesh.indices.length === 0) {
    // Raised before anything is assembled: a blank result is not worth
    // caching, and the next attempt may use a different resource pack, which
    // is exactly the fix for this failure.
    throw new EmptyPreviewError(countSolidBlocks(structure));
  }
  const bounds = boundsOf([mesh]);

  const result: CachedPreview = {
    // A file preview has no session remembering what the renderer holds, so
    // it always carries the whole sheet.
    mesh: { ...toMeshPayload([mesh], [0], source), atlas: fullAtlas(source) },
    center: bounds.center,
    size: bounds.size,
    format: structure.format,
    unmappedLegacyIds: structure.unmappedLegacyIds,
  };

  cache.set(key, result);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      break;
    }
    cache.delete(oldest.value);
  }

  return { ...result, cached: false };
}

export interface DocumentPreviewOptions {
  resourcePackPath: string | null;
  fallbackResourcePackPath?: string | null;
  biomeColor?: string;
  waterColor?: string;
  /**
   * Whether barriers and structure voids are drawn. Default true.
   *
   * See `hideMarkers`. Off is the player's view of the build; on is the
   * builder's, and the builder is who this app is for — which is why the
   * default is the one the game does not give you.
   */
  showMarkers?: boolean;
  /**
   * Whether blocks that glow light the mesh. Default true.
   *
   * Off means every surface sits at full sky light, which is what the viewport
   * looked like before any of this existed. It is the expensive half -- a flood
   * fill over every cell, and a chunk re-meshed wherever the light reached.
   */
  blockLight?: boolean;
  /** Whether corners are darkened by what is buried in them. Default true. */
  occlusion?: boolean;
  /**
   * Whether a vertex averages the light of the four cells around it. Default
   * true.
   *
   * The game's "smooth lighting". Off is flat, per-face light, which is what
   * vanilla looks like with the setting off.
   */
  smoothLighting?: boolean;
  /**
   * What to draw empty space as. Empty means air, and nothing changes.
   *
   * The mesher's, like the two tints and `showMarkers`: it changes the
   * geometry without moving `doc.revision`, so it is part of the cache key.
   */
  voidBlock?: string;

  /*
   * Both are part of the mesh cache key, for the same reason the two tints
   * are: they change the geometry and move no revision.
   */
}

/**
 * The structure as it would look to a player: markers turned back into air.
 *
 * Done here rather than in the baker, and that is the load-bearing part. A
 * baker keyed on this flag would be a second baker, a second texture set and a
 * second atlas -- and the block icons, which always draw markers because you
 * have to see what you are picking, would be meshed against the wrong one. The
 * palette is a handful of entries; rewriting the matching ones costs nothing
 * and leaves exactly one atlas in the process.
 */
function hideMarkers(structure: StructureData): StructureData {
  const air: PaletteEntry = { namespacedName: "minecraft:air", properties: {} };
  let touched = false;
  const palette = structure.palette.map((entry) => {
    const name = entry.namespacedName.replace("minecraft:", "");
    // `light` joins the two: it is drawn for the same reason they are -- placed
    // on purpose, invisible in game, and a decision somebody has to be able to
    // review -- so it hides for the same reason too.
    if (name !== "barrier" && name !== "structure_void" && name !== "light") return entry;
    touched = true;
    return air;
  });
  // The arrays are shared with the document on purpose; only rebuild when
  // there was actually a marker to hide.
  return touched ? { ...structure, palette } : structure;
}

/**
 * Empty space made of something other than air.
 *
 * Done here rather than in the baker for `hideMarkers`' reason, and by that
 * function's mechanism inverted: it rewrites the *air* palette entry into
 * the chosen block, so every empty cell in the document becomes a cell of
 * water without a single voxel being touched. Index 0 is always air
 * (`domain/document.ts` guarantees it), which is what makes the swap a
 * one-entry edit rather than a pass over millions of cells.
 *
 * It returns **which palette indices are the void**, and that set is the
 * whole reason this is more than a palette swap. Two populations end up
 * holding the block: the cells drawn over air, and the cells a break
 * actually wrote it into. One rule covers both -- *any cell holding the
 * void block is void* -- which is why the answer is keyed on the palette
 * rather than on whether a cell used to be air.
 *
 * The consequence is worth stating before it is reported as a bug: with
 * water as the void block, water placed by hand is unpickable too. That is
 * the request rather than a side effect -- if water is what empty space is
 * made of, a click has to pass through it the way it passes through air.
 *
 * ## The second population needs `matchesBlockPattern`, and used to have
 * ## exact-key equality
 *
 * The rule above was written and the comparison was `paletteEntryCacheKey`
 * equality, states and all -- so a cell only joined the void if its full
 * state string was byte-identical to the one the setting parses to. A cell
 * a *break* wrote always is, because it is written from that same string.
 * A cell that came out of a file, or out of this app's own placement, very
 * often is not: the modal's presets are bare ids and a barrier carries
 * `[waterlogged=false]`, water carries `[level=0]`.
 *
 * So choosing `minecraft:barrier` over a schematic already full of barrier
 * left every one of them opaque and clickable. Reported that way, with a
 * workaround that went through *Replace* -- which is `replaceAny`, which
 * has known the pattern rule all along. One place decides it now.
 */
export function fillVoid(
  structure: StructureData,
  block: string,
): { structure: StructureData; voidIndices: ReadonlySet<number> } {
  const wanted = block.trim();
  if (wanted === "") return { structure, voidIndices: new Set() };
  const entry = parsePaletteEntry(wanted);
  if (paletteEntryIsAir(entry)) return { structure, voidIndices: new Set() };

  const voidIndices = new Set<number>();
  const palette = structure.palette.map((existing, index) => {
    if (paletteEntryIsAir(existing)) {
      voidIndices.add(index);
      return entry;
    }
    if (matchesBlockPattern(existing, entry)) voidIndices.add(index);
    return existing;
  });
  // The voxels are shared with the document on purpose; only the palette
  // is rebuilt, and only when there is something to rewrite.
  return { structure: { ...structure, palette }, voidIndices };
}

export interface DocumentPreviewResult extends PreviewResult {
  /** Hand this back on the next call to re-mesh only what changed. */
  meshCache: ChunkMeshCache;
  rebuiltChunks: number;
  totalChunks: number;
  /**
   * Where the time went, in milliseconds, by step.
   *
   * Main's half of the stutter report: the renderer can only see how long it
   * waited for an answer, and a wait is the same length whether it was spent
   * relighting the document, repacking the atlas or queued behind something
   * else. See `MeshPayload.timings`.
   */
  timings: Record<string, number>;
  /** The atlas the UVs address; `atlasFor` decides what of it to send. */
  atlas: AtlasSource;
}

/**
 * The same pipeline, driven from an open document rather than a file.
 *
 * This is the edit loop: no read, no decode, no `loadStructure`, and -- thanks
 * to the baker cache above -- no resource pack either. What is left is the work
 * that genuinely depends on the blocks having changed.
 *
 * There is no content cache here on purpose. `buildPreview` hashes the file
 * bytes because the same file gets previewed repeatedly; a document is
 * previewed because it just changed, so a cache keyed on its contents would
 * miss every time and cost a hash of the whole grid to find that out. The
 * caller has `doc.revision`, which answers "is my last mesh still current" for
 * free.
 */
export async function buildDocumentPreview(
  doc: SchematicDocument,
  options: DocumentPreviewOptions,
  meshCache?: ChunkMeshCache,
): Promise<DocumentPreviewResult> {
  const timings: Record<string, number> = {};
  let at = performance.now();
  const lap = (name: string): void => {
    const now = performance.now();
    timings[name] = (timings[name] ?? 0) + (now - at);
    at = now;
  };
  const cached = await cachedBaker(
    options.resourcePackPath,
    options.fallbackResourcePackPath ?? null,
    options.biomeColor ?? DEFAULT_BIOME_COLOR,
    options.waterColor ?? DEFAULT_WATER_COLOR,
  );
  const visible =
    options.showMarkers === false ? hideMarkers(toStructureData(doc)) : toStructureData(doc);
  const filled = fillVoid(visible, options.voidBlock ?? "");
  const structure = filled.structure;

  /*
   * The atlas has to exist before the chunks are meshed, because their UVs
   * address it -- but it only knows about a block once the baker has been
   * asked for it, and that is what culling does. So the first pass over a
   * document primes the baker, and the atlas built after it is complete.
   *
   * Only the first pass: `cachedAtlas` rebuilds nothing when the texture set
   * has not grown, and `buildChunkedMesh` re-meshes nothing when no voxel has
   * moved, so the steady-state cost of an edit is the chunks it touched.
   */
  const signs = signsIn(doc);
  const present = documentPresence(doc);
  lap("prepare");
  await primeBaker(structure, cached.baker, signs, present);
  lap("prime");
  /*
   * The banners' composed cloth, for the glyphs' reason: a tile first made
   * *during* meshing would land in an atlas the chunks already have UVs into,
   * and the first patterned banner would come out wearing some other tile.
   */
  const banners = await bannersIn(doc, cached.baker);
  lap("banners");
  const source = cachedAtlas(cached);
  const atlas = source.atlas;
  lap("atlas");

  /*
   * Light before geometry, and for the whole structure at once.
   *
   * It cannot be a per-chunk job: a torch lights fifteen blocks in every
   * direction, straight across chunk boundaries, so a chunk cannot know how
   * bright it is without seeing the rest of the document. The chunk cache
   * diffs the result and re-meshes whatever the light actually reached, which
   * is how placing a torch relights the room and nothing else.
   */
  /*
   * Light is flooded through the document *without* the void block in it.
   *
   * `lighting.ts` floods from `occludesNeighbours`, so a void block that
   * happens to be solid -- barrier, stone, anything somebody tries -- would
   * seal every empty cell and take the light out of the whole schematic.
   * The build would go black and the cause would be a dropdown two panels
   * away. The void is a way of seeing the space; it does not get to decide
   * how lit the space is.
   */
  /*
   * ...and, after an ordinary edit, only where it can have moved.
   *
   * The cells written since the cache was built are the document's own record
   * (`takeVoxelChanges`), and with them `relight` floods the columns within
   * `LIGHT_REACH` of the change instead of the document: on a 256x96x256
   * terrain, ~100 ms became a few. Anything that makes the record or the old
   * grid untrustworthy -- a resize, a settings change, a cache somebody else
   * built -- takes the whole flood, which is always right.
   */
  const key = [
    options.showMarkers === false ? "markers-hidden" : "markers-shown",
    options.blockLight === false ? "flat" : "lit",
    options.occlusion === false ? "open" : "ao",
    options.smoothLighting === false ? "flat-light" : "smooth",
  ].join("|");
  // Taken even with no cache to compare with: the epoch is recorded on the
  // cache this build returns, so the next edit can be listed.
  const taken = takeVoxelChanges(doc, meshCache?.epoch ?? null);
  const known = meshCache !== undefined && meshCache.width >= 0 && meshCache.key === key;
  const sameGrid =
    known &&
    meshCache.width === doc.width &&
    meshCache.height === doc.height &&
    meshCache.length === doc.length &&
    meshCache.frame[0] === doc.frame[0] &&
    meshCache.frame[1] === doc.frame[1] &&
    meshCache.frame[2] === doc.frame[2];
  const listed = known && taken.cells !== null ? taken.cells : null;
  /*
   * The box was resized since the cache was built, and only grown: the cells
   * it added are air, and are relit from scratch below as though they had been
   * written. A shrink -- an undo, a peel -- compares everything, which is what
   * it always did; growing is what building outwards does on every block.
   */
  const shift: [number, number, number] = known
    ? [doc.frame[0] - meshCache.frame[0], doc.frame[1] - meshCache.frame[1], doc.frame[2] - meshCache.frame[2]]
    : [0, 0, 0];
  const grown =
    known &&
    !sameGrid &&
    listed !== null &&
    shift.every((step) => step >= 0) &&
    meshCache.width + shift[0] <= doc.width &&
    meshCache.height + shift[1] <= doc.height &&
    meshCache.length + shift[2] <= doc.length;
  let light: LightGrid | null = null;
  let changed: number[] | null = listed !== null && (sameGrid || grown) ? [...listed] : null;
  if (options.blockLight !== false) {
    const before = known ? meshCache.lightGrid : null;
    if (sameGrid && listed !== null && before !== null && listed.size === 0) {
      light = before;
    } else if ((sameGrid || grown) && listed !== null && before !== null) {
      const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      const include = (x0: number, x1: number, z0: number, z1: number): void => {
        if (x0 < box.minX) box.minX = x0;
        if (x1 > box.maxX) box.maxX = x1;
        if (z0 < box.minZ) box.minZ = z0;
        if (z1 > box.maxZ) box.maxZ = z1;
      };
      const plane = doc.height * doc.length;
      for (const index of listed) {
        const x = Math.floor(index / plane);
        const z = index % doc.length;
        include(x, x, z, z);
      }
      let start = before;
      if (grown) {
        start = carryLight(before, [doc.width, doc.height, doc.length], shift);
        // The new cells, as slabs: a slab added on top spans every column.
        const old = [meshCache!.width, meshCache!.height, meshCache!.length];
        if (shift[1] > 0 || old[1] + shift[1] < doc.height) include(0, doc.width - 1, 0, doc.length - 1);
        if (shift[0] > 0) include(0, shift[0] - 1, 0, doc.length - 1);
        if (old[0] + shift[0] < doc.width) include(old[0] + shift[0], doc.width - 1, 0, doc.length - 1);
        if (shift[2] > 0) include(0, doc.width - 1, 0, shift[2] - 1);
        if (old[2] + shift[2] < doc.length) include(0, doc.width - 1, old[2] + shift[2], doc.length - 1);
      }
      if (box.minX === Infinity) {
        light = start;
      } else {
        const relit = relight(start, visible, box);
        light = relit.grid;
        // A loop, not a spread: a big fill relights tens of thousands of cells.
        for (const index of relit.changed) changed!.push(index);
      }
    } else {
      light = computeLight(visible);
      changed = null;
    }
  }
  const shading = {
    light,
    occlusion: options.occlusion !== false,
    smooth: options.smoothLighting !== false,
  };
  lap("light");

  const chunked = await buildChunkedMesh(
    structure,
    cached.baker,
    atlas.uvRects,
    // The layout, not the version: a tile added to the reserve moves no UV,
    // so the chunks already meshed against this sheet stay right.
    source.layout,
    meshCache ?? createChunkMeshCache(),
    shading,
    signs,
    filled.voidIndices,
    banners,
    timings,
    { frame: doc.frame, changed, key, epoch: taken.epoch },
  );
  at = performance.now();
  await warnAboutBlocksWithNoGeometry(
    structure,
    cached.baker,
    new Set(Object.keys(atlas.uvRects)),
    present,
  );
  lap("silent check");
  /*
   * `pieces` only ever receives chunks that have indices, so this is exactly
   * the question the fused mesh used to be built to answer -- and building it
   * was **155 ms of a 207 ms edit** on a dense 128x32x128, some 264 MB
   * allocated and copied per placed block. See `concatChunks`.
   */
  if (chunked.pieces.length === 0) {
    throw new EmptyPreviewError(doc.voxels.length - (doc.counts[0] ?? 0));
  }
  // Unioned from the chunks' own boxes rather than walked over every vertex,
  // which was another 39 ms of the same edit. The boxes are in content
  // coordinates, so the frame goes back on for the caption.
  const [fx, fy, fz] = doc.frame;
  const bounds = extentOf({
    min: [chunked.bounds.min[0] + fx, chunked.bounds.min[1] + fy, chunked.bounds.min[2] + fz],
    max: [chunked.bounds.max[0] + fx, chunked.bounds.max[1] + fy, chunked.bounds.max[2] + fz],
  });
  const mesh = toMeshPayload(
    chunked.pieces,
    chunked.pieceKeys,
    source,
    chunked.voidPieces,
    chunked.voidPieceKeys,
    doc.frame,
  );
  lap("payload");
  return {
    mesh,
    center: bounds.center,
    size: bounds.size,
    meshCache: chunked.cache,
    rebuiltChunks: chunked.rebuilt,
    totalChunks: chunked.total,
    timings,
    atlas: source,
  };
}

/**
 * Decodes what a set of blocks needs and packs the atlas, once.
 *
 * This is the difference between a one-second warm-up and a thirty-nine-second
 * one, and the reason is entirely in `cachedAtlas` above: the atlas is repacked
 * whenever the texture set grows, and meshing blocks one at a time grows it on
 * almost every block. Measured on the 920-block list with the bundled pack:
 * decoding every texture is ~740 ms, packing the atlas once is ~150 ms, and
 * meshing all 920 against a settled atlas is ~150 ms -- against ~38,750 ms for
 * the same work done in an order that let the atlas move.
 *
 * So the order is the fix, and no amount of concurrency substitutes for it:
 * the work being repeated is quadratic, and the baker's texture map is one
 * mutable object that cannot be shared across threads anyway.
 *
 * A block that fails to bake is skipped rather than fatal. It contributes no
 * texture, so it cannot move the atlas, and whatever is wrong with it will be
 * wrong again where it is actually asked for -- with a message about what it
 * was, which is not something this loop could give.
 */
export async function warmBaker(
  entries: readonly PaletteEntry[],
  options: DocumentPreviewOptions,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<number> {
  const cached = await cachedBaker(
    options.resourcePackPath,
    options.fallbackResourcePackPath ?? null,
    options.biomeColor ?? DEFAULT_BIOME_COLOR,
    options.waterColor ?? DEFAULT_WATER_COLOR,
  );
  for (const [index, entry] of entries.entries()) {
    try {
      await cached.baker.bakeBlockstate(entry);
    } catch {
      // Skipped, for the reason in the note above.
    }
    await breathe(index, entries.length, onProgress);
  }
  return cachedAtlas(cached).version;
}

/** The atlas the cached baker for these options draws with, as it stands now. */
export async function currentAtlas(options: DocumentPreviewOptions): Promise<AtlasSource> {
  const cached = await cachedBaker(
    options.resourcePackPath,
    options.fallbackResourcePackPath ?? null,
    options.biomeColor ?? DEFAULT_BIOME_COLOR,
    options.waterColor ?? DEFAULT_WATER_COLOR,
  );
  return cachedAtlas(cached);
}

/**
 * Makes sure the baker has decoded every block the structure uses.
 *
 * Cheaper than it looks: `bakeBlockstate` is memoised per blockstate, so this
 * is one bake per *distinct* block, however many voxels there are -- and which
 * entries are present comes from the document's counts. It came from
 * `new Set(voxels)`, which on a 256x96x256 was ~95 ms of every edit, and the
 * same set was built a second time a few lines later for the silent check.
 */
async function primeBaker(
  structure: StructureData,
  baker: ModelBaker,
  signs: ReadonlyMap<number, SignText>,
  present: Presence,
): Promise<void> {
  for (const [index, entry] of structure.palette.entries()) {
    if (present(index) && !paletteEntryIsAir(entry)) {
      await baker.bakeBlockstate(entry);
    }
  }
  /*
   * ...and every letter on every sign, for exactly the reason above it.
   *
   * A glyph is a tile like any other and the atlas is packed once, after this,
   * so a character first cut *during* meshing would land in an atlas the
   * already-meshed chunks have UVs into. That is the "the icons are wrong until
   * I scroll" failure with a different subject, and it would show up as the
   * first sign in a build wearing somebody else's letters.
   */
  for (const text of signs.values()) {
    for (const side of [text.front, text.back]) {
      const colour = signColour(side.color);
      for (const line of side.lines) {
        for (const character of line) {
          await baker.glyph(character.codePointAt(0) ?? 0, colour);
        }
      }
    }
  }
}

/**
 * What every sign in the document says, by flat voxel index.
 *
 * Read here rather than in the pipeline because this is the only place that
 * has a *document*: `StructureData` is bounds, palette and voxels, and it is
 * documented as exactly that. Text is a per-position overlay like the light
 * grid, computed once and handed to every chunk.
 *
 * Filtered by the *block* rather than by the block entity's id, which is
 * `minecraft:sign` for all forty-four of them and would not tell a standing one
 * from a wall one -- and the mesher needs the block state anyway, to know which
 * way the board faces.
 *
 * Re-read on every preview rather than cached, which puts a JSON parse per line
 * in the edit loop: **1.2 ms for five hundred signs**, measured, against a mesh
 * build that is a good deal more than that. A cache would have to be keyed on
 * something that moves when a block entity does and not otherwise, and
 * `doc.revision` moves on every edit -- so it would cost the walk anyway and
 * add a second thing to keep true.
 */
function signsIn(doc: SchematicDocument): Map<number, SignText> {
  const signs = new Map<number, SignText>();
  for (const record of doc.blockEntities.values()) {
    const [x, y, z] = record.pos;
    if (x < 0 || y < 0 || z < 0 || x >= doc.width || y >= doc.height || z >= doc.length) continue;
    if (!isSignBlock(getBlock(doc, x, y, z).namespacedName)) continue;
    const text = readSignText(record.nbt);
    // RULEBOOK §2's canonical index, the one every consumer of `voxels` uses.
    if (text !== null) signs.set(x * doc.height * doc.length + y * doc.length + z, text);
  }
  return signs;
}

/**
 * The composed cloth of every banner whose block entity says how it looks, by
 * flat voxel index.
 *
 * A banner with no design and a flat-era block entity is left out, and keeps
 * the plain dyed cloth its block state already gives it. A **legacy** banner
 * with a `Base` is put in even with no layers: every pre-Flattening banner is
 * `white_banner` in the palette, and `Base` is the only place its colour is --
 * without this a 1.12 schematic's banners were all white.
 *
 * Read here rather than in the pipeline for `signsIn`'s reason: this is the one
 * place with a document, and a block entity is the document's.
 */
async function bannersIn(doc: SchematicDocument, baker: ModelBaker): Promise<Map<number, string>> {
  const banners = new Map<number, string>();
  const format = bannerFormat(documentEra(doc.format, doc.dataVersion), doc.dataVersion);
  for (const record of doc.blockEntities.values()) {
    const [x, y, z] = record.pos;
    if (x < 0 || y < 0 || z < 0 || x >= doc.width || y >= doc.height || z >= doc.length) continue;
    const entry = getBlock(doc, x, y, z);
    if (!isBannerBlock(entry.namespacedName)) continue;
    const look = readBanner(record.nbt, format);
    if (look.layers.length === 0 && look.base === null) continue;
    const base = look.base ?? bannerBlockColor(entry.namespacedName) ?? "white";
    const key = await baker.bannerCloth(
      DYE_COLOURS[base],
      look.layers.map((layer) => ({ pattern: layer.pattern, hex: DYE_COLOURS[layer.color] })),
    );
    if (key !== null) banners.set(x * doc.height * doc.length + y * doc.length + z, key);
  }
  return banners;
}

/**
 * component.py:331-332 applied `math.radians` when constructing
 * `PreviewOptions`; the UI holds degrees, the viewer wants radians, and this
 * is the same single conversion point.
 */
export function sunAnglesRadians(settings: PreviewSettings): { azimuth: number; elevation: number } {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  return {
    azimuth: toRad(settings.sunAzimuthDeg),
    elevation: toRad(settings.sunElevationDeg),
  };
}

export function clearPreviewCache(): void {
  cache.clear();
}
