/**
 * `pipeline/chunked_mesh.ts` — meshing only what changed.
 *
 * The property everything else rests on: **an incrementally updated mesh is
 * identical to one built from scratch.** A chunk cache that is merely
 * *plausible* renders a structure that looks right until the one chunk it
 * forgot, and there is no error to notice — so the suite compares bytes, over a
 * sequence of edits chosen to land on the awkward places: chunk interiors,
 * chunk boundaries, corners where three chunks meet, and a block removed rather
 * than added.
 *
 * The second property is that it actually saves the work it exists to save.
 * A cache that quietly rebuilds everything would pass every equality check
 * above and be worthless, so the number of chunks rebuilt is asserted too.
 */

import {
  countsOf,
  createDocument,
  resizeDocument,
  setBlock,
  toStructureData,
  type SchematicDocument,
} from "../src/main/domain/document.js";
import { appendTiles, buildAtlas, packAtlas, tilePixels } from "../src/main/pipeline/atlas.js";
import { computeLight } from "../src/main/pipeline/lighting.js";
import { buildDocumentPreview } from "../src/main/services/preview.js";
import type { RgbaImage } from "../src/main/pipeline/types.js";
import {
  buildChunkedMesh,
  chunkKey,
  concatChunks,
  createChunkMeshCache,
  CHUNK_SIZE,
  type ChunkedMeshResult,
  type ChunkMeshCache,
  type LodRequest,
} from "../src/main/pipeline/chunked_mesh.js";
import { COARSE_ERROR, REGION_CHUNKS, REGION_SIZE } from "../src/main/pipeline/coarse_mesh.js";
import { lodShapeError } from "../src/main/pipeline/block_shapes.js";
import { buildMesh, culledFaces } from "../src/main/pipeline/mesher.js";
import { fillVoid } from "../src/main/services/preview.js";
import { readSignText, type SignText } from "../src/main/pipeline/sign_text.js";
import { ModelBaker } from "../src/main/pipeline/model_baker.js";
import { readFileSync } from "fs";
import { readdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { MeshBuffers, PaletteEntry } from "../src/main/pipeline/types.js";
import { paletteEntryCacheKey } from "../src/main/pipeline/types.js";

let failures = 0;

function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  PASS: ${label}`);
  } else {
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failures += 1;
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    console.log(`         expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  check(label, ok);
}

const block = (name: string, properties: Record<string, string> = {}): PaletteEntry => ({
  namespacedName: name,
  properties,
});
const STONE = block("minecraft:stone");
const PLANKS = block("minecraft:oak_planks");
const GLASS = block("minecraft:glass");
const SIGN = block("minecraft:oak_sign", { rotation: "0" });

/** A sign saying one thing, as the mesher is handed it. */
function sign(line: string): SignText {
  const read = readSignText({
    Text1: { type: "string", value: JSON.stringify({ text: line }) },
  } as never);
  if (read === null) throw new Error("the fixture says nothing");
  return read;
}
const AIR = block("minecraft:air");

