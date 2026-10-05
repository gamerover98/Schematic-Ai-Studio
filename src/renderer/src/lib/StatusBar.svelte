<script lang="ts">
  /**
   * The status bar: what is selected, what the schematic is, and whether
   * anything outside the window can change it.
   *
   * The facts used to ride beside the file name in the application bar --
   * size, block count, container and version on one line that a narrow window
   * cut off first -- and the selection's size was only in the tool window,
   * which was only there with a selection. Here they are always on screen and
   * never on top of anything: the bar is a row of the window's grid, not an
   * overlay of the viewport.
   *
   * Readings, not controls. The one thing in it you can press is the MCP
   * state, because a status light with no way to act on what it reports is a
   * half-feature (see `McpIndicator`).
   *
   * And on the right, what the buttons do in the camera you are in, as a 3D
   * editor's status bar says it. It was a plate in the viewport's corner, and
   * every notification the app raised landed on top of it. It is the reading
   * that gives way first when the window runs out of room.
   */
  import type { DocumentState, McpStatus } from "../../../shared/ipc.js";
  import type { Box } from "../../../shared/regions.js";
  import { SCHEMATIC_FORMAT_LABEL } from "../../../shared/schematic.js";
  import { mcVersion, versionNameOf } from "../../../shared/mc_versions.js";
  import McpIndicator from "./McpIndicator.svelte";
  import { t, tn } from "./i18n.svelte.js";

  interface Props {
    /** `doc`, not `state`: a prop of that name breaks every rune in the file. */
    doc: DocumentState | null;
    /** The active area, or nothing selected. */
    selection: Box | null;
    /** How many areas are selected, the active one among them. */
    areas: number;
    /** Blocks the areas cover together, a block in two of them counted once. */
    cells: number;
    /** Whether to show the MCP state at all: `showsIndicator`. */
    mcp: boolean;
    mcpStatus: McpStatus | null;
    onmcp: () => void;
    /** What the mouse and the keys do in the viewport now, or nothing. */
    hint?: string | null;
  }

  const { doc, selection, areas, cells, mcp, mcpStatus, onmcp, hint = null }: Props = $props();

  const size = (box: Box): string =>
    `${box.maxX - box.minX + 1}×${box.maxY - box.minY + 1}×${box.maxZ - box.minZ + 1}`;

  const selected = $derived(
    selection === null
      ? t("statusbar.nothingSelected")
      : areas > 1
        ? t("statusbar.areas", { count: areas, blocks: tn("count.blocks", cells) })
        : t("statusbar.selection", { size: size(selection), blocks: tn("count.blocks", cells) }),
  );

  /** Nothing rather than a guess: an MCEdit file legitimately has no version tag. */
  const container = $derived.by(() => {
    if (doc === null) return "";
    const version = mcVersion(versionNameOf(doc.dataVersion) ?? "")?.label ?? null;
    return [SCHEMATIC_FORMAT_LABEL[doc.format], version].filter((part) => part !== null).join(" · ");
  });
</script>

<footer class="status-bar">
  {#if doc !== null}
    <span class="item" title={t("statusbar.selectionHint")}>{selected}</span>
    <span class="item">
      {doc.size[0]}×{doc.size[1]}×{doc.size[2]} · {tn("count.blocks", doc.blockCount)}
    </span>
    <span class="item">{container}</span>
  {:else}
    <span class="item">{t("doc.nothingOpen")}</span>
  {/if}
  <span class="push"></span>
  {#if hint !== null}
    <span class="item keys" title={hint}>{hint}</span>
  {/if}
  {#if mcp}
    <McpIndicator status={mcpStatus} onopen={onmcp} />
  {/if}
</footer>

<style>
  .status-bar {
    display: flex;
    align-items: stretch;
    min-width: 0;
    padding: 0 var(--space-2);
    border-top: var(--bevel) solid var(--bevel-hi);
    background: var(--bg-panel);
    color: var(--text-dim);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* Each reading keeps its own width until the window runs out, then the
     later ones give way first: the selection is the one that moves. */
  .item {
    display: block;
    align-self: center;
    min-width: 0;
    padding: 0 var(--space-3);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item + .item {
    border-left: 1px solid var(--border);
  }

  .item:first-child {
    flex: 0 0 auto;
    color: var(--text);
  }

  .push {
    flex: 1;
  }

  /* Long, and the least of the readings: it shrinks before the others do. */
  .keys {
    flex: 0 1000 auto;
  }
</style>
