<script lang="ts">
  /**
   * One icon from `icons.ts`, drawn in the colour of the text around it.
   *
   * A block-level SVG of a fixed square, so the box it sits in centres it
   * exactly -- which is the whole of why icons are drawn rather than typed. It
   * is always decorative: the button carrying it has the `aria-label`.
   */
  import { ICONS, type IconName, type IconShape } from "./icons.js";

  interface Props {
    name: IconName;
    /** Edge length in pixels. */
    size?: number;
    /** Stroke width on the 24-unit grid; thinner reads better at small sizes. */
    weight?: number;
  }

  const { name, size = 16, weight = 2 }: Props = $props();

  const shape = $derived<IconShape>(ICONS[name]);
</script>

<svg
  class="icon-svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={weight}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#each shape.rects ?? [] as rect, index (index)}
    <rect
      x={rect.x}
      y={rect.y}
      width={rect.w}
      height={rect.h}
      rx={rect.rx ?? 0}
      stroke-dasharray={rect.dashed ? "3 2.6" : undefined}
    />
  {/each}
  {#each shape.paths ?? [] as d, index (index)}
    <path {d} />
  {/each}
  {#each shape.filled ?? [] as d, index (index)}
    <path {d} fill="currentColor" stroke="none" />
  {/each}
  {#each shape.circles ?? [] as circle, index (index)}
    <circle
      cx={circle.cx}
      cy={circle.cy}
      r={circle.r}
      fill={circle.fill ? "currentColor" : "none"}
      stroke={circle.fill ? "none" : "currentColor"}
    />
  {/each}
</svg>

<style>
  .icon-svg {
    display: block;
    flex: none;
  }
</style>
