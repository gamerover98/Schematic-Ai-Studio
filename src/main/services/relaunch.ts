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

import { spawn } from "child_process";
import path from "path";

import { app, BrowserWindow, dialog, type MessageBoxOptions } from "electron";

import { stopMcpServer } from "../mcp/server.js";
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
  if (process.env.ELECTRON_RENDERER_URL) {
    // The new process binds the same MCP port.
    await stopMcpServer();
    relaunchUnderDevServer();
    return true;
  }
  app.relaunch();
  app.quit();
  return true;
}

/*
 * In development `app.relaunch()` restarts into a grey window. electron-vite
 * spawned this process and exits when it closes (`ps.on('close',
 * process.exit)`), taking the dev server -- and so `ELECTRON_RENDERER_URL` --
 * with it, and the new process loads a page nobody serves.
 *
 * So the old process starts the new one itself and stays alive, with no
 * window, until the new one exits: electron-vite keeps waiting on it, the
 * server keeps serving, and closing the new window still ends the session.
 */
function relaunchUnderDevServer(): void {
  const child = spawn(process.execPath, process.argv.slice(1), { stdio: "inherit", env: process.env });
  child.on("exit", (code) => app.exit(code ?? 0));
  child.on("error", () => app.exit(1));
  // The window going away must not quit the app, which would take the server down.
  app.removeAllListeners("window-all-closed");
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
}
