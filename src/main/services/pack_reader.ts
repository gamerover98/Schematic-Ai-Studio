/**
 * One `ResourcePackTextures` for everything that reads a texture the mesher
 * never asks for.
 *
 * The sun, the moon and the marker's wooden axe all live outside `textures/block`
 * — nothing that meshes a block ever looks them up, so none of them go through
 * the baker or the atlas. They do, however, all come out of the same 17 MB zip,
 * and opening it once per caller is a cost worth not paying twice.
 *
 * Pixels rather than a PNG, for all of them, for the reason the atlas is pixels:
 * the renderer's CSP forbids `blob:`, three.js decodes an embedded image through
 * `ImageBitmapLoader`, and a decode that cannot happen fails by rendering white
 * while reporting success. Raw RGBA has nothing to decode.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { ResourcePackTextures } from "../pipeline/model_baker.js";
import type { RgbaImage } from "../pipeline/types.js";
import type { PackTexture } from "../../shared/ipc.js";

let cached: { key: string; textures: ResourcePackTextures } | null = null;

export async function packTextures(
  resourcePackPath: string | null,
  fallbackResourcePackPath: string | null,
): Promise<ResourcePackTextures> {
  const key = `${resourcePackPath ?? ""}\n${fallbackResourcePackPath ?? ""}`;
  if (cached?.key === key) return cached.textures;
  const textures = await ResourcePackTextures.create(resourcePackPath, fallbackResourcePackPath);
  cached = { key, textures };
  return textures;
}

export function toPackTexture(image: RgbaImage): PackTexture {
  return { width: image.width, height: image.height, pixels: image.data };
}

/** Dropped when the resource pack changes, like every other cached read. */
export function forgetPackTextures(): void {
  cached = null;
}

/** Where a resource pack keeps what this app reads out of it. */
const TEXTURES_DIR = "assets/minecraft/textures/";

/**
 * Why `packPath` cannot be used as a resource pack, or `null` when it can.
 *
 * Asked when the pack is chosen, so a wrong file is refused with a sentence
 * rather than chosen and then silently drawing the bundled pack: anything
 * without `assets/minecraft/textures/` at its root would be opened, searched
 * for every texture, and found to hold none of them.
 */
export async function resourcePackProblem(packPath: string): Promise<string | null> {
  const name = path.basename(packPath);
  const stat = await fs.stat(packPath).catch(() => null);
  if (stat === null) return `${name} does not exist.`;
  if (stat.isDirectory()) {
    const textures = await fs.stat(path.join(packPath, TEXTURES_DIR)).catch(() => null);
    return textures?.isDirectory() ? null : `${name} is not a resource pack: it has no ${TEXTURES_DIR} folder.`;
  }
  let zip: AdmZip;
  try {
    zip = new AdmZip(packPath);
  } catch {
    return `${name} could not be opened as a .zip.`;
  }
  return zip.getEntries().some((entry) => entry.entryName.replace(/\\/g, "/").startsWith(TEXTURES_DIR))
    ? null
    : `${name} is not a resource pack: it has no ${TEXTURES_DIR} folder.`;
}
