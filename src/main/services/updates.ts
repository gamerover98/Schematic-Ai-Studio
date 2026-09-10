/**
 * Finding a newer build, downloading it, and restarting into it.
 *
 * The decisions are in `update_core.ts`, which the suites can load; this is
 * the half that needs Electron -- `net` for the request, electron-updater for
 * the download, `dialog` for the one question it asks.
 *
 * ## What happens, in order
 *
 * 1. `checkForUpdates` reads the release list from GitHub and chooses
 *    (`pickUpdate`). Nothing is downloaded.
 * 2. `downloadUpdate`, only when somebody asks, points electron-updater at
 *    *that* release as a `generic` feed. It reads the release's `latest.yml`,
 *    verifies the sha512 it names, and downloads differentially when the
 *    running release has a `.blockmap` to compare against.
 * 3. `installUpdate` restarts into it -- or the next ordinary quit does, since
 *    `autoInstallOnAppQuit` is on.
 *
 * The portable build, macOS and development runs stop after step 1: the
 * renderer offers the release page instead.
 *
 * ## Why `net.fetch`
 *
 * It goes through Chromium's network stack, so it honours the system proxy.
 * Node's `fetch` would not, and an update check that works everywhere except
 * behind the one proxy somebody cannot configure away is the least findable
 * failure there is.
 */

import { existsSync } from "fs";
import path from "path";

import { app, dialog, net, type BrowserWindow, type MessageBoxOptions } from "electron";
/*
 * The default import, not `{ autoUpdater }`. electron-updater is CommonJS and
 * defines `autoUpdater` as a getter, which Node's ESM loader cannot see as a
 * named export -- the named form fails when the packaged app starts, not when
 * it builds. The getter is also why it is only ever read inside a function:
 * reading it constructs the platform's updater.
 */
import electronUpdater, { type AppUpdater, type ProgressInfo } from "electron-updater";

import { RELEASES_API_URL, releaseDownloadBase } from "../../shared/app_version.js";
import { IPC, type UpdateStatus } from "../../shared/ipc.js";
import { effectiveIncludeDevBuilds } from "../../shared/settings.js";
import { isDirty } from "../domain/history.js";
import { discardPrompt } from "./discard_prompt.js";
import { confirmQuit } from "./quit_guard.js";
import { currentSession } from "./session.js";
import { getSettings } from "./settings-store.js";
import {
  installKind,
  NSIS_UNINSTALLER,
  parseReleases,
  pickUpdate,
  toUpdateRelease,
  updatesInApp,
  type ReleaseInfo,
} from "./update_core.js";

/** Long enough for a slow link, short enough that "checking" does not stick. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * How long after launch the startup check waits.
 *
 * Long enough that the window, the settings and the resource pack have had the
 * machine first: a check is worth nothing if it makes the start slower.
 */
const STARTUP_CHECK_DELAY_MS = 8_000;

let window: (() => BrowserWindow | null) | null = null;
let status: UpdateStatus | null = null;
/** The release `status.latest` describes, with the asset list the renderer never sees. */
let chosen: ReleaseInfo | null = null;
let inFlight: Promise<UpdateStatus> | null = null;
let listening = false;

/**
 * Where the pushes go. Installed from `registerIpcHandlers`, beside
 * `broadcast.ts`'s own, and a getter for the reason that one is.
 */
export function useUpdateWindow(getWindow: () => BrowserWindow | null): void {
  window = getWindow;
}

/** What is known right now. Never a request. */
export function updateStatus(): UpdateStatus {
  if (status === null) {
    const kind = installKind({
      platform: process.platform,
      isPackaged: app.isPackaged,
      env: process.env,
      hasUninstaller:
        process.platform === "win32" &&
        existsSync(path.join(path.dirname(process.execPath), NSIS_UNINSTALLER)),
    });
    status = {
      state: "idle",
      currentVersion: app.getVersion(),
      kind,
      inApp: updatesInApp(kind),
      latest: null,
      progress: null,
      checkedAt: null,
      message: null,
    };
  }
  return status;
}

function publish(patch: Partial<UpdateStatus>): UpdateStatus {
  status = { ...updateStatus(), ...patch };
  const target = window?.() ?? null;
  if (target !== null && !target.isDestroyed()) {
    target.webContents.send(IPC.updateStatusChanged, status);
  }
  return status;
}

function messageOf(err: unknown): string {
  return err instanceof Error && err.message !== "" ? err.message : String(err);
}

/**
 * The release list, or a sentence saying why not.
 *
 * Anonymous, and therefore limited to sixty requests an hour per address. One
 * per launch is nothing, but an address shared with others can use them up,
 * and that answer is a 403 that reads exactly like "forbidden" -- so it is
 * named instead, with the time it lifts.
 */
