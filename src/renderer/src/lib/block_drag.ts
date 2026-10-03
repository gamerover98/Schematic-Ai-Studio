/**
 * A block carried by the pointer from one part of the window to another, and
 * the rule that keeps it from being mistaken for a file.
 *
 * The viewport takes a file dropped on it and opens it, and it decided what
 * was a file by asking the drag whether it carried `Files`. Chromium says yes
 * for an **image dragged from inside the page**: it hands the picture over as
 * a file called `download.png`. So dragging a material's icon onto the canvas
 * -- the obvious thing to try -- came back as "download.png cannot be opened
 * as a schematic", with nothing anybody had asked to open.
 *
 * Three things answer it, and each covers what the others cannot:
 *
 * - **a block drag says so.** It carries `BLOCK_MIME` and nothing else, not
 *   even `text/plain`, which a text field under the pointer would type in;
 * - **icons are not draggable at all** (`img { -webkit-user-drag: none }` in
 *   `app.css`), so the only drags that start in the page are the ones this
 *   app starts on purpose;
 * - **a drag that started in the page is never a file**, whatever it carries
 *   (`trackPageDrags`). That is the backstop for a drag nobody labelled.
 *
 * Plain for `selection_drag.ts`'s reason: the decision is stated in a check
 * rather than found in a handler.
 */

/** What a dragged block is carried as: its spelling, exactly as a field holds it. */
export const BLOCK_MIME = "application/x-schematic-block";

/** Whether a drag carries a block from this window. */
export function carriesBlock(types: readonly string[] | undefined): boolean {
  return types !== undefined && types.includes(BLOCK_MIME);
}

/**
 * Whether a drag is a file from outside the window, which is the only thing
 * the viewport opens. `fromPage` is `trackPageDrags`' answer.
 */
export function isFileDrop(types: readonly string[] | undefined, fromPage: boolean): boolean {
  return types !== undefined && types.includes("Files") && !carriesBlock(types) && !fromPage;
}

/**
 * Starts a block drag: the spelling under `BLOCK_MIME` and nothing else, as a
 * copy -- the slot keeps its block.
 */
export function startBlockDrag(transfer: DataTransfer, block: string): void {
  transfer.clearData();
  transfer.setData(BLOCK_MIME, block);
  transfer.effectAllowed = "copy";
}

/** The block a drop carries, or `null` when it carries none. */
export function droppedBlock(transfer: DataTransfer | null): string | null {
  if (transfer === null || !carriesBlock([...transfer.types])) return null;
  const block = transfer.getData(BLOCK_MIME).trim();
  return block === "" ? null : block;
}

/**
 * Whether a drag in progress started inside the page.
 *
 * Set by a `dragstart` caught on the way down, so nothing that starts a drag
 * can keep it from being seen. Cleared by the `dragend` -- which does not
 * arrive when the element the drag started on has been taken out of the page
 * meanwhile, as a keyed list does when it changes under the pointer -- so also
 * by any `drop`, after the drop has been handled, and by the next pointer
 * move or press, which no drag lets through while it lasts.
 */
export function trackPageDrags(target: Window): { fromPage(): boolean; dispose(): void } {
  let active = false;
  const start = (): void => {
    active = true;
  };
  const end = (): void => {
    active = false;
  };
  // After every listener of this drop has run, or the viewport's own would
  // see the flag already gone.
  const dropped = (): void => {
    setTimeout(end, 0);
  };
  target.addEventListener("dragstart", start, true);
  target.addEventListener("dragend", end, true);
  target.addEventListener("drop", dropped, true);
  target.addEventListener("pointermove", end, true);
  target.addEventListener("pointerdown", end, true);
  return {
    fromPage: () => active,
    dispose: () => {
      target.removeEventListener("dragstart", start, true);
      target.removeEventListener("dragend", end, true);
      target.removeEventListener("drop", dropped, true);
      target.removeEventListener("pointermove", end, true);
      target.removeEventListener("pointerdown", end, true);
    },
  };
}
