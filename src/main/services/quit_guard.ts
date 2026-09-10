/**
 * Whether leaving has already been agreed to.
 *
 * The window's close handler (`index.ts`) asks about unsaved work, and has to:
 * `close` is not async, so it refuses the first one and closes again once
 * answered. Installing an update quits too, and it asks the same question
 * *first* -- before the installer is started, because that installer closes
 * the app and, if the app will not go, ends it. Asked a second time, the
 * prompt would hold the window open under an installer about to kill it.
 *
 * So the question is answered once and recorded here, where both can read it.
 * A module of its own because `index.ts` and `updates.ts` would otherwise
 * import each other.
 */

let confirmed = false;

/** The user has agreed to leave; nothing should ask again. */
export function confirmQuit(): void {
  confirmed = true;
}

export function quitConfirmed(): boolean {
  return confirmed;
}
