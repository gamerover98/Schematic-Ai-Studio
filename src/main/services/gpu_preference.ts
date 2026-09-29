/**
 * Which GPU the window is drawn with, on a machine that has two.
 *
 * Chromium chooses the adapter when its GPU process starts, and the only way
 * to steer that is a command-line switch appended before `app.whenReady`. So
 * the preference is read here, synchronously, from the file the settings
 * store writes -- that store is async and not available yet -- and a change
 * takes effect at the next launch.
 *
 * Electron-free, so `tests/services.ts` can reach it.
 */

import { gpuPreference, type GpuPreference } from "../../shared/settings.js";

let launched: GpuPreference = "auto";

/** What this process was started with; the setting may have moved since. */
export function launchedGpuPreference(): GpuPreference {
  return launched;
}

/** Called once, from `index.ts`, with what it applied. */
export function recordLaunchedGpuPreference(pref: GpuPreference): void {
  launched = pref;
}

/** The Chromium switch for a preference; `null` leaves the choice to the OS. */
export function gpuSwitchFor(pref: GpuPreference): string | null {
  if (pref === "high-performance") return "force_high_performance_gpu";
  if (pref === "low-power") return "force_low_power_gpu";
  return null;
}

/**
 * The preference as stored in `settings.json`'s text.
 *
 * Startup is the least deserving place to fail, so anything unreadable --
 * no file, bad JSON, no field, a junk value -- is `"auto"`.
 */
export function readGpuPreference(json: string | null): GpuPreference {
  if (json === null) return "auto";
  try {
    const parsed = JSON.parse(json) as { preview?: { gpuPreference?: unknown } } | null;
    return gpuPreference(parsed?.preview?.gpuPreference);
  } catch {
    return "auto";
  }
}
