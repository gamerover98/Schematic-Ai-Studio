<script lang="ts" module>
  export type DocumentMenuItem = "rename" | "version" | "dimensions" | "void" | "anchor" | "nbt";
</script>

<script lang="ts">
  /**
   * The schematic's own settings, behind one button beside its name.
   *
   * They were five text buttons along the application bar -- Version,
   * Dimensions, Empty space, Anchor, NBT -- beside Convert, which is not about
   * the open document at all. Each is reached a few times per schematic and
   * none is reached while building, so six permanent buttons were the widest
   * thing in the bar for the least-used verbs in it. The UX audit's first
   * structural finding; one menu, next to the thing it changes.
   *
   * A menu in the ARIA sense: the button says it has one, the items are
   * `menuitem`s, the arrows move between them and Escape closes it and gives
   * the focus back to the button. Opening by keyboard puts the focus on the
   * first item, which is what makes the arrows reachable at all.
   */
  import { tick } from "svelte";
  import { placePopover } from "./floating.js";
  import { t } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";

  interface Props {
    disabled?: boolean;
    /**
     * Whether the schematic is a file yet. One never saved has nothing to
     * rename, and the row says so rather than disappearing.
     */
    saved?: boolean;
    onpick: (item: DocumentMenuItem) => void;
  }

  const { disabled = false, saved = true, onpick }: Props = $props();

  /**
   * In menu order, each with its label and the sentence it used to carry as a
   * title -- shown under the label now, so it needs no tooltip repeating it.
   */
  const ITEMS: readonly { id: DocumentMenuItem; label: string; hint: string; off?: boolean }[] = $derived([
    {
      id: "rename",
      label: t("docMenu.rename"),
      hint: saved ? t("rename.openHint") : t("rename.unsaved"),
      off: !saved,
    },
    { id: "version", label: t("docMenu.version"), hint: t("mcversion.openHint") },
    { id: "dimensions", label: t("docMenu.dimensions"), hint: t("dimensions.openHint") },
    { id: "void", label: t("docMenu.void"), hint: t("void.openHint") },
    { id: "anchor", label: t("docMenu.anchor"), hint: t("anchor.openHint") },
    { id: "nbt", label: t("docMenu.nbt"), hint: t("nbt.openHint") },
  ]);

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLDivElement | null>(null);
  let placement = $state<{ x: number; y: number } | null>(null);
  let innerWidth = $state(0);
  let innerHeight = $state(0);

  async function show(focusFirst: boolean): Promise<void> {
    open = true;
    if (!focusFirst) return;
    await tick();
    panel?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
  }

  function close(returnFocus: boolean): void {
    open = false;
    if (returnFocus) trigger?.focus();
  }

  function pick(item: DocumentMenuItem): void {
    close(false);
    onpick(item);
  }

  function onTriggerKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      event.preventDefault();
      close(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void show(true);
    }
  }

  function onMenuKey(event: KeyboardEvent): void {
    const items = [...(panel?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (at + 1) % items.length;
    else if (event.key === "ArrowUp") next = (at - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape" || event.key === "Tab") {
      // Escape is the menu's, not the window's: the window's drops the selection.
      event.stopPropagation();
      if (event.key === "Escape") event.preventDefault();
      close(event.key === "Escape");
      return;
    }
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  }

  function onWindowClick(event: MouseEvent): void {
    // Fixed, but still a child of `root`: a click inside it is inside `root`.
    if (open && root && !root.contains(event.target as Node)) open = false;
  }

  // Measure, then place, as the model picker does: the menu has to be in the
  // DOM to know how tall it is.
  $effect(() => {
    if (!open || !panel || !trigger) {
      placement = null;
      return;
    }
    void innerWidth;
    void innerHeight;
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
        gap: 4,
      },
      "below",
      "start",
    );
  });
</script>

<svelte:window onclick={onWindowClick} bind:innerWidth bind:innerHeight />

<div class="doc-menu" bind:this={root}>
  <button
    class="trigger"
    bind:this={trigger}
    {disabled}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open ? close(false) : void show(false))}
    onkeydown={onTriggerKey}
    title={t("docMenu.hint")}
  >
    {t("docMenu.label")}
    <Icon name="chevronDown" size={12} weight={2.4} />
  </button>

  {#if open}
    <div
      class="menu"
      role="menu"
      tabindex="-1"
      aria-label={t("docMenu.label")}
      bind:this={panel}
      style:left={placement ? `${placement.x}px` : "0"}
      style:top={placement ? `${placement.y}px` : "0"}
      style:visibility={placement ? "visible" : "hidden"}
      onkeydown={onMenuKey}
    >
      {#each ITEMS as item (item.id)}
        <button role="menuitem" disabled={item.off === true} onclick={() => pick(item.id)}>
          <span class="label">{item.label}</span>
          <span class="hint">{item.hint}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .doc-menu {
    flex: none;
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  /* The inventory's slab, floating: the menu is a small window of its own. */
  .menu {
    position: fixed;
    z-index: var(--z-popover);
    display: flex;
    flex-direction: column;
    width: 300px;
    padding: var(--space-1);
    border: var(--bevel) solid;
    border-color: var(--bevel-hi) var(--bevel-lo) var(--bevel-lo) var(--bevel-hi);
    background: var(--bg-panel);
    box-shadow: var(--shadow-float);
  }

  .menu button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-height: var(--control-h);
    padding: var(--space-2) var(--space-3);
    border: 0;
    background: transparent;
    text-align: left;
  }

  .menu button:hover:not(:disabled),
  .menu button:focus-visible {
    background: var(--bg-hover);
  }

  /* A verb that is not available yet still says why, so it stays readable. */
  .menu button:disabled .label {
    color: var(--text-dim);
  }

  .label {
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--text-dim);
  }
</style>
