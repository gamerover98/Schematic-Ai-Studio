/**
 * The graphics card select in the settings pane, as rules.
 *
 * One `<select>` holds two settings: a preference by power, or one adapter by
 * its key. The value of each option says which, so the pane writes both
 * fields from one change and a key can never be mistaken for a preference.
 * Plain, for `selection_drag.ts`'s reason: a rule inside a component can only
 * be grepped for.
 */

import { gpuAdapterKey, gpuPreference, type GpuPreference } from "../../../shared/settings.js";
import type { GpuLaunch } from "../../../shared/ipc.js";

const ADAPTER = "adapter:";

/** The option value for a stored choice. An adapter outranks a preference. */
export function choiceValue(preference: unknown, adapter: unknown): string {
  const key = gpuAdapterKey(adapter);
  return key === null ? gpuPreference(preference) : `${ADAPTER}${key}`;
}

/** Both fields, from an option value. A preference clears the adapter. */
export function parseChoiceValue(value: string): { gpuPreference: GpuPreference; gpuAdapter: string | null } {
  if (value.startsWith(ADAPTER)) {
    const key = gpuAdapterKey(value.slice(ADAPTER.length));
    // The preference is left as `auto` under an adapter: it is what applies
    // if the card is ever taken out, and "the system decides" is the honest
    // fallback for a choice that named a card that is not there.
    if (key !== null) return { gpuPreference: "auto", gpuAdapter: key };
  }
  return { gpuPreference: gpuPreference(value), gpuAdapter: null };
}

/** Whether the stored choice differs from what this process launched with. */
export function gpuNeedsRestart(preference: unknown, adapter: unknown, launch: GpuLaunch): boolean {
  const key = gpuAdapterKey(adapter);
  if (key !== launch.adapter) return true;
  // With an adapter chosen the preference is only its fallback.
  return key === null && gpuPreference(preference) !== launch.preference;
}

/** `16 GB`, `512 MB`; empty when the system did not say. */
export function formatMemory(bytes: number): string {
  if (!(bytes > 0)) return "";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${Math.round(gb)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * The drawing-buffer pixels a viewport of this size costs, the way
 * `Viewer.svelte` sizes it: `min(devicePixelRatio, maxDpr) * renderScale` per
 * axis. Multiply by the MSAA samples for what the GPU fills per frame.
 */
export function pixelLoad(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxDpr: number,
  renderScale: number,
): number {
  const ratio = Math.min(devicePixelRatio, maxDpr) * renderScale;
  return Math.floor(cssWidth * ratio) * Math.floor(cssHeight * ratio);
}
