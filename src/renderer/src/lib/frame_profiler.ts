/**
 * Where a slow frame's time went.
 *
 * The frame counter averages over half a second, so a single 300ms frame in
 * a stream of 16ms ones reads as a dip of a few frames per second and says
 * nothing about why. This records every frame instead, per phase, and keeps
 * the ones that were slow together with what was happening around them.
 *
 * Its unit is the **interval between two drawn frames**, not the loop body.
 * `beginFrame` closes the interval that the previous one opened: its `gap` is
 * the whole wall-clock time between them, its `work` is what the loop itself
 * measured, and the difference is `outside` -- a Svelte effect, a mesh payload
 * being turned into geometry, a structured clone, a garbage collection. Most of
 * what can stall a frame in this app happens there, where the loop cannot see
 * it, and that difference is the only way the loop can know it happened.
 *
 * What fills `outside` in is the browser's own **Long Animation Frame** record,
 * which attributes the time to scripts by source and function name. Those
 * entries arrive a little after the frame they describe, so they are attached
 * to spikes both ways: at the spike if they are already here, and to earlier
 * spikes when they land.
 *
 * A plain module for `selection_drag.ts`'s reason: the decisions -- what is a
 * spike, which phase is to blame -- are tested without a browser, and only the
 * hooks live in `Viewer.svelte`.
 */

/** Something that happened during an interval, besides the loop's phases. */
export interface ProfilerEvent {
  readonly name: string;
  /** When, on `performance.now()`'s clock. */
  readonly at: number;
  /** How long it took, when it is a piece of work rather than a moment. */
  readonly ms?: number;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** A long frame as the browser reported it, reduced to what a report needs. */
export interface LongFrame {
  readonly kind: "long-animation-frame" | "longtask";
  readonly start: number;
  readonly duration: number;
  /** Scripts that ran in it, heaviest first. Empty for a `longtask`. */
  readonly scripts: readonly {
    readonly source: string;
    readonly fn: string;
    readonly invoker: string;
    readonly ms: number;
  }[];
}

export interface FrameRecord {
  /** When the interval opened: the previous drawn frame. */
  readonly start: number;
  /** Wall-clock time to the next drawn frame. */
  readonly gap: number;
  /** What the loop measured itself doing. */
  readonly work: number;
  /** `gap - work`: time spent somewhere the loop cannot see. */
  readonly outside: number;
  readonly phases: Readonly<Record<string, number>>;
  readonly events: readonly ProfilerEvent[];
}

export interface Spike extends FrameRecord {
  /** The phase that took longest, or `OUTSIDE` when nothing inside did. */
  readonly culprit: string;
  /** The median gap it was judged against. */
  readonly typical: number;
  readonly longFrames: LongFrame[];
}

/** The culprit named when the time was not spent in the loop. */
export const OUTSIDE = "outside the loop";

/** No frame shorter than this is a spike, however steady the others were. */
export const SPIKE_FLOOR_MS = 50;

/** How many times the typical frame a gap has to be to count. */
export const SPIKE_FACTOR = 3;

/**
 * A gap this long is a pause rather than a stutter.
 *
 * A window behind others, minimised or on another desktop has its animation
 * frames throttled or stopped, and the first one after it comes back is
 * seconds late. Reporting that as the worst stutter of the session would bury
 * every real one, and what is being looked for is a few hundred milliseconds.
 */
export const PAUSE_MS = 2000;

/** How many recent gaps the typical frame is taken from. */
const TYPICAL_WINDOW = 120;

/** The median of a list, without changing it. `0` for an empty one. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Whether a gap is a stutter, against the typical gap before it.
 *
 * Relative as well as absolute, because the loop may be capped: at 30 frames
 * a second every gap is 33ms, and that is the setting working. The floor keeps
 * a steady 144Hz display, where three times the typical frame is 21ms, from
 * reporting every hiccup the eye cannot see.
 */
export function isSpike(gap: number, typical: number): boolean {
  if (gap >= PAUSE_MS) return false;
  return gap > Math.max(SPIKE_FLOOR_MS, SPIKE_FACTOR * typical);
}

/**
 * Which part of an interval is to blame: the heaviest phase, unless the time
 * outside the loop was heavier than all of them.
 */
export function culpritOf(phases: Readonly<Record<string, number>>, outside: number): string {
  let name = OUTSIDE;
  let most = outside;
  for (const [phase, ms] of Object.entries(phases)) {
    if (ms > most) {
      name = phase;
      most = ms;
    }
  }
  return name;
}

/** Whether a long frame overlaps the interval `[from, to]`. */
export function overlaps(frame: LongFrame, from: number, to: number): boolean {
  return frame.start < to && frame.start + frame.duration > from;
}

/** The `q`-th quantile of a sorted list, by nearest rank. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[rank];
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

export interface ProfilerOptions {
  /** How many intervals are kept. */
  readonly frames?: number;
  /** How many spikes are kept. */
  readonly spikes?: number;
  /** How many long frames are kept while they wait for a spike to join. */
  readonly longFrames?: number;
  /** Told about each spike as it is found. */
  readonly onSpike?: (spike: Spike) => void;
  /**
   * Told about each phase, for `performance.measure`, which is what puts the
   * phases on DevTools' timeline by name. Injected so the tests need no
   * `performance` of their own.
   */
  readonly measure?: (name: string, start: number, end: number) => void;
}

