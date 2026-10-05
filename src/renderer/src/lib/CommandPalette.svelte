<script lang="ts" module>
  export interface Command {
    id: string;
    title: string;
    /** Where it lives in the UI, shown beside the title. */
    group: string;
    /** Extra words to match on — what someone might call this instead. */
    keywords?: string;
    /** Shown right-aligned, e.g. "Ctrl+S". */
    shortcut?: string;
    enabled: boolean;
    run: () => void;
  }

  /**
   * Commands matching `query`, best first, with the unavailable ones last.
   *
   * Disabled commands are kept rather than filtered out. "Save" vanishing
   * because nothing is open reads as a missing feature; "Save" greyed out
   * says the app has it and this is not the moment.
   */
  export function searchCommands(commands: readonly Command[], query: string): Command[] {
    const needle = query.trim().toLowerCase();
    const rank = (command: Command): number => {
      if (needle === "") return 0;
      const title = command.title.toLowerCase();
      if (title === needle) return 0;
      if (title.startsWith(needle)) return 1;
      if (title.includes(needle)) return 2;
      const haystack = `${command.group} ${command.keywords ?? ""}`.toLowerCase();
      return haystack.includes(needle) ? 3 : -1;
    };

    return commands
      .map((command) => ({ command, rank: rank(command) }))
      .filter((entry) => entry.rank >= 0)
      .sort(
        (a, b) =>
          // Available first, whatever the text says: offering something that
          // cannot run above something that can wastes the top of the list.
          Number(b.command.enabled) - Number(a.command.enabled) || a.rank - b.rank,
      )
      .map((entry) => entry.command);
  }
</script>

<script lang="ts">
  /**
   * Every action in the app, by name.
   *
   * The commands are built in `App.svelte`, beside the handlers they call, so
   * the palette cannot drift into offering something the buttons no longer do.
   */
  import { t } from "./i18n.svelte.js";

  interface Props {
    open: boolean;
    commands: readonly Command[];
    onclose: () => void;
  }

  const { open, commands, onclose }: Props = $props();

  let query = $state("");
  let highlighted = $state(0);
  let input = $state<HTMLInputElement | null>(null);
  let list = $state<HTMLUListElement | null>(null);

  const matches = $derived(searchCommands(commands, query));

  // Opening starts fresh and takes the keyboard. Without the focus the first
  // thing typed goes to whatever had it before — in Creative mode, the camera.
  $effect(() => {
    if (open) {
      query = "";
      highlighted = 0;
      input?.focus();
    }
  });

  /**
   * Keeps the highlighted row in view.
   *
   * `list === null`, not `=== undefined`: `bind:this` writes **`null`** when the
   * element goes away, and the `<ul>` goes away whenever the query matches
   * nothing. Typed and guarded against `undefined` — which this was — the guard
   * is false at exactly that moment and `.children` throws inside the effect
   * flush, which leaves Svelte's scheduler broken and every effect in the window
   * with it. Ctrl+K and a query that matches nothing was a total freeze.
   *
   * And `list.scrollTop`, not `scrollIntoView`: that method scrolls *every*
   * scrollable ancestor. `BlockPicker` has the long version of why.
   */
  $effect(() => {
    if (!open || list === null) return;
    const row = list.children[highlighted] as HTMLElement | undefined;
    if (row === undefined) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  });

  function choose(command: Command): void {
    if (!command.enabled) return;
    // Closed first: several of these open a dialog of their own, and a palette
    // still sitting over it would take the keys meant for it.
    onclose();
    command.run();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onclose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      highlighted = Math.min(highlighted + 1, matches.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = matches[highlighted];
      if (command) choose(command);
    }
  }
</script>

{#if open}
  <!--
    `keydown` is handled on the wrapper rather than on `window`: while this is
    open it is the only thing that should see the keyboard, and the app's own
    single-key shortcuts must not fire on what is being typed here.
  -->
  <div
    class="scrim"
    role="presentation"
    onkeydown={onKeydown}
    onclick={(event) => {
      // Only a click on the backdrop itself. Comparing target to currentTarget
      // rather than stopping propagation inside the dialog: the dialog is not
      // an interactive element and hanging a click handler on it just to
      // swallow events is what the a11y lint is objecting to.
      if (event.target === event.currentTarget) onclose();
    }}
  >
    <div class="palette modal" role="dialog" aria-modal="true" aria-label={t("palette.label")}>
      <input
        bind:this={input}
        bind:value={query}
        placeholder={t("palette.placeholder")}
        spellcheck="false"
        autocomplete="off"
        oninput={() => (highlighted = 0)}
      />
      {#if matches.length === 0}
        <p class="empty">{t("palette.noMatch", { query })}</p>
      {:else}
        <ul bind:this={list}>
          {#each matches as command, i (command.id)}
            <li>
              <button
                type="button"
                class:highlighted={i === highlighted}
                disabled={!command.enabled}
                onmouseenter={() => (highlighted = i)}
                onclick={() => choose(command)}
              >
                <span class="title">{command.title}</span>
                <span class="group">{command.group}</span>
                {#if command.shortcut}
                  <kbd>{command.shortcut}</kbd>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: var(--scrim);
    display: flex;
    justify-content: center;
    /* Not centred: a dialog that grows and shrinks around the midpoint moves
       the first row while the user is aiming at it. */
    align-items: flex-start;
    padding-top: 12vh;
  }

  /* `.modal` in app.css is the look: a slab over the scrim, like every dialog. */
  .palette {
    width: min(560px, 90vw);
    overflow: hidden;
  }

  /* The search is the game's text box, the full width of the slab. */
  .palette input {
    width: 100%;
    min-height: 0;
    border: none;
    border-bottom: var(--bevel) solid var(--bevel-lo);
    padding: var(--space-4) var(--space-5);
    font-size: var(--text-lg);
  }

  /* The ring inside the slab's edge, where it cannot be clipped. */
  .palette input:focus-visible {
    outline-offset: -2px;
  }

  .palette ul {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    max-height: 46vh;
    overflow-y: auto;
  }

  .palette button {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
    width: 100%;
    min-height: var(--control-h);
    text-align: left;
    padding: var(--space-2) var(--space-4);
    background: none;
    border-color: transparent;
    color: inherit;
    font-size: var(--text-md);
  }

  /* The highlighted row is the one Enter takes: pressed into the slab and lit. */
  .palette button:hover:not(:disabled),
  .palette button.highlighted:not(:disabled) {
    background: none;
  }

  .palette button.highlighted:not(:disabled),
  .palette button.highlighted:hover:not(:disabled) {
    border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
    background: var(--accent-tint);
  }

  .palette button:disabled {
    color: var(--text-dim);
    cursor: default;
  }

  .title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group {
    font-size: var(--text-xs);
    color: var(--text-dim);
  }

  kbd {
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    background: var(--bg-input);
    color: var(--text-dim);
    font: inherit;
    font-family: var(--mono);
    font-size: var(--text-xs);
  }

  .empty {
    margin: 0;
    padding: var(--space-5);
    font-size: var(--text-md);
    color: var(--text-dim);
  }
</style>
