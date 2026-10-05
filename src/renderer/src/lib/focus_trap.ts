/**
 * Tab goes round inside a dialog, never out into the window behind its scrim.
 *
 * Shared by `Modal.svelte` and `Screen.svelte`: both cover the window with a
 * scrim and say `aria-modal`, and a keyboard that could Tab out of either
 * would land on a control nobody can see.
 */

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Call from the container's Tab keydown; wraps at either end, and lets the browser move the focus everywhere else. */
export function keepFocusInside(container: HTMLElement, event: KeyboardEvent): void {
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0,
  );
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
