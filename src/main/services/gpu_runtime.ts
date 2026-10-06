/**
 * The GPU, once the app is up: which adapter actually draws, and the list.
 *
 * `index.ts` asks Chromium for an adapter before `ready` and records what it
 * asked (`gpu_preference.ts`). Nothing ever checked the answer, which is how
 * a laptop set to "high performance" could draw with its integrated GPU for
 * weeks with every screen saying otherwise. This module checks it:
 * `app.getGPUInfo("complete").auxAttributes.glRenderer` is the same ANGLE
 * string WebGL reports, device id included, so main can tell which adapter
 * draws without asking the window.
 *
 * It also refreshes the per-boot adapter list in the background, so the
 * launch after this one finds it, and marks a LUID that was passed and did
 * not take, so the next launch reads the list again instead of trusting it.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { app } from "electron";

import type { GpuStatus } from "../../shared/ipc.js";
import {
  adapterForKey,
  bootTime,
  cacheForBoot,
  enumerateAdapters,
  gpuStatusFrom,
  launchHonoured,
  type AdapterCache,
  type AdapterList,
  type ChromiumGpuDevice,
} from "./gpu_adapters.js";
import { launchedGpu } from "./gpu_preference.js";

/** Where the per-boot adapter list lives; `index.ts` reads it before ready. */
export function gpuCachePath(): string {
  return path.join(app.getPath("userData"), "gpu-adapters.json");
}

let list: AdapterList | null = null;
let devices: ChromiumGpuDevice[] = [];
let renderer: string | null = null;
let checking: Promise<void> | null = null;

async function writeCache(cache: AdapterCache): Promise<void> {
  try {
    await mkdir(path.dirname(gpuCachePath()), { recursive: true });
    await writeFile(gpuCachePath(), JSON.stringify(cache), "utf-8");
  } catch {
    // A cache that cannot be written costs the next launch a second, no more.
  }
}

async function check(): Promise<void> {
  try {
    const info = (await app.getGPUInfo("complete")) as {
      auxAttributes?: { glRenderer?: unknown };
      gpuDevice?: ChromiumGpuDevice[];
    };
    renderer = typeof info.auxAttributes?.glRenderer === "string" ? info.auxAttributes.glRenderer : null;
    devices = Array.isArray(info.gpuDevice) ? info.gpuDevice : [];
  } catch {
    renderer = null;
  }
  if (process.platform !== "win32") return;

  const boot = bootTime(Date.now(), os.uptime());
  let previous: AdapterCache | null = null;
  try {
    previous = cacheForBoot(await readFile(gpuCachePath(), "utf-8"), boot);
  } catch {
    previous = null;
  }
  list = previous?.list ?? null;
  const fresh = await enumerateAdapters();
  if (fresh !== null) list = fresh;
  if (list === null) return;

  const launch = launchedGpu();
  const asked = launch.adapter === null ? null : adapterForKey(list, launch.adapter);
  const badLuids = new Set(previous?.badLuids ?? []);
  if (renderer !== null && launch.luid !== null && launchHonoured(launch, asked, renderer) === false) {
    badLuids.add(launch.luid);
  }
  await writeCache({ boot, list, badLuids: [...badLuids] });
}

/** Called once after `ready`, from `index.ts`. */
export function startGpuCheck(): void {
  checking ??= check();
}

/** What the pane and the stutter report show. Waits for the check. */
export async function gpuStatus(): Promise<GpuStatus> {
  startGpuCheck();
  await checking;
  return gpuStatusFrom({ platform: process.platform, launch: launchedGpu(), list, devices, renderer });
}
