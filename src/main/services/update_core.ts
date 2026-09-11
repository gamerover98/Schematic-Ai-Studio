/**
 * Which release to offer, and what this copy can do with it -- as data.
 *
 * Electron-free on purpose, the split `settings_coerce.ts` and `menu_model.ts`
 * were made for: `updates.ts` needs `app`, `net` and electron-updater, and the
 * suites can load none of them. Everything worth being wrong about lives here.
 *
 * ## Why the choice is ours and not electron-updater's
 *
 * electron-updater's GitHub provider would pick the release itself, from the
 * releases feed, by *channel* -- a notion it derives from the prerelease tag,
 * and whose handling of a name it does not know, `dev`, is its own logic. The
 * development-builds setting would then be a second rule sitting beside that
 * one. So the app reads the release list, chooses here, and hands
 * electron-updater one release's directory as a `generic` feed: it only
 * downloads, verifies and installs what it was pointed at.
 */

import {
  compareVersions,
  isPrereleaseVersion,
  parseVersion,
  releasePageUrl,
} from "../../shared/app_version.js";
import type { InstallKind, UpdateRelease } from "../../shared/ipc.js";
import { APP_NAME } from "../menu_model.js";

/** One published release, reduced to what the choice needs. */
export interface ReleaseInfo {
  /** As published: `v1.0.1-dev.7`. */
  tag: string;
  /** Without the `v`. */
  version: string;
  prerelease: boolean;
  draft: boolean;
  publishedAt: string;
  /** The names of its files. */
  assets: string[];
}

/**
 * The GitHub API's release list, defensively.
 *
 * An entry with no tag, a tag that is not a version, or a shape nobody
 * expected is dropped rather than thrown on: one odd release -- a tag pushed
 * by hand, a field GitHub renamed -- must not stop every other one from being
 * offered.
 */
export function parseReleases(raw: unknown): ReleaseInfo[] {
  if (!Array.isArray(raw)) return [];
  const releases: ReleaseInfo[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const release = entry as Record<string, unknown>;
    const tag = typeof release.tag_name === "string" ? release.tag_name.trim() : "";
    if (parseVersion(tag) === null) continue;
    releases.push({
      tag,
      version: tag.replace(/^v/, ""),
      prerelease: release.prerelease === true,
      draft: release.draft === true,
      publishedAt: typeof release.published_at === "string" ? release.published_at : "",
      assets: Array.isArray(release.assets) ? release.assets.flatMap(assetName) : [],
    });
  }
  return releases;
}

function assetName(asset: unknown): string[] {
  if (asset === null || typeof asset !== "object") return [];
  const name = (asset as { name?: unknown }).name;
  return typeof name === "string" ? [name] : [];
}

/**
 * A development build, by either of the two things that can say so.
 *
 * Both, because they are written in different places -- the flag by `gh
 * release create --prerelease`, the suffix by `npm version` on the runner --
 * and somebody who opted out of development builds must not be offered one
 * because only one of the two was set.
 */
export function isDevRelease(release: ReleaseInfo): boolean {
  return release.prerelease || isPrereleaseVersion(release.version);
}

/**
 * The newest release strictly newer than the running build, or `null`.
 *
 * The **newest by version**, not the first in the list: GitHub orders by
 * creation date, and merging `develop` into `master` publishes `v1.0.0` after
 * `v1.0.1-dev.1` -- a list read in order would offer the older one. Never
 * older than what is running either, so turning development builds off on a
 * `-dev` build waits for the next stable release rather than going back to the
 * previous one.
 */
export function pickUpdate(
  releases: readonly ReleaseInfo[],
  currentVersion: string,
  includeDevBuilds: boolean,
): ReleaseInfo | null {
  let best: ReleaseInfo | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    if (!includeDevBuilds && isDevRelease(release)) continue;
    const newer = compareVersions(release.version, currentVersion);
    if (newer === null || newer <= 0) continue;
    if (best === null || (compareVersions(release.version, best.version) ?? 0) > 0) best = release;
  }
  return best;
}

/**
 * What electron-builder's NSIS installer leaves beside the executable.
 *
 * `Uninstall ${PRODUCT_FILENAME}.exe` in app-builder-lib's `common.nsh`, where
 * the product name is `electron-builder.yml`'s `productName` -- which is
 * `APP_NAME`, held to it by `tests/services.ts` since nothing else does.
 */
export const NSIS_UNINSTALLER = `Uninstall ${APP_NAME}.exe`;

export interface InstallContext {
  platform: string;
  isPackaged: boolean;
  env: Readonly<Record<string, string | undefined>>;
  /** `NSIS_UNINSTALLER` sits beside `process.execPath`. */
  hasUninstaller: boolean;
}

/**
 * How this copy was installed. See `InstallKind`.
 *
 * The uninstaller is what tells an installed copy from `win-unpacked` started
 * by hand: both are packaged and neither is portable, but only one of them was
 * put there by the installer an update runs -- and run over the other, that
 * installer would put a second copy somewhere else.
 */
export function installKind(context: InstallContext): InstallKind {
  if (!context.isPackaged) return "unpackaged";
  switch (context.platform) {
    case "win32":
      // Set by the portable build's launcher, for the process it starts.
      if (context.env.PORTABLE_EXECUTABLE_FILE) return "portable";
      return context.hasUninstaller ? "nsis" : "other";
    case "linux":
      // Set by the AppImage runtime; absent when the image was extracted.
      return context.env.APPIMAGE ? "appimage" : "other";
    case "darwin":
      return "mac";
    default:
      return "other";
  }
}

/** Whether this kind of install can replace itself. */
export function updatesInApp(kind: InstallKind): boolean {
  return kind === "nsis" || kind === "appimage";
}

/**
 * The file electron-updater reads from a release, for this kind of install.
 *
 * One name per platform whatever the version, because `electron-builder.yml`
 * sets `detectUpdateChannel: false` -- without it a `-dev` build writes
 * `dev.yml`, and this would have to know about channels after all.
 */
export function updateMetadataFile(kind: InstallKind): string | null {
  if (kind === "nsis") return "latest.yml";
  if (kind === "appimage") return "latest-linux.yml";
  return null;
}

/**
 * The release carries what this copy needs to update itself from it.
 *
 * Asked rather than assumed: every release published before the updater
 * existed lacks the metadata, and so would one the CI let out without it.
 */
export function installableFrom(release: ReleaseInfo, kind: InstallKind): boolean {
  const file = updateMetadataFile(kind);
  return file !== null && release.assets.includes(file);
}

/** The release as the renderer sees it. */
export function toUpdateRelease(release: ReleaseInfo, kind: InstallKind): UpdateRelease {
  return {
    version: release.version,
    tag: release.tag,
    prerelease: isDevRelease(release),
    pageUrl: releasePageUrl(release.tag),
    publishedAt: release.publishedAt,
    installable: installableFrom(release, kind),
  };
}