async function fetchReleases(): Promise<unknown> {
  let response: Response;
  try {
    response = await net.fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `SchematicAIStudio/${app.getVersion()}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Could not reach GitHub to look for updates: ${messageOf(err)}`);
  }
  if (
    (response.status === 403 || response.status === 429) &&
    response.headers.get("x-ratelimit-remaining") === "0"
  ) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const until =
      Number.isFinite(reset) && reset > 0 ? ` until ${new Date(reset * 1000).toLocaleTimeString()}` : "";
    throw new Error(
      `GitHub is refusing anonymous requests from this network${until}. Try again after that.`,
    );
  }
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} when asked for the release list.`);
  }
  return await response.json();
}

/**
 * Asks GitHub whether there is anything newer, and says so.
 *
 * Never throws: a failed check is a state the pane shows rather than an error
 * for a banner, the arrangement `McpStatus` has. One at a time -- a second
 * request while one is out gets the first one's answer. And not at all while a
 * download is running or waiting to install: a check could only swap the
 * release being downloaded for a newer one, under a download still writing it.
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (inFlight !== null) return await inFlight;
  const state = updateStatus().state;
  if (state === "downloading" || state === "ready") return updateStatus();

  inFlight = (async () => {
    publish({ state: "checking", message: null });
    try {
      const settings = await getSettings();
      const version = app.getVersion();
      const found = pickUpdate(
        parseReleases(await fetchReleases()),
        version,
        effectiveIncludeDevBuilds(settings.updates, version),
      );
      chosen = found;
      return publish({
        state: found === null ? "upToDate" : "available",
        latest: found === null ? null : toUpdateRelease(found, updateStatus().kind),
        checkedAt: Date.now(),
      });
    } catch (err) {
      return publish({ state: "error", message: messageOf(err), checkedAt: Date.now() });
    } finally {
      inFlight = null;
    }
  })();
  return await inFlight;
}

/** electron-updater, with its events wired to the status once. */
function updater(): AppUpdater {
  const instance = electronUpdater.autoUpdater;
  if (!listening) {
    listening = true;
    instance.on("download-progress", (info: ProgressInfo) => {
      // A late event after the download settled must not reopen the bar.
      if (updateStatus().state !== "downloading") return;
      publish({ progress: { percent: info.percent, transferred: info.transferred, total: info.total } });
    });
    /*
     * A listener has to exist even though every failure also rejects the
     * promise awaited in `downloadUpdate`: an `EventEmitter` with no `error`
     * listener throws, and here it would throw from inside electron-updater.
     */
    instance.on("error", (err: Error) => console.warn("[updates]", err.message));
  }
  return instance;
}

/**
 * Downloads the release on offer, and says how that went.
 *
 * Resolves once the download is ready or has failed; the progress in between
 * is pushed. Refuses, by saying so, when this copy cannot install it -- the
 * renderer offers the release page there instead, so arriving here means
 * something asked out of turn.
 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  const now = updateStatus();
  if (now.state === "downloading" || now.state === "ready") return now;
  const release = chosen;
  if (!now.inApp || release === null || now.latest === null || !now.latest.installable) {
    return publish({
      state: "error",
      message: "This copy cannot install that update by itself. Download it from its release page.",
    });
  }

  const instance = updater();
  instance.autoDownload = false;
  instance.autoInstallOnAppQuit = true;
  // The release was chosen before this point; nothing the feed says may take
  // the app backwards.
  instance.allowDowngrade = false;
  instance.setFeedURL({ provider: "generic", url: releaseDownloadBase(release.tag) });

  publish({ state: "downloading", progress: { percent: 0, transferred: 0, total: 0 }, message: null });
  try {
    const result = await instance.checkForUpdates();
    const described = result?.updateInfo.version ?? null;
    /*
     * The metadata has to describe the release it sits in. If it does not --
     * a file uploaded to the wrong release by hand -- installing whatever it
     * names would be installing something nobody chose.
     */
    if (described !== release.version) {
      throw new Error(
        `The update metadata in ${release.tag} describes ${described ?? "no version"}, ` +
          `not ${release.version}. Nothing was downloaded.`,
      );
    }
    await instance.downloadUpdate();
    return publish({ state: "ready", progress: null });
  } catch (err) {
    return publish({ state: "error", progress: null, message: messageOf(err) });
  }
}

/**
 * Restarts into the downloaded update. `false` when it did not go ahead.
 *
 * Unsaved work is asked about here, before the installer exists -- see
 * `quit_guard.ts` for why it cannot be left to the close handler.
 */
export async function installUpdate(): Promise<boolean> {
  if (updateStatus().state !== "ready") return false;

  const session = currentSession();
  if (session !== null && isDirty(session.history)) {
    const prompt = discardPrompt(
      "update",
      session.doc.filePath === null ? null : path.basename(session.doc.filePath),
    );
    const options: MessageBoxOptions = {
      type: "warning",
      buttons: [prompt.confirmLabel, prompt.cancelLabel],
      // Escape and the box's own close button both land on "keep my work".
      defaultId: 1,
      cancelId: 1,
      message: prompt.message,
      detail: prompt.detail,
    };
    const target = window?.() ?? null;
    const answer =
      target !== null && !target.isDestroyed()
        ? await dialog.showMessageBox(target, options)
        : await dialog.showMessageBox(options);
    if (answer.response !== 0) return false;
  }

  confirmQuit();
  // Not silent: the installer's own window is the only thing on screen while
  // the app is gone. Run after: the point of "Restart and install" is to come
  // back.
  updater().quitAndInstall(false, true);
  return true;
}

/**
 * The one request at launch, if the setting allows it.
 *
 * Packaged builds only: a development run is restarted constantly and would
 * spend the hour's sixty anonymous requests on a question nobody asked -- the
 * pane's Check now still works there. Not repeated while the app stays open,
 * and the answer arrives as the navbar indicator, never as a banner.
 */
export function scheduleStartupCheck(): void {
  if (!app.isPackaged) return;
  setTimeout(() => {
    void (async () => {
      try {
        if ((await getSettings()).updates.checkOnStartup) await checkForUpdates();
      } catch (err) {
        console.warn("[updates] startup check failed:", err);
      }
    })();
  }, STARTUP_CHECK_DELAY_MS);
}