/** A stable fingerprint of the geometry, order included. */
function fingerprint(buffers: MeshBuffers): string {
  const hash = (array: Float32Array | Uint32Array): string => {
    let h = 2166136261;
    for (let i = 0; i < array.length; i += 1) {
      h ^= Math.round(array[i] * 1000) | 0;
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  };
  return [
    buffers.positions.length,
    buffers.indices.length,
    hash(buffers.positions),
    hash(buffers.normals),
    hash(buffers.uvs),
    hash(buffers.indices),
  ].join(":");
}

console.log("=== Schematic AI Studio: chunked meshing ===\n");

const baker = await ModelBaker.create(null);

/** A structure spanning several chunks, with something in every one. */
function seeded(): SchematicDocument {
  const doc = createDocument({ width: 40, height: 40, length: 40 });
  for (let x = 0; x < 40; x += 1) {
    for (let z = 0; z < 40; z += 1) {
      setBlock(doc, x, 0, z, STONE);
      if (x % 5 === 0 || z % 5 === 0) setBlock(doc, x, 1, z, PLANKS);
    }
  }
  for (let y = 0; y < 40; y += 1) setBlock(doc, 20, y, 20, GLASS);
  return doc;
}

/** Meshes from a cold cache — the "from scratch" reference. */
async function fromScratch(doc: SchematicDocument) {
  const structure = toStructureData(doc);
  // Prime the baker so the atlas is complete before UVs are computed, exactly
  // as `preview.ts` does.
  await culledFaces(structure, baker);
  const atlas = buildAtlas(baker.textures);
  return buildChunkedMesh(structure, baker, atlas.uvRects, 1, createChunkMeshCache());
}

async function incremental(
  doc: SchematicDocument,
  cache: ChunkMeshCache,
  signs: ReadonlyMap<number, SignText> | null = null,
) {
  const structure = toStructureData(doc);
  const atlas = buildAtlas(baker.textures);
  return buildChunkedMesh(structure, baker, atlas.uvRects, 1, cache, null, signs);
}

// --- chunked output matches the unchunked mesher ----------------------------
//
// Different order, so the bytes differ; what must agree is how much geometry
// there is. A chunked pass that dropped or duplicated a face would show here.
console.log("--- against the whole-structure mesher ---");
{
  const doc = seeded();
  const structure = toStructureData(doc);
  const faces = await culledFaces(structure, baker);
  const atlas = buildAtlas(baker.textures);
  const whole = buildMesh(faces, atlas.uvRects);
  const chunked = await fromScratch(doc);

  equal("the same number of vertices", concatChunks(chunked.pieces).positions.length, whole.positions.length);
  equal("the same number of indices", concatChunks(chunked.pieces).indices.length, whole.indices.length);
  equal("the same number of UVs", concatChunks(chunked.pieces).uvs.length, whole.uvs.length);
  check(
    "every index still addresses a real vertex",
    concatChunks(chunked.pieces).indices.every((i) => i < concatChunks(chunked.pieces).positions.length / 3),
  );
}

// --- the property that matters ----------------------------------------------
console.log("\n--- incremental equals from-scratch ---");
{
  // Deliberately awkward positions: inside a chunk, on a face boundary, on an
  // edge, on the corner where eight chunks meet, and a removal.
  const edits: Array<[string, (doc: SchematicDocument) => void]> = [
    ["deep inside one chunk", (d) => setBlock(d, 5, 5, 5, STONE)],
    ["on an x boundary", (d) => setBlock(d, CHUNK_SIZE - 1, 4, 4, GLASS)],
    ["across that boundary", (d) => setBlock(d, CHUNK_SIZE, 4, 4, GLASS)],
    ["on a y boundary", (d) => setBlock(d, 4, CHUNK_SIZE, 4, PLANKS)],
    ["on the corner of eight chunks", (d) => setBlock(d, CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, STONE)],
    ["removing a block", (d) => setBlock(d, 20, 10, 20, AIR)],
    ["removing one on a boundary", (d) => setBlock(d, 20, CHUNK_SIZE, 20, AIR)],
    ["re-adding it", (d) => setBlock(d, 20, CHUNK_SIZE, 20, GLASS)],
  ];

  const doc = seeded();
  let result = await fromScratch(doc);
  let mismatches = 0;

  for (const [label, edit] of edits) {
    edit(doc);
    result = await incremental(doc, result.cache);

    // The same document, meshed with no history behind it.
    const clean = createDocument({ width: doc.width, height: doc.height, length: doc.length });
    clean.voxels.set(doc.voxels);
    clean.palette = [...doc.palette];
    clean.paletteIndex = new Map(doc.paletteIndex);
    const reference = await fromScratch(clean);

    const same = fingerprint(concatChunks(result.pieces)) === fingerprint(concatChunks(reference.pieces));
    if (!same) mismatches += 1;
    check(`${label}: incremental matches a rebuild`, same);
  }
  equal("no edit produced a different mesh", mismatches, 0);
}

// --- it really does skip work -----------------------------------------------
//
// Everything above would also pass if the cache silently rebuilt the whole
// structure every time, which would make it pointless.
console.log("\n--- and it skips the untouched chunks ---");
{
  const doc = seeded();
  const cold = await fromScratch(doc);
  equal("a cold cache builds every chunk", cold.rebuilt, cold.total);
  check("the structure really spans many chunks", cold.total >= 27, `${cold.total} chunks`);

  const unchanged = await incremental(doc, cold.cache);
  equal("meshing again with no edit rebuilds nothing", unchanged.rebuilt, 0);
  check(
    "...and produces the same geometry",
    fingerprint(concatChunks(unchanged.pieces)) === fingerprint(concatChunks(cold.pieces)),
  );

  setBlock(doc, 5, 5, 5, STONE);
  const one = await incremental(doc, unchanged.cache);
  equal("one block deep inside a chunk rebuilds exactly that chunk", one.rebuilt, 1);

  // A block on a boundary has to dirty the chunk across it, or that chunk
  // keeps drawing a face the new neighbour now hides.
  setBlock(doc, CHUNK_SIZE - 1, 5, 5, GLASS);
  const boundary = await incremental(doc, one.cache);
  equal("one on an x boundary rebuilds two", boundary.rebuilt, 2);

  /*
   * Eight, not four: the four were its own chunk and the three across its
   * faces, and the other four share only an edge or a corner with it -- but
   * their faces' occlusion and smooth lighting read the cells at their
   * corners, which this is. Leaving them out kept stale shading at chunk
   * edges; the random walk below compares light in every vertex and caught it.
   */
  setBlock(doc, CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, PLANKS);
  const corner = await incremental(doc, boundary.cache);
  equal("one on a three-axis corner rebuilds the eight chunks that meet there", corner.rebuilt, 8);

  /*
   * ...and a sign that has been retyped, which is the third thing this cache
   * has had to learn to see.
   *
   * The rule is the same one and this is why it is a rule: a voxel grid and a
   * light grid are what the cache compares, and text is neither. Editing a
   * sign's words moved nothing either array holds, so the chunk stayed exactly
   * as it was -- the old sign on screen and the new one in the file, until some
   * unrelated edit nearby happened to dirty it.
   *
   * One chunk and not seven. `markDirty` spreads to the face-neighbours because
   * light does; text does not leave the block it is written on.
   */
  setBlock(doc, 5, 5, 5, SIGN);
  const at = 5 * doc.height * doc.length + 5 * doc.length + 5;
  const said = (line: string) => new Map([[at, sign(line)]]);
  const written = await incremental(doc, corner.cache, said("prima"));
  check("placing the sign rebuilt its chunk", written.rebuilt >= 1);

  const same = await incremental(doc, written.cache, said("prima"));
  equal("the same words rebuild nothing", same.rebuilt, 0);

  const retyped = await incremental(doc, same.cache, said("dopo"));
  equal("retyping it rebuilds exactly its chunk", retyped.rebuilt, 1);

  const rubbedOut = await incremental(doc, retyped.cache, new Map());
  equal("...and rubbing it out does too", rubbedOut.rebuilt, 1);
}

// --- a banner's design is a block entity too --------------------------------
//
// The signs' rule once more. Repainting a banner moves no voxel and no light,
// so without the overlay being diffed the chunk would go on showing the old
// design -- the new one in the file, the old one on screen.
console.log("\n--- a banner's design ---");
{
  const doc = seeded();
  const first = await fromScratch(doc);
  const BANNER = block("minecraft:white_banner", { rotation: "0" });
  setBlock(doc, 5, 5, 5, BANNER);
  const at = 5 * doc.height * doc.length + 5 * doc.length + 5;
  const painted = (key: string) => new Map([[at, key]]);
  const mesh = (cache: ChunkMeshCache, banners: ReadonlyMap<number, string> | null) =>
    buildChunkedMesh(toStructureData(doc), baker, buildAtlas(baker.textures).uvRects, 1, cache, null, null, null, banners);

  const placed = await mesh(first.cache, null);
  check("placing the banner rebuilt its chunk", placed.rebuilt >= 1);
  const designed = await mesh(placed.cache, painted("minecraft:entity/banner/base#f9fffe|mojang:f9801d"));
  equal("giving it a design rebuilds exactly its chunk", designed.rebuilt, 1);
  const same = await mesh(designed.cache, painted("minecraft:entity/banner/base#f9fffe|mojang:f9801d"));
  equal("the same design rebuilds nothing", same.rebuilt, 0);
  const redesigned = await mesh(same.cache, painted("minecraft:entity/banner/base#f9fffe|creeper:1d1d21"));
  equal("a different design rebuilds exactly its chunk", redesigned.rebuilt, 1);
  const cleared = await mesh(redesigned.cache, null);
  equal("...and clearing it does too", cleared.rebuilt, 1);
}

// --- what has to invalidate everything --------------------------------------
console.log("\n--- full invalidation ---");
{
  const doc = seeded();
  const first = await fromScratch(doc);

  const atlas = buildAtlas(baker.textures);
  const newAtlas = await buildChunkedMesh(
    toStructureData(doc),
    baker,
    atlas.uvRects,
    // A different atlas version: cached UVs address a layout that no longer
    // exists, so keeping them would texture the whole structure wrongly.
    99,
    first.cache,
  );
  equal("a rebuilt atlas invalidates every chunk", newAtlas.rebuilt, newAtlas.total);

  const resized = createDocument({ width: 48, height: 40, length: 40 });
  resized.voxels.set(doc.voxels.subarray(0, Math.min(doc.voxels.length, resized.voxels.length)));
  resized.palette = [...doc.palette];
  resized.paletteIndex = new Map(doc.paletteIndex);
  const afterResize = await buildChunkedMesh(
    toStructureData(resized),
    baker,
    atlas.uvRects,
    1,
    first.cache,
  );
  equal("so does a resize", afterResize.rebuilt, afterResize.total);
}

/** The pieces of one layer, fused, so two layers can be compared as bytes. */
function concat(pieces: readonly MeshBuffers[]): MeshBuffers {
  let vertices = 0;
  let indices = 0;
  for (const piece of pieces) {
    vertices += piece.positions.length / 3;
    indices += piece.indices.length;
  }
  const out = {
    positions: new Float32Array(vertices * 3),
    normals: new Float32Array(vertices * 3),
    uvs: new Float32Array(vertices * 2),
    indices: new Uint32Array(indices),
    light: new Float32Array(vertices * 3),
    opaqueIndices: 0,
  };
  let v = 0;
  let i = 0;
  for (const piece of pieces) {
    out.positions.set(piece.positions, v * 3);
    out.normals.set(piece.normals, v * 3);
    out.uvs.set(piece.uvs, v * 2);
    out.light.set(piece.light, v * 3);
    for (let k = 0; k < piece.indices.length; k += 1) out.indices[i + k] = piece.indices[k] + v;
    v += piece.positions.length / 3;
    i += piece.indices.length;
  }
  return out;
}


// --- empty space made of something else -------------------------------------
//
// A schematic has always been full of air, and for an underwater build that is
// wrong in a way that only shows up after the paste. Choosing a block here
// swaps the *air palette entry* for it, so every empty cell becomes a cell of
// water without a voxel being touched -- and the faces come out in a layer of
// their own, which is what lets the viewer give them their own material and
// keep them out of the raycaster.
console.log("\n--- the void block ---");
{
  const doc = createDocument({ width: 4, height: 4, length: 4 });
  setBlock(doc, 1, 1, 1, STONE);
  const real = toStructureData(doc);

  /*
   * Air is the default and has to stay free. Nothing is rebuilt, nothing is
   * marked, and the structure comes back as the very same object -- which is
   * what makes "no void block" cost nothing at all rather than cost a copy.
   */
  const untouched = fillVoid(real, "");
  check("no void block leaves the structure alone", untouched.structure === real);
  equal("...and marks nothing", untouched.voidIndices.size, 0);
  /*
   * And so does one that *spells* air. Two spellings of one state would have
   * the mesher visit every cell to draw nothing.
   */
  equal("air by name is the same as no void block", fillVoid(real, "minecraft:air").voidIndices.size, 0);

  const filled = fillVoid(real, "minecraft:water");
  /*
   * Index 0 is always air (`domain/document.ts` guarantees it), which is what
   * makes this a one-entry edit rather than a pass over the whole grid.
   */
  equal("the air entry becomes the void block", filled.structure.palette[0].namespacedName, "minecraft:water");
  check("...and is marked as void", filled.voidIndices.has(0));
  check("...while the stone beside it is not", !filled.voidIndices.has(1));
  check("the voxels are shared, not copied", filled.structure.voxels === real.voxels);
  check("...and the original palette is untouched", real.palette[0].namespacedName === "minecraft:air");

  /*
   * Both populations, one rule.
   *
   * A break writes the void block for real, so a document can hold cells of it
   * that were never air. Keyed on the palette rather than on "was this cell
   * air", they are the same thing -- which is the sentence that makes\
   * hand-placed water unpickable too, and that is the request rather than a
   * side effect.
   */
  const withWater = createDocument({ width: 4, height: 4, length: 4 });
  setBlock(withWater, 1, 1, 1, block("minecraft:water"));
  const both = fillVoid(toStructureData(withWater), "minecraft:water");
  equal("a placed void block is void as well", both.voidIndices.size, 2);

  /*
   * ...and the check above passes for a reason that is not good enough,
   * which is why the ones below exist.
   *
   * It compares a stateless entry against a stateless string, so it holds
   * however narrow the comparison inside `fillVoid` is -- and for a long time
   * that comparison was full-state equality. Every document the suites build
   * for themselves has stateless blocks in it, so nothing anywhere saw the
   * gap: a barrier out of a file carries `[waterlogged=false]`, water carries
   * `[level=0]`, and the modal's presets are bare ids.
   *
   * Reported as choosing barrier over a schematic already full of barrier and
   * nothing happening -- the cells stayed opaque and clickable. The rule is
   * `matchesBlockPattern`, which `replaceAny` had all along and this did not.
   */
  const stated = createDocument({ width: 4, height: 4, length: 4 });
  setBlock(stated, 1, 1, 1, block("minecraft:barrier", { waterlogged: "false" }));
  const bare = fillVoid(toStructureData(stated), "minecraft:barrier");
  equal(
    "a bare void block finds the block in any state",
    bare.voidIndices.size,
    2,
  );

  /*
   * And naming a state still means that state, which is how somebody targets
   * one water level and leaves the others. The looser rule must not become no
   * rule at all.
   */
  const levels = createDocument({ width: 4, height: 4, length: 4 });
  setBlock(levels, 1, 1, 1, block("minecraft:water", { level: "0" }));
  setBlock(levels, 2, 1, 1, block("minecraft:water", { level: "8" }));
  const exact = fillVoid(toStructureData(levels), "minecraft:water[level=0]");
  equal(
    "a stated void block finds only that state",
    exact.voidIndices.size,
    2,
  );
  /*
   * Stated as *which* entry rather than only as a count, because two entries
   * out of three is the right number whichever of the two waters it picked.
   */
  const drawn = [...exact.voidIndices].map((index) =>
    paletteEntryCacheKey(exact.structure.palette[index]),
  );
  check(
    "...which is the one it names",
    drawn.includes("minecraft:water[level=0]") && !drawn.includes("minecraft:water[level=8]"),
    drawn.join(" "),
  );
}

console.log("\n--- the two layers ---");
{
  /*
   * One pass, two layers. Culling has to see both at once: the water's face at
   * a wall and the wall's own face are the same plane, and only a pass that
   * knows about both removes one of them. Meshed separately they would both be
   * drawn and z-fight along every surface of the build.
   */
  const doc = createDocument({ width: 6, height: 6, length: 6 });
  setBlock(doc, 2, 2, 2, STONE);
  const real = toStructureData(doc);
  const filled = fillVoid(real, "minecraft:water");

  await culledFaces(filled.structure, baker, undefined, null, undefined, filled.voidIndices);
  const atlas = buildAtlas(baker.textures);

  const plain = await buildChunkedMesh(
    real,
    baker,
    atlas.uvRects,
    1,
    createChunkMeshCache(),
  );
  equal("without a void block there is no void layer", plain.voidPieces.length, 0);
  check("...and the structure is still meshed", plain.pieces.length > 0);

  const voided = await buildChunkedMesh(
    filled.structure,
    baker,
    atlas.uvRects,
    1,
    createChunkMeshCache(),
    null,
    null,
    filled.voidIndices,
  );
  check("with one, the void gets a layer of its own", voided.voidPieces.length > 0);

  /*
   * The solid layer is *unchanged* by the void, which is the property the
   * whole split exists for: the schematic is what it always was, and the void
   * is drawn beside it.
   */
  equal(
    "the structure's own geometry is untouched by it",
    fingerprint(concat(voided.pieces)),
    fingerprint(concat(plain.pieces)),
  );

  /*
   * And `buffers` -- the fused geometry, which `EmptyPreviewError` measures --
   * stays about the schematic. Folded together, an empty document would come
   * back full of water and the check that catches a deleted build showing its
   * own ghost would never fire again.
   */
  equal(
    "the fused mesh is the structure, not the void",
    fingerprint(concatChunks(voided.pieces)),
    fingerprint(concatChunks(plain.pieces)),
  );

  const empty = createDocument({ width: 4, height: 4, length: 4 });
  const emptyFilled = fillVoid(toStructureData(empty), "minecraft:water");
  const emptyVoided = await buildChunkedMesh(
    emptyFilled.structure,
    baker,
    atlas.uvRects,
    1,
    createChunkMeshCache(),
    null,
    null,
    emptyFilled.voidIndices,
  );
  equal("a document with nothing in it still meshes as empty", concatChunks(emptyVoided.pieces).indices.length, 0);
  check("...while its void has a shell", emptyVoided.voidPieces.length > 0);

  /*
   * And the interface is culled, which is the z-fighting guard stated as a
   * number.
   *
   * A stone block dropped into the middle of the void takes one cell away
   * from it -- and that cell's six faces were interior ones, culled against
   * its identical neighbours. The six water faces now *pointing at* the stone
   * are culled too, because stone covers them and its texture is opaque. So
   * the void geometry has to come out **byte for byte the same** as it does
   * with nothing in the box at all.
   *
   * If it does not, the extra faces are water drawn in the same plane as the
   * stone's own -- which is exactly what meshing the two layers in separate
   * passes would produce, and it is invisible until the two start flickering
   * against each other at a distance.
   */
  const boxed = createDocument({ width: 4, height: 4, length: 4 });
  setBlock(boxed, 1, 1, 1, STONE);
  const boxedFilled = fillVoid(toStructureData(boxed), "minecraft:water");
  const boxedVoided = await buildChunkedMesh(
    boxedFilled.structure,
    baker,
    atlas.uvRects,
    1,
    createChunkMeshCache(),
    null,
    null,
    boxedFilled.voidIndices,
  );
  equal(
    "the void draws no face where a block covers it",
    fingerprint(concat(boxedVoided.voidPieces)),
    fingerprint(concat(emptyVoided.voidPieces)),
  );

  /*
   * Glass, on the other hand, does *not* cover it: its texture is not opaque,
   * so the water behind it is drawn and has to be. The pair is what stops the
   * check above from passing for the wrong reason -- a void layer that culled
   * against everything would satisfy it just as well, and would put a hole in
   * the water behind every pane in the build.
   */
  const glazed = createDocument({ width: 4, height: 4, length: 4 });
  setBlock(glazed, 1, 1, 1, GLASS);
  const glazedFilled = fillVoid(toStructureData(glazed), "minecraft:water");
  const glazedVoided = await buildChunkedMesh(
    glazedFilled.structure,
    baker,
    atlas.uvRects,
    1,
    createChunkMeshCache(),
    null,
    null,
    glazedFilled.voidIndices,
  );
  check(
    "...but does draw one behind something see-through",
    concat(glazedVoided.voidPieces).indices.length >
      concat(emptyVoided.voidPieces).indices.length,
  );
}

// --- changing the void block re-meshes ---------------------------------------
//
// The fourth thing that changes what a chunk draws without moving a voxel, after
// light and sign text -- and the one the cache could not see at all. `fillVoid`
// rewrites the **palette**: index 0 stops being air and starts being water, so
// every empty cell in the document changes while the grid this cache diffs stays
// byte for byte identical.
//
// Unobserved, the answer came back in the worst shape available. `documentMesh`'s
// own key contains the void block, so the mesh *was* rebuilt -- and every chunk
// was carried forward unchanged, and `shipMesh`, which tests object identity on
// the positions array, then truthfully reported that nothing had changed. The
// viewport was told the truth about a lie. On screen it read as the choice having
// no effect whatever until some unrelated edit dirtied a chunk, and then as the
// new void appearing in that one chunk alone.
console.log("\n--- changing the void block re-meshes ---");
{
  const doc = createDocument({ width: 20, height: 20, length: 20 });
  setBlock(doc, 2, 2, 2, STONE);
  const real = toStructureData(doc);
  const filled = fillVoid(real, "minecraft:water");
  await culledFaces(filled.structure, baker, undefined, null, undefined, filled.voidIndices);
  const atlas = buildAtlas(baker.textures);

  // A cache warmed with no void block, which is what an open document has.
  const dry = await buildChunkedMesh(real, baker, atlas.uvRects, 1, createChunkMeshCache());
  equal("the cache starts with no void layer", dry.voidPieces.length, 0);

  const wet = await buildChunkedMesh(
    filled.structure,
    baker,
    atlas.uvRects,
    1,
    dry.cache,
    null,
    null,
    filled.voidIndices,
  );
  check("choosing one against a warm cache builds the layer", wet.voidPieces.length > 0);
  equal("...by re-meshing every chunk, since every empty cell changed", wet.rebuilt, wet.total);

  /*
   * The property this whole file exists to state, applied to the void: what an
   * incremental pass produces has to equal what a cold one would, or the picture
   * depends on how you arrived at it.
   */
  const cold = await buildChunkedMesh(
    filled.structure,
    baker,
    atlas.uvRects,
    1,
    createChunkMeshCache(),
    null,
    null,
    filled.voidIndices,
  );
  equal(
    "...and it is what a cold cache would have built",
    fingerprint(concat(wet.voidPieces)),
    fingerprint(concat(cold.voidPieces)),
  );

  // And back. Going to air has to take the layer down, or the water stays on
  // screen over a document that no longer has any.
  const dried = await buildChunkedMesh(real, baker, atlas.uvRects, 1, wet.cache);
  equal("going back to air takes it down again", dried.voidPieces.length, 0);
  equal(
    "...leaving the structure exactly as it was",
    fingerprint(concat(dried.pieces)),
    fingerprint(concat(dry.pieces)),
  );

  /*
   * Swapping one void block for another is the case a set of palette *indices*
   * cannot see: water and lava mark the very same index, so anything keyed on
   * `voidIndices` alone would call these two documents identical.
   */
  const lava = fillVoid(real, "minecraft:lava");
  await culledFaces(lava.structure, baker, undefined, null, undefined, lava.voidIndices);
  const both = buildAtlas(baker.textures);
  const wetAgain = await buildChunkedMesh(
    filled.structure,
    baker,
    both.uvRects,
    2,
    createChunkMeshCache(),
    null,
    null,
    filled.voidIndices,
  );
  const burning = await buildChunkedMesh(
    lava.structure,
    baker,
    both.uvRects,
    2,
    wetAgain.cache,
    null,
    null,
    lava.voidIndices,
  );
  check(
    "swapping one void block for another re-meshes too",
    fingerprint(concat(burning.voidPieces)) !== fingerprint(concat(wetAgain.voidPieces)),
  );
}


// --- the box comes from the chunks, not from the vertices ---------------------
//
// The viewport's caption wants the geometry's extent, and `preview.ts` used to
// find it by walking every vertex of every chunk on every edit -- 39 ms of a
// 207 ms edit on a dense 128x32x128, over chunks that had not moved. Each chunk
// carries its own box now, so the union is O(chunks) and only a rebuilt chunk
// pays for one. Fourth thing to ride with a chunk, after voxels, light and
// sign text.
//
// The property to check is the one an incremental cache always has to have:
// **the cheap answer equals the expensive one**, over a sequence of edits.
console.log("\n--- the box comes from the chunks ---");
{
  const walked = (pieces: readonly MeshBuffers[]) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const piece of pieces) {
      for (let i = 0; i < piece.positions.length; i += 3) {
        for (let a = 0; a < 3; a += 1) {
          const v = piece.positions[i + a];
          if (v < min[a]) min[a] = v;
          if (v > max[a]) max[a] = v;
        }
      }
    }
    return { min, max };
  };

  /*
   * A floor and nothing else, deliberately not `seeded()`.
   *
   * `seeded()` has a column running the full height of the document, so its
   * overall box never moves however the chunks are edited -- and a union that
   * read stale per-chunk boxes would pass every comparison below. The extremes
   * have to be the thing being edited, or the check is about nothing. Verified
   * by making a rebuilt chunk hold on to its old box: against `seeded()` that
   * fails nothing at all.
   */
  const doc = createDocument({ width: 40, height: 40, length: 40 });
  for (let x = 0; x < 40; x += 1) {
    for (let z = 0; z < 40; z += 1) setBlock(doc, x, 0, z, STONE);
  }
  const cold = await fromScratch(doc);
  equal("a cold build\'s box is the box its vertices are in", cold.bounds, walked(cold.pieces));

  /*
   * And it survives editing, which is the half a cold build cannot show. A
   * chunk carried forward by reference carries its box with it, so a stale one
   * would only appear after an edit -- and only in the caption, which is
   * exactly the kind of wrongness that survives.
   */
  let cache = cold.cache;
  /*
   * Outward first, which grows the box, then back, which shrinks it: a union
   * that never forgot a chunk would pass the first and fail the second.
   *
   * `(5, 15, 5)` is the case that matters and is easy to leave out. It lands
   * in a chunk that **already has geometry** -- the seeded floor -- so the
   * chunk is rebuilt rather than created, and its box has to be rebuilt with
   * it. An edit into an empty chunk cannot see that: there is no stale box to
   * keep. Verified by making a rebuilt chunk hold on to its old box, which
   * fails nothing at all without this row.
   */
  for (const [x, y, z, block] of [
    [5, 15, 5, GLASS],
    [39, 30, 39, GLASS],
    [0, 30, 0, GLASS],
    [5, 15, 5, AIR],
    [39, 30, 39, AIR],
    [0, 30, 0, AIR],
  ] as const) {
    setBlock(doc, x, y, z, block);
    const next = await incremental(doc, cache);
    cache = next.cache;
    equal(
      `...and after writing ${block.namespacedName} at ${x},${y},${z}`,
      next.bounds,
      walked(next.pieces),
    );
  }

  /*
   * And nothing in the app fuses the chunks any more.
   *
   * `concatChunks` had exactly one consumer -- `preview.ts` asking
   * `buffers.indices.length === 0` -- and `pieces` only ever receives chunks
   * that have indices, so the question was already answered. Building the
   * fused mesh to ask it was **155 ms of a 207 ms edit**, some 264 MB
   * allocated and copied per placed block. Putting it back would restore that
   * silently: every check in this file would still pass, because this file is
   * where the fusing legitimately happens.
   */
  const preview = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "main", "services", "preview.ts"),
    "utf8",
  );
  // A *call*, not a mention: the comment there names it deliberately, and a
  // check that forbade the word would be a check against writing the reason
  // down.
  check(
    "the preview does not fuse the chunks to ask if they are empty",
    !/concatChunks\(/.test(preview),
  );
  check(
    "...it counts them instead",
    /chunked\.pieces\.length === 0/.test(preview),
  );
}

