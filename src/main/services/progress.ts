/**
 * How far a long piece of work on the document has got, for the loading bar.
 *
 * Opening a large schematic is seconds of work in main -- on a 384x72x384
 * terrain 0.7 s of reading and 14 s of meshing, chunk after chunk -- and the
 * window used to sit through it with nothing on screen to say it was not
 * hung. `IPC.docProgress` is the answer, and this module is the half of it
 * that decides *when* to say anything.
 *
 * Electron-free, for `breathing.ts`'s reason: `openDocument` and
 * `buildChunkedMesh` report through it, and the suites have to reach both.
 * The handlers install the sink, which is a `webContents.send`.
 *
 * Three rules, each of which keeps the bar honest:
 *
 * - **Nothing is said about work that ends quickly.** An operation stays
 *   silent for its first `PROGRESS_QUIET_MS`, so the hundreds of edits a
 *   creative session makes -- each one a mesh build of a few chunks -- send
 *   nothing at all. The window waits a little longer again before it draws.
 * - **At most one event per `PROGRESS_EVERY_MS`**, except that a new phase is
 *   always sent: a bar that skipped "lighting" would jump.
 * - **Reporting never yields.** It is a `send` from inside a loop that holds
 *   the main thread on purpose -- giving the event loop back in the middle of
 *   a mesh would let an MCP edit change the voxels under it. A `send` is
 *   handed to the IPC thread, so it arrives while this one is still busy.
 */

import type { DocProgress, DocProgressPhase } from "../../shared/ipc.js";

/** How long an operation runs before it says anything. */
export const PROGRESS_QUIET_MS = 150;

/** The least time between two events of one phase. */
export const PROGRESS_EVERY_MS = 50;

type Sink = (progress: DocProgress) => void;

let sink: Sink | null = null;

/** Where the events go: the window, from `registerIpcHandlers`. `null` stops them. */
export function setProgressSink(next: Sink | null): void {
  sink = next;
}

export interface Progress {
  /** Where the work is now. Cheap enough to call once per chunk. */
  report(phase: DocProgressPhase, done?: number, total?: number): void;
  /**
   * Says the work ended with nothing for the window to wait for, if anything
   * was said about it at all. A mesh build never calls this: the window puts
   * the bar away when the mesh arrives.
   */
  abandon(): void;
  /** Whether anything has been sent. */
  readonly spoke: boolean;
}

/** Starts timing one operation. `now` is for the tests. */
export function startProgress(now: () => number = () => performance.now()): Progress {
  const began = now();
  let lastAt = -Infinity;
  let lastPhase: DocProgressPhase | null = null;
  let spoke = false;
  return {
    report(phase, done = 0, total = 1) {
      if (sink === null) return;
      const at = now();
      if (at - began < PROGRESS_QUIET_MS) return;
      if (phase === lastPhase && at - lastAt < PROGRESS_EVERY_MS) return;
      lastAt = at;
      lastPhase = phase;
      spoke = true;
      sink({ phase, done, total });
    },
    abandon() {
      if (!spoke || sink === null) return;
      sink({ phase: "done", done: 1, total: 1 });
    },
    get spoke() {
      return spoke;
    },
  };
}
