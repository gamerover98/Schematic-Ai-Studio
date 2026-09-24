/**
 * At most one run in flight, and at most one more queued behind it.
 *
 * Built for `refreshDocument`, and the second stutter report is why. Every
 * call used to send its own mesh request, and a burst of them -- a colour
 * picker dragged, whose every `input` rebuilds the atlas -- sent fifty at once.
 * Main answered them one by one, each with a full rebuild and the whole 27 MB
 * atlas because none of them yet knew the atlas the others were fetching, and
 * the window applied every answer, stale or not: 400 to 600 ms of structured
 * clone and texture upload each, for thirty seconds after the drag had ended,
 * with the answers arriving up to 29 s late.
 *
 * Only the latest state is worth drawing, so a call that arrives while a run
 * is in flight does not start another: it asks for one more run after the
 * current one, which reads whatever is current by then. Any number of calls in
 * that window collapse into that one run.
 *
 * Every caller gets a promise that settles after a run that *started after its
 * call* -- which is what `await refreshDocument()` has always promised: that
 * the picture now reflects the state as it was when you asked. A failure
 * rejects everybody waiting on that run, and the next call starts afresh.
 */
export function coalesce(run: () => Promise<void>): () => Promise<void> {
  let current: Promise<void> | null = null;
  let wanted = false;

  const loop = async (): Promise<void> => {
    try {
      while (wanted) {
        wanted = false;
        await run();
      }
    } catch (error) {
      wanted = false;
      throw error;
    } finally {
      current = null;
    }
  };

  return () => {
    wanted = true;
    if (current === null) current = loop();
    return current;
  };
}
