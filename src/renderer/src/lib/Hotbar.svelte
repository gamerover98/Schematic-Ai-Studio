<script lang="ts">
  /**
   * Nine blocks along the bottom, in creative.
   *
   * The block to place used to be a text field with a dropdown — right for a
   * form, wrong for building, where the whole point is that changing material
   * costs no attention. Keys 1–9 pick a slot and the wheel steps through them,
   * which is what anyone who has played the game will try first.
   *
   * ## The wheel is already the zoom, and has to be taken
   *
   * `OrbitControls` maps it, so this listens with `capture` and calls
   * `preventDefault` — the same problem the left mouse button poses for
   * selection drags, and the same remedy. Only in flight (`ownsWheel`): in
   * orbit the wheel is the zoom, and the bar is on screen there too now, so
   * "there is no hotbar to step through" has stopped being the reason. The
   * reason is that the game has no zoom to lose and this does.
   *
   * ## Only what it is told
   *
   * The slot and the contents are props, and every change goes out through
   * `onchange`. They live in `UiSettings`, so the component holding its own copy
   * would mean two answers to "what am I holding" — and the one on screen would
   * be the one that failed to persist.
   *
   * ## A block dropped on a slot goes in it
   *
   * From the materials list or the creative inventory, by dragging, which is
   * how the game fills its hotbar. The inventory is a modal over the window,
   * so while it is open the bar is lifted above its scrim (`raised`): the
   * game draws the hotbar inside its inventory for the same reason.
   */
  import { HOTBAR_SLOTS } from "../../../shared/settings.js";
  import { splitBlockInput } from "../../../shared/block_input.js";
  import { describeMix, tryParseMix } from "../../../shared/block_mix.js";
  import { blockIcons, iconsReady, requestBlockIcons } from "./block_icons.svelte.js";
  import { t } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";
  import { isTyping } from "./typing.js";
  import { carriesBlock, droppedBlock } from "./block_drag.js";

  interface Props {
    /** Exactly `HOTBAR_SLOTS` block ids; `coerceUi` guarantees the length. */
    slots: readonly string[];
    /** Which one is held, 0-based. */
    active: number;
    /** Shown whenever a document is open, in either camera mode. */
    visible: boolean;
    /**
     * Whether the wheel belongs to this bar.
     *
     * Only in flight. In orbit the wheel is the zoom, and taking it would trade
     * a control the user needs constantly for one the number keys already
     * provide -- the game gets to claim the wheel because the game has no zoom.
     */
    ownsWheel: boolean;
    onselect: (slot: number) => void;
    /** A slot was emptied or asked to be filled from the inventory. */
    onedit?: (slot: number) => void;
    /** The button past the ninth slot: open the full block list. */
    onopeninventory?: () => void;
    /** A block dropped on a slot. Without it a slot takes no drop. */
    onassign?: (slot: number, block: string) => void;
    /** Above the modal tier, for the creative inventory to drop onto. */
    raised?: boolean;
  }

  const {
    slots,
    active,
    visible,
    ownsWheel,
    onselect,
    onedit,
    onopeninventory,
    onassign,
    raised = false,
  }: Props = $props();

  /** The slot a dragged block is over. */
  let dropTarget = $state<number | null>(null);

  function dragOver(index: number, event: DragEvent): void {
    if (onassign === undefined || !carriesBlock(event.dataTransfer ? [...event.dataTransfer.types] : undefined)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dropTarget = index;
  }

  /*
   * The block alone, never its pair: a slot is what the hand holds, and
   * holding a bed's foot places the whole bed.
   */
  function drop(index: number, event: DragEvent): void {
    dropTarget = null;
    const dragged = droppedBlock(event.dataTransfer);
    if (onassign === undefined || dragged === null) return;
    event.preventDefault();
    event.stopPropagation();
    onassign(index, dragged.block);
  }

  /**
   * `minecraft:oak_planks` → `oak planks`, which is what fits under a tile.
   *
   * Through `splitBlockInput` first, because a slot may hold a patterned banner
   * pasted as a whole `/give` command -- and labelled by its first characters
   * that is `/give @p m…` under every one of them.
   */
  function label(id: string): string {
    const mix = tryParseMix(id);
    if (mix !== null && mix.entries.length > 1) {
      return t("hotbar.mix", { first: label(mix.entries[0].block), more: mix.entries.length - 1 });
    }
    let block = id;
    try {
      block = splitBlockInput(id).block;
    } catch {
      // Half a command: label what is there, as before.
    }
    return block.replace(/^minecraft:/, "").replace(/\[.*$/, "").replace(/_/g, " ");
  }

  /**
   * The blocks, drawn as blocks.
   *
   * These were hashed colour swatches — "a real texture would be better and is
   * what the inventory is for" was the note, and it was wrong twice over: the
   * bar is the thing you look at while building, and having two different
   * pictures of gravel in one window is worse than having none. Same cache the
   * inventory draws from, so they cannot disagree.
   */
  const icons = $derived(blockIcons());

  /**
   * The block a slot is drawn as: itself, or the first block of a mix. The
   * mix's text is not a block, and asking for an icon of it would intern a
   * block called `70%stone,30%andesite` on the way.
   */
  function iconOf(id: string): string {
    return tryParseMix(id)?.entries[0]?.block ?? id;
  }

  function isMix(id: string): boolean {
    return (tryParseMix(id)?.entries.length ?? 1) > 1;
  }

  $effect(() => {
    if (!visible) return;
    // Read, so the warm-up landing re-draws these rather than leaving them wrong.
    void iconsReady();
    requestBlockIcons(slots.map(iconOf));
  });

  function step(by: number): void {
    onselect(((active + by) % HOTBAR_SLOTS + HOTBAR_SLOTS) % HOTBAR_SLOTS);
  }

  $effect(() => {
    if (!visible) return;

    const onKey = (event: KeyboardEvent) => {
      /*
       * Not while the user is typing: this listens on `window`, so a "3" in the
       * chat would otherwise change what is in your hand mid-sentence.
       *
       * Ctrl is let through while the pointer is locked, which is the same rule
       * `onWindowKey` applies from the other side: in flight Ctrl is the sprint
       * modifier, so refusing it here meant a sprinting player could not change
       * what they were holding. Nothing is being typed with the pointer locked,
       * and no app shortcut answers Ctrl+3 either.
       */
      const flying = document.pointerLockElement !== null;
      if (isTyping(event.target) || event.metaKey || event.altKey) return;
      if (event.ctrlKey && !flying) return;
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= HOTBAR_SLOTS) {
        event.preventDefault();
        onselect(digit - 1);
      }
    };

    /*
     * `capture` and `passive: false`, both load-bearing. OrbitControls listens
     * on the canvas, so without capture the zoom happens first; without
     * `passive: false` the browser refuses `preventDefault` and the zoom happens
     * anyway. Registered on `window` so it works wherever the pointer is.
     */
    const onWheel = (event: WheelEvent) => {
      if (isTyping(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      step(event.deltaY > 0 ? 1 : -1);
    };

    window.addEventListener("keydown", onKey);
    if (ownsWheel) {
      window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel, { capture: true });
    };
  });
</script>

{#if visible}
  <!--
    The game's hotbar: nine slots sunk into a slab, the one in hand framed,
    and over it the name of what is held, where the game prints it. The names
    used to sit under every slot at nine pixels, cut to a few letters each;
    every slot still says its own in its hover and to a screen reader.
  -->
  <div class="hotbar" class:raised role="toolbar" aria-label={t("hotbar.label")}>
    <p class="held pixel" aria-hidden="true">{label(slots[active] ?? "")}</p>
    <div class="slots slab">
      {#each slots as id, index (index)}
        <button
          class="slot"
          class:active={index === active}
          class:dropping={index === dropTarget}
          onclick={() => onselect(index)}
          ondragenter={(event) => dragOver(index, event)}
          ondragover={(event) => dragOver(index, event)}
          ondragleave={() => {
            if (dropTarget === index) dropTarget = null;
          }}
          ondrop={(event) => drop(index, event)}
          oncontextmenu={(event) => {
            event.preventDefault();
            onedit?.(index);
          }}
          title={`${isMix(id) ? describeMix(tryParseMix(id)!) : id} — ${t("hotbar.slotHint", { key: String(index + 1) })}`}
          aria-label={label(id)}
          aria-pressed={index === active}
        >
          {#if icons.get(iconOf(id))}
            <img src={icons.get(iconOf(id))} alt="" width="32" height="32" />
          {:else}
            <span class="pending" aria-hidden="true"></span>
          {/if}
          <span class="key pixel" aria-hidden="true">{index + 1}</span>
          {#if isMix(id)}
            <span class="mix pixel" aria-hidden="true">{t("hotbar.mixBadge")}</span>
          {/if}
        </button>
      {/each}

      <!--
        Past the ninth slot, because that is where a tenth would be and there
        is no tenth. `E` opens the same list; this is for the hand that is
        already on the mouse. A raised slab rather than a slot: it holds
        nothing, it opens something.
      -->
      <button
        class="browse"
        onclick={() => onopeninventory?.()}
        title={t("hotbar.browse")}
        aria-label={t("hotbar.browse")}
      >
        <Icon name="browse" size={18} weight={1.7} />
      </button>
    </div>
  </div>
{/if}

<style>
  /*
   * A column -- the name, then the slab -- and only the slab takes the
   * pointer: the room beside the name is the canvas's, and a click there is
   * a click on the build.
   */
  .hotbar {
    position: absolute;
    /* Shared with whatever stacks above it. See `app.css`. */
    bottom: var(--hotbar-inset);
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-overlay);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    max-width: calc(100% - 2 * var(--space-5));
    pointer-events: none;
  }

  /* Over the creative inventory's scrim, which the game draws it inside. */
  .hotbar.raised {
    z-index: var(--z-beside-modal);
  }

  /*
   * Slot-dark in every theme, with the game's white words and their hard
   * shadow: over a sky, a floor or a build, in either theme, it reads.
   */
  .held {
    max-width: 100%;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--slot);
    color: var(--slot-text);
    text-shadow: 1px 1px 0 var(--slot-text-shadow);
    font-size: var(--text-sm);
    line-height: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slots {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    box-shadow: var(--shadow-float);
    pointer-events: auto;
  }

  /* `.inset`'s well, as a button: sunk into the slab, under the pointer too. */
  .slot,
  .slot:hover:not(:disabled),
  .slot:active:not(:disabled) {
    position: relative;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    min-height: 0;
    padding: 0;
    background: var(--slot);
    border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
  }

  /* The game lightens the slot under the pointer rather than outlining it. */
  .slot:hover:not(:disabled)::after {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--slot-text);
    opacity: 0.15;
    pointer-events: none;
  }

  /*
   * The slot in hand, framed. A shadow rather than an outline, because the
   * outline is the keyboard's focus ring and the two have to be told apart;
   * two pixels wide, which is exactly the gap to the next slot.
   */
  .slot.active {
    box-shadow: 0 0 0 var(--bevel) var(--accent);
  }

  .slot.dropping {
    outline: var(--bevel) dashed var(--selection);
    outline-offset: 0;
  }

  img {
    width: 32px;
    height: 32px;
    /* The atlas is 16px art; anything but nearest turns a face into mush. */
    image-rendering: pixelated;
  }

  /* Held open at the icon's size, so a slot does not change when one arrives. */
  .pending {
    width: 32px;
    height: 32px;
    background: var(--bg-raised);
    opacity: 0.35;
  }

  /* Written on the slot the way the game writes a stack's count. */
  .key,
  .mix {
    position: absolute;
    font-size: var(--text-xs);
    line-height: 1;
    pointer-events: none;
  }

  .key {
    top: var(--space-1);
    left: var(--space-1);
    color: var(--slot-text);
    text-shadow: 1px 1px 0 var(--slot-text-shadow);
  }

  /* A slot holding several blocks says so, where the count would be. */
  .mix {
    right: 0;
    bottom: 0;
    padding: var(--space-1);
    background: var(--accent);
    color: var(--accent-contrast);
  }

  .browse {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    min-height: 0;
    margin-left: var(--space-2);
    padding: 0;
    color: var(--text-dim);
  }

  .browse:hover:not(:disabled) {
    color: var(--text);
  }
</style>
