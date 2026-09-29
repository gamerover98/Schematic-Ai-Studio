/**
 * Restarts the app, for a setting that only applies at launch -- today the
 * GPU preference (`gpu_preference.ts`).
 *
 * Unsaved work is asked about *before* `app.relaunch()`, which is
 * `installUpdate`'s order for a sharper reason: a relaunch is scheduled for
 * whenever the process next exits, so leaving the question to the close
 * handler and having it declined would restart the app at some unrelated
 * quit later on.
 */

import path from "path";

import { app, dialog, type BrowserWindow, type MessageBoxOptions } from "electron";

import { isDirty } from "../domain/history.js";
import { discardPrompt } from "./discard_prompt.js";
import { confirmQuit } from "./quit_guard.js";
import { currentSession } from "./session.js";

/** `false` when the unsaved-work prompt was declined and nothing happened. */
export async function relaunchApp(target: BrowserWindow | null): Promise<boolean> {
  const session = currentSession();
  if (session !== null && isDirty(session.history)) {
    const prompt = discardPrompt(
      "restart",
      session.doc.filePath === null ? null : path.basename(session.doc.filePath),
    );
    const options: MessageBoxOptions = {
      type: "warning",
      buttons: [prompt.confirmLabel, prompt.cancelLabel],
      defaultId: 1,
      cancelId: 1,
      message: prompt.message,
      detail: prompt.detail,
    };
    const answer =
      target !== null && !target.isDestroyed()
        ? await dialog.showMessageBox(target, options)
        : await dialog.showMessageBox(options);
    if (answer.response !== 0) return false;
  }
  confirmQuit();
  app.relaunch();
  app.quit();
  return true;
}
