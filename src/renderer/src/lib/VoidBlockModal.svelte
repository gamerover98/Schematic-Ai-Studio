<script lang="ts">
  /**
   * What empty space is made of.
   *
   * A schematic has always been full of air, and for an underwater build that
   * is wrong in a way that only shows up after the paste: breaking a block
   * leaves a bubble, because the file says the cell is empty and the game
   * believes it.
   *
   * Choosing a block here does three things, and they are three mechanisms
   * rather than three settings:
   *
   * - it is **written** when a block is broken, so the file is right;
   * - it is **drawn** over every empty cell at the opacity below, so the space
   *     is visible as space;
   * - it is **ignored by the pointer**, so a click reaches whatever is behind
   *     it -- which is the only thing that makes editing inside it bearable.
   *
   * The last of those has a consequence worth reading before it is met: with
   * water chosen, water placed by hand is unpickable too. There is no way to
   * have both, and this is the half that was asked for.
   *
   * **The choice belongs to the schematic, not to the app.** It used to be a
   * global setting, which meant it followed you from an underwater build to
   * a cathedral quietly changing what a break wrote into the file. It is now
   * remembered per path, beside the version and the container.
   */
  import type { LegacyIndex } from "../../../shared/legacy_ids.js";
  import { VOID_OPACITY, voidSources } from "../../../shared/settings.js";
  import BlockPicker from "./BlockPicker.svelte";
  import { t } from "./i18n.svelte.js";
  import Modal from "./Modal.svelte";
  import { blockLabel } from "./inventory.js";

  interface Props {
    open: boolean;
    /** The chosen block, or `""` for air. */
    block: string;
    opacity: number;
    busy: boolean;
    /** Every id the app can place; the picker searches it. */
    blocks: readonly string[];
    /** What this schematic can hold; see `BlockPicker`. */
    placeable?: ReadonlySet<string> | null;
    /** Passed straight to the block fields; see `BlockPicker`. */
    legacy?: LegacyIndex | null;
    /** A failure from main, shown here: the app banner is behind the scrim. */
    error: string;
    /**
     * What empty space was made of before the current pick.
     *
     * Owned by the parent, for `VersionModal`'s `needsConfirmation` reason:
     * only the parent sees whether a conversion actually landed. Picking a
     * block takes effect at once, so by the time the button is pressed the
     * document's own value is the *new* one and this is the only thing still
     * holding the old one.
     *
     * It says what to convert **from**, and deliberately nothing about whether
     * there is anything to convert -- see `present`.
     */
    converted: string;
    /**
     * Every block the document actually contains.
     *
     * This decides whether the button is live, and a *belief* could not: a
     * schematic whose empty space is set to barrier with its cells still air
     * looks identical, from the setting, to one where the conversion already
     * happened. Both say barrier; only one has anything to do. Deciding from
     * the setting disabled the button in both, so the one gesture that would
     * have fixed it was the one with no answer.
     */
    present: ReadonlySet<string>;
    /** Choose what empty space is. Takes effect at once; moves no block. */
    onblock: (block: string) => void;
    /**
     * Rewrite the cells that hold `from` so they hold `to`. One transaction.
     *
     * A press of its own rather than a checkbox carried along with the choice.
     * The checkbox was read at the moment the block changed, so ticking it
     * after picking water did nothing, and re-picking water to make it fire
     * was refused as choosing what was already chosen -- the one gesture
     * anybody would try was the one with no answer.
     */
    onreplace: (from: string, to: string) => void;
    onopacity: (opacity: number) => void;
    onclose: () => void;
  }

  const {
    open,
    block,
    opacity,
    busy,
    blocks,
    placeable = null,
    legacy = null,
    error,
    converted,
    present,
    onblock,
    onreplace,
    onopacity,
    onclose,
  }: Props = $props();

  /**
   * The blocks worth offering, and why they are a list rather than the whole
   * inventory.
   *
   * Every one of them is something a builder means by "the space is not empty":
   * a medium you are inside (water, lava), or a marker for a volume nobody may
   * enter (barrier, structure void). The picker below still accepts anything --
   * this is a shortcut, not a restriction, because a rule about which blocks
   * make sense as a medium is one this app would get wrong.
   */
  const SUGGESTED = [
    "",
    "minecraft:water",
    "minecraft:lava",
    "minecraft:barrier",
    "minecraft:structure_void",
  ] as const;

  /*
   * Cut to what this schematic can hold. `structure_void` arrived in 1.10 and
   * `barrier` in 1.8, so a legacy document can be offered some of these and
   * not others -- and a preset that is refused the moment it is clicked is
   * worse than one that is not there.
   */
  const offered = $derived(
    SUGGESTED.filter(
      (candidate) => candidate === "" || placeable === null || placeable.has(candidate),
    ),
  );

  /**
   * A block as a person reads it -- `Structure void`, not `structure_void` --
   * beside `Air`, which used to be the only one of the five with a name.
   * `""` is air, which has no id to show.
   */
  const readable = (id: string): string => (id === "" ? t("void.air") : blockLabel(id));

  /*
   * What a press converts *from*, from the same function main converts with.
   * Two copies of that rule is how the button comes to be live over an edit
   * that changes nothing, or dead over one that would work.
   */
  const sources = $derived(voidSources(converted, block));

  /*
   * Dead only when the document holds none of them -- observed, not inferred.
   * The setting cannot tell the two identical-looking states apart; the
   * palette can, because one of them has air in it and the other does not.
   */
  const nothingToDo = $derived(!sources.some((id) => present.has(id)));

  /*
   * What is typed in the field, until a block is picked from the list or
   * Enter takes it. The field used to choose on every keystroke, so typing
   * "stone" made the empty space `s`, then `st`, then `sto` -- each a request
   * to main, and each a block that does not exist.
   */
  let typed = $state<string | null>(null);
  $effect(() => {
    void block;
    if (!open) typed = null;
  });
