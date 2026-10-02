/**
 * What one placed block costs, end to end in main, on documents of the sizes
 * people build.
 *
 *   npm run bench:edit            all three documents
 *   npm run bench:edit -- dense   one of them by name
 *
 * The steps are the ones a click in creative mode goes through: the edit, the
 * `DocumentState` the window gets back, and the mesh request that follows,
 * answered against the token the window holds. The block-icon warm-up runs
 * first, as it does at startup, so the atlas starts settled.
 *
 * Three documents, each a different kind of hard:
 * - **dense**, a 3D checkerboard of stone and dirt: every face visible, the
 *   worst geometry per cell;
 * - **terrain**, rolling ground under open sky: big, mostly air, and lit;
 * - **statues**, copper golem statues in every pose: the heaviest model in the
 *   game, many times over.
 *
 * Not a test: nothing here can fail. It prints, so the numbers can go into
 * the commit and into `CLAUDE.md` beside the change that moved them.
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createDocument, internPalette } from "../src/main/domain/document.js";
import {
  adoptDocument,
  applyEdit,
  documentMesh,
  documentState,
  type DocumentSession,
} from "../src/main/services/session.js";
import { clearBakerCache, warmBaker, type DocumentPreviewOptions } from "../src/main/services/preview.js";
import { parsePaletteEntry } from "../src/main/pipeline/loader_formats.js";
import type { MeshPayload } from "../src/shared/ipc.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pack = path.join(root, "resources", "Faithful 64x - Release 14.zip");

const options: DocumentPreviewOptions = {
  resourcePackPath: null,
  fallbackResourcePackPath: pack,
};

function blockList(): string[] {
  return readFileSync(path.join(root, "block_id_list.txt"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

type Builder = () => DocumentSession;

/** A grid filled by a function of the cell, written straight into the voxels. */
function grid(
  width: number,
  height: number,
  length: number,
  at: (x: number, y: number, z: number) => string | null,
): DocumentSession {
  const doc = createDocument({ width, height, length });
  const indices = new Map<string, number>();
  const plane = height * length;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      for (let z = 0; z < length; z++) {
        const block = at(x, y, z);
        if (block === null) continue;
        let index = indices.get(block);
        if (index === undefined) {
          index = internPalette(doc, parsePaletteEntry(block));
          indices.set(block, index);
        }
        doc.voxels[x * plane + y * length + z] = index;
      }
    }
  }
  return adoptDocument(doc);
}

const POSES = ["standing", "sitting", "running", "star"];
const FACINGS = ["north", "east", "south", "west"];

const documents: Record<string, { build: Builder; place: [number, number, number]; edge: [number, number, number] }> = {
  dense: {
    build: () => grid(128, 32, 128, (x, y, z) => ((x + y + z) % 2 === 0 ? "minecraft:stone" : (x + z) % 3 === 0 ? "minecraft:dirt" : null)),
    place: [64, 16, 63],
    edge: [128, 0, 64],
  },
  terrain: {
    build: () =>
      grid(256, 96, 256, (x, y, z) => {
        const ground = Math.round(40 + 8 * Math.sin(x / 23) + 6 * Math.cos(z / 17) + 3 * Math.sin((x + z) / 9));
        if (y > ground) return null;
        if (y === ground) return "minecraft:grass_block[snowy=false]";
        if (y > ground - 4) return "minecraft:dirt";
        return "minecraft:stone";
      }),
    place: [128, 70, 128],
    edge: [256, 40, 128],
  },
  statues: {
    build: () =>
      grid(64, 16, 64, (x, y, z) =>
        `minecraft:copper_golem_statue[copper_golem_pose=${POSES[(x + y) % 4]},facing=${FACINGS[(z + y) % 4]},waterlogged=false]`,
      ),
    place: [32, 8, 32],
    edge: [64, 0, 32],
  },
};

