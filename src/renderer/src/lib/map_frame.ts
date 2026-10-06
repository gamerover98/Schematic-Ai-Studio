/**
 * What a mix's map and a terrain's picture are drawn over.
 *
 * The box round every selected area, which is what a fill covers; or the
 * schematic with nothing selected, which is what the hand takes its shares
 * over (`pickAt`'s frame in `App.svelte`). A plain module because two panels
 * ask it -- the selection's With field and the Terrain tab -- and two copies
 * of a frame are how a map and the fill it previews come to disagree.
 */
import type { Box } from "../../../shared/regions.js";

export function mapFrameOf(
  selection: Box | null,
  areas: readonly Box[],
  documentSize: readonly [number, number, number] | null,
): Box | null {
  const boxes = selection === null ? areas : [selection, ...areas];
  if (boxes.length > 0) {
    return {
      minX: Math.min(...boxes.map((box) => box.minX)),
      minY: Math.min(...boxes.map((box) => box.minY)),
      minZ: Math.min(...boxes.map((box) => box.minZ)),
      maxX: Math.max(...boxes.map((box) => box.maxX)),
      maxY: Math.max(...boxes.map((box) => box.maxY)),
      maxZ: Math.max(...boxes.map((box) => box.maxZ)),
    };
  }
  if (documentSize === null) return null;
  const [width, height, length] = documentSize;
  return { minX: 0, minY: 0, minZ: 0, maxX: width - 1, maxY: height - 1, maxZ: length - 1 };
}