export class FrameProfiler {
  private readonly frameLimit: number;
  private readonly spikeLimit: number;
  private readonly longFrameLimit: number;
  private readonly onSpike?: (spike: Spike) => void;
  private readonly measure?: (name: string, start: number, end: number) => void;

  private readonly frames: FrameRecord[] = [];
  private readonly spikeList: Spike[] = [];
  private readonly longFrameList: LongFrame[] = [];

  private opened: number | null = null;
  private phases: Record<string, number> = {};
  private events: ProfilerEvent[] = [];

  constructor(options: ProfilerOptions = {}) {
    this.frameLimit = options.frames ?? 300;
    this.spikeLimit = options.spikes ?? 50;
    this.longFrameLimit = options.longFrames ?? 100;
    this.onSpike = options.onSpike;
    this.measure = options.measure;
  }

  /**
   * A drawn frame starts: closes the interval the previous one opened, and
   * returns it as a spike if it was one.
   */
  beginFrame(now: number): Spike | null {
    let spike: Spike | null = null;
    if (this.opened !== null) {
      const gap = now - this.opened;
      let work = 0;
      for (const ms of Object.values(this.phases)) work += ms;
      const record: FrameRecord = {
        start: this.opened,
        gap,
        work,
        outside: Math.max(0, gap - work),
        phases: this.phases,
        events: this.events,
      };
      // Judged before it joins the window, so it is not part of its own
      // baseline -- and only past the floor, so the sort is not paid per frame.
      if (gap > SPIKE_FLOOR_MS) {
        const typical = median(this.frames.slice(-TYPICAL_WINDOW).map((frame) => frame.gap));
        if (isSpike(gap, typical)) {
          spike = {
            ...record,
            culprit: culpritOf(record.phases, record.outside),
            typical,
            longFrames: this.longFrameList.filter((frame) => overlaps(frame, record.start, now)),
          };
          this.spikeList.push(spike);
          if (this.spikeList.length > this.spikeLimit) this.spikeList.shift();
          this.onSpike?.(spike);
        }
      }
      this.frames.push(record);
      if (this.frames.length > this.frameLimit) this.frames.shift();
    }
    this.opened = now;
    this.phases = {};
    this.events = [];
    return spike;
  }

  /** Something the loop did, between `start` and `end`. Repeats accumulate. */
  phase(name: string, start: number, end: number): void {
    this.phases[name] = (this.phases[name] ?? 0) + (end - start);
    this.measure?.(name, start, end);
  }

  /** Something that happened in this interval, in the loop or outside it. */
  event(event: ProfilerEvent): void {
    this.events.push(event);
  }

  /** A long frame from the browser; joins any spike it overlaps. */
  addLongFrame(frame: LongFrame): void {
    this.longFrameList.push(frame);
    if (this.longFrameList.length > this.longFrameLimit) this.longFrameList.shift();
    for (const spike of this.spikeList) {
      if (overlaps(frame, spike.start, spike.start + spike.gap) && !spike.longFrames.includes(frame)) {
        spike.longFrames.push(frame);
      }
    }
  }

  /** The slowest interval that ended in the last `windowMs`. */
  worst(now: number, windowMs: number): FrameRecord | null {
    let found: FrameRecord | null = null;
    for (const frame of this.frames) {
      if (frame.start + frame.gap < now - windowMs) continue;
      if (frame.gap >= PAUSE_MS) continue;
      if (found === null || frame.gap > found.gap) found = frame;
    }
    return found;
  }

  get spikes(): readonly Spike[] {
    return this.spikeList;
  }

