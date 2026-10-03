<script lang="ts">
  /**
   * What you can do to the selected region, next to the region.
   *
   * These controls used to live in `DocumentPanel`, in the sidebar, which meant
   * driving a 3D box from a form on the other side of the window. They are the
   * same requests to the same handlers -- nothing about the domain changed --
   * but a fill button an inch from the thing being filled is a different tool
   * from one across the room.
   *
   * Every button is disabled from `selection` and `busy` rather than from
   * anything tracked here. The renderer holds no schematic; there is one copy
   * of the truth and it is in the main process.
   */
  import type { LegacyIndex } from "../../../shared/legacy_ids.js";
  import type { PaletteCount, RegionSpec } from "../../../shared/ipc.js";
  import BlockMixField from "./BlockMixField.svelte";
  import BannerPatternHint from "./BannerPatternHint.svelte";
  import Icon from "./Icon.svelte";
  import MaterialsInventory from "./MaterialsInventory.svelte";
  import { isBannerBlock } from "../../../shared/banner_patterns.js";
  import { splitBlockInput } from "../../../shared/block_input.js";
  import { tryParseMix } from "../../../shared/block_mix.js";
  import { canonicalBlock, withBlockAdded } from "./block_spelling.js";
  import type { MaterialAction } from "./materials.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    /** The active area: the one the readout below describes. */
    selection: RegionSpec | null;
    /**
     * Every selected area in order, the active one among them. Listed only
     * when there are several -- one area is what the readout already says.
     */
    areas?: readonly RegionSpec[];
    /** Which of `areas` is active. */
    activeArea?: number;
    /** Blocks the areas cover together, a block in two of them counted once. */
    cells?: number;
    onactivatearea?: (index: number) => void;
    onremovearea?: (index: number) => void;
    busy: boolean;
    /** The registry to search — the same set the agent is judged against. */
    blocks: readonly string[];
    /** Passed straight to the block fields; see `BlockPicker`. */
    placeable?: ReadonlySet<string> | null;
    /** Passed straight to the block fields; see `BlockPicker`. */
    legacy?: LegacyIndex | null;
    /**
     * The block Fill writes and the one Creative mode places. Owned by the app,
     * because the viewport places it too and the two must not disagree about
     * what "the current block" is.
     */
    block: string;
    onblockchange: (block: string) => void;
    /**
     * What the selection is made of, or the whole schematic with nothing
     * selected; `null` while the first count is on its way.
     *
     * It used to be the whole document's always, beside tools that act on the
     * selection -- so it offered blocks the selection did not hold and gave no
     * count for the ones it did. With nothing selected the whole schematic is
     * still the useful answer: it is how you find the one stray block.
     */
    materials: {
      palette: readonly PaletteCount[];
      air: number;
      outside: number;
      cells: number;
    } | null;
    /**
     * The block Replace looks for.
     *
     * A prop rather than local state because the block list can fill it in too,
     * and a value with two writers cannot live inside one of them.
     */
    replaceFrom: string;
    onreplacefromchange: (block: string) => void;
    /**
     * Open the full block list for one of these two fields.
     *
     * The typing picker stays: it is faster when you know the name. This is for
     * when you do not, which is most of the time — and it is the same list `E`
     * opens, because a second block browser would be the same nine hundred
     * tiles behind a different scrollbar.
     */
    onbrowse: (purpose: "fill" | "replace") => void;
    /** Exchanges the two fields, weights and all. */
    onswap: () => void;
    onfill: (block: string) => void;
    onreplace: (from: string, to: string) => void;
    /**
     * Empties the selection, which is a fill with air.
     *
     * It stays here where Copy and Cut left, because it is the one of that
     * group with no other way in: the rest are on the keyboard and in the
     * palette, and Delete is too, but this is also the only destructive verb a
     * person is likely to look for rather than remember.
     */
    ondelete: () => void;
    onclearselection: () => void;
    onselectall: () => void;
  }

  const {
    selection,
    areas = [],
    activeArea = 0,
    cells = 0,
    onactivatearea,
    onremovearea,
    busy,
    blocks,
    placeable = null,
    legacy = null,
    block,
    onblockchange,
    materials,
    replaceFrom,
    onreplacefromchange,
    onbrowse,
    onswap,
    onfill,
    onreplace,
    ondelete,
    onclearselection,
    onselectall,
  }: Props = $props();

  let withField = $state<ReturnType<typeof BlockMixField> | null>(null);

  /**
   * A slot of the inventory, clicked: `materialAction` decides what the click
   * means, and this is where each meaning lands. The state comes along -- the
   * count on the slot is of exactly that state, and a replace naming it finds
   * exactly those.
   */
  function onMaterial(material: string, action: MaterialAction): void {
    switch (action) {
      case "with":
        onblockchange(canonicalBlock(material, legacy));
        break;
      case "addWith":
        onblockchange(withBlockAdded(block, material, legacy));
        break;
      case "replace":
        onreplacefromchange(canonicalBlock(material, legacy));
        break;
      case "addReplace":
        onreplacefromchange(withBlockAdded(replaceFrom, material, legacy));
        break;
      case "state":
        onblockchange(canonicalBlock(material, legacy));
        withField?.editLast();
        break;
      case "none":
        break;
    }
  }

  const volume = $derived(
    selection === null
      ? 0
      : (selection.maxX - selection.minX + 1) *
          (selection.maxY - selection.minY + 1) *
          (selection.maxZ - selection.minZ + 1),
  );

  const none = $derived(selection === null);

  /*
   * Whether any block in With is a banner, however it was spelled: a bare id,
   * one with a design already in it, or a pasted `/give` command. A half-typed
   * or malformed one is not a banner yet, and the hint waits.
   */
  const holdsBanner = $derived.by(() =>
    (tryParseMix(block)?.entries ?? []).some((entry) => {
      try {
        return isBannerBlock(splitBlockInput(entry.block).block.split("[", 1)[0]);
      } catch {
        return false;
      }
    }),
  );
