/**
 * Whether the picture a move drag asked for may still be put on screen.
 *
 * The gizmo fetches the region's mesh at the press and does not wait for it,
 * so the answer can land after the drag is over. Two ways it did, and both
 * left the ghost standing at the corner of every selection after it until the
 * app was restarted:
 *
 * - **a press on an arrow released without moving a whole block.** No move
 *   is committed, and the commit was the only thing that ever cleared it;
 * - **a release before the mesh arrived.** The commit cleared it, and then
 *   the answer wrote it back, because the guard asked whether there was a
 *   selection -- which there still was, having moved with the blocks.
 *
 * So the question is asked of the drag rather than of the selection: a token
 * per press, and an answer is accepted only while its token is the current
 * one. `armStamp`'s identity check, for `armStamp`'s reason.
 *
 * A plain module for `selection_drag.ts`'s reason: the press and the release
 * come from pointer events the harness cannot drive.
 */
export interface GhostRequests {
  current: object | null;
}

export function ghostRequests(): GhostRequests {
  return { current: null };
}

/** A press on a move handle: any earlier request is stale from here on. */
export function grabGhost(requests: GhostRequests): object {
  const token = {};
  requests.current = token;
  return token;
}

/** Whether the answer to `token` may still become the ghost. */
export function ghostStillWanted(requests: GhostRequests, token: object): boolean {
  return requests.current === token;
}

/** The drag is over, whatever it decided: no answer may land after this. */
export function releaseGhost(requests: GhostRequests): void {
  requests.current = null;
}
