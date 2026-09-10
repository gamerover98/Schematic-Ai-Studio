/**
 * This app's own version numbers, and where its releases are published.
 *
 * Pure and Electron-free, and in `shared/` because both sides ask: main to
 * decide which release to offer, the renderer to show what "follow the running
 * build" currently means for the development-builds checkbox.
 *
 * ## Why a comparator is written out here
 *
 * The release list is the one place this app reads versions it did not
 * produce, and the one ordering that matters is the one everything else gets
 * wrong: `git tag --sort=-v:refname` puts `v1.0.0-dev.5` *above* `v1.0.0`
 * (CLAUDE.md records it for the release skill), and a string compare puts
 * `dev.10` below `dev.9`. Semver's own rule (§11) is twenty lines, and a
 * dependency for twenty lines is one more thing to keep in step with the one
 * electron-updater already brings.
 */

/**
 * The repository the releases are published to.
 *
 * `electron-builder.yml`'s `publish` block says the same thing and cannot
 * import this; `tests/services.ts` holds the two together.
 */
export const UPDATE_REPOSITORY = { owner: "gamerover98", repo: "Schematic-Ai-Studio" } as const;

export const REPOSITORY_URL = `https://github.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.repo}`;

/**
 * The newest thirty releases.
 *
 * A list rather than `/releases/latest`, because the answer depends on a
 * setting: `latest` never returns a prerelease, and with development builds
 * turned on the newest release usually is one.
 */
export const RELEASES_API_URL =
  `https://api.github.com/repos/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.repo}/releases?per_page=30`;

/** The page a person reads: the notes, and every file of the release. */
export function releasePageUrl(tag: string): string {
  return `${REPOSITORY_URL}/releases/tag/${encodeURIComponent(tag)}`;
}

/**
 * The directory a release's files are downloaded from.
 *
 * electron-updater is pointed here as a `generic` feed, so it reads this one
 * release's `latest.yml` and resolves the installer beside it.
 */
export function releaseDownloadBase(tag: string): string {
  return `${REPOSITORY_URL}/releases/download/${encodeURIComponent(tag)}`;
}

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** `["dev", 7]` for `-dev.7`; empty for a release. Numeric parts are numbers. */
  prerelease: (string | number)[];
}

const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** `1.0.1-dev.7`, with or without a leading `v`; `null` for anything else. */
export function parseVersion(raw: string): ParsedVersion | null {
  const match = SEMVER.exec(raw.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease:
      match[4] === undefined
        ? []
        : match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
  };
}

/**
 * Negative, zero or positive as `a` is older than, equal to or newer than `b`;
 * `null` when either is not a version at all.
 *
 * Semver §11: a prerelease comes before its own release, numeric identifiers
 * compare as numbers and before any word, and of two lists that agree as far
 * as the shorter goes, the longer is the newer.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) return null;
  const core = left.major - right.major || left.minor - right.minor || left.patch - right.patch;
  if (core !== 0) return Math.sign(core);
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    // A release is newer than any of its prereleases; two releases are equal.
    return Math.sign(right.prerelease.length - left.prerelease.length);
  }
  const shared = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < shared; index += 1) {
    const order = compareIdentifier(left.prerelease[index], right.prerelease[index]);
    if (order !== 0) return order;
  }
  return Math.sign(left.prerelease.length - right.prerelease.length);
}

function compareIdentifier(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return Math.sign(a - b);
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whether a version is a prerelease -- here, a `-dev.N` build of `develop`. */
export function isPrereleaseVersion(raw: string): boolean {
  const parsed = parseVersion(raw);
  return parsed !== null && parsed.prerelease.length > 0;
}
