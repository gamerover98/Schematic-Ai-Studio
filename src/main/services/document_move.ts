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

import { rename, stat } from "fs/promises";
import path from "path";

import { carryConversations } from "./conversation.js";
import { carryHotbar } from "./hotbars.js";
import { carrySnapshots } from "./snapshots.js";
import type { DocumentSession } from "./session.js";

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

/** A rename main will not do, said in a sentence the user can act on. */
export class RenameRefusedError extends Error {}

/** Names Windows will not give a file, whatever follows the dot. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Characters no file name may hold on Windows, plus the two separators. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/;

/**
 * Why `name` cannot be a schematic's new name, or `null` when it can.
 *
 * Windows' rules, on every platform: a schematic is a file people send each
 * other, and a name one system cannot hold is a file that will not copy.
 */
export function renameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "A schematic needs a name.";
  if (FORBIDDEN.test(trimmed)) {
    return `"${trimmed}" has a character a file name cannot hold: none of < > : " / \\ | ? * may be used.`;
  }
  if (/[. ]$/.test(trimmed)) return "A file name cannot end with a dot or a space.";
  if (RESERVED.test(trimmed.split(".")[0])) return `"${trimmed}" is a name Windows keeps for itself.`;
  if (trimmed.length > 200) return "That name is too long for a file.";
  return null;
}

/**
 * Where `filePath` goes under `name`: the same folder and the same extension.
 *
 * The extension is the format's and is not the user's to change here -- a
 * `.schem` holding MCEdit bytes is a file nothing opens -- so a name typed
 * with it already on is not given it twice.
 */
export function renamedPath(filePath: string, name: string): string {
  const extension = path.extname(filePath);
  let base = name.trim();
  if (extension !== "" && base.toLowerCase().endsWith(extension.toLowerCase())) {
    base = base.slice(0, -extension.length);
  }
  return path.join(path.dirname(filePath), base + extension);
}

/**
 * Renames the open schematic's file and takes everything kept under its path
 * with it. Answers both paths, for the caller's recents.
 *
 * Refused, with nothing touched, for a document never saved, for a name that
 * cannot be a file and for a destination that exists: renaming must not write
 * over somebody else's file, and it is not `save_document_as`, which moves one
 * aside. Unsaved changes stay unsaved -- renaming is not saving.
 */
export async function renameDocumentFile(
  session: DocumentSession,
  name: string,
): Promise<{ from: string; to: string }> {
  const from = session.doc.filePath;
  if (from === null) {
    throw new RenameRefusedError("This schematic has never been saved, so it has no file to rename. Save it first.");
  }
  const problem = renameProblem(name);
  if (problem !== null) throw new RenameRefusedError(problem);
  const to = renamedPath(from, name);
  if (to === from) return { from, to };
  const sameFile = from.toLowerCase() === to.toLowerCase() && !caseSensitive;
  if (!sameFile && (await stat(to).catch(() => null)) !== null) {
    throw new RenameRefusedError(`${path.basename(to)} already exists in that folder. Choose another name.`);
  }
  try {
    await rename(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new RenameRefusedError(
      code === "ENOENT"
        ? `${path.basename(from)} is no longer where it was opened from, so it cannot be renamed. Use Save As.`
        : `${path.basename(from)} could not be renamed: ${(err as Error).message}`,
    );
  }
  session.doc.filePath = to;
  await carryDocumentStores(from, to, "move");
  return { from, to };
}