</script>

<Modal {open} title={t("void.title")} {onclose} width={460}>
  <p class="hint lead">{t("void.hint")}</p>

  <div class="presets segmented" role="group" aria-label={t("void.presets")}>
    {#each offered as candidate (candidate)}
      <button
        aria-pressed={block === candidate}
        disabled={busy}
        title={candidate === "" ? "minecraft:air" : candidate}
        onclick={() => onblock(candidate)}
      >
        {readable(candidate)}
      </button>
    {/each}
  </div>

  <label class="field">
    <span>{t("void.block")}</span>
    <BlockPicker
      value={typed ?? block}
      placeholder="minecraft:air"
      {blocks}
      {placeable}
      {legacy}
      onchange={(next) => (typed = next)}
      onpick={(next) => {
        typed = null;
        onblock(next);
      }}
    />
  </label>

  <!--
    Disabled with air chosen rather than hidden: it is the same control
    either way, and a slider that comes and goes reads as a bug in the
    panel. There is simply nothing for it to make see-through.
  -->
  <label class="field" class:inert={block === ""}>
    <span>{t("void.opacity", { percent: Math.round(opacity * 100) })}</span>
    <input
      type="range"
      min={VOID_OPACITY.min}
      max={VOID_OPACITY.max}
      step="0.05"
      value={opacity}
      disabled={busy || block === ""}
      oninput={(event) => onopacity(Number(event.currentTarget.value))}
    />
  </label>

  <!--
    The rewrite, on a press of its own.

    It converts the cells that hold the *previous* answer -- the air a
    schematic has always been full of, or whatever was chosen before. One
    transaction, so it is one Ctrl+Z.

    It was a checkbox carried along with the choice, and that could not
    work: it was read at the moment the block changed, so ticking it after
    picking water did nothing, and re-picking water to make it fire was
    refused as choosing what was already chosen. Two acts that happen at
    different moments need two controls.
  -->
  <fieldset class="rewrite">
    <legend>{t("void.convertLegend")}</legend>
    <!--
      With air chosen over air there is no source at all: air is what every
      schematic starts with and the target is never its own source. Joining
      an empty list put "holds ." on screen, so that case has its own words.
    -->
    <p class="hint what">
      {sources.length === 0
        ? t("void.replaceAir")
        : nothingToDo
        ? t("void.replaceNone", { from: sources.map(readable).join(", ") })
        : t("void.replaceWhat", {
            from: sources.map(readable).join(", "),
            to: readable(block),
          })}
    </p>
    <!-- The one control here that changes the document, so it is the one that looks like it. -->
    <button class="primary" disabled={busy || nothingToDo} onclick={() => onreplace(converted, block)}>
      {t("void.replaceApply")}
    </button>
  </fieldset>

  {#if error}
    <p class="callout bad" role="alert">{error}</p>
  {/if}

  <p class="hint">{t("void.pickNote")}</p>

  {#snippet footer()}
    <button onclick={onclose}>{t("common.close")}</button>
  {/snippet}
</Modal>

<style>
  .lead {
    margin: 0 0 var(--space-4);
    line-height: 1.5;
  }

  /* Five words in a 460px dialog: the row wraps rather than cutting
     "Structure void" short. */
  .presets {
    flex-wrap: wrap;
    margin-bottom: var(--space-4);
  }

  .field {
    margin-bottom: var(--space-4);
  }

  .field > span {
    display: block;
    margin-bottom: var(--space-2);
  }

  .inert {
    opacity: 0.5;
  }

  .rewrite {
    margin-bottom: var(--space-4);
  }

  .what {
    margin: 0 0 var(--space-3);
    line-height: 1.5;
  }

  .rewrite button {
    width: 100%;
  }

  .callout {
    margin-bottom: var(--space-4);
  }
</style>
