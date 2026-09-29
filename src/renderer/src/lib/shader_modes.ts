import {
  AA_LEVELS,
  DEFAULT_PREVIEW_SETTINGS,
  FPS_CAPS,
  gpuPreference,
} from "../../../shared/settings.js";

/**
 * What each shader mode does to the renderer and to the two scene lights.
 *
 * A plain module for `selection_drag.ts`'s reason: written inside an `$effect`
 * these numbers could only be grepped for, and the one property that matters
 * about them -- that `vanilla` is the identity -- is a sentence a test can
 * state.
 *
 * The two light values are **multipliers**, not intensities, and that is the
 * whole reason this composes with anything. `applySky` already writes both
 * lights from the hour: the sun's colour and strength at dawn, the ambient
 * rising with the daylight. A preset that set them outright would be a second
 * opinion about what time it is, and whichever ran last would win.
 */
export interface ShaderPreset {
  /**
   * `"aces"` for ACES Filmic, `"none"` for the linear output three does by
   * default.
   *
   * A string rather than three's own constant so this module imports nothing:
   * `Viewer.svelte` maps it, which is the one place that has a renderer.
   */
  readonly toneMapping: "none" | "aces";
  /** `renderer.toneMappingExposure`. */
  readonly exposure: number;
  /** Multiplies the directional light `applySky` decided on. */
  readonly sun: number;
  /** Multiplies the hemisphere light the same function decided on. */
  readonly ambient: number;
  /** `envMapIntensity`, which does nothing unless global illumination is on. */
  readonly environment: number;
}

const PRESETS: Readonly<Record<string, ShaderPreset>> = {
  /*
   * The identity, exactly. Every number here is what the viewport did before
   * there was a setting, which is what makes "vanilla" a true name rather than
   * a taste -- somebody who never opens this pane must see no change at all.
   */
  vanilla: { toneMapping: "none", exposure: 1, sun: 1, ambient: 1, environment: 1 },
  /*
   * ACES compresses the highlights instead of clipping them, which is what a
   * lit build against a bright sky needs; the exposure lift puts the midtones
   * back where they were before the curve pulled them down. The sun gains and
   * the ambient gives way, because the contrast is the point.
   */
  cinematic: { toneMapping: "aces", exposure: 1.15, sun: 1.25, ambient: 0.8, environment: 1.2 },
  /*
   * No directional light at all: nothing is shaded by where the sun is, so a
   * texture is drawn as it was painted. It is for looking at the blocks rather
   * than at the building, and it is the one mode where a face's own colour is
   * the only thing on screen.
   *
   * The baked vertex light still applies -- it is the schematic's own light,
   * not the scene's -- so a torch still lights the room it is in.
   */
  flat: { toneMapping: "none", exposure: 1, sun: 0, ambient: 2.2, environment: 0.4 },
};

/**
 * The preset for a mode, and `vanilla` for anything else.
 *
 * Total, because `coerceSettings` spreads `preview` over the defaults without
 * validating it: a junk value has to be indistinguishable from an absent one or
 * the spread is not safe. `Projection` is read the same way for the same
 * reason.
 */
export function shaderPreset(mode: string): ShaderPreset {
  return PRESETS[mode] ?? PRESETS.vanilla;
}

/**
 * The multisampling level for a stored value, snapped to one that exists.
 *
 * Total for `shaderPreset`'s reason, and the fallback is the *default* rather
 * than off: a settings file written by a newer build, or by hand, should not be
 * able to turn anti-aliasing off silently.
 */
export function antialiasSamples(value: unknown): number {
  return typeof value === "number" && ALLOWED.has(value)
    ? value
    : DEFAULT_PREVIEW_SETTINGS.antialias;
}

/*
 * Derived from the offered list rather than written out again: the pane builds
 * its own control from `AA_LEVELS`, and a second copy here is how one of them
 * comes to offer a level the other refuses.
 */
const ALLOWED: ReadonlySet<number> = new Set(AA_LEVELS);

/**
 * The frame rate cap for a stored value, snapped to one that is offered.
 *
 * Total for the same reason, and the fallback is the default, which is no
 * cap: a junk value must read exactly like an absent one, or the spread
 * `coerceSettings` does over `preview` would stop being safe for this field.
 */
export function fpsCap(value: unknown): number {
  return typeof value === "number" && ALLOWED_FPS.has(value)
    ? value
    : DEFAULT_PREVIEW_SETTINGS.maxFps;
}

const ALLOWED_FPS: ReadonlySet<number> = new Set(FPS_CAPS);

/**
 * How early a frame may arrive and still be drawn, in milliseconds.
 *
 * A display's refresh is not a metronome: at 60Hz frames land at 16.7ms give
 * or take a fraction, and a cap of 60 compared strictly would find every
 * early one "too soon" and draw at 30. A millisecond covers the jitter and is
 * far too small to let a second frame through inside one interval.
 */
const FRAME_SLACK_MS = 1;

/**
 * Whether the animation loop should draw at `now`, and the anchor it keeps
 * for the next decision.
 *
 * The anchor advances by exactly one interval per drawn frame rather than
 * jumping to `now`, so the rate converges on the cap instead of drifting below
 * it: a 60 cap on a 144Hz display draws on ticks that arrive up to 7ms late,
 * and anchoring on each of them would lose that much every frame. It is
 * re-anchored to `now` only once it has fallen a whole interval behind -- after
 * a stall, or on the first frame -- or it would draw a burst to catch up.
 */
export function frameDue(
  now: number,
  anchor: number,
  cap: number,
): { draw: boolean; anchor: number } {
  if (cap <= 0) return { draw: true, anchor: now };
  const interval = 1000 / cap;
  if (now - anchor < interval - FRAME_SLACK_MS) return { draw: false, anchor };
  const next = anchor + interval;
  return { draw: true, anchor: now - next > interval ? now : next };
}

/**
 * The WebGL context's `powerPreference` for the stored GPU preference.
 *
 * The Chromium switch main applies at launch is what actually picks the
 * adapter; this makes the context ask for the same one rather than for the
 * browser's default.
 */
export function webglPowerPreference(value: unknown): WebGLPowerPreference {
  const pref = gpuPreference(value);
  return pref === "auto" ? "default" : pref;
}
