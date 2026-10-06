<script lang="ts">
  /**
   * The creative tools, over the hotbar, in flight.
   *
   * Only in flight, because only there is the right button a tool: in orbit
   * it turns the camera. Clickable while the pointer is free -- Escape, as
   * ever, is how to get a cursor -- and read-only while it is locked, when B
   * and the bracket keys are how it changes. Its line under the buttons says
   * what the tool will do, and after a first corner, where that corner is and
   * how to let go of it.
   *
   * The keys are heard here rather than in `App.svelte`'s `onWindowKey`, for
   * the hotbar's reason: that function gives every Ctrl chord to the camera
   * while flying, and B is a key somebody presses while sprinting.
   * `creativeKey` holds the rule.
   */
  import { CREATIVE_TOOLS, type CreativeSettings, type CreativeTool } from "../../../shared/creative.js";
  import { creativeKey, takesCorners, type Cell } from "./creative_tools.js";
  import { t } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons.js";
  import { isTyping } from "./typing.js";

  interface Props {
    settings: CreativeSettings;
    /** The first corner of a shape or a wall, until the second is clicked. */
    corner: Cell | null;
    /** The pointer is locked: the view is flying and the bar cannot be clicked. */
    flying: boolean;
    /** Whether the keys are the bar's: not with a modal or a menu over the view. */
    keys: boolean;
    optionsOpen: boolean;
    ontool: (tool: CreativeTool) => void;
    oncycle: () => void;
    onresize: (by: number) => void;
    onoptions: () => void;
  }

  const { settings, corner, flying, keys, optionsOpen, ontool, oncycle, onresize, onoptions }: Props = $props();

  const ICONS: Record<CreativeTool, IconName> = {
    place: "block",
    brush: "brush",
    shape: "shape",
    walls: "walls",
    terrain: "terrain",
    smooth: "smooth",
    erode: "erode",
  };

  /** What the tool in hand will do, in a few words. */
  const summary = $derived.by(() => {
    switch (settings.tool) {
      case "place":
        return t("creative.summary.place");
      case "brush":
        return t("creative.summary.brush", {
          shape: t(`creative.brushShape.${settings.brush.shape}`),
          radius: settings.brush.radius,
        });
      case "shape":
        return t(settings.shape.hollow ? "creative.summary.hollowShape" : "creative.summary.shape", {
          shape: t(`creative.shapeKind.${settings.shape.kind}`),
          height: settings.shape.height,
        });
      case "walls":
        return t("creative.summary.walls", {
          height: settings.walls.height,
          thickness: settings.walls.thickness,
        });
      case "terrain":
        return t("creative.summary.terrain", {
          mode: t(`terrain.mode.${settings.terrain.mode}`),
          footprint: t(`terrain.footprint.${settings.terrain.footprint}`),
          radius: settings.terrain.radius,
        });
      case "smooth":
        return t("creative.summary.smooth", {
          footprint: t(`terrain.footprint.${settings.smooth.footprint}`),
          radius: settings.smooth.radius,
          passes: settings.smooth.iterations,
        });
      case "erode":
        return t("creative.summary.erode", {
          preset: t(`erode.preset.${settings.erode.preset}`),
          radius: settings.erode.radius,
        });
    }
  });

  /** What to do next: the gesture the tool waits for. */
  const hint = $derived.by(() => {
    if (!flying) return t("creative.hint.paused");
    if (corner !== null) return t("creative.hint.secondCorner", { x: corner.x, y: corner.y, z: corner.z });
    if (takesCorners(settings.tool)) return t("creative.hint.firstCorner");
    if (settings.tool === "brush") return t("creative.hint.brush");
    if (settings.tool === "terrain") return t("creative.hint.terrain");
    if (settings.tool === "smooth") return t("creative.hint.smooth");
    if (settings.tool === "erode") return t("creative.hint.erode");
    return t("creative.hint.place");
  });

  $effect(() => {
    if (!keys) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const key = creativeKey(event, document.pointerLockElement !== null);
      if (key === null) return;
      event.preventDefault();
      if (key === "cycle") oncycle();
      else onresize(key === "bigger" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>

<div class="creative-bar slab" class:locked={flying} role="toolbar" aria-label={t("creative.legend")}>
  <div class="tools">
    <!-- One tool in hand, so `.segmented`: the gizmo bar's modes, in flight. -->
    <div class="segmented">
      {#each CREATIVE_TOOLS as tool (tool)}
        <button
          class:active={settings.tool === tool}
          onclick={() => ontool(tool)}
          aria-pressed={settings.tool === tool}
          title={`${t(`creative.tool.${tool}`)} — ${t(`creative.toolHint.${tool}`)}`}
        >
          <Icon name={ICONS[tool]} />
          <span>{t(`creative.tool.${tool}`)}</span>
        </button>
      {/each}
    </div>
    <button
      class="icon options"
      class:active={optionsOpen}
      onclick={onoptions}
      disabled={settings.tool === "place"}
      aria-pressed={optionsOpen}
      aria-label={t("creative.options")}
      title={t("creative.options")}
    >
      <Icon name="gear" />
    </button>
  </div>
  <div class="line">
    <strong>{summary}</strong>
    <span class="hint" class:pending={corner !== null}>{hint}</span>
  </div>
</div>

<style>
  /* A slab over the scene, clear of the hotbar from the tokens that describe
     it -- the gizmo bar's place, which it never shares: that one is orbit's
     and this is flight's. */
  .creative-bar {
    position: absolute;
    bottom: calc(var(--hotbar-inset) + var(--hotbar-height) + var(--space-3));
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-overlay);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    max-width: calc(100% - 2 * var(--space-5));
    padding: var(--space-1) var(--space-2) var(--space-2);
    box-shadow: var(--shadow-float);
  }

  /* Nothing can be pressed while the pointer is locked; saying so is the honest look. */
  .creative-bar.locked .tools {
    pointer-events: none;
  }

  .tools {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    max-width: 100%;
  }

  .segmented {
    min-width: 0;
  }

  .segmented > button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* A flex item cuts its own text: the ellipsis on the button reaches no further. */
  .segmented > button > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Pressed and lit while its window is out, as a toggle should say. */
  .options.active,
  .options.active:hover:not(:disabled) {
    border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
    background: var(--accent);
    color: var(--accent-contrast);
  }

  .line {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    max-width: 100%;
    font-size: var(--text-xs);
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .line strong {
    color: var(--text);
    font-weight: 700;
  }

  .hint {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A first corner is waiting: the one line that asks for something, in the
     gold of what glows. */
  .hint.pending {
    color: var(--warn);
  }
</style>
