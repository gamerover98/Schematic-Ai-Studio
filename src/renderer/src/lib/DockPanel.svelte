<script lang="ts" module>
  export type DockTab = "selection" | "inspector" | "terrain";
</script>

<script lang="ts">
  /**
   * The left-hand panel: the selection's tools, the inspector and the terrain,
   * as three tabs docked to the window's edge.
   *
   * They were floating windows over the viewport -- two of them, each with its
   * own position and size on disk -- and the UX audit counted what that cost:
   * they opened on top of the build they act on, on top of each other, and on
   * top of the HUD, and a window hidden behind the other was a window found by
   * dragging. Chosen by the user from the audit's three directions: the tools
   * dock to the edges, and only the windows that are settings (the creative
   * options, the modals) float.
   *
   * A docked panel is always there while a document is open, so it says what
   * to do when there is nothing to act on rather than disappearing; a panel
   * that comes and goes with the selection moves the viewport under the
   * pointer every time somebody clicks.
   *
   * Tabs in the ARIA sense: a `tablist` of `tab`s with the arrows moving
   * between them and one `tabpanel`. The content is the parent's, passed as
   * snippets, because each tab is a component with thirty props that belong
   * to `App.svelte` and threading them through here would be a second copy of
   * every one.
   */
  import type { Snippet } from "svelte";
  import { t } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";

  interface Props {
    tab: DockTab;
    ontab: (tab: DockTab) => void;
    oncollapse: () => void;
    /*
     * `...Tab`, not the tab's own name: a snippet declared in the parent's
     * markup binds its name there, and one called `selection` would shadow
     * the selection every prop inside it is passed.
     */
    selectionTab: Snippet;
    inspectorTab: Snippet;
    terrainTab: Snippet;
  }

  const { tab, ontab, oncollapse, selectionTab, inspectorTab, terrainTab }: Props = $props();

  const TABS: readonly DockTab[] = ["selection", "inspector", "terrain"];

  let strip = $state<HTMLDivElement | null>(null);

  function onTabKey(event: KeyboardEvent): void {
    const at = TABS.indexOf(tab);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (at + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (at - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    ontab(TABS[next]);
    strip?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  }
</script>

<aside class="dock" aria-label={t("dock.label")}>
  <div class="panel-head">
    <div class="tabs" role="tablist" aria-label={t("dock.label")} bind:this={strip}>
      {#each TABS as id (id)}
        <button
          class="panel-tab"
          role="tab"
          id={`dock-tab-${id}`}
          aria-selected={tab === id}
          aria-controls="dock-panel"
          tabindex={tab === id ? 0 : -1}
          onclick={() => ontab(id)}
          onkeydown={onTabKey}
        >
          {t(`dock.tab.${id}`)}
        </button>
      {/each}
    </div>
    <button
      class="icon"
      onclick={oncollapse}
      title={t("dock.hide")}
      aria-label={t("dock.hide")}><Icon name="chevronLeft" /></button
    >
  </div>

  <div class="body" id="dock-panel" role="tabpanel" aria-labelledby={`dock-tab-${tab}`}>
    {#if tab === "selection"}
      {@render selectionTab()}
    {:else if tab === "inspector"}
      {@render inspectorTab()}
    {:else}
      {@render terrainTab()}
    {/if}
  </div>
</aside>

<style>
  .dock {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    background: var(--bg-panel);
    border-right: var(--bevel) solid var(--bevel-lo);
  }

  /* The strip and its tabs are app.css's `.panel-head` and `.panel-tab`, which
     the chat wears too. */
  .tabs {
    display: flex;
    flex: 1;
    min-width: 0;
    gap: var(--space-1);
  }

  .body {
    min-height: 0;
    padding: var(--space-4);
    overflow-y: auto;
  }
</style>
