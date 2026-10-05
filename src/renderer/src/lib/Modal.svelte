<script lang="ts">
  /**
   * Every dialog in the app: a slab over a scrim, its title in the pixel face,
   * a close button, a body that scrolls and, when there is something to
   * confirm, a row of actions along the bottom.
   *
   * There were ten copies of this skeleton, and they had drifted the way copies
   * do. Three ways of handling Escape (`preventDefault`, `stopPropagation`, or
   * both), a close button that was in the header's flow in some and pinned to a
   * corner in others, two dialogs with no close button at all, a backdrop that
   * closed on any click in some and only on its own in others, the pointer-lock
   * release in six of the ten. What a dialog *looks* like was already one rule
   * in `app.css`; what it *does* is this component.
   *
   * What it does, once:
   *
   * - **the scrim is the modal tier**, `--z-modal`, over the bar, the chat, the
   *   tool windows and the start screen;
   * - **the pointer lock goes on open.** In flight the canvas holds the pointer,
   *   and a panel opened over a camera that is still turning has no cursor to
   *   click anything with;
   * - **the keyboard is the dialog's.** Every key stops here, so the window's
   *   single-key shortcuts -- Delete empties the selection, E opens the
   *   inventory, Escape drops the selection -- never fire from inside a dialog.
   *   Escape closes it, unless something inside already took it (a block list
   *   that was open, say), and Tab goes round inside it rather than out into the
   *   app behind the scrim;
   * - **focus goes in, and comes back.** The dialog takes it on open, so Escape
   *   works without a click first, and the control that opened it gets it back
   *   on close, so a keyboard user is where they were;
   * - **the backdrop closes it only when the press began there.** A drag that
   *   starts on a slider and is let go past the dialog's edge ends in a click on
   *   the scrim, and closing on that threw the dialog away mid-gesture.
   */
  import type { Snippet } from "svelte";
  import { keepFocusInside } from "./focus_trap.js";
  import { t } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";

  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    /** The widest it gets, in CSS pixels; never wider than the window allows. */
    width?: number;
    /**
     * A fixed height, for a dialog laid out against its own frame -- a text
     * that takes what is left, a rail beside a pane. It fits its content
     * otherwise.
     */
    height?: number;
    /** No padding and no scrolling on the body: the dialog lays out its own regions. */
    flush?: boolean;
    /** Keys before this component looks at them: Enter to confirm, say. */
    onkeydown?: (event: KeyboardEvent) => void;
    /** Beside the title: a search field, a count. */
    head?: Snippet;
    children: Snippet;
    /** The actions, right-aligned along the bottom. */
    footer?: Snippet;
  }

  const { open, title, onclose, width = 460, height, flush = false, onkeydown, head, children, footer }: Props =
    $props();

  let dialog = $state<HTMLDivElement | null>(null);
  let pressedOnScrim = false;

  const titleId = `modal-title-${Math.random().toString(36).slice(2, 10)}`;

  $effect(() => {
    if (!open || dialog === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (document.pointerLockElement) document.exitPointerLock();
    dialog.focus();
    return () => {
      if (opener !== null && opener.isConnected) opener.focus({ preventScroll: true });
    };
  });

  function onKey(event: KeyboardEvent): void {
    // The dialog's keyboard, whatever the key: see the header.
    event.stopPropagation();
    onkeydown?.(event);
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.preventDefault();
      onclose();
    } else if (event.key === "Tab" && dialog !== null) {
      keepFocusInside(dialog, event);
    }
  }
</script>

{#if open}
  <div
    class="scrim"
    role="presentation"
    onkeydown={onKey}
    onpointerdown={(event) => (pressedOnScrim = event.target === event.currentTarget)}
    onclick={(event) => {
      if (pressedOnScrim && event.target === event.currentTarget) onclose();
      pressedOnScrim = false;
    }}
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="modal dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
      style:--modal-width={`${width}px`}
      style:height={height === undefined ? undefined : `min(${height}px, 100%)`}
      bind:this={dialog}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        {#if head}{@render head()}{/if}
        <button class="icon close" onclick={onclose} aria-label={t("common.close")}><Icon name="close" /></button>
      </header>
      <div class="body" class:flush>
        {@render children()}
      </div>
      {#if footer}
        <footer>{@render footer()}</footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-7) var(--space-6);
    background: var(--scrim);
  }

  /* `.modal` in app.css is the look; this is the frame: a column whose body
     takes what is left and scrolls, so a long dialog never grows past the
     window. */
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(var(--modal-width), 100%);
    max-height: 100%;
    outline: none;
    overflow: hidden;
  }

  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
  }

  h2 {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    font-size: var(--text-lg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* `min-height: 0` so the body scrolls inside the dialog rather than growing
     it past the window: the grid-child rule, for a flex child. */
  .body {
    flex: 1 1 auto;
    min-height: 0;
    padding: var(--space-2) var(--space-5) var(--space-5);
    overflow-y: auto;
  }

  .body.flush {
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
  }

  /* A groove above the actions, as between two exchanges in the chat. */
  footer {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-top: var(--bevel) solid var(--bevel-lo);
    box-shadow: inset 0 var(--bevel) 0 var(--bevel-hi);
  }
</style>