</script>

<div class="tools">
  {#if selection}
    <p class="readout">
      {t("selection.size", {
        width: selection.maxX - selection.minX + 1,
        height: selection.maxY - selection.minY + 1,
        length: selection.maxZ - selection.minZ + 1,
      })}
    </p>
    <p class="coords">
      {t("selection.range", {
        minX: selection.minX,
        minY: selection.minY,
        minZ: selection.minZ,
        maxX: selection.maxX,
        maxY: selection.maxY,
        maxZ: selection.maxZ,
        volume: volume.toLocaleString(),
      })}
    </p>
    {#if areas.length > 1}
      <!--
        The areas, in a fixed order: activating one leaves it where it is in
        the list, so the numbers mean the same boxes from one click to the next.
      -->
      <p class="coords">{t("selection.areas", { count: areas.length, cells: cells.toLocaleString() })}</p>
      <ul class="areas">
        {#each areas as area, index (index)}
          <li class:active={index === activeArea}>
            <button
              type="button"
              class="area"
              onclick={() => onactivatearea?.(index)}
              aria-pressed={index === activeArea}
              title={t("selection.areaActivate")}
            >
              {t("selection.area", { n: index + 1 })}
              <span class="dim">
                {t("selection.size", {
                  width: area.maxX - area.minX + 1,
                  height: area.maxY - area.minY + 1,
                  length: area.maxZ - area.minZ + 1,
                })}
              </span>
            </button>
            <button
              type="button"
              class="remove"
              onclick={() => onremovearea?.(index)}
              title={t("selection.areaRemove")}
              aria-label={t("selection.areaRemove")}
            >
              <Icon name="close" size={10} weight={2.6} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="hint">{t("selection.areasHint")}</p>
  {:else}
    <p class="hint">{t("selection.hint")}</p>
  {/if}

  {#if materials !== null && (materials.palette.length > 0 || materials.air > 0 || materials.outside > 0)}
    <div class="group">
      <span class="heading">{selection ? t("materials.ofSelection") : t("materials.ofDocument")}</span>
      <MaterialsInventory
        palette={materials.palette}
        air={materials.air}
        outside={materials.outside}
        cells={materials.cells}
        scope={selection ? "selection" : "document"}
        {legacy}
        onaction={onMaterial}
      />
    </div>
  {/if}

  <!--
    Replace first, then With, so the panel reads top to bottom the way the
    sentence does: replace these with those. It used to read the other way --
    "Block", then "Replace" with a button saying "Replace with the block
    above" -- which made the field nearest the button the one it did *not*
    write.

    With is also what Fill writes and what the hand places, because it is the
    active hotbar slot: one answer to "what am I holding".
  -->
  <div class="group">
    <label for="tool-from-block">{t("selection.replace")}</label>
    <BlockMixField
      id="tool-from-block"
      value={replaceFrom}
      weights={false}
      placeholder="minecraft:cobblestone"
      {blocks}
      {placeable}
      {legacy}
      onchange={onreplacefromchange}
      onbrowse={() => onbrowse("replace")}
    />
  </div>

  <div class="swap-row">
    <button
      class="swap"
      type="button"
      onclick={onswap}
      disabled={replaceFrom.trim() === "" && block.trim() === ""}
      title={t("selection.swap")}
      aria-label={t("selection.swap")}
    >
      <Icon name="swapVertical" size={14} weight={1.8} />
    </button>
  </div>

  <div class="group">
    <label for="tool-to-block">{t("selection.with")}</label>
    <BlockMixField
      bind:this={withField}
      id="tool-to-block"
      value={block}
      placeholder="minecraft:stone"
      {blocks}
      {placeable}
      {legacy}
      onchange={onblockchange}
      onbrowse={() => onbrowse("fill")}
    />
    {#if holdsBanner}
      <BannerPatternHint where="place" />
    {/if}
  </div>

  <div class="row">
    <button
      class="primary"
      onclick={() => onfill(block)}
      disabled={busy || none || block.trim() === ""}
      title={none ? t("selection.selectFirst") : t("selection.fillHint")}
    >
      {t("selection.fill")}
    </button>
    <button
      onclick={() => onreplace(replaceFrom, block)}
      disabled={busy || none || replaceFrom.trim() === "" || block.trim() === ""}
      title={none ? t("selection.selectFirst") : t("selection.replaceHint")}
    >
      {t("selection.replaceButton")}
    </button>
  </div>

  <!--
    Cut, copy, paste, move, turn and mirror used to be nine buttons here.

    They are handles on the gizmo in the viewport now, which is where the
    thing they act on actually is -- a button that turns a region you are
    looking at somewhere else is a worse version of grabbing it. What stays
    is what has no handle to hang on: the block operations, and the three
    that are about the selection rather than about its contents.

    The keyboard kept all of them: Ctrl+C, Ctrl+X, Ctrl+V and Delete are in
    `App.svelte`, and the command palette lists the rest.
  -->
  <div class="row">
    <button onclick={onselectall} disabled={busy}>{t("selection.all")}</button>
    <button onclick={onclearselection} disabled={busy || none} title={t("selection.clearHint")}>
      {t("selection.clear")}
    </button>
    <button
      class="danger"
      onclick={ondelete}
      disabled={busy || none}
      title={t("selection.deleteHint")}
    >
      {t("selection.delete")}
    </button>
  </div>
</div>

<style>
  .tools {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
  }

  .readout {
    margin: 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .coords {
    margin: -4px 0 0;
    font-size: 11px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .areas {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .areas li {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .areas li.active {
    border-color: var(--selection);
  }

  .areas button {
    border: 0;
    border-radius: 0;
    padding: 2px 6px;
    font-size: 11px;
    background: transparent;
  }

  .areas li.active .area {
    font-weight: 600;
  }

  .areas .dim {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .areas .remove {
    display: grid;
    place-items: center;
    width: 20px;
    padding: 0;
    color: var(--text-dim);
  }

  .group label {
    margin: 0;
  }

  .row {
    display: flex;
    gap: 5px;
  }

  .row button {
    flex: 1;
    min-width: 0;
    padding: 5px 6px;
    font-size: 12px;
  }

  /* The one button here that destroys blocks rather than moving or copying
     them, coloured like the risk it carries. */
  .danger {
    border-color: var(--danger);
    color: var(--danger);
  }

  .swap-row {
    display: flex;
    justify-content: center;
    margin: -4px 0;
  }

  .swap {
    display: grid;
    place-items: center;
    width: 32px;
    height: 22px;
    padding: 0;
  }

  .tools :global(.hint) {
    margin: 0;
  }

  .heading {
    font-weight: 600;
  }
</style>
