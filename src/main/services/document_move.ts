/**
 * A schematic changing its path, and what goes with it.
 *
 * Four things are kept under the file's path rather than in the file: its
 * conversations (and the project notes beside them), its version history and
 * its hotbar. The recents are the fourth and need Electron, so the callers do
 * those. A file renamed outside the app therefore arrives with none of it --
 * which is what the rename here exists to stop: the user's report was losing
 * the chats with the AI by renaming a schematic.
 *
 * Two modes, one per verb:
 * - **move** for a rename. The file is the same file under another name, so
 *   everything goes with it and nothing is left behind.
 * - **copy** for Save As, which the user chose: the new file starts with the
 *   chats, the versions and the bar, and the old file keeps its own. Save As
 *   used to leave the chat behind: `adoptSubject` saved it under the old path
 *   and loaded the new one, empty.
 *
 * Every store is taken on its own, and a failure in one is a warning rather
 * than a refusal: by the time this runs the file has already been renamed or
 * written, and refusing then would report a failure about an act that
 * happened. `rememberProject`'s rule for its reason.
 *
 * Electron-free, so the suites can drive it; the stores are pointed at temp
 * directories there exactly as they are at startup here.
 */

import { carryConversations } from "./conversation.js";
import { carryHotbar } from "./hotbars.js";
import { carrySnapshots } from "./snapshots.js";

export type CarryMode = "move" | "copy";

const caseSensitive = process.platform !== "win32" && process.platform !== "darwin";

/** Takes the conversations, the versions and the hotbar from one path to another. */
export async function carryDocumentStores(from: string, to: string, mode: CarryMode): Promise<void> {
  // Every store is keyed on the lowercased path, so a rename that only
  // changes the case has nothing to move.
  if (from.toLowerCase() === to.toLowerCase()) return;
  const steps: [string, () => Promise<void>][] = [
    ["conversations", () => carryConversations(from, to, mode)],
    ["version history", () => carrySnapshots(from, to, mode)],
    ["hotbar", () => carryHotbar(from, to, mode)],
  ];
  for (const [what, step] of steps) {
    try {
      await step();
    } catch (err) {
      console.warn(`[document] the ${what} of ${from} could not be taken to ${to}:`, err);
    }
  }
}
