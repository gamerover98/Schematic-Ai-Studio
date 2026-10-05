<script lang="ts">
  /**
   * What the window shows when it has no document to show: the start screen,
   * and the question about work an earlier session left unsaved.
   *
   * A sibling of `Modal.svelte` rather than a use of it, and the difference is
   * the keyboard. A dialog takes every key, so nothing behind it fires; this is
   * the window's resting state, and the app's commands -- Ctrl+K for the
   * palette, Ctrl+, for Settings -- have to work from it. So **a Ctrl chord
   * goes through to the window and a plain key stays here.** With nothing open
   * the single-key shortcuts have nothing to act on, and with a schematic
   * opened behind the recovery question by an MCP client, E would open the
   * inventory over a question about lost work.
   *
   * The rest is what a dialog does: the slab is `.modal`, the pointer lock
   * goes, the focus goes in and Tab stays inside, and a screen that can be put
   * away closes on Escape, on its close button, or on a backdrop press that
   * began on the backdrop. It does not hand the focus back on the way out:
   * what opened it was the launch, and the one way out that wants the focus
   * somewhere -- the chat -- puts it there itself.
   *
   * `--z-screen` is a tier of its own, just under the dialogs: it covers the
   * whole shell, and a dialog opened from it -- or from the menu while it is
   * up, as Ctrl+, opens Settings -- lands on top rather than behind it.
   *
   * `fixed`, so it covers the window rather than the viewport section it is
   * mounted in. Dropping a file still works, which is the thing a full-bleed
   * cover is supposed to break: the handlers are on `section.preview`, this
   * stays a DOM child of it whatever `fixed` does to its painting, drag events
   * bubble, and `App.svelte` counts enters against leaves precisely because
   * children fire them.
   */
  import type { Snippet } from "svelte";
  import { keepFocusInside } from "./focus_trap.js";
  import { t } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";

  interface Props {
    title: string;
    /** A line under the title; it is also what the screen is described by. */
    lead?: string;
    /** A picture before the title: the app's mark, on the start screen. */
    mark?: string;
    /**
     * Put it away. Absent, there is no close button, and Escape and the
     * backdrop do nothing: the recovery question has two explicit answers and
     * no third, because dismissing it by accident loses work for good.
     */
    ondismiss?: () => void;
    /** `alertdialog` for a question that has to be answered. */
    role?: "dialog" | "alertdialog";
    /** The widest it gets, in CSS pixels; never wider than the window allows. */
    width?: number;
    children?: Snippet;
    /** The answers, right-aligned along the bottom; or a closing line. */
    footer?: Snippet;
  }

  const { title, lead, mark, ondismiss, role = "dialog", width = 460, children, footer }: Props = $props();

  let card = $state<HTMLDivElement | null>(null);
  let pressedOnScrim = false;

  const id = Math.random().toString(36).slice(2, 10);
  const titleId = `screen-title-${id}`;
  const leadId = `screen-lead-${id}`;

  // It can appear over a canvas that was still flying when the document
  // closed, and the focus goes in so Escape works without a click first.
  $effect(() => {
    if (card === null) return;
    if (document.pointerLockElement) document.exitPointerLock();
    card.focus();
  });

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Tab") {
      event.stopPropagation();
      if (card !== null) keepFocusInside(card, event);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      if (ondismiss === undefined || event.defaultPrevented) return;
      event.preventDefault();
      ondismiss();
    } else if (!(event.ctrlKey || event.metaKey)) {
      // A plain key is the screen's; a chord is a command, and the window's.
      event.stopPropagation();
    }
  }
</script>

<div
  class="screen"
  role="presentation"
  onkeydown={onKey}
  onmousedown={(event) => {
    // A press on the backdrop keeps the focus where it was, inside the card,
    // so the keyboard rule above still applies after it.
    if (event.target === event.currentTarget) event.preventDefault();
  }}
  onpointerdown={(event) => (pressedOnScrim = event.target === event.currentTarget)}
  onclick={(event) => {
    if (ondismiss !== undefined && pressedOnScrim && event.target === event.currentTarget) ondismiss();
    pressedOnScrim = false;
  }}
>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="modal card"
    {role}
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={lead === undefined ? undefined : leadId}
    tabindex="-1"
    style:--screen-width={`${width}px`}
    bind:this={card}
  >
    <header>
      {#if mark}<img class="mark" src={mark} alt="" width="48" height="48" />{/if}
      <div class="titles">
        <h2 id={titleId}>{title}</h2>
        {#if lead !== undefined}<p class="lead" id={leadId}>{lead}</p>{/if}
      </div>
      {#if ondismiss !== undefined}
        <button class="icon close" onclick={ondismiss} aria-label={t("common.close")}><Icon name="close" /></button>
      {/if}
    </header>
    {#if children}
      <div class="body">
        {@render children()}
      </div>
    {/if}
    {#if footer}
      <footer>{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .screen {
    position: fixed;
    inset: 0;
    z-index: var(--z-screen);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    background: var(--scrim);
  }

  /* `.modal` in app.css is the look; this is the frame, as in `Modal.svelte`:
     a column whose body takes what is left and scrolls. */
  .card {
    display: flex;
    flex-direction: column;
    width: min(var(--screen-width), 100%);
    max-height: 100%;
    outline: none;
    overflow: hidden;
  }

  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-3) var(--space-4) var(--space-5);
  }

  .mark {
    flex: none;
    display: block;
  }

  .titles {
    flex: 1 1 auto;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: var(--text-xl);
  }

  .lead {
    margin: var(--space-2) 0 0;
    color: var(--text-dim);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .close {
    flex: none;
    align-self: flex-start;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    padding: 0 var(--space-5) var(--space-5);
    overflow-y: auto;
  }

  /* A groove above the answers, as above a dialog's actions. */
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