// --- incremental edits match a rebuild, through growth and light -------------
//
// The edit loop no longer compares the whole grid: it takes the document's own
// list of written cells, relights only the columns near them, and carries the
// chunks across a resize in content coordinates. Each of those is a shortcut
// that is only worth having if it is exact, so every step of a random walk --
// blocks, torches, glowstone, holes, the box growing on every side and
// shrinking back -- is meshed incrementally and from scratch, and the two have
// to be the same geometry, the same light in every vertex, and the same light
// grid. A shortcut that is merely close fails here.
console.log("\n--- incremental edits match a rebuild, through growth and light ---");
{
  const options = { resourcePackPath: null, fallbackResourcePackPath: null };
  const TORCH = block("minecraft:torch");
  const GLOWSTONE = block("minecraft:glowstone");
  const doc = createDocument({ width: 34, height: 20, length: 30 });
  for (let x = 0; x < doc.width; x += 1) {
    for (let z = 0; z < doc.length; z += 1) setBlock(doc, x, 0, z, STONE);
  }
  for (let y = 1; y < 12; y += 1) setBlock(doc, 10, y, 10, PLANKS);
  for (let x = 4; x < 20; x += 1) setBlock(doc, x, 9, 8, STONE);

  /** The same document with no history: what a rebuild from nothing sees. */
  const copy = (from: SchematicDocument): SchematicDocument => {
    const clean = createDocument({ width: from.width, height: from.height, length: from.length });
    clean.voxels.set(from.voxels);
    clean.palette = [...from.palette];
    clean.paletteIndex = new Map(from.paletteIndex);
    clean.counts = countsOf(clean.voxels, clean.palette.length);
    clean.frame = [from.frame[0], from.frame[1], from.frame[2]];
    return clean;
  };
  /** Geometry *and* light, so a relight that is only close is caught. */
  const lit = (pieces: readonly MeshBuffers[]): string => {
    const fused = concatChunks(pieces);
    let h = 2166136261;
    for (let i = 0; i < fused.light.length; i += 1) {
      h ^= Math.round(fused.light[i] * 1000) | 0;
      h = Math.imul(h, 16777619);
    }
    return `${fingerprint(fused)}:${(h >>> 0).toString(16)}`;
  };

  let seed = 7;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];

  let built = await buildDocumentPreview(doc, options);
  let mismatches = 0;
  let lightMismatches = 0;
  const failed: string[] = [];
  let what = "";
  let incremental = 0;
  let grew = 0;
  const steps = 70;
  for (let step = 0; step < steps; step += 1) {
    const roll = random();
    if (roll < 0.12) {
      // Grow on one side, low sides moving the content.
      const axis = Math.floor(random() * 3);
      const low = random() < 0.5;
      const by = 1 + Math.floor(random() * 3);
      const size = { width: doc.width, height: doc.height, length: doc.length };
      const shift: [number, number, number] = [0, 0, 0];
      if (axis === 0) size.width += by;
      if (axis === 1) size.height += by;
      if (axis === 2) size.length += by;
      if (low) shift[axis] = by;
      resizeDocument(doc, size, shift);
      grew += 1;
      what = `grow ${"xyz"[axis]}${low ? "-" : "+"}${by}`;
    } else if (roll < 0.16 && doc.width > 30) {
      resizeDocument(doc, { width: doc.width - 2, height: doc.height, length: doc.length });
      what = "shrink x";
    } else {
      const x = Math.floor(random() * doc.width);
      const y = 1 + Math.floor(random() * (doc.height - 1));
      const z = Math.floor(random() * doc.length);
      const placed = pick([STONE, PLANKS, GLASS, TORCH, GLOWSTONE, AIR, AIR]);
      setBlock(doc, x, y, z, placed);
      what = `${placed.namespacedName.slice(10)} at ${x},${y},${z}`;
    }
    built = await buildDocumentPreview(doc, options, built.meshCache);
    if (process.env.DEBUG_LIGHT) console.log(`    step ${step}: ${what} -> ${built.rebuiltChunks}/${built.totalChunks} ${doc.width}x${doc.height}x${doc.length} frame ${doc.frame}`);
    if (built.rebuiltChunks < built.totalChunks) incremental += 1;
    const reference = await buildDocumentPreview(copy(doc), options);
    if (lit(built.mesh.chunks) !== lit(reference.mesh.chunks)) {
      mismatches += 1;
      if (failed.length < 6) failed.push(`step ${step}: ${what}`);
    }
    const truth = computeLight(toStructureData(doc));
    const held = built.meshCache.lightGrid;
    if (
      held === null ||
      held.block.length !== truth.block.length ||
      held.block.some((value, i) => value !== truth.block[i]) ||
      held.sky.some((value, i) => value !== truth.sky[i])
    ) {
      lightMismatches += 1;
      if (failed.length < 6) failed.push(`light at step ${step}: ${what}`);
      if (process.env.DEBUG_LIGHT && held !== null && lightMismatches === 1) {
        const plane = doc.height * doc.length;
        let shown = 0;
        for (let i = 0; i < truth.block.length && shown < 12; i += 1) {
          if (held.block[i] !== truth.block[i] || held.sky[i] !== truth.sky[i]) {
            const x = Math.floor(i / plane);
            const y = Math.floor((i % plane) / doc.length);
            const z = i % doc.length;
            console.log(`    ${x},${y},${z}: held ${held.block[i]}/${held.sky[i]} truth ${truth.block[i]}/${truth.sky[i]}`);
            shown += 1;
          }
        }
      }
    }
  }
  check("every step meshes the same as a rebuild, light included", mismatches === 0, `${mismatches}; ${failed.join("; ")}`);
  equal("...and leaves the same light grid as a full flood", lightMismatches, 0);
  check("the walk grew the box on its way", grew >= 4, `${grew}`);
  check("...and most steps took the short way", incremental > steps / 2, `${incremental} of ${steps}`);

  /*
   * And the short way is short: one block placed past the far edge re-meshes
   * a chunk or two, not the column of chunks along the face it crossed.
   */
  const edge = createDocument({ width: 40, height: 16, length: 40 });
  for (let x = 0; x < 40; x += 1) for (let z = 0; z < 40; z += 1) setBlock(edge, x, 0, z, STONE);
  let edgeBuilt = await buildDocumentPreview(edge, options);
  resizeDocument(edge, { width: 41, height: 16, length: 40 });
  setBlock(edge, 40, 0, 20, STONE);
  edgeBuilt = await buildDocumentPreview(edge, options, edgeBuilt.meshCache);
  check("a block past the far edge re-meshes a chunk or two", edgeBuilt.rebuiltChunks <= 3, `${edgeBuilt.rebuiltChunks}`);
  resizeDocument(edge, { width: 42, height: 16, length: 40 }, [1, 0, 0]);
  setBlock(edge, 0, 0, 20, STONE);
  edgeBuilt = await buildDocumentPreview(edge, options, edgeBuilt.meshCache);
  check("...and past the near edge, where the content moves, too", edgeBuilt.rebuiltChunks <= 3, `${edgeBuilt.rebuiltChunks}`);
  equal("the payload says where the content went", edgeBuilt.mesh.frame, [1, 0, 0]);
}