  get recorded(): number {
    return this.frames.length;
  }

  /**
   * Everything a person needs to say where the time went, as plain data.
   *
   * `context` is what the viewer knows and this module does not: the settings
   * in force, how much geometry there is, which GPU it runs on.
   */
  report(context: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
    const gaps = this.frames
      .map((frame) => frame.gap)
      .filter((gap) => gap < PAUSE_MS)
      .sort((a, b) => a - b);
    const culprits: Record<string, number> = {};
    for (const spike of this.spikeList) culprits[spike.culprit] = (culprits[spike.culprit] ?? 0) + 1;
    return {
      context,
      frames: {
        count: gaps.length,
        p50: round(quantile(gaps, 0.5)),
        p95: round(quantile(gaps, 0.95)),
        p99: round(quantile(gaps, 0.99)),
        max: round(gaps.length > 0 ? gaps[gaps.length - 1] : 0),
      },
      culprits,
      spikes: this.spikeList.map((spike) => ({
        at: round(spike.start),
        gap: round(spike.gap),
        typical: round(spike.typical),
        culprit: spike.culprit,
        reading: readingOf(spike),
        work: round(spike.work),
        outside: round(spike.outside),
        phases: Object.fromEntries(
          Object.entries(spike.phases).map(([name, ms]) => [name, round(ms)]),
        ),
        events: spike.events.map((event) => ({
          name: event.name,
          at: round(event.at),
          ...(event.ms === undefined ? {} : { ms: round(event.ms) }),
          ...(event.detail === undefined ? {} : { detail: event.detail }),
        })),
        longFrames: spike.longFrames.map((frame) => ({
          kind: frame.kind,
          start: round(frame.start),
          duration: round(frame.duration),
          scripts: frame.scripts.map((script) => ({ ...script, ms: round(script.ms) })),
        })),
      })),
    };
  }
}

/**
 * What a spike most likely means, in a sentence.
 *
 * The one inference worth writing down is the negative one. Time outside the
 * loop with no long frame from the browser means no *script* ran long: the
 * WebGL calls return before the GPU has done the work, so a GPU-bound frame
 * shows up as the next frame arriving late with nobody to blame -- as does a
 * garbage collection or the compositor. A long frame with scripts in it names
 * them instead.
 */
export function readingOf(spike: Spike): string {
  if (spike.culprit !== OUTSIDE) return "the loop itself: see the culprit phase";
  const scripted = spike.longFrames.some((frame) => frame.scripts.length > 0);
  if (scripted) return "a script outside the loop: see longFrames";
  if (spike.events.length > 0) return "outside the loop, alongside the events listed";
  return "no script ran long: most likely the GPU, the compositor or a garbage collection";
}

/**
 * One line per spike, for the console beside a DevTools recording.
 */
export function describeSpike(spike: Spike): string {
  const phases = Object.entries(spike.phases)
    .filter(([, ms]) => ms >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([name, ms]) => `${name} ${round(ms)}`)
    .join(", ");
  const events = spike.events.map((event) => event.name).join(", ");
  return (
    `[stutter] ${round(spike.gap)} ms (typical ${round(spike.typical)}) — ${spike.culprit}` +
    ` | outside ${round(spike.outside)}` +
    (phases ? ` | ${phases}` : "") +
    (events ? ` | events: ${events}` : "")
  );
}

/*
 * The report is asked for from the settings pane and built by the viewer,
 * which are siblings with nothing between them but `App.svelte`. There is one
 * viewer per window, so the viewer registers the function while it is
 * diagnosing and the pane asks for it here; `null` is "diagnostics are off".
 */
let reporter: (() => Record<string, unknown>) | null = null;
let recording: FrameProfiler | null = null;

/**
 * The viewer's profiler and its report, or `null` for both when it stops.
 */
export function provideStutterReport(
  profiler: FrameProfiler | null,
  source: (() => Record<string, unknown>) | null,
): void {
  recording = profiler;
  reporter = source;
}

/**
 * An event from outside the viewer -- `App.svelte` waiting on main for a mesh
 * -- into whatever interval is open. Nothing at all when not diagnosing.
 */
export function recordEvent(event: ProfilerEvent): void {
  recording?.event(event);
}

/** Whether anything is recording, so a caller can skip building an event. */
export function diagnosing(): boolean {
  return recording !== null;
}

export function stutterReport(): Record<string, unknown> | null {
  return reporter === null ? null : reporter();
}
