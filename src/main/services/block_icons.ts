/**
 * One block, meshed on its own, so the inventory can draw it.
 *
 * The creative inventory shows blocks as they look, not as names — a stairs
 * block has to *be* a stairs block on screen. That geometry is described in
 * `pipeline/block_shapes.ts`, which lives in main and cannot be imported by the
 * renderer, so the icons are built here and the geometry crosses the boundary
 * the same way the viewport's does.
 *
 * ## It is the same pipeline, on a 1x1x1 document
 *
 * Not a second mesher, not a table of pre-rendered sprites. A one-block
 * document goes through `buildDocumentPreview` exactly as an open schematic
 * does, which means an icon cannot disagree with what appears in the viewport
 * when the block is placed. A stand-in built by other means would drift the
 * moment `block_shapes.ts` gained a shape — and drift silently, because nothing
 * compares the two.
 *
 * Face culling removes nothing here: a lone block has all six faces exposed,
 * which is what an icon wants.
 *
 * ## Cached, because the answer never changes
 *
 * A block's geometry depends on the block and on the texture atlas, and the
 * atlas has a version already. So the cache is keyed on both and a scroll
 * through the inventory re-meshes nothing it has seen. Without it, sixty
 * one-block documents would be built per row of scrolling.
 */

import { createDocument, setBlock, type SchematicDocument } from "../domain/document.js";
import { parsePaletteEntry } from "../pipeline/loader_formats.js";
import type { PaletteEntry } from "../pipeline/types.js";
import { splitBlockInput } from "../../shared/block_input.js";
import { wholeOf, type BlockState } from "../../shared/two_part.js";
import type { ChunkGeometry, MeshAtlas } from "../../shared/ipc.js";
import {
  buildDocumentPreview,
  currentAtlas,
  fullAtlas,
  warmBaker,
  type AtlasSource,
  type DocumentPreviewOptions,
} from "./preview.js";
import { breathe } from "./breathing.js";

export interface BlockIcon {
  block: string;
  /**
   * The block's geometry, or `null` when it meshed to nothing.
   *
   * Air does, and so does anything the mesher declines to draw. `null` rather
   * than an empty geometry so the renderer can show a placeholder instead of an
   * invisible tile that looks like a failure to load.
   */
  geometry: ChunkGeometry | null;
  /** The cells the picture is of; see `BlockIcon.size` in `shared/ipc.ts`. */
  size: [number, number, number];
}

/** What is cached per block: the picture's geometry and the cells it spans. */
interface IconMesh {
  geometry: ChunkGeometry | null;
  size: [number, number, number];
}

export interface BlockIconsResult {
  icons: BlockIcon[];
  /** Omitted when the caller already holds this version — same rule as the viewport. */
  atlas: MeshAtlas | null;
  atlasVersion: number;
  /** See `MeshAtlas.layout`: icons drawn against this layout are still right. */
  atlasLayout: number;
}

/**
 * Icons already built, by `${layout}:${block}`.
 *
 * The layout and not the version: a tile added to the atlas's reserve moves no
 * UV, so an icon meshed before it is as right after it. Keyed on the version,
 * every texture a document added -- a lit furnace, a sign's letters -- threw
 * away every icon, and the renderer asked for all nine hundred again.
 */
const cache = new Map<string, IconMesh>();

/**
 * Enough for several screens of scrolling and nowhere near enough to matter.
 *
 * Each entry is one block's worth of triangles — a few kilobytes — so this is
 * megabytes at worst, against a 900-block list somebody may scroll all of.
 */
const MAX_CACHED_ICONS = 4096;

/**
 * The cells an icon is a picture of: one, or two for a block that is two.
 *
 * A bed's icon was its foot, a door's its lower half and a sunflower's its
 * stalk -- half a block, in the inventory, the hotbar, the block picker and the
 * materials list, which read as a broken model rather than as half of one.
 * `wholeOf` is the reading placement uses, so the picture is of exactly what a
 * click with it in hand puts down: a bare bed or a foot is both halves, a head
 * on its own is a head.
 *
 * The far half goes where placing puts it, so the two cells are shifted to
 * start at zero: a bed facing north has its head at `z = 0` and its foot at
 * `z = 1`.
 */
