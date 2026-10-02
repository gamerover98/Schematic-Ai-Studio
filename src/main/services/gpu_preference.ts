/**
 * Which GPU the window is drawn with, on a machine that has more than one.
 *
 * Chromium chooses the adapter when its GPU process starts, and the only way
 * to steer that is a command-line switch appended before `app.whenReady`. So
 * the choice is read here, synchronously, from the file the settings store
 * writes -- that store is async and not available yet -- and a change takes
 * effect at the next launch. `services/gpu_adapters.ts` turns a choice into
 * switches.
 *
 * **The file is read through `settings_file.ts`, the store's own reading.**
 * This module used to parse it itself and looked for `preview` at the top,
 * where the store writes it under `settings`. Every launch therefore read
 * `"auto"`, the switch was never appended, and a laptop set to "high
 * performance" went on drawing with its integrated GPU while the pane showed
 * the choice as saved. The test agreed with the parser rather than with the
 * file, so it passed.
 *
 * Electron-free, so `tests/services.ts` can reach it.
 */

import { gpuAdapterKey, gpuPreference, type GpuPreference } from "../../shared/settings.js";
import type { GpuLaunch } from "../../shared/ipc.js";
import { settingsFromFileText } from "./settings_file.js";

let launched: GpuLaunch = {
  preference: "auto",
  adapter: null,
  method: "default",
  luid: null,
  adapterName: null,
  note: null,
};

/** What this process was started with; the setting may have moved since. */
export function launchedGpu(): GpuLaunch {
  return launched;
}

/** Called once, from `index.ts`, with what it applied. */
export function recordLaunchedGpu(launch: GpuLaunch): void {
  launched = launch;
}

/** The Chromium switch for a preference; `null` leaves the choice to the OS. */
export function gpuSwitchFor(pref: GpuPreference): string | null {
  if (pref === "high-performance") return "force_high_performance_gpu";
  if (pref === "low-power") return "force_low_power_gpu";
  return null;
}

/**
 * The GPU choice in `settings.json`'s text.
 *
 * Startup is the least deserving place to fail, so anything unreadable --
 * no file, bad JSON, no field, a junk value -- is `"auto"` and no adapter.
 */
export function readGpuChoice(json: string | null): { preference: GpuPreference; adapter: string | null } {
  const preview = settingsFromFileText(json).preview;
  return { preference: gpuPreference(preview.gpuPreference), adapter: gpuAdapterKey(preview.gpuAdapter) };
}
