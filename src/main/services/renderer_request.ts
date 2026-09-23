/**
 * A question main asks the renderer, and the wait for its answer.
 *
 * Main could only ever *send* to the window: `ipcMain.handle` answers requests
 * that start in the renderer, and nothing answers one that starts here. Every
 * fact main needed from the window was therefore *reported* -- the canvas's
 * rect, the pointer lock -- and `capture_viewport` said outright that it could
 * not aim the camera, because aiming needs a reply: a picture taken before the
 * new view is drawn is a picture of the old one.
 *
 * So a request is an event carrying an `id`, and the answer is an event
 * carrying the same `id` back. This is the table between the two. It is
 * Electron-free so the suites can drive it -- `handlers.ts` owns the channels
 * and nothing else.
 *
 * ## What it refuses to do
 *
 * - **Wait forever.** A window that is minimised, or whose renderer has died,
 *   never answers, and an MCP call that hangs is worse than one that says so.
 *   Every request has a deadline and rejects with `RendererTimeoutError`.
 * - **Accept an answer it did not ask for.** An unknown id, or one whose
 *   deadline has passed, is ignored and reported as such by `settle`. A late
 *   reply to a timed-out request must not resolve the *next* request, which is
 *   exactly what matching on "the pending one" instead of on an id would do.
 */

/** The renderer did not answer in time. */
export class RendererTimeoutError extends Error {
  constructor(readonly waitedMs: number) {
    super(`The window did not answer within ${waitedMs} ms.`);
    this.name = "RendererTimeoutError";
  }
}

export interface ReplyTable<T> {
  /**
   * Sends a request through `send`, which is handed the id to put on it, and
   * resolves with the answer that comes back under that id.
   *
   * `timeoutMs` overrides the table's default for this one request.
   */
  ask(send: (id: number) => void, timeoutMs?: number): Promise<T>;
  /** Delivers an answer. `false` when nothing was waiting for that id. */
  settle(id: number, value: T): boolean;
  /** How many requests are still waiting, for the suites. */
  pending(): number;
}

interface Waiting<T> {
  resolve(value: T): void;
  timer: ReturnType<typeof setTimeout>;
}

export function createReplyTable<T>(defaultTimeoutMs: number): ReplyTable<T> {
  const waiting = new Map<number, Waiting<T>>();
  // Never reused, so an id held by a late reply can only go stale -- it can
  // never come to name a different request. `Transaction.id`'s rule.
  let next = 1;

  return {
    ask(send, timeoutMs = defaultTimeoutMs) {
      const id = next++;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new RendererTimeoutError(timeoutMs));
        }, timeoutMs);
        waiting.set(id, { resolve, timer });
        try {
          send(id);
        } catch (err) {
          clearTimeout(timer);
          waiting.delete(id);
          reject(err);
        }
      });
    },
    settle(id, value) {
      const entry = waiting.get(id);
      if (entry === undefined) return false;
      clearTimeout(entry.timer);
      waiting.delete(id);
      entry.resolve(value);
      return true;
    },
    pending: () => waiting.size,
  };
}
