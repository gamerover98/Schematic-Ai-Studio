/**
 * Which of the atlas's animated tiles a piece of geometry actually draws.
 *
 * The atlas is shared by everything the process has ever meshed -- the block
 * icon warm-up alone decodes every block in the game -- so its animation list
 * is every animated texture there is: water, lava, fire, prismarine, portals,
 * thirty-odd of them. Playing all of them uploaded every one into the atlas
 * every tick, for a document that might hold none, and each upload is a point
 * where the renderer waits for the GPU to finish with the atlas. The first
 * stutter report measured exactly that: an 11x12x11 document, 34 animations,
 * frames of up to 443 ms, all of it inside those uploads.
 *
 * So the viewer asks the geometry. A plain module for `selection_drag.ts`'s
 * reason: the arithmetic is the part that can be wrong, and it is tested.
 */

/** An animated tile, in atlas pixels -- `AtlasAnimation`'s `x`, `y`, `size`. */
export interface AnimatedTile {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/**
 * The indices of the tiles `uvs` samples.
 *
 * One vertex per quad is enough: `buildMesh` emits every face as four
 * vertices, all four inside the one tile the face's texture lives in, so the
 * first stands for the other three and the scan costs a quarter of the
 * vertices.
 *
 * The UVs are the tile's rect inset half a pixel (`atlasAnimations` in main
 * inverts the same arithmetic), so a corner lies strictly inside the tile and
 * never on the padding between two -- which is why the comparison is strict:
 * a UV on a tile's outer edge belongs to the padding, not to the tile.
 */
export function animationsUsed(
  uvs: Float32Array,
  tiles: readonly AnimatedTile[],
  atlasWidth: number,
  atlasHeight: number,
): number[] {
  if (tiles.length === 0) return [];
  const used = new Uint8Array(tiles.length);
  let found = 0;
  for (let i = 0; i + 1 < uvs.length; i += 8) {
    const px = uvs[i] * atlasWidth;
    const py = uvs[i + 1] * atlasHeight;
    for (let t = 0; t < tiles.length; t++) {
      if (used[t] === 1) continue;
      const tile = tiles[t];
      if (px > tile.x && px < tile.x + tile.size && py > tile.y && py < tile.y + tile.size) {
        used[t] = 1;
        found++;
        break;
      }
    }
    if (found === tiles.length) break;
  }
  const out: number[] = [];
  for (let t = 0; t < tiles.length; t++) if (used[t] === 1) out.push(t);
  return out;
}