function iconCells(block: string): {
  cells: { x: number; y: number; z: number; entry: PaletteEntry }[];
  size: [number, number, number];
} {
  const entry = parsePaletteEntry(iconBlock(block));
  const whole = wholeOf(entry);
  if (whole === null) return { cells: [{ x: 0, y: 0, z: 0, entry }], size: [1, 1, 1] };
  const [dx, dy, dz] = whole.step;
  const near = { x: Math.max(0, -dx), y: Math.max(0, -dy), z: Math.max(0, -dz) };
  const plain = (state: BlockState): PaletteEntry => ({
    namespacedName: state.namespacedName,
    properties: { ...state.properties },
  });
  return {
    cells: [
      { ...near, entry: plain(whole.near) },
      { x: near.x + dx, y: near.y + dy, z: near.z + dz, entry: plain(whole.far) },
    ],
    size: [1 + Math.abs(dx), 1 + Math.abs(dy), 1 + Math.abs(dz)],
  };
}

/** The document an icon is a picture of. */
function documentFor(block: string): { doc: SchematicDocument; size: [number, number, number] } {
  const { cells, size } = iconCells(block);
  const doc = createDocument({ width: size[0], height: size[1], length: size[2], format: "sponge3" });
  for (const cell of cells) setBlock(doc, cell.x, cell.y, cell.z, cell.entry);
  return { doc, size };
}

/**
 * The block an icon is a picture of, without the banner patterns a hotbar slot
 * may carry.
 *
 * The icon is the plain banner, deliberately: a composed cloth is a tile of its
 * own, and making one per slot would move the atlas every icon addresses. What
 * must not happen is the pattern list reaching `parsePaletteEntry`, which splits
 * on its commas and would intern a banner with a dozen nonsense states.
 */
function iconBlock(block: string): string {
  try {
    return splitBlockInput(block).block;
  } catch {
    return block.split("[", 1)[0];
  }
}

/**
 * Meshes one block and reports which atlas its UVs address.
 *
 * `null` geometry for anything the mesher declines to draw, which is a tile
 * with a placeholder in it rather than a failed request: one bad id must not
 * empty the whole inventory.
 */
async function meshOne(
  block: string,
  options: DocumentPreviewOptions,
): Promise<{ mesh: IconMesh; source: AtlasSource } | null> {
  try {
    const { doc, size } = documentFor(block);
    const preview = await buildDocumentPreview(doc, options);
    return { mesh: { geometry: preview.mesh.chunks[0] ?? null, size }, source: preview.atlas };
  } catch {
    return null;
  }
}

/**
 * Decodes what a set of blocks needs, so the atlas stops growing under them.
 *
 * This exists because of a bug that was not in the renderer. The baker decodes
 * a texture the first time a block asks for it, and the atlas grows with it --
 * so meshing sixty blocks in a row, each into a freshly packed sheet, produced
 * sixty geometries addressing sixty layouts and one atlas to draw them all
 * with. Fifty-nine of them were wrong.
 *
 * It used to prime by *meshing* every block and throwing the geometry away,
 * on the grounds that a 1x1x1 document is a handful of triangles and the
 * expensive half is the decoding. The triangles were indeed free. What was not
 * free was that each of those meshes asked for an atlas, and the atlas was
 * repacked whenever the texture set had grown -- so priming nine hundred blocks
 * packed the atlas nine hundred times over an ever-larger set. That was 38.7 of
 * the 39 seconds this took.
 *
 * So it decodes directly and packs once. Same guarantee, two orders of
 * magnitude cheaper, and `warmBaker` carries the measurements.
 *
 * **Both halves of a block that is two**, for the same reason: a bed's head
 * has textures its foot does not, and left to the mesh they would be decoded
 * in the middle of a batch -- the sixty-layouts fault, one block at a time.
 */