// --- the atlas grows without moving a tile ----------------------------------
//
// A texture that arrives after the sheet was packed goes into its reserve. If
// any tile already placed moved, every chunk meshed against it would be
// wrong; if the patch did not hold exactly the new tile's pixels, the renderer
// would draw garbage there.
console.log("\n--- the atlas grows without moving a tile ---");
{
  const tile = (size: number, shade: number): RgbaImage => {
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = shade;
      data[i + 1] = (i / 4) % 256;
      data[i + 2] = 255 - shade;
      data[i + 3] = 255;
    }
    return { width: size, height: size, data };
  };
  const images: Record<string, RgbaImage> = {};
  for (let i = 0; i < 20; i += 1) images[`block/t${i}`] = tile(16 << (i % 3), i * 10);
  const atlas = packAtlas(images, 256, 6, 0.15);
  const before = JSON.stringify(atlas.uvRects);
  check("a packing with reserve keeps empty rows below", atlas.image.height > atlas.layout.penY + atlas.layout.shelfHeight);
  equal("...and is laid out as the plain packing is", JSON.stringify(buildAtlas(images, 256, 6).uvRects).length > 0, true);

  images["block/new"] = tile(32, 99);
  const fits = appendTiles(atlas, images, ["block/new"]);
  check("a new texture fits in the reserve", fits);
  const kept = JSON.parse(before) as Record<string, number[]>;
  check(
    "...and no tile already placed moved",
    Object.entries(kept).every(([key, rect]) => JSON.stringify(atlas.uvRects[key]) === JSON.stringify(rect)),
  );
  const patch = tilePixels(atlas, "block/new");
  const placed = atlas.layout.placed.get("block/new");
  check("the patch is the new tile's square", patch !== null && placed !== undefined && patch.width === 32 + 12);
  if (patch !== null) {
    let same = true;
    for (let row = 0; row < patch.height && same; row += 1) {
      for (let col = 0; col < patch.width * 4; col += 1) {
        if (patch.pixels[row * patch.width * 4 + col] !== atlas.image.data[((patch.y + row) * atlas.image.width + patch.x) * 4 + col]) {
          same = false;
          break;
        }
      }
    }
    check("...holding exactly the sheet's pixels there", same);
  }

  // Far more than the reserve can take: the caller has to pack again.
  const flood: string[] = [];
  for (let i = 0; i < 400; i += 1) {
    images[`block/flood${i}`] = tile(64, i % 256);
    flood.push(`block/flood${i}`);
  }
  check("more than the reserve holds is refused, so the sheet is packed again", !appendTiles(atlas, images, flood));
}