function kilobytes(payload: MeshPayload): number {
  let bytes = 0;
  for (const chunk of payload.chunks) {
    bytes += chunk.positions.byteLength + chunk.normals.byteLength + chunk.uvs.byteLength + chunk.indices.byteLength + chunk.light.byteLength;
  }
  if (payload.atlas !== null) {
    bytes += payload.atlas.pixels.byteLength;
    for (const animation of payload.atlas.animations) bytes += animation.frames.byteLength;
  }
  if (payload.atlasPatch !== null) {
    for (const tile of payload.atlasPatch.tiles) bytes += tile.pixels.byteLength;
    for (const animation of payload.atlasPatch.animations) bytes += animation.frames.byteLength;
  }
  return Math.round(bytes / 1024);
}

function triangles(payload: MeshPayload): number {
  let count = 0;
  for (const chunk of payload.chunks) count += chunk.indices.length / 3;
  return count;
}

const ms = (from: number) => Math.round((performance.now() - from) * 10) / 10;

async function run(name: string): Promise<void> {
  const spec = documents[name];
  let t = performance.now();
  const session = spec.build();
  console.log(`\n=== ${name} ${session.doc.width}x${session.doc.height}x${session.doc.length} (built in ${ms(t)} ms) ===`);

  t = performance.now();
  const first = await documentMesh(session, options);
  let held = {
    mesh: first.mesh.token as string | null,
    atlas: first.mesh.atlasVersion as number | null,
    atlasLayout: first.mesh.atlasLayout as number | null,
  };
  console.log(`cold mesh            ${ms(t)} ms   ${first.mesh.chunks.length} chunks   ${triangles(first.mesh).toLocaleString()} tris   ${kilobytes(first.mesh).toLocaleString()} KB`);

  const edit = async (label: string, block: string, at: [number, number, number]): Promise<void> => {
    const t0 = performance.now();
    const changed = applyEdit(session, { kind: "setBlock", x: at[0], y: at[1], z: at[2], block: parsePaletteEntry(block) });
    const tEdit = ms(t0);
    const t1 = performance.now();
    documentState(session);
    const tState = ms(t1);
    const t2 = performance.now();
    const answer = await documentMesh(session, options, held);
    const tMesh = ms(t2);
    held = { mesh: answer.mesh.token, atlas: answer.mesh.atlasVersion, atlasLayout: answer.mesh.atlasLayout };
    const timings = (answer as { timings?: Record<string, number> }).timings;
    console.log(
      `${label.padEnd(20)} edit ${tEdit} ms · state ${tState} ms · mesh ${tMesh} ms · ` +
        `${answer.mesh.chunks.length} chunks${answer.mesh.partial ? "" : " (full)"} · ${kilobytes(answer.mesh).toLocaleString()} KB` +
        `${answer.mesh.atlas !== null ? " · whole atlas" : ""}` +
        `${answer.mesh.atlasPatch !== null ? ` · ${answer.mesh.atlasPatch.tiles.length} atlas tiles` : ""}` +
        `${changed === 0 ? " · nothing changed" : ""}` +
        (timings ? `\n${"".padEnd(21)}${Object.entries(timings).map(([k, v]) => `${k} ${Math.round(v * 10) / 10}`).join(" · ")}` : ""),
    );
  };

  await edit("place, middle", "minecraft:oak_planks", spec.place);
  await edit("break, middle", "minecraft:air", spec.place);
  await edit("place, middle again", "minecraft:oak_planks", spec.place);
  await edit("torch, middle", "minecraft:torch", [spec.place[0] + 1, spec.place[1], spec.place[2]]);
  await edit("new texture", "minecraft:furnace[facing=north,lit=true]", [spec.place[0] - 1, spec.place[1], spec.place[2]]);
  await edit("place at the edge", "minecraft:oak_planks", spec.edge);
  await edit("place past it again", "minecraft:oak_planks", [spec.edge[0] + 1, spec.edge[1], spec.edge[2]]);
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((arg) => arg !== "--");
  clearBakerCache();
  const t = performance.now();
  await warmBaker(blockList().map((block) => parsePaletteEntry(block.split("[", 1)[0])), options);
  console.log(`warm-up ${ms(t)} ms`);
  for (const name of only.length > 0 ? only : Object.keys(documents)) {
    if (!(name in documents)) {
      console.log(`unknown document ${name}; one of ${Object.keys(documents).join(", ")}`);
      continue;
    }
    await run(name);
  }
}

await main();
