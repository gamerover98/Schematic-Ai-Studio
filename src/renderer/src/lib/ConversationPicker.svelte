<script lang="ts">
  /**
   * Which conversation about this schematic you are looking at.
   *
   * A button naming the current one, opening a list of the rest. The list is
   * fetched when the popover opens rather than held: conversations change from
   * main's side — a turn retitles one, a save reorders them — and a list kept
   * in the renderer would be a second copy going quietly stale.
   *
   * The button is the chat panel's one tab, standing on the strip the tools'
   * panel stands its three on (`.panel-tab` in `app.css`): the name of the
   * conversation is the name of the panel. It is a tab to look at and a button
   * to a screen reader, because what it opens is a list, not a panel.
   *
   * Positioned by `placePopover`, not by CSS. Every panel between here and
   * `<body>` is `overflow: hidden`, and this control sits at the top of the
   * right-hand column, so a popover laid out from its trigger is either clipped
   * by an ancestor or off the screen — which is exactly the bug the model
   * picker had before that function existed.
   *
   * The keyboard reaches it: the arrows walk the list, Escape puts it away and
   * hands the focus back, and stops there -- the window's own Escape drops the
   * selection, which is not what somebody closing a list meant.
   *
   * **A row renames in place**, from the pencil or F2 on the focused row. The
   * field takes every key itself: the list's arrows and Escape, and the
   * window's single-key shortcuts, would all otherwise reach somebody typing a
   * name. Enter and leaving the field both keep it, Escape throws it away, and
   * an empty one takes the name off -- the way back to the derived title.
   */
  import { tick } from "svelte";
  import { CONVERSATION_TITLE_LIMIT, type ConversationSummary } from "../../../shared/ipc.js";
  import { ageLabel } from "./age_label.js";
  import { placePopover } from "./floating.js";
  import { t } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";

  interface Props {
    conversations: ConversationSummary[];
    activeId: string;
    busy: boolean;
    /** Fetches the list; called when the popover opens. */
    onrefresh: () => void;
    onopen: (id: string) => void;
    ondelete: (id: string) => void;
    /** `""` takes a chosen name off again. */
    onrename: (id: string, title: string) => void;
  }

  const { conversations, activeId, busy, onrefresh, onopen, ondelete, onrename }: Props = $props();

  let open = $state(false);
  let root: HTMLDivElement | null = null;
  let trigger = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLDivElement | null>(null);
  let placement = $state<{ x: number; y: number } | null>(null);
  let innerWidth = $state(0);
  let innerHeight = $state(0);
  /** Whether this opening has put the focus in the list yet; once per opening. */
  let focused = false;

  const active = $derived(conversations.find((one) => one.id === activeId) ?? null);
  const label = $derived(active === null ? t("chat.newChat") : nameOf(active));

  /** The row being renamed, and what is typed so far. */
  let editing = $state<string | null>(null);
  let draft = $state("");

  /**
   * What a row says. An empty conversation reads "New chat" in the window's
   * language -- unless somebody named it, which is then what it says.
   */
  function nameOf(one: ConversationSummary): string {
    return one.entryCount === 0 && !one.named ? t("chat.newChat") : one.title;
  }

  function startRename(one: ConversationSummary): void {
    editing = one.id;
    draft = one.entryCount === 0 && !one.named ? "" : one.title;
  }

  /** Puts the caret in the field with the name selected, as a rename expects. */
  function selectAll(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }

  /**
   * Keeps the name and leaves the field. Guarded on `editing`, because Enter
   * unmounts the field and the blur that follows must not keep it twice.
   * Nothing is sent for a name that is what the row already says.
   */
  function commitRename(one: ConversationSummary): void {
    if (editing !== one.id) return;
    editing = null;
    const typed = draft.replace(/\s+/g, " ").trim();
    if (typed === "" ? !one.named : typed === one.title) return;
    onrename(one.id, typed);
  }

  function cancelRename(): void {
    editing = null;
  }

  /** The focus back on the row, after the field has gone. */
  function refocus(id: string): void {
    void tick().then(() => {
      panel?.querySelector<HTMLButtonElement>(`li[data-id="${id}"] .entry`)?.focus();
    });
  }

  function onFieldKey(event: KeyboardEvent, one: ConversationSummary): void {
    // Every key stops here: see the note at the top of the component.
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename(one);
      refocus(one.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
      refocus(one.id);
    }
  }

  function toggle(): void {
    open = !open;
    focused = false;
    if (open) onrefresh();
  }

  function close(): void {
    open = false;
    trigger?.focus();
  }

  function onWindowClick(event: MouseEvent): void {
    // The popover is `position: fixed` but still a child of `root`, so this
    // stays a containment test rather than needing a portal.
    //
    // **Asked of the path the event took, not of `target`.** A click on the
    // pencil swaps the button for the field, and for a click the user made --
    // unlike one a script dispatched -- Svelte's update runs between two
    // listeners of the same dispatch: by the time this one sees the event the
    // button is gone from the document and `root.contains(target)` is false, so
    // the list closed on the very press that was meant to open the field. The
    // path was fixed when the event started, and still holds the row.
    if (root && !event.composedPath().includes(root)) open = false;
  }

  function onTriggerKey(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" && !open) {
      event.preventDefault();
      toggle();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  /** The rows' open buttons, in order: what the arrows walk. */
  function entries(): HTMLButtonElement[] {
    return panel ? [...panel.querySelectorAll<HTMLButtonElement>(".entry")] : [];
  }

  function onPanelKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "F2") {
      const row = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("li[data-id]");
      const one = conversations.find((candidate) => candidate.id === row?.dataset.id);
      if (one !== undefined) {
        event.preventDefault();
        startRename(one);
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = entries();
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    rows[(at + step + rows.length) % rows.length].focus();
  }

  /** Measure, then place. Rendered hidden for one flush; an `$effect` runs
      after the DOM updates and before paint, so there is nothing to see. */
  $effect(() => {
    if (!open || !panel || !trigger) {
      placement = null;
      return;
    }
    // The list arriving changes the popover's height, so re-place on it.
    void conversations;

    const anchor = trigger.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    placement = placePopover(
      { left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height },
      {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        popoverWidth: box.width,
        popoverHeight: box.height,
        margin: 8,
        gap: 6,
      },
      "below",
      "start",
    );
  });

  /*
   * Into the list once it is on screen: the conversation you are in, or the
   * first, or the list itself when there is nothing in it -- so the arrows and
   * Escape have somewhere to start from.
   *
   * After a `tick`, and that is not caution. This effect wakes on the same
   * `placement` the popover's `style` is written from, and runs before it:
   * measured, the focus landed while the popover was still
   * `visibility: hidden`, which the browser refuses without a word, and the
   * keyboard stayed on the button.
   */
  $effect(() => {
    if (placement === null || !panel || focused) return;
    focused = true;
    const list = panel;
    void tick().then(() => {
      const target = list.querySelector<HTMLButtonElement>("li.active .entry") ?? entries()[0] ?? list;
      target.focus();
    });
  });
</script>

<svelte:window onclick={onWindowClick} bind:innerWidth bind:innerHeight />

<div class="picker" bind:this={root}>
  <button
    class="panel-tab current trigger"
    bind:this={trigger}
    onclick={toggle}
    onkeydown={onTriggerKey}
    disabled={busy}
    aria-haspopup="dialog"
    aria-expanded={open}
    title={t("chat.historyHint")}
  >
    <span class="label">{label}</span>
    <Icon name="chevronDown" size={12} weight={2.4} />
  </button>

  {#if open}
    <div
      class="popover slab"
      role="dialog"
      aria-label={t("chat.historyHint")}
      tabindex="-1"
      bind:this={panel}
      onkeydown={onPanelKey}
      style={placement === null
        ? "visibility: hidden"
        : `left: ${placement.x}px; top: ${placement.y}px`}
    >
      {#if conversations.length === 0}
        <p class="hint">{t("chat.noHistory")}</p>
      {:else}
        <ul>
          {#each conversations as one (one.id)}
            <li class:active={one.id === activeId} class:editing={editing === one.id} data-id={one.id}>
              {#if editing === one.id}
                <input
                  class="rename-field"
                  type="text"
                  bind:value={draft}
                  maxlength={CONVERSATION_TITLE_LIMIT}
                  placeholder={t("chat.renameHint")}
                  aria-label={t("chat.renameLabel")}
                  use:selectAll
                  onkeydown={(event) => onFieldKey(event, one)}
                  onblur={() => commitRename(one)}
                />
              {:else}
                <button
                  class="entry"
                  aria-current={one.id === activeId ? "true" : undefined}
                  onclick={() => {
                    open = false;
                    if (one.id !== activeId) onopen(one.id);
                  }}
                >
                  <span class="title">{nameOf(one)}</span>
                  <span class="when">{ageLabel(one.updatedAt)}</span>
                </button>
                <button
                  class="icon rename"
                  title={t("chat.renameChat")}
                  aria-label={t("chat.renameChat")}
                  onclick={() => startRename(one)}><Icon name="pencil" size={14} /></button
                >
              {/if}
              <button
                class="icon remove"
                title={t("chat.deleteChat")}
                aria-label={t("chat.deleteChat")}
                onclick={() => ondelete(one.id)}><Icon name="close" size={14} /></button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Out of the layout: the button is the strip's flex item, as a tab is. */
  .picker {
    display: contents;
  }

  .trigger {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    max-width: min(320px, 100%);
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Against the window; see the note at the top of the component. */
  .popover {
    position: fixed;
    z-index: var(--z-popover);
    width: min(320px, calc(100vw - 16px));
    max-height: min(420px, calc(100vh - 16px));
    overflow-y: auto;
    padding: var(--space-2);
    box-shadow: var(--shadow-float);
  }

  .popover:focus {
    outline: none;
  }

  .popover .hint {
    margin: var(--space-2) var(--space-3);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
  }

  /* The field takes the row up to the delete button: it is the row. */
  .rename-field {
    grid-column: 1 / 3;
    min-width: 0;
    margin: var(--space-1) var(--space-2);
  }

  li:hover {
    background: var(--bg-hover);
  }

  /* The one you are in: a selected row, with an emerald edge to say so. */
  li.active {
    background: var(--accent-dim);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .entry {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
    min-height: 0;
    padding: var(--space-2) var(--space-3);
    border: 0;
    background: none;
    text-align: left;
  }

  .entry:hover:not(:disabled) {
    background: none;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .when {
    font-size: var(--text-xs);
    color: var(--text-dim);
  }

  li.active .when {
    color: var(--text);
  }

  .remove,
  .rename {
    /* Hidden until the row is pointed at: a delete button on every row of a
       list you are only reading is an invitation to a mistake. The pencil
       goes with it, so the row is not a line of three controls at rest. */
    opacity: 0;
  }

  .remove {
    margin-right: var(--space-1);
  }

  li:hover .remove,
  li:hover .rename,
  .remove:focus-visible,
  .rename:focus-visible {
    opacity: 1;
  }

  .remove:hover:not(:disabled) {
    color: var(--danger);
  }
</style>