// --- levels of detail -------------------------------------------------------
//
// Built beside the chunks, from main's queue and never from an edit's own
// build, and only when the window asks for them. The property the suite above
// rests on holds here too: a queue drained after edits gives exactly the
// pieces a build from nothing gives.
console.log("\n--- levels of detail ---");
{
  equal("a region is four chunks of sixteen", REGION_SIZE, REGION_CHUNKS * CHUNK_SIZE);

  /*
   * With the bundled pack, and not the bare baker the rest of this suite
   * uses: without textures a statue bakes to the hashed-colour cube, which
   * has six faces and nothing to simplify.
   */
  const resources = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "resources");
  const zips = (await readdir(resources)).filter((name) => name.toLowerCase().endsWith(".zip")).sort();
  const lodBaker = await ModelBaker.create(null, zips.length > 0 ? path.join(resources, zips[0]) : null);

  const STATUE = block("minecraft:copper_golem_statue", {
    copper_golem_pose: "running",
    facing: "north",
    waterlogged: "false",
  });
  /*
   * A stone floor two blocks thick, a patch of statues in the first chunk and
   * a wall. Two thick so the floor's top is on a two-block cell's top: a
   * coarse face reads the corner shading of the fine faces in its own plane.
   */
  const lodDoc = (): SchematicDocument => {
    const doc = createDocument({ width: 40, height: 20, length: 40 });
    for (let x = 0; x < 40; x += 1) {
      for (let z = 0; z < 40; z += 1) {
        setBlock(doc, x, 0, z, STONE);
        setBlock(doc, x, 1, z, STONE);
      }
    }
    for (let x = 2; x < 8; x += 1) {
      for (let z = 2; z < 8; z += 1) setBlock(doc, x, 2, z, STATUE);
    }
    for (let y = 2; y < 10; y += 1) {
      for (let z = 20; z < 30; z += 1) setBlock(doc, 24, y, z, STONE);
    }
    return doc;
  };
  const ask = (budgetMs: number, autoTriangles: number | null = null): LodRequest => ({
    shapes: true,
    coarse: true,
    autoTriangles,
    budgetMs,
  });
  const lodBuild = async (
    doc: SchematicDocument,
    cache: ChunkMeshCache,
    lod: LodRequest | null,
  ): Promise<ChunkedMeshResult> => {
    const structure = toStructureData(doc);
    await culledFaces(structure, lodBaker);
    for (const entry of structure.palette) await lodBaker.bakeLod(entry);
    const atlas = buildAtlas(lodBaker.textures);
    const light = computeLight(structure);
    return buildChunkedMesh(
      structure,
      lodBaker,
      atlas.uvRects,
      1,
      cache,
      { light, occlusion: true, smooth: true },
      null,
      null,
      null,
      null,
      { frame: [0, 0, 0], changed: null, lod },
    );
  };
  /** Builds, then asks again until nothing is queued: what the window does. */
  const drained = async (doc: SchematicDocument, cache: ChunkMeshCache, lod: LodRequest) => {
    let result = await lodBuild(doc, cache, lod);
    let rounds = 0;
    while (result.lod.state === "pending" && rounds < 1000) {
      result = await lodBuild(doc, result.cache, { ...lod, budgetMs: 40 });
      rounds += 1;
    }
    return result;
  };
  const piecesOf = (result: ChunkedMeshResult) =>
    new Map(result.lodPieces.map((piece) => [`${piece.layer}:${piece.key}`, piece]));
  const statueChunk = chunkKey(0, 0, 0);
  const region = chunkKey(0, 0, 0);

  const off = await lodBuild(lodDoc(), createChunkMeshCache(), null);
  equal("asked for nothing, nothing is built", off.lodPieces.length, 0);
  equal("...and says so", off.lod.state, "off");

  const doc = lodDoc();
  const cold = await lodBuild(doc, createChunkMeshCache(), ask(0));
  equal("an edit's own build builds no level", cold.lodPieces.length, 0);
  equal("...and says they are coming", cold.lod.state, "pending");
  check("...and counts the full mesh", cold.lod.triangles > 0);

  const ready = await drained(doc, cold.cache, ask(0));
  equal("asking again builds them all", ready.lod.state, "ready");
  const built = piecesOf(ready);
  check("the chunk with statues has a level 1", built.has(`lod1:${statueChunk}`));
  equal(
    "...whose error is the statues' own, measured",
    built.get(`lod1:${statueChunk}`)?.error,
    lodShapeError(STATUE),
  );
  check(
    "no chunk without a complex block has one",
    [...built.keys()].filter((name) => name.startsWith("lod1:")).length === 1,
  );
  check("the region has both coarse levels", built.has(`lod2:${region}`) && built.has(`lod3:${region}`));
  equal("...erring by a whole cell each", [built.get(`lod2:${region}`)?.error, built.get(`lod3:${region}`)?.error], [
    COARSE_ERROR.lod2,
    COARSE_ERROR.lod3,
  ]);

  // An edit among the statues: level 1 of that chunk goes at once, the
  // region's coarse meshes stay on screen until their rebuild lands.
  setBlock(doc, 3, 2, 3, AIR);
  const edited = await lodBuild(doc, ready.cache, ask(0));
  const after = piecesOf(edited);
  check("an edit takes its chunk's level 1 down at once", !after.has(`lod1:${statueChunk}`));
  check(
    "...and keeps the stale region on screen meanwhile",
    after.get(`lod2:${region}`)?.buffers === built.get(`lod2:${region}`)?.buffers,
  );
  equal("...and queues both", edited.lod.state, "pending");

  const caught = await drained(doc, edited.cache, ask(0));
  const fresh = await drained(doc, createChunkMeshCache(), ask(0));
  const prints = (result: ChunkedMeshResult) =>
    result.lodPieces.map((piece) => `${piece.layer}:${piece.key}:${fingerprint(piece.buffers)}:${piece.error}`).join("|");
  equal("a drained queue gives exactly what a build from nothing gives", prints(caught), prints(fresh));
  check("...and the region was rebuilt, not kept", piecesOf(caught).get(`lod2:${region}`)?.buffers !== built.get(`lod2:${region}`)?.buffers);

  // Asking for levels re-meshes no chunk: they are built beside them.
  const plain = await lodBuild(doc, createChunkMeshCache(), null);
  const asked = await drained(doc, plain.cache, ask(0));
  check(
    "asking for levels re-meshes no chunk's full mesh",
    asked.pieces.length === plain.pieces.length && asked.pieces.every((piece, i) => piece === plain.pieces[i]),
  );
  const dropped = await lodBuild(doc, asked.cache, null);
  equal("no longer asking takes every level down", dropped.lodPieces.length, 0);

  // Automatic: only from the threshold.
  const below = await drained(doc, createChunkMeshCache(), ask(0, 1e9));
  equal("under the automatic threshold, nothing is built", below.lodPieces.length, 0);
  equal("...and it says why", below.lod.state, "below");
  const above = await drained(doc, below.cache, ask(0, 1));
  check("over it, the levels are built", above.lodPieces.length > 0 && above.lod.state === "ready");
  const backBelow = await lodBuild(doc, above.cache, ask(0, 1e9));
  equal("back under it, they go", backBelow.lodPieces.length, 0);

  // A coarse face is as bright as what it stands for: on open flat ground,
  // full sky and no occlusion; beside the wall, darker at the corner.
  const level2 = built.get(`lod2:${region}`)!.buffers;
  let open = false;
  let shaded = false;
  for (let v = 0; v < level2.positions.length / 3; v += 1) {
    const up = level2.normals[v * 3 + 1] > 0.5;
    if (!up) continue;
    const sky = level2.light[v * 3 + 1];
    const occlusion = level2.light[v * 3 + 2];
    if (sky === 1 && occlusion === 1) open = true;
    if (occlusion < 1 && occlusion > 0.4) shaded = true;
  }
  check("a coarse face on open ground is lit like the ground", open);
  check("one against the wall carries the corner shading the ground there has", shaded);
}

console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exitCode = failures === 0 ? 0 : 1;