async function prime(
  blocks: readonly string[],
  options: DocumentPreviewOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const entries = blocks.flatMap((block) => iconCells(block).cells.map((cell) => cell.entry));
  // Reported against the blocks, not the halves: the caller's bar counts blocks.
  const scale = entries.length === 0 ? 1 : blocks.length / entries.length;
  await warmBaker(entries, options, (done) => onProgress?.(Math.round(done * scale), blocks.length));
}

/**
 * The atlas as it stands, for the reply: the sheet unless the caller holds
 * exactly this version of it.
 *
 * Whole, never patched: the icon renderer is a single texture rebuilt on
 * arrival, and this happens when a document has added tiles since the last
 * request -- rare enough that a patch path would be code with no use.
 */
function reply(
  icons: BlockIcon[],
  source: AtlasSource,
  knownVersion: number | null,
  knownLayout: number | null,
): BlockIconsResult {
  const current = knownVersion === source.version && knownLayout === source.layout;
  return {
    icons,
    atlas: current ? null : fullAtlas(source),
    atlasVersion: source.version,
    atlasLayout: source.layout,
  };
}

/**
 * Meshes every block there is, so the atlas reaches its final size once.
 *
 * Without this the atlas keeps growing as someone scrolls. Nine hundred
 * one-block documents is a few seconds in the main process, spent once, off
 * the renderer's thread; the geometry is kept, so afterwards every request is
 * a cache hit.
 */
export async function warmBlockIcons(
  blocks: readonly string[],
  options: DocumentPreviewOptions,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<number> {
  /*
   * Two passes, and the progress reported covers both -- the first decodes
   * every texture and the second meshes against them. They are within about
   * five to one of each other now that neither repacks the atlas, so counting
   * only one would make the bar stall and then leap.
   */
  const total = blocks.length * 2;
  await prime(blocks, options, (done) => onProgress(done, total));

  for (const [index, block] of blocks.entries()) {
    const built = await meshOne(block, options);
    if (built !== null) cache.set(`${built.source.layout}:${block}`, built.mesh);
    await breathe(blocks.length + index, total, onProgress);
  }

  evict();
  return (await currentAtlas(options)).version;
}

export async function buildBlockIcons(
  blocks: readonly string[],
  options: DocumentPreviewOptions,
  knownAtlasVersion: number | null,
  knownAtlasLayout: number | null = null,
): Promise<BlockIconsResult> {
  const wanted = [...new Set(blocks)];

  /*
   * The fast path, and after a warm-up it is the only one: every block already
   * meshed against the layout that is still in force.
   */
  const now = await currentAtlas(options);
  if (wanted.every((block) => cache.has(`${now.layout}:${block}`))) {
    return reply(
      wanted.map((block) => {
        const cached = cache.get(`${now.layout}:${block}`);
        return { block, geometry: cached?.geometry ?? null, size: cached?.size ?? [1, 1, 1] };
      }),
      now,
      knownAtlasVersion,
      knownAtlasLayout,
    );
  }

  await prime(wanted, options);

  const icons: BlockIcon[] = [];
  for (const block of wanted) {
    const built = await meshOne(block, options);
    if (built === null) {
      icons.push({ block, geometry: null, size: [1, 1, 1] });
      continue;
    }
    cache.set(`${built.source.layout}:${block}`, built.mesh);
    icons.push({ block, ...built.mesh });
  }

  evict();
  // Only when the caller does not already hold it: the pixels are the large
  // part of this message and re-sending them is most of its cost.
  return reply(icons, await currentAtlas(options), knownAtlasVersion, knownAtlasLayout);
}

/** Oldest-first eviction, which `Map` gives for free by insertion order. */
function evict(): void {
  while (cache.size > MAX_CACHED_ICONS) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
}

/** Drops every cached icon. Called when the resource pack changes. */
export function forgetBlockIcons(): void {
  cache.clear();
}
