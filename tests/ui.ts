/**
 * The renderer's pure modules.
 *
 * Svelte components cannot be exercised here -- there is no component runner in
 * this project, and adding one would be a bigger decision than any single
 * feature warrants. So the parts of the renderer worth testing are deliberately
 * written *outside* the components: `i18n_core.ts` holds the lookup and
 * interpolation while `i18n.svelte.ts` holds only the rune, and that split is
 * what makes this file possible.
 *
 * The centrepiece is not the interpolation tests -- those are arithmetic. It is
 * `every key used by the renderer exists`, which walks the actual source and
 * resolves every `t(...)`/`tn(...)` against the catalogue. A missing message
 * degrades to the key itself, which is visible but not loud, and would
 * otherwise reach a user before it reached anyone else.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  clampPanelSize,
  clampToBounds,
  isWithinBounds,
  placePopover,
} from "../src/renderer/src/lib/floating.js";
import { mapFrameOf } from "../src/renderer/src/lib/map_frame.js";
import {
  AA_LEVELS,
  blocksInDocument,
  OPTIONS_PANEL_MIN_WIDTH,
  PANEL_SIZE,
  SHADER_MODES,
  FPS_CAPS,
  voidSources,
} from "../src/shared/settings.js";
import { animationsUsed } from "../src/renderer/src/lib/atlas_animation.js";
import { coalesce } from "../src/renderer/src/lib/coalesce.js";
import {
  FrameProfiler,
  OUTSIDE,
  PAUSE_MS,
  culpritOf,
  isSpike,
  median,
  readingOf,
  type LongFrame,
} from "../src/renderer/src/lib/frame_profiler.js";
import {
  antialiasSamples,
  fpsCap,
  webglPowerPreference,
  frameDue,
  shaderPreset,
} from "../src/renderer/src/lib/shader_modes.js";
import { choiceValue, formatMemory, gpuNeedsRestart, parseChoiceValue, pixelLoad } from "../src/renderer/src/lib/gpu_choice.js";
import { counterIdle, SETTLE_MS, shouldDraw, ViewWatch } from "../src/renderer/src/lib/render_demand.js";
import * as THREE from "three";
import {
  allowed,
  BAYER_4X4,
  chunkTarget,
  FADE_MS,
  keepsPixel,
  LodSelector,
  nearestDepth,
  packKey,
  regionOfChunk,
  regionTarget,
  unpackKey,
  worldPerPixel,
  type LodBox,
  type LodDraw,
  type LodRegion,
  type LodView,
} from "../src/renderer/src/lib/lod.js";
import { chunkCoords, chunkKey } from "../src/main/pipeline/chunked_mesh.js";
import {
  continuedPlacement,
  entryFace,
  rayBox,
  thinBoxes,
  facingNormal,
  hasDominantAxis,
  hoverSource,
  outlineCentre,
  pointerOnHandle,
} from "../src/renderer/src/lib/block_hover.js";
import {
  blockLabel,
  gridWindow,
  inventoryBlocks,
  OVERSCAN_ROWS,
} from "../src/renderer/src/lib/inventory.js";
import { blocksIn, versionRangeOf, versionTableFloor } from "../src/shared/block_versions.js";
import { versionNameOf } from "../src/shared/mc_versions.js";
import { buildLegacyIndex } from "../src/shared/legacy_ids.js";
import {
  emptyTimeline,
  recordDocumentEdit,
  recordEditSelection,
  recordSelection,
  redoTarget,
  takeEditRedo,
  takeEditUndo,
  takeRedo,
  takeUndo,
  undoTarget,
  type SelectionState,
} from "../src/renderer/src/lib/selection_history.js";
import {
  cellFade,
  cellUnderRay,
  isInsideBox,
  cellRegion,
  placementNeeds,
  regionBetween,
  visibleCells,
  MAX_GRID_REACH,
} from "../src/renderer/src/lib/build_grid.js";
import {
  clickIntent,
  dragFace,
  moveDestination,
  movedRegion,
  translatedRegion,
  dragPlaneNormal,
  faceCentre,
  intersectPlane,
  plateScale,
  type Ray,
} from "../src/renderer/src/lib/selection_drag.js";
import {
  defaultPivot,
  dragAlongAxis,
  gizmoOrigin,
  quartersBetween,
  regionCentre,
  regionFits,
  ringAngleAt,
  scaleFromRatio,
  scaledRegion,
  transformedRegion,
} from "../src/renderer/src/lib/gizmo.js";
import {
  ghostRequests,
  ghostStillWanted,
  grabGhost,
  releaseGhost,
} from "../src/renderer/src/lib/ghost_request.js";
import {
  activated,
  activeIndex,
  areaAt,
  areaBounds,
  areaCells,
  areaList,
  mapAreas,
  NO_AREAS,
  single,
  withArea,
  withoutArea,
} from "../src/renderer/src/lib/selection_set.js";
import { MAX_BOXES } from "../src/shared/regions.js";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

import { toSafeHtml } from "../src/renderer/src/lib/markdown.js";
import { isSafeHref } from "../src/renderer/src/lib/markdown_policy.js";
import { HOSTILE_CASES } from "./markdown_cases.js";
import { missingKeys, translate, translatePlural } from "../src/renderer/src/lib/i18n_core.js";
import { openedAge } from "../src/renderer/src/lib/recent_age.js";
import { DEFAULT_PREVIEW_SETTINGS, PREVIEW_SETTING_RANGES } from "../src/shared/settings.js";
import {
  COPLANAR_OFFSET,
  depthEpsilon,
  GRID_SIZE,
  orthoDepthEpsilon,
} from "../src/renderer/src/lib/depth.js";
import {
  documentFraming,
  GRID_CELL,
  gridCentre,
  ORBIT_FOV,
  orthoBounds,
  orthoFrustumHeight,
  pivotDepth,
  zoomAfterPivot,
} from "../src/renderer/src/lib/framing.js";
import {
  dotColor,
  dotFor,
  maskToken,
  showsIndicator,
} from "../src/renderer/src/lib/mcp_status.js";
import { bridgeCommand, connectCommand } from "../src/shared/mcp.js";
import type { PaletteCount, McpStatus } from "../src/shared/ipc.js";
import { normalizeTicks, skyAt, skyDistance } from "../src/renderer/src/lib/sky.js";
import { fitShadow } from "../src/renderer/src/lib/shadow_fit.js";
import { anchorKey, mirrorAnchor } from "../src/renderer/src/lib/anchor_draft.js";
import {
  isSpuriousLook,
  LOCK_SETTLE_MS,
  MAX_LOOK_STEP,
} from "../src/renderer/src/lib/look_filter.js";
import { en } from "../src/renderer/src/lib/locales/en.js";
import { BANNER_EDITOR_URL } from "../src/shared/banner_patterns.js";
import { propertyKind, propertyRows, showsAsCheckbox } from "../src/renderer/src/lib/inspector_rows.js";
import {
  canonicalBlock,
  isAirBlock,
  readSpelling,
  withBlockAdded,
  withBlocksAdded,
  writeSpelling,
} from "../src/renderer/src/lib/block_spelling.js";
import {
  formatCount,
  glowPatterns,
  materialAction,
  materialRows,
  nextGlow,
} from "../src/renderer/src/lib/materials.js";
import {
  BLOCK_MIME,
  decodeDragged,
  encodeDragged,
  isFileDrop,
  trackPageDrags,
} from "../src/renderer/src/lib/block_drag.js";
import { DISTRIBUTION_KINDS, DISTRIBUTION_PARAMS, tryParseMix } from "../src/shared/block_mix.js";
import { MAP_PLANES } from "../src/shared/distribution_map.js";
import {
  brushSpec,
  columnReach,
  cornerBox,
  cornerClick,
  cornerSpec,
  creativeKey,
  erodeGhost,
  ghostFaces,
  nextTool,
  reachOf,
  reached,
  resized,
  shouldTouch,
  smoothSpec,
  sphereReach,
  strokeRadius,
  strokeSpacing,
  takesCorners,
  takesStroke,
  terrainGhost,
  toolMode,
} from "../src/renderer/src/lib/creative_tools.js";
import { DEFAULT_CREATIVE_SETTINGS } from "../src/shared/creative.js";
import { heightField, inFootprint } from "../src/shared/terrain.js";
import { shapeCells } from "../src/shared/shapes.js";
import { averageColour } from "../src/renderer/src/lib/icon_colour.js";
import {
  arcBetween,
  axisAt,
  COMPASS_AXES,
  easeInOutCubic,
  flightAt,
  HANDLE_REACH,
  orbitFor,
  projectAxis,
  type Quat,
} from "../src/renderer/src/lib/compass.js";
import {
  FACE_VECTOR,
  type Face,
  type PlacementLook,
} from "../src/shared/block_orientation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(here, "..", "src", "renderer", "src");

let failures = 0;

/**
 * `detail` is printed only on failure, and only when there is something to say.
 *
 * It exists because this file used not to be typechecked -- `tsconfig.node.json`
 * covers `src/**` and not `tests/**` -- so an extra argument passed to a
 * two-parameter function was silently dropped rather than refused, which is
 * exactly what had been happening here. `tsconfig.tests.json` closed that; the
 * parameter stays because the call sites want it.
 */
function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.log(`  FAIL: ${label}`);
    if (detail !== undefined && detail !== "") console.log(`         ${detail}`);
    failures += 1;
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    console.log(`         expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  check(label, ok);
}

console.log("=== Schematic AI Studio renderer unit tests ===\n");

// --- i18n_core: lookup and interpolation ----------------------------------
console.log("--- i18n lookup ---");
{
  const catalog = {
    plain: "Save",
    greet: "Hello {name}, you have {count} messages",
    "thing.one": "{count} thing",
    "thing.other": "{count} things",
  };

  equal("a plain message comes back", translate(catalog, "plain"), "Save");
  equal(
    "placeholders are filled",
    translate(catalog, "greet", { name: "Ada", count: 3 }),
    "Hello Ada, you have 3 messages",
  );
  equal(
    "a repeated placeholder is filled every time",
    translate({ x: "{a} and {a}" }, "x", { a: "one" }),
    "one and one",
  );

  // The whole design of the failure mode: loud enough to spot, quiet enough to
  // ship the rest of the screen.
  equal("a missing key returns itself", translate(catalog, "no.such.key"), "no.such.key");
  equal(
    "a missing parameter leaves its placeholder standing",
    translate(catalog, "greet", { name: "Ada" }),
    "Hello Ada, you have {count} messages",
  );
  equal(
    "a message with no params is returned untouched",
    translate({ x: "{literal}" }, "x"),
    "{literal}",
  );

  equal("one selects the singular", translatePlural(catalog, "thing", 1), "1 thing");
  equal("two selects the plural", translatePlural(catalog, "thing", 2), "2 things");
  equal("zero selects the plural", translatePlural(catalog, "thing", 0), "0 things");
  // Formatted as every other count in the window, so a call site never has to
  // pick between the right form and the thousands separator.
  equal(
    "...and the count comes out formatted",
    translatePlural(catalog, "thing", 12345),
    `${(12345).toLocaleString()} things`,
  );

  equal("missingKeys finds the gaps", missingKeys(catalog, ["plain", "nope", "gone"]), [
    "nope",
    "gone",
  ]);
  equal("...and nothing when there are none", missingKeys(catalog, ["plain"]), []);
}

// --- every key the renderer asks for exists -------------------------------
console.log("\n--- catalogue coverage ---");
{
  function sourceFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
      else if (/\.(svelte|ts)$/.test(entry)) found.push(full);
    }
    return found;
  }

  /*
   * `t(` and `tn(` call sites, and every string literal in the first argument.
   *
   * Reading the argument rather than assuming `t("literal")` is what makes this
   * cover the two conditional call sites -- `t(doc.dirty ? "a" : "b")` names two
   * keys, and a test that only understood the simple form would check neither.
   */
  const CALL = /(?<![\w.])(tn?)\(\s*([^,)]*)/g;
  const LITERAL = /"([^"\n]+)"/g;

  const used = new Map<string, { key: string; plural: boolean; file: string }>();
  const files = sourceFiles(RENDERER).filter(
    (file) => !file.includes("locales") && !file.endsWith("i18n_core.ts"),
  );

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const call of text.matchAll(CALL)) {
      const plural = call[1] === "tn";
      for (const literal of call[2].matchAll(LITERAL)) {
        const key = literal[1];
        // A key, not some other string that happened to be an argument.
        // Digits are part of a key -- `selection.rotate90` is one, and a
        // pattern that stopped at letters silently skipped those call sites,
        // which is how the orphan check below first earned its keep.
        if (!/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/.test(key)) continue;
        used.set(`${key}|${plural}`, { key, plural, file: path.relative(RENDERER, file) });
      }
    }
  }

  check("the scan found call sites at all", used.size > 40);

  const wanted: string[] = [];
  for (const { key, plural } of used.values()) {
    if (plural) wanted.push(`${key}.one`, `${key}.other`);
    else wanted.push(key);
  }

  const absent = missingKeys(en, wanted);
  if (absent.length > 0) {
    console.log(`         missing from en.ts: ${absent.join(", ")}`);
  }
  check("every key the renderer asks for is in the catalogue", absent.length === 0);

  /*
   * And the other direction. An unused message is not a bug the way a missing
   * one is, but it is how a catalogue rots: strings outlive the components
   * that showed them, a translator pays to translate them, and nobody can
   * tell which ones still matter.
   *
   * This direction has to be more generous than the one above, because not
   * every key reaches `t()` as a literal, and the two shapes that do not are
   * both legitimate: a key sitting in a data table (the `{ id, key }` rows
   * the settings rail iterates) and a key assembled from a template
   * (`settings.theme.${theme}`). Counting only strict call sites here would
   * report those as unused, and a check that cries wolf gets deleted. The
   * strict set is still what the *missing* check above uses, so nothing is
   * loosened where it matters.
   */
  const asked = new Set(wanted);
  const KEY_LITERAL = /"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)"/g;
  const KEY_TEMPLATE = /`([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*\.)\$\{/g;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // A key-shaped literal that *is* in the catalogue is being used as a key.
    for (const literal of text.matchAll(KEY_LITERAL)) {
      if (en[literal[1] as keyof typeof en] !== undefined) asked.add(literal[1]);
    }
    // `prefix.${…}` claims every catalogue key under that prefix.
    for (const template of text.matchAll(KEY_TEMPLATE)) {
      for (const key of Object.keys(en)) {
        if (key.startsWith(template[1])) asked.add(key);
      }
    }
  }
  const orphans = Object.keys(en).filter((key) => !asked.has(key));
  if (orphans.length > 0) {
    console.log(`         unused in en.ts: ${orphans.join(", ")}`);
  }
  check("no message sits in the catalogue unused", orphans.length === 0);

  /*
   * A plural message may only ask for `{count}`.
   *
   * `translatePlural` supplies exactly that one name, and no `tn(...)` call site
   * passes anything else. A placeholder it does not fill is not an error and not
   * blank -- it renders as itself, so the user reads a literal `{n}` in the
   * middle of a sentence. That shipped once: `mcp.clients` was written with
   * `{n}` and the settings pane said "{n} client connected".
   *
   * Narrow on purpose. If a plural message ever legitimately needs a second
   * parameter, this is where to say so deliberately rather than a rule to work
   * around silently.
   */
  const PLACEHOLDER = /\{(\w+)\}/g;
  const wrongPlaceholders: string[] = [];
  for (const [key, message] of Object.entries(en)) {
    if (!key.endsWith(".one") && !key.endsWith(".other")) continue;
    for (const found of String(message).matchAll(PLACEHOLDER)) {
      if (found[1] !== "count") wrongPlaceholders.push(`${key}: {${found[1]}}`);
    }
  }
  equal("a plural message only asks for {count}", wrongPlaceholders, []);

  /*
   * And every *singular* form that has a plural sibling names no number at all.
   *
   * "1 client connected" rather than "{count} client connected": the count is
   * known to be one, and spelling it is what makes the two forms read as one
   * sentence rather than as a template.
   */
  const chattySingulars = Object.entries(en)
    .filter(([key, message]) => key.endsWith(".one") && String(message).includes("{count}"))
    .map(([key]) => key);
  equal("a singular form spells its one out", chattySingulars, []);
}

// --- keeping the floating tool window reachable ---------------------------
console.log("\n--- floating panel bounds ---");
{
  // A 232px panel in an 800x600 pane, keeping 24px reachable.
  const bounds = { paneWidth: 800, paneHeight: 600, panelWidth: 232, panelHeight: 420, margin: 24 };

  equal("a position already inside is left alone", clampToBounds({ x: 100, y: 80 }, bounds), {
    x: 100,
    y: 80,
  });
  check("...and reported as within", isWithinBounds({ x: 100, y: 80 }, bounds));

  // Dragged off the bottom-right: a corner has to stay grabbable.
  equal("the right edge stops with a margin showing", clampToBounds({ x: 5000, y: 80 }, bounds), {
    x: 776,
    y: 80,
  });
  equal("...and so does the bottom", clampToBounds({ x: 100, y: 5000 }, bounds), {
    x: 100,
    y: 576,
  });

  /*
   * The two edges are deliberately not symmetrical, and this is the pair of
   * cases that says why. Off the left, the panel may hang out until only a
   * sliver of its right edge shows -- the title bar runs its whole width, so a
   * sliver is still something to grab. Off the top it may not go at all,
   * because the first thing to disappear upwards is that title bar, and a panel
   * dragged up by its own height could never be dragged back.
   */
  equal("off the left, a sliver stays", clampToBounds({ x: -5000, y: 80 }, bounds), {
    x: 24 - 232,
    y: 80,
  });
  equal("off the top, nothing goes above zero", clampToBounds({ x: 100, y: -5000 }, bounds), {
    x: 100,
    y: 0,
  });

  // The case the ResizeObserver exists for: the pane shrinks under a panel
  // parked in the far corner. This is the decision it makes; its trigger runs
  // in the rendering steps and cannot be driven from a hidden page.
  const parked = { x: 776, y: 576 };
  const shrunk = { paneWidth: 133, paneHeight: 396, panelWidth: 232, panelHeight: 300, margin: 24 };
  check("a parked panel falls outside a shrunken pane", !isWithinBounds(parked, shrunk));
  equal("...and is pulled back to the new corner", clampToBounds(parked, shrunk), {
    x: 109,
    y: 372,
  });

  // A pane narrower than the margin must not produce a negative maximum.
  equal("a pane narrower than the margin still clamps to zero", clampToBounds({ x: 500, y: 500 }, {
    paneWidth: 10,
    paneHeight: 10,
    panelWidth: 232,
    panelHeight: 160,
    margin: 24,
  }), { x: 0, y: 0 });

  equal("fractional positions are rounded", clampToBounds({ x: 10.4, y: 10.6 }, bounds), {
    x: 10,
    y: 11,
  });

  /*
   * `panelHeight` joined `panelWidth` when these panels became resizable, and
   * it changes exactly one rule: a panel *taller than the pane* may go above
   * zero, far enough to bring its bottom edge -- and the resize corner that
   * lives there -- back into reach. Without it such a panel is pinned at the
   * top with no way to make itself smaller, which is a window you cannot
   * recover from.
   */
  const tall = { paneWidth: 800, paneHeight: 300, panelWidth: 232, panelHeight: 500, margin: 24 };
  equal("a panel taller than the pane may hang off the top", clampToBounds({ x: 40, y: -5000 }, tall), {
    x: 40,
    y: -200,
  });
  equal("...and no further than its bottom edge", clampToBounds({ x: 40, y: -180 }, tall), {
    x: 40,
    y: -180,
  });
  // One that fits keeps the old rule exactly: the title bar never leaves.
  equal("a panel that fits still cannot go above zero", clampToBounds({ x: 40, y: -5000 }, bounds), {
    x: 40,
    y: 0,
  });
}

// --- how big a floating panel may be ---------------------------------------
//
// The tool window was a hard-coded 232px. That is what sent the version
// history off to a modal, and what left the inspector rendering
// `Items[0].tag.display.Name` in a column narrower than the path.
console.log("\n--- floating panel size ---");
{
  const pane = { width: 900, height: 700 };

  equal("a size that fits is kept", clampPanelSize({ width: 400, height: 300 }, pane), {
    width: 400,
    height: 300,
  });

  // The minimum exists because a panel dragged to nothing cannot be dragged
  // back: the corner that resizes it would have no room to exist in.
  equal("...and one dragged to nothing stops at the minimum", clampPanelSize({ width: 0, height: 0 }, pane), {
    width: PANEL_SIZE.minWidth,
    height: PANEL_SIZE.minHeight,
  });

  // The maximum is the pane, because these hover over the thing they edit.
  equal("a panel cannot outgrow its pane", clampPanelSize({ width: 5000, height: 5000 }, pane), {
    width: 900,
    height: 700,
  });

  /*
   * The order of the two clamps, which is the part worth pinning. In a pane
   * smaller than the minimum, taking the pane last would collapse the panel to
   * something with no resize corner and no way out. Taking the minimum last
   * overflows instead: an unusable window you can see and drag beats a usable
   * one you cannot reach.
   */
  equal("a pane smaller than the minimum overflows rather than collapsing", clampPanelSize(
    { width: 300, height: 300 },
    { width: 100, height: 100 },
  ), { width: PANEL_SIZE.minWidth, height: PANEL_SIZE.minHeight });

  equal("fractional sizes are rounded", clampPanelSize({ width: 400.4, height: 300.6 }, pane), {
    width: 400,
    height: 301,
  });

  // A window with a minimum of its own keeps it while being dragged, not only
  // when its size is read back from disk.
  equal(
    "a panel with a minimum of its own stops at that one",
    clampPanelSize({ width: 248, height: 300 }, pane, OPTIONS_PANEL_MIN_WIDTH).width,
    OPTIONS_PANEL_MIN_WIDTH,
  );
}

// --- the chat's markdown, and what it must not let through -----------------
console.log("\n--- markdown rendering ---");
{
  /*
   * The real sanitiser, against a real DOM. Checking the configuration object
   * would only prove I wrote the allowlist I meant to write -- not that the
   * allowlist holds. jsdom is a devDependency for exactly this: it never
   * reaches the bundle, and without it this whole block would be a table
   * inspecting itself.
   */
  const window = new JSDOM("").window;
  const purify = createDOMPurify(window as unknown as Window & typeof globalThis);
  const render = (source: string): string => toSafeHtml(source, purify);

  // The thing the user actually reported.
  {
    const html = render("| Block | Count |\n|:------|------:|\n| stone | 12 |");
    check("a pipe table becomes a table", html.includes("<table"), html);
    check("...with a header row", html.includes("<th"), html);
    check("...and the alignment survives", html.includes('align="right"'), html);
  }

  equal(
    "a fenced block keeps its text verbatim",
    render("```\na | b\n```").includes("a | b"),
    true,
  );
  check("...inside a pre", render("```js\nlet x = 1;\n```").includes("<pre"));
  check("a nested list nests", render("- a\n  - b").split("<ul").length - 1 === 2);
  check("a heading is a heading", render("## Title").includes("<h2"));
  check("bold is bold", render("**yes**").includes("<strong>"));

  /*
   * Block ids are full of underscores, and this app says `minecraft:oak_log`
   * more than it says anything else. GFM only opens emphasis at a word
   * boundary, so this holds -- but it is the single most likely thing to break
   * on a parser change, and it would break quietly, as missing text.
   */
  {
    const html = render("place minecraft:oak_log and quartz_block_top here");
    check("intra-word underscores are not emphasis", !html.includes("<em>"), html);
    check("...and the id survives whole", html.includes("minecraft:oak_log"), html);
  }

  // A link that is fine gets sent to the system browser, not followed in-app.
  {
    const html = render("[docs](https://example.com/x)");
    check("a good link keeps its href", html.includes('href="https://example.com/x"'), html);
    check("...opens outside the app", html.includes('target="_blank"'), html);
    check("...and cannot reach back through window.opener", html.includes("noopener"), html);
  }

  // The hook is added per purifier, not per message: DOMPurify *appends*
  // hooks, so re-registering would stack a duplicate on every single turn.
  {
    const before = render("[a](https://example.com)");
    for (let i = 0; i < 5; i += 1) render("[a](https://example.com)");
    equal("rendering repeatedly does not change the output", render("[a](https://example.com)"), before);
    equal(
      "...and the rel is written once",
      (render("[a](https://example.com)").match(/noopener/g) ?? []).length,
      1,
    );
  }

  // An image cannot load under this CSP, so it becomes something readable
  // rather than a broken icon or -- worse -- nothing at all.
  {
    const html = render("![a diagram](https://example.com/x.png)");
    check("an image becomes a link", html.includes("<a "), html);
    check("...and keeps its alt text", html.includes("a diagram"), html);
    check("...with no img tag left", !html.includes("<img"), html);
  }

  // The list itself.
  for (const hostile of HOSTILE_CASES) {
    const html = render(hostile.source).toLowerCase();
    const leaked = hostile.mustNotContain.filter((needle) => html.includes(needle.toLowerCase()));
    check(`${hostile.name} is neutralised`, leaked.length === 0, `leaked ${JSON.stringify(leaked)} in ${html}`);

    const lost = (hostile.mustContain ?? []).filter(
      (needle) => !html.includes(needle.toLowerCase()),
    );
    if ((hostile.mustContain ?? []).length > 0) {
      check(`...without losing the text`, lost.length === 0, `lost ${JSON.stringify(lost)} in ${html}`);
    }
  }
}

// --- which hrefs may survive ----------------------------------------------
console.log("\n--- link schemes ---");
{
  check("https is fine", isSafeHref("https://example.com"));
  check("http is fine", isSafeHref("http://example.com"));
  check("...case does not matter", isSafeHref("HTTPS://EXAMPLE.COM"));

  check("javascript is not", !isSafeHref("javascript:alert(1)"));
  check("data is not", !isSafeHref("data:text/html,<script>alert(1)</script>"));
  check("a bare mailto is not", !isSafeHref("mailto:someone@example.com"));
  check("a relative path is not", !isSafeHref("/etc/passwd"));
  check("an empty href is not", !isSafeHref(""));

  /*
   * The reason this function strips before it tests. A browser ignores ASCII
   * control characters and whitespace while parsing a URL, so every one of
   * these navigates -- and every one of them fails a naive `startsWith`.
   */
  check("a scheme split by a tab is still javascript", !isSafeHref("java\tscript:alert(1)"));
  check("...by a newline too", !isSafeHref("java\nscript:alert(1)"));
  check("...and leading whitespace does not launder it", !isSafeHref("  javascript:alert(1)"));
  check("...nor a leading NUL", !isSafeHref(" javascript:alert(1)"));

  // The other half of that: stripping must not eat the good ones.
  check("a real URL survives the stripping", isSafeHref(" https://example.com "));
  check("...including its own path and query", isSafeHref("https://example.com/a b?c=d"));
}

// --- putting a popover somewhere it can be seen ---------------------------
console.log("\n--- popover placement ---");
{
  /*
   * The window and the control that produced the bug: a 1440x900 window, the
   * model picker at the right-hand end of the chat composer, which is itself at
   * the bottom of the right-hand panel. Laid out from the control's left edge
   * -- the obvious way, and what the CSS did -- a 340px popover reaches
   * x=1590 in a 1440px window, and a good half of it is off the screen.
   */
  const trigger = { left: 1250, top: 820, width: 120, height: 22 };
  const window1440 = {
    viewportWidth: 1440,
    viewportHeight: 900,
    popoverWidth: 340,
    popoverHeight: 260,
    margin: 8,
    gap: 6,
  };

  const placed = placePopover(trigger, window1440);
  equal("it hangs to the left of the control that opened it", placed, { x: 1030, y: 554 });
  check(
    "...and clears it rather than covering it",
    placed.y + window1440.popoverHeight <= trigger.top,
  );

  /*
   * The property the bug violated, over every place the control could be
   * rather than the one it is: all of the popover is on screen. Stated as a
   * sweep because a single position proves nothing here -- with the preference
   * the picker had, the popover is inside the window for most anchors and
   * outside it only near the edge the picker actually sits at.
   */
  {
    let worst: { x: number; y: number; at: number } | null = null;
    for (let left = 0; left <= 1440; left += 40) {
      for (const top of [0, 430, 878]) {
        const at = placePopover({ ...trigger, left, top }, window1440);
        const inside =
          at.x >= window1440.margin &&
          at.y >= window1440.margin &&
          at.x + window1440.popoverWidth <= window1440.viewportWidth - window1440.margin &&
          at.y + window1440.popoverHeight <= window1440.viewportHeight - window1440.margin;
        if (!inside && worst === null) worst = { x: at.x, y: at.y, at: left };
      }
    }
    check(
      "wherever the control is, all of the popover is on screen",
      worst === null,
      worst === null ? "" : `anchor at x=${worst.at} placed it at ${worst.x},${worst.y}`,
    );
  }

  // Narrow enough that the preferred position does not fit either: the clamp,
  // not the preference, is what keeps it on screen.
  const narrow = placePopover(trigger, { ...window1440, viewportWidth: 420 });
  equal("a window too narrow for the preference pins it to the far margin", narrow.x, 72);

  /*
   * Upwards is the preference because the composer is at the bottom. A control
   * near the *top* of the window has no room above it, and a popover that
   * insisted would be clamped to the top margin and cover the control it
   * belongs to -- so it goes below instead.
   */
  const high = placePopover({ ...trigger, top: 100 }, window1440);
  equal("with no room above, it opens downwards", high.y, 128);
  check("...still below the control", high.y >= 100 + trigger.height);

  // Bigger than the window in both directions. Something has to give; what
  // gives is the far edge, because these panels are read from the top down.
  const cramped = placePopover(trigger, {
    ...window1440,
    viewportWidth: 300,
    viewportHeight: 200,
  });
  equal("a popover larger than the window keeps its near corner", cramped, { x: 8, y: 8 });

  // Element rects are fractional; CSS pixels here should not be.
  equal(
    "a fractional anchor gives whole pixels",
    placePopover({ left: 1250.4, top: 820.5, width: 120.2, height: 22 }, window1440),
    { x: 1031, y: 555 },
  );
}

// --- dragging a face of the selection box ---------------------------------
console.log("\n--- selection face drag ---");
{
  // A 4x4x4 box in the middle of a 32-cube document.
  const region = { minX: 10, minY: 10, minZ: 10, maxX: 13, maxY: 13, maxZ: 13 };

  /** A ray straight down -Z from above the far side, as an orbit camera gives. */
  const rayAt = (x: number): Ray => ({
    origin: { x, y: 12, z: 60 },
    direction: { x: 0, y: 0, z: -1 },
  });
  // Looking down -Z, so the X axis is fully across the view: the best drag
  // plane for X is the one facing the camera.
  const view = { x: 0, y: 0, z: -1 };

  equal(
    "the plane for X drops the X component of the view",
    dragPlaneNormal("x", { x: 0.6, y: 0, z: -0.8 }),
    { x: 0, y: 0, z: -1 },
  );
  equal("an axis pointed at the camera has no usable plane", dragPlaneNormal("z", view), null);

  equal("a face centre sits on the near edge for min", faceCentre(region, "x", "min").x, 10);
  equal("...and past the far cell for max", faceCentre(region, "x", "max").x, 14);

  equal(
    "a ray parallel to the plane misses it",
    intersectPlane({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
      { x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 1 }),
    null,
  );
  equal(
    "a plane behind the ray is not a hit",
    intersectPlane({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
      { x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 1 }),
    null,
  );

  const dragX = (x: number, side: "min" | "max") =>
    dragFace({ region, axis: "x", side, ray: rayAt(x), view });

  equal("dragging the max face out grows the box", dragX(20.2, "max")?.maxX, 19);
  equal("dragging the max face in shrinks it", dragX(12.4, "max")?.maxX, 11);
  equal("dragging the min face out grows the box", dragX(4.6, "min")?.minX, 5);
  equal("the untouched face does not move", dragX(20.2, "max")?.minX, 10);

  /*
   * The two clamps. A face pushed past its partner stops at one block thick
   * rather than swapping the two: an inverted box would leave every subsequent
   * fill acting on a region the user is no longer looking at.
   */
  equal("max cannot be pushed below min", dragX(-100, "max")?.maxX, 10);
  equal("min cannot be pushed above max", dragX(500, "min")?.minX, 13);
  check("...and the box stays at least one block thick", (dragX(-100, "max")?.maxX ?? -1) >= region.minX);

  /*
   * The document is *not* a limit. A face may be dragged out past the edge --
   * that is where the next thing is going to be built -- and filling the region
   * grows the schematic to contain it, with saving trimming the air back off.
   * Only the sanity bound applies, and only to keep a near-parallel ray from
   * reporting a selection in the millions.
   */
  equal("a face may be dragged past the far edge", dragX(500.2, "max")?.maxX, 499);
  equal("...and below the origin", dragX(-40.4, "min")?.minX, -40);
  check(
    "a runaway ray still stops somewhere sane",
    (dragX(1e9, "max")?.maxX ?? 0) === 100_000,
  );

  /*
   * The plate mapping, on a deliberately oblong box so a transposition shows.
   * On a cube every answer is the same number and the bug is invisible, which
   * is exactly how the X face shipped wrong the first time.
   */
  const size = { x: 2, y: 3, z: 5 };
  equal("the X plate takes its width from Z and height from Y", plateScale("x", size), {
    width: 5,
    height: 3,
  });
  equal("the Y plate takes X and Z", plateScale("y", size), { width: 2, height: 5 });
  equal("the Z plate takes X and Y", plateScale("z", size), { width: 2, height: 3 });

  equal(
    "an unusable drag plane changes nothing",
    dragFace({ region, axis: "z", side: "max", ray: rayAt(12), view }),
    null,
  );
  equal(
    "a ray that misses the plane changes nothing",
    dragFace({
      region,
      axis: "x",
      side: "max",
      ray: { origin: { x: 12, y: 12, z: 60 }, direction: { x: 0, y: 0, z: 1 } },
      view,
    }),
    null,
  );
}

// --- what a stationary click means -----------------------------------------
//
// The rule that broke. Selecting became a Shift gesture so a plain *drag*
// would belong to the camera, and the click was taken along with it -- which
// quietly removed the block inspector, because asking what a block is had
// never been anything but a click. It was in an event handler, where a rule
// cannot be read, which is why it is here now.
console.log("\n--- click intent ---");
{
  const click = (hit: boolean, shift = false, ctrl = false) => clickIntent({ hit, shift, ctrl });

  equal("a plain click on a block asks what it is", click(true), "pick");
  equal("...and so does a Shift-click, which also selects it", click(true, true), "pick");
  equal("Ctrl grows the selection, behind Shift", click(true, true, true), "extend");
  // Ctrl without Shift is not the extend gesture: extending is a selection
  // gesture and every one of those takes Shift.
  equal("Ctrl alone is still a plain pick", click(true, false, true), "pick");

  // The asymmetry on a miss, which is the whole of the second half of the rule.
  equal("Shift-clicking past the structure clears the selection", click(false, true), "clear");
  equal(
    "...but a plain click past it does nothing, because that is the usual accident",
    click(false),
    "ignore",
  );
}

// --- moving a region --------------------------------------------------------
//
// The region's min corner follows the cursor, which is the rule paste already
// uses. Keeping a grab point under the cursor would read better for a box you
// pressed on, and this gesture does not start with a press on the box: it
// starts from a button, so there is no grab point to keep.
console.log("\n--- moving a region ---");
{
  const region = { minX: 4, minY: 2, minZ: 6, maxX: 7, maxY: 3, maxZ: 6 };

  equal("the corner goes where the pointer is", moveDestination({ x: 10, y: 1, z: 2 }), {
    x: 10,
    y: 1,
    z: 2,
  });
  /*
   * The grid has nothing below the origin. Moving "down past zero" cannot mean
   * pushing everything else up -- that is what growth-on-fill does, and doing it
   * here would move the coordinates the user is aiming at, under the pointer,
   * mid-gesture.
   */
  equal("below the origin it stops at the origin", moveDestination({ x: -3, y: -1, z: 0 }), {
    x: 0,
    y: 0,
    z: 0,
  });

  equal("the moved box keeps its size", movedRegion(region, { x: 0, y: 0, z: 0 }), {
    minX: 0,
    minY: 0,
    minZ: 0,
    maxX: 3,
    maxY: 1,
    maxZ: 0,
  });
  equal(
    "...and a move to where it already is changes nothing",
    movedRegion(region, { x: region.minX, y: region.minY, z: region.minZ }),
    region,
  );

  /*
   * And the box carried by a growth that moved the document.
   *
   * The grid has no negative index, so an edit reaching below the origin makes
   * room by moving everything already there up and out of the way. Main has
   * always done that and never said so, and the renderer holds three things
   * naming a cell in the frame that moved: the selection, the pivot, and the
   * stamp's ghost, which is derived from the selection.
   *
   * A translation, not a `movedRegion`: the box keeps its size **and its place
   * relative to the blocks**, which is the whole point of following.
   */
  equal("a shifted box keeps its size and its contents", translatedRegion(region, [4, 0, 0]), {
    minX: 8,
    minY: 2,
    minZ: 6,
    maxX: 11,
    maxY: 3,
    maxZ: 6,
  });
  // The identity has to be the identity, because it is the case that runs on
  // every edit that did not grow -- which is very nearly all of them.
  equal("...and a growth that moved nothing moves it nowhere", translatedRegion(region, [0, 0, 0]), region);
  equal(
    "...on every axis at once",
    translatedRegion(region, [1, 2, 3]),
    { minX: 5, minY: 4, minZ: 9, maxX: 8, maxY: 5, maxZ: 9 },
  );

  /*
   * The wiring, which needs an IPC round trip this harness does not make.
   *
   * `runDocument` is the one place every edit passes through, so the live
   * selection, its anchor and the pivot are carried there -- and each of the
   * four commits that *replace* the selection afterwards has to restate its
   * destination in the new frame, or the box lands back where the blocks used
   * to be. Each commit is named and its own body asked, rather than counting
   * `translatedRegion` across the file: several areas brought that call into
   * places that are not commits at all, and a count is exactly the check that
   * goes on passing when one commit loses it and another site gains one.
   */
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  const run = app.slice(app.indexOf("async function runDocument"));
  const runBody = run.slice(0, run.indexOf("\n  }"));
  check("every edit carries what the renderer aims at", /followShift\(response\.shift\)/.test(runBody));
  // Sliced to `runDocument` itself, or the comparison would be against the
  // first `refreshDocument` anywhere in the file and would prove nothing.
  check(
    "...before the document is redrawn from it",
    runBody.indexOf("followShift(response.shift)") < runBody.indexOf("await refreshDocument()"),
  );
  const bodyOf = (name: string): string => {
    const from = app.indexOf(name);
    if (from === -1) return "";
    const rest = app.slice(from);
    return rest.slice(0, rest.search(/\n {2}\}\r?\n/));
  };
  for (const commit of ["async function commitMove", "async function gizmoTransform", "async function gizmoScale"]) {
    check(
      `${commit.split(" ").pop()} restates its destination in the new frame`,
      bodyOf(commit).includes("outcome.shift"),
    );
  }
  check(
    "...and the other areas are carried by the same edit as the active one",
    /otherAreas = otherAreas\.map\(\(area\) => translatedRegion\(area, shift\)\)/.test(bodyOf("function followShift")),
  );
  /*
   * And the timeline is **not** carried. Its entries are in the frame the
   * document had when they were recorded, and undoing the growth puts the
   * document back into that frame -- so translating them would be right twice
   * and wrong on the one press that matters.
   */
  const follow = app.slice(app.indexOf("function followShift"));
  check(
    "...and the recorded history is left in the frame it was written in",
    !follow.slice(0, follow.indexOf("\n  }")).includes("selectionTimeline"),
  );
}

console.log("\n--- the transform gizmo ---");
{
  /*
   * The arithmetic behind the handles. Everything that draws runs from
   * `requestAnimationFrame`, which this harness does not turn, so what is
   * checked here is what a drag *decides* -- and in particular the two signs
   * that no screenshot can catch: which way a ring turns, and which way a
   * mirror reflects.
   */
  const cell = (x: number, y: number, z: number) => ({
    minX: x,
    minY: y,
    minZ: z,
    maxX: x,
    maxY: y,
    maxZ: z,
  });
  const down = (x: number, z: number) => ({
    origin: { x, y: 10, z },
    direction: { x: 0, y: -1, z: 0 },
  });

  // Where it stands.
  equal("a single cell's middle is at its own centre", regionCentre(cell(0, 0, 0)), {
    x: 0.5,
    y: 0.5,
    z: 0.5,
  });
  equal(
    "with no pivot the gizmo stands in the middle of the region",
    gizmoOrigin({ minX: 0, minY: 0, minZ: 0, maxX: 3, maxY: 1, maxZ: 3 }, null),
    { x: 2, y: 1, z: 2 },
  );
  equal(
    "...and on the pivot's own cell once one is placed",
    gizmoOrigin({ minX: 0, minY: 0, minZ: 0, maxX: 3, maxY: 1, maxZ: 3 }, { x: 7, y: 2, z: 9 }),
    { x: 7.5, y: 2.5, z: 9.5 },
  );
  equal(
    "a fresh pivot lands on the cell the middle falls in",
    defaultPivot({ minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 2 }),
    { x: 1, y: 1, z: 1 },
  );

  /*
   * Dragging an arrow. The answer is a difference from where the press
   * landed, which is what lets an arrow be grabbed anywhere along its length
   * without the region jumping to sit under the cursor.
   */
  const origin = { x: 0.5, y: 0.5, z: 0.5 };
  equal(
    "an arrow drag answers in whole cells",
    dragAlongAxis({ origin, axis: "x", ray: down(4.4, 0.5), view: { x: 0, y: -1, z: 0 }, grab: 0.5 }),
    4,
  );
  equal(
    "...and a drag back to where it was grabbed is zero, not a jump",
    dragAlongAxis({ origin, axis: "x", ray: down(0.5, 0.5), view: { x: 0, y: -1, z: 0 }, grab: 0.5 }),
    0,
  );
  /*
   * An axis pointed straight at the camera has no usable drag plane: the
   * region would travel the length of the schematic for one pixel. `null` is
   * "leave it alone", and the caller must not read it as zero -- doing so
   * would snap the region back to the start the moment a drag grazed that
   * angle.
   */
  equal(
    "an axis pointed at the camera refuses rather than guessing",
    dragAlongAxis({ origin, axis: "z", ray: down(0, 0), view: { x: 0, y: 0, z: 1 }, grab: 0 }),
    null,
  );

  /*
   * The ring, and the sign that matters. Main turns a region by
   * `(x, z) -> (length - 1 - z, x)`, which sends **east to south**; the ring
   * has to read the same way round or dragging clockwise would turn the build
   * anticlockwise. Stated as the four compass points rather than as one
   * predicate, so a failure names which one went wrong.
   */
  const angle = (x: number, z: number) => ringAngleAt({ origin, axis: "y", ray: down(x, z) });
  equal("the Y ring reads east as its zero", angle(4.5, 0.5), 0);
  equal("...south as a quarter turn on", angle(0.5, 4.5), Math.PI / 2);
  equal("...and west as a half turn", Math.abs(angle(-3.5, 0.5) ?? 0), Math.PI);
  check(
    "...with north on the other side of zero",
    (angle(0.5, -3.5) ?? 0) < 0,
    String(angle(0.5, -3.5)),
  );
  equal("a ring grabbed exactly at its centre has no angle", angle(0.5, 0.5), null);

  equal("east to south is one quarter turn", quartersBetween(0, Math.PI / 2), 1);
  equal("...and it wraps rather than counting past four", quartersBetween(0, 2 * Math.PI), 0);
  equal("...backwards is three, not minus one", quartersBetween(0, -Math.PI / 2), 3);
  equal("a twitch is no turn at all", quartersBetween(0, 0.2), 0);

  /*
   * Where a turn puts the region. The pivot is the whole point of this one:
   * a square turned about its own middle must not move, and a cell turned
   * about a *different* cell must swing round it. Without the second check a
   * pivot that was quietly ignored would pass.
   */
  const square = { minX: 0, minY: 0, minZ: 0, maxX: 3, maxY: 0, maxZ: 3 };
  equal(
    "a square turned about its own middle stays where it is",
    transformedRegion(square, gizmoOrigin(square, null), { kind: "rotate", axis: "y", steps: 1 }),
    square,
  );
  equal(
    "a cell two east of the pivot lands two south of it",
    transformedRegion(cell(2, 0, 0), origin, { kind: "rotate", axis: "y", steps: 1 }),
    cell(0, 0, 2),
  );
  equal(
    "...and four steps is where it started",
    transformedRegion(cell(2, 0, 0), origin, { kind: "rotate", axis: "y", steps: 0 }),
    cell(2, 0, 0),
  );
  /*
   * An oblong is the case a turn in place cannot do at all -- main refuses it
   * with `NotSquareError`, because the destination is the source. With a
   * destination it is simply a box of the other shape.
   */
  equal(
    "an oblong turns into its own transpose",
    transformedRegion(
      { minX: 0, minY: 0, minZ: 0, maxX: 4, maxY: 0, maxZ: 2 },
      gizmoOrigin({ minX: 0, minY: 0, minZ: 0, maxX: 4, maxY: 0, maxZ: 2 }, null),
      { kind: "rotate", axis: "y", steps: 1 },
    ),
    { minX: 1, minY: 0, minZ: -1, maxX: 3, maxY: 0, maxZ: 3 },
  );

  /*
   * Mirroring, in continuous coordinates rather than on the inclusive index.
   * Cell 2 spans [2, 3); reflected about 0.5 that is (-2, -1], which is cell
   * -2. Doing it on `maxX` directly is off by one, and only on regions of
   * even width -- the half of the cases a hand-picked example misses.
   */
  equal(
    "a mirror reflects the cell, not its index",
    transformedRegion(cell(2, 0, 0), origin, { kind: "mirror", axis: "x" }),
    cell(-2, 0, 0),
  );
  equal(
    "...and an even-width region keeps its width",
    transformedRegion({ minX: 0, minY: 0, minZ: 0, maxX: 3, maxY: 0, maxZ: 0 }, origin, {
      kind: "mirror",
      axis: "x",
    }),
    { minX: -3, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
  );
  equal(
    "mirroring twice is where it started",
    transformedRegion(
      transformedRegion(cell(2, 0, 0), origin, { kind: "mirror", axis: "y" }),
      origin,
      { kind: "mirror", axis: "y" },
    ),
    cell(2, 0, 0),
  );

  /*
   * Scaling. The dead band is deliberately wide: every ratio between 0.75 and
   * 1.5 means "I have not decided", and snapping to x2 on a twitch would make
   * a destructive edit out of a nudge.
   */
  equal("a nudge is not a scale", scaleFromRatio(1.2), null);
  equal("...nor is a small shrink", scaleFromRatio(0.9), null);
  equal("doubling is a whole factor", scaleFromRatio(2.1), { kind: "multiply", factor: 2 });
  equal("halving is its own shape", scaleFromRatio(0.5), { kind: "divide", factor: 2 });
  equal("...and never a factor of one", scaleFromRatio(0.75), { kind: "divide", factor: 2 });
  equal("a runaway ratio is capped", scaleFromRatio(500), { kind: "multiply", factor: 8 });
  equal("a ratio of nothing is refused", scaleFromRatio(0), null);

  equal(
    "doubling about the low corner grows away from it",
    scaledRegion({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }, { x: 0, y: 0, z: 0 }, {
      kind: "multiply",
      factor: 2,
    }),
    { minX: 0, minY: 0, minZ: 0, maxX: 3, maxY: 3, maxZ: 3 },
  );
  /*
   * A thin axis divided away would leave an empty region, which nothing else
   * in the editor has an answer for. One cell is kept instead -- worse
   * arithmetic, and the only option that produces a region at all.
   */
  equal(
    "halving never divides an axis out of existence",
    scaledRegion(cell(0, 0, 0), { x: 0, y: 0, z: 0 }, { kind: "divide", factor: 2 }),
    cell(0, 0, 0),
  );

  const size = { width: 8, height: 8, length: 8 };
  check("a region inside the document fits", regionFits(cell(0, 0, 0), size));
  check("...one past the far face does not", !regionFits(cell(8, 0, 0), size));
  check("...and neither does one below the origin", !regionFits(cell(0, -1, 0), size));
}
console.log("\n--- the gizmo takes the press, and gives the camera back ---");
{
  /*
   * Pointer choreography, which this harness cannot drive: there is no canvas,
   * no camera and no render loop. Read out of the source instead, the way the
   * framing call site and the flight-mode key gate already are.
   */
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");

  /*
   * Placing a block in orbit is gone, and with it the only thing that ever
   * happened without Shift. That is what frees the plain left press for the
   * gizmo's handles -- the two halves are one change, so the absence is checked
   * rather than assumed.
   */
  check(
    "a plain orbit press no longer places a block",
    !viewer.includes("placeCandidate"),
    "placeCandidate is still in Viewer.svelte",
  );
  check(
    "...and the build grid is drawn in flight, where placing went",
    viewer.includes("gridCellAtCrosshair"),
  );

  /*
   * The one that would be silently wrong. A press on a handle that never moved
   * still ends as a click, and without `draggedThisGesture` it falls through to
   * `clickIntent` -- which picks whatever block is behind the gizmo and
   * collapses the selection the user was about to transform.
   */
  const grabAt = viewer.indexOf("const handle = gizmoBox === null ? null : gizmoAt(");
  const shiftGate = viewer.indexOf("if (!event.shiftKey) return;");
  const grab = viewer.slice(grabAt, shiftGate);
  check("the gizmo grab is found at all", grab.length > 0);
  check(
    "a handle press marks the gesture as a drag",
    grab.includes("draggedThisGesture = true"),
    "a stationary press on a handle would fall through to clickIntent",
  );
  check(
    "...and takes the left button from the camera",
    grab.includes("controls.enabled = false"),
    "LEFT is THREE.MOUSE.PAN, so the camera would pan instead",
  );
  check(
    "...without asking for Shift",
    grabAt >= 0 && shiftGate > grabAt,
    "a handle is drawn for this gesture; behind the Shift gate it would need one",
  );

  /*
   * And the release puts the camera back. Written as `cameraMode !== "fly"`
   * rather than `true`, because re-enabling OrbitControls while the pointer is
   * locked would give the flight camera a second controller.
   */
  check(
    "the release hands the button back",
    viewer.includes('if (controls) controls.enabled = cameraMode !== "fly";'),
  );

  /*
   * Rotation is offered on one axis, and that is a decision rather than an
   * omission: a quarter turn about X or Z would have to write `facing=up` on a
   * staircase, which is a state no version of the game has. Checked so that
   * "completing" the set is a deliberate act.
   */
  check(
    "only the vertical ring is built",
    viewer.includes('gizmoMode === "rotate" ? (["y"] as const)'),
    "a horizontal ring would write block states the game cannot hold",
  );

  /*
   * The ground patch yields to a handle as well. Reported as an arrow with a
   * lit cell on the floor behind it -- two indicators, one of which was about
   * to do nothing.
   */
  check(
    "the build grid asks whether the pointer is on a handle",
    viewer.includes("pointerOnHandle({"),
  );
  /*
   * And the hover is refreshed before the two things that read it. After
   * them, each would be deciding from the previous frame's answer -- which
   * on a 50ms throttle is a visible flicker as the pointer crosses a handle.
   */
  const order = (name: string) => viewer.indexOf(`${name}(performance.now())`);
  check(
    "the hover is refreshed before the outline that reads it",
    order("updateHover") >= 0 && order("updateHover") < order("updateBlockHighlight"),
  );
  check(
    "...and before the build grid",
    order("updateHover") < order("updateBuildGrid"),
  );
}

// --- the camera's own input -------------------------------------------------
//
// In Creative flight the camera is driven by movementX/movementY from
// pointer-locked mousemove events, and those are not always a mouse. Chromium
// delivers a spurious one the instant the lock is acquired, carrying the
// distance from wherever the cursor was to where it was warped -- which is the
// "the view snaps somewhere at random" report.
console.log("\n--- look filter ---");
{
  const look = (movementX: number, movementY: number, sinceLock: number): boolean =>
    isSpuriousLook({ movementX, movementY, sinceLock });

  check("an ordinary movement is the user's", !look(12, -7, 1000));
  check("...however fast, within reason", !look(MAX_LOOK_STEP, -MAX_LOOK_STEP, 1000));

  // The click that entered flight must not also spin the camera.
  check("everything in the first instants after the lock is discarded", look(1, 0, 0));
  check("...including a movement that would otherwise be fine", look(3, 3, LOCK_SETTLE_MS - 1));
  check("...and it stops being discarded once settled", !look(3, 3, LOCK_SETTLE_MS));

  // And the general case: no wrist produces this between two frames.
  check("a jump larger than any hand is discarded", look(MAX_LOOK_STEP + 1, 0, 5000));
  check("...on either axis", look(0, -(MAX_LOOK_STEP + 1), 5000));
}

// --- the sky through a day --------------------------------------------------
//
// Curves through a 24000-tick day, every one of them with boundaries where it
// is easy to be a whole phase out, and none of it observable from a component
// that owns a WebGL context.
console.log("\n--- sky ---");
{
  const dawn = skyAt(0);
  const noon = skyAt(6000);
  const dusk = skyAt(12000);
  const midnight = skyAt(18000);

  // The sun rises in the east (+X), is overhead at noon, sets in the west.
  check("at dawn the sun is on the eastern horizon", dawn.sunDirection[0] > 0.99);
  check("at noon it is overhead", noon.sunDirection[1] > 0.99);
  check("at dusk it is west", dusk.sunDirection[0] < -0.99);
  check("at midnight it is under the world", midnight.sunDirection[1] < -0.99);
  check("the moon is always opposite", Math.abs(noon.moonDirection[1] + 1) < 1e-6);

  check("noon is day", !noon.night);
  check("midnight is not", midnight.night);

  /*
   * The floor is what makes this usable. Sky light at night in the game is
   * dim, and an editor that went black at 18000 would be a setting nobody
   * could turn on -- "you cannot see what you are working on" is a bug however
   * faithful it is.
   */
  check("full daylight at noon", noon.daylight === 1);
  check("...dimmed at midnight", midnight.daylight < 0.5);
  check("...but never dark", midnight.daylight > 0);

  check("stars are out at midnight", midnight.starOpacity > 0.9);
  check("...and gone at noon", noon.starOpacity === 0);

  // Dusk is orange, and noon is not.
  check("the horizon warms at dusk", dusk.horizon[0] > dusk.horizon[2]);
  check("...and is blue at noon", noon.horizon[2] > noon.horizon[0]);

  // The moon lights far less than the sun, which is what keeps night readable
  // without pretending it is daytime.
  check("the moon is weaker than the sun", midnight.lightIntensity < noon.lightIntensity);
  check("...but not nothing", midnight.lightIntensity > 0);

  /*
   * The dome has to be inside the frustum, and this is the check that would
   * have caught a black sky.
   *
   * It was a sphere of radius 3000 while the draw-distance setting defaults to
   * 512: every vertex outside the far plane, clipped, nothing drawn, and the
   * viewport showing the renderer's clear colour. Every draw distance the
   * slider offers has to work, which is why this is a function and not a
   * constant.
   */
  for (const far of [
    PREVIEW_SETTING_RANGES.maxDrawDistance.min,
    512,
    PREVIEW_SETTING_RANGES.maxDrawDistance.max,
  ]) {
    const distance = skyDistance(0.1, far);
    check(`the sky is nearer than the far plane at ${far}`, distance < far, String(distance));
    check(`...and further than the near plane at ${far}`, distance > 0.1, String(distance));
  }
  // A frustum with no room for a margin still has to put it somewhere inside.
  const pinched = skyDistance(10, 12);
  check("a pinched frustum still fits the sky in it", pinched > 10 && pinched < 12, String(pinched));
  // And nonsense planes do not produce a NaN scale, which would take the whole
  // sky out of the scene rather than merely misplace it.
  check("a zero far plane still answers", Number.isFinite(skyDistance(0, 0)));

  // The clock wraps, and midnight-to-dawn has no seam in it.
  equal("a day later is the same sky", skyAt(24000).daylight, dawn.daylight);
  equal("...and so is a day earlier", skyAt(-24000).daylight, dawn.daylight);
  equal("ticks wrap", normalizeTicks(-1000), 23000);

  // The azimuth turns the whole path, so a facade can be lit without inventing
  // an hour that does not exist.
  const turned = skyAt(6000, 90);
  check("turning the path leaves noon overhead", turned.sunDirection[1] > 0.99);
  const morning = skyAt(1000, 90);
  check(
    "...but moves where the low sun comes from",
    Math.abs(morning.sunDirection[2]) > Math.abs(skyAt(1000, 0).sunDirection[2]),
  );
}

// --- where the shadow camera goes ---------------------------------------------
//
// Two properties, and the second is the one nobody thinks of. The box has to
// cover the build -- a shadow map has a fixed pixel budget, and a box sized for
// the largest possible schematic spends it all on empty air. And it has to move
// in whole texels: slide it half a texel and every receiver lands on a
// different depth sample, so the edge of every shadow shimmers as the sun
// moves. Along a straight wall, which is what a schematic is made of, that is
// the only thing you can see.
console.log("\n--- the MCP indicator ---");
{
  const listening = (over: Partial<McpStatus> = {}): McpStatus => ({
    state: "listening",
    url: "http://127.0.0.1:4571/mcp",
    token: "abcdefghijklmnop",
    clients: 0,
    calls: 0,
    message: null,
    bridge: "C:/app/resources/mcp-bridge.mjs",
    requiresAuth: true,
    bindAddress: "127.0.0.1",
    ...over,
  });

  /*
   * The fifth state, and the reason it outranks the other two.
   *
   * A server with no token is the most permissive thing this app can be doing,
   * and `active` would hide it at exactly the wrong moment: somebody connecting
   * is when "anybody could" stops being hypothetical. So it wins over both.
   *
   * Read from the status rather than from the setting, like everything else
   * here -- `requiresAuth` is what the listener is doing, and the checkbox is
   * only what was asked for.
   */
  equal("a listening server with no token warns", dotFor(listening({ requiresAuth: false })), "unauthenticated");
  equal(
    "...and goes on warning once a client arrives",
    dotFor(listening({ requiresAuth: false, clients: 3 })),
    "unauthenticated",
  );
  equal("a listening server that wants one does not", dotFor(listening()), "listening");
  equal("...and still says when somebody is using it", dotFor(listening({ clients: 1 })), "active");
  /*
   * Off is off. The warning is about a server that is serving, and a dot that
   * warned about a stopped one would be the boy who cried wolf.
   */
  equal(
    "a server that is not running warns about nothing",
    dotFor(listening({ state: "off", requiresAuth: false })),
    "off",
  );
  /*
   * Its own colour, and not `--danger`: nothing has gone wrong. A red dot over
   * a working server teaches people that red means nothing.
   */
  equal("the warning has its own colour", dotColor("unauthenticated"), "--warn");
  check("...which is not the error colour", dotColor("unauthenticated") !== dotColor("error"));
  /*
   * The whole reason this is a function of `McpStatus` and not of the setting.
   *
   * The checkbox says "on" and the server is not listening, because a second
   * copy of the app has the port. A dot derived from the setting is green over
   * nothing; this one is red, and the message beside it names the port.
   */
  equal(
    "a server that failed to start is not green",
    dotFor({ ...listening(), state: "error", url: null, message: "Port 4571 is already in use" }),
    "error",
  );
  equal("...listening with nobody connected is", dotFor(listening()), "listening");
  equal("...and a connected client is louder still", dotFor(listening({ clients: 1 })), "active");
  equal("off is off", dotFor({ ...listening(), state: "off", url: null }), "off");

  /*
   * The dangerous default. A status that has not come back must not read as
   * "listening" — green means "something outside can edit this build", and it
   * cannot appear because a question is still in flight.
   */
  equal("no answer yet is not an answer", dotFor(null), "starting");

  // Four states, four distinct tokens, all of which exist in app.css in both
  // palettes -- a dot that shares a colour with another state says nothing.
  const colors = (["off", "starting", "listening", "active", "error"] as const).map(dotColor);
  check("the states are told apart by colour", new Set(colors).size === 4, colors.join(" "));

  /*
   * Visibility. Hidden while off, so the bar is not carrying a dim dot for a
   * feature nobody switched on -- but a *listening* server is never hidden,
   * whatever the setting says, because the warning is the point.
   */
  check("hidden while the server is off", !showsIndicator(false, { ...listening(), state: "off" }));
  check("...shown once it is enabled", showsIndicator(true, null));
  check(
    "...and never hidden while something is listening",
    showsIndicator(false, listening()),
  );

  // The token is shown at all -- a deliberate exception to "secrets stay in
  // main" -- so it is masked by default, and the tail is what lets someone tell
  // which token they are looking at without revealing it.
  const masked = maskToken("abcdefghijklmnop");
  check("a masked token hides the secret", !masked.includes("abcdefghijkl"), masked);
  check("...but shows enough to recognise it", masked.endsWith("mnop"), masked);
  equal("no token, nothing to mask", maskToken(null), "");

  // The one string in this feature that has to be exactly right: a wrong flag
  // is a client that cannot connect and an error message about neither.
  const command = connectCommand("http://127.0.0.1:4571/mcp", "s3cret");
  check("the connect command names the transport", command.includes("--transport http"), command);
  check("...and carries the token as a bearer header", command.includes("Bearer s3cret"), command);
  /*
   * ...and omits it when there is none, which authentication being off is.
   * An empty `Bearer ` would be a command that looks right, runs, and fails to
   * connect -- with an error naming authentication on a server not asking for
   * any.
   */
  check(
    "no token, no header",
    !connectCommand("http://127.0.0.1:4571/mcp", null).includes("--header"),
    connectCommand("http://127.0.0.1:4571/mcp", null),
  );
  check("...and the address is still there", connectCommand("http://x/mcp", null).includes("http://x/mcp"));

  /*
   * The stdio form quotes the path, and that is not cosmetic: the bridge ships
   * under the app's install directory, which on Windows is under "Program
   * Files". Unquoted, the command a user pastes stops at the space.
   */
  const stdio = bridgeCommand("C:/Program Files/Schematic AI Studio/resources/mcp-bridge.mjs");
  check("the bridge command quotes the path", stdio.includes('"C:/Program Files/'), stdio);
  check("...and passes it to node after the separator", stdio.includes("-- node"), stdio);
}

console.log("\n--- the floor and the grid ---");
{
  /*
   * Three surfaces share y=0: the virtual floor, the 256-block grid over it and
   * the build-grid patch under the cursor. They used to be held apart by
   * hand-picked epsilons -- -0.02, -0.01, +0.002 -- and those *are* the bug
   * rather than the fix, because a perspective depth buffer's precision is a
   * function of distance. What follows is the arithmetic that says so, and it
   * fails if anyone reaches for a constant again.
   */
  const CORNER = (GRID_SIZE / 2) * Math.SQRT2;
  const NEAR = 0.1;
  const FAR = DEFAULT_PREVIEW_SETTINGS.maxDrawDistance;

  check(
    "near the camera an epsilon looks like it works",
    depthEpsilon(NEAR, FAR, 16) < 0.002,
    String(depthEpsilon(NEAR, FAR, 16)),
  );
  check(
    "...the build grid's 0.002 is gone by 64 blocks",
    depthEpsilon(NEAR, FAR, 64) > 0.002,
    String(depthEpsilon(NEAR, FAR, 64)),
  );
  check(
    "...and the grid's 0.01 by its own far corner",
    depthEpsilon(NEAR, FAR, CORNER) > 0.01,
    String(depthEpsilon(NEAR, FAR, CORNER)),
  );
  // The corner is inside the frustum at the default draw distance, so this is
  // not a hypothetical: it is on screen whenever the floor and the grid are.
  check("...which is a place you can see", CORNER < FAR, String(CORNER));

  /*
   * Every draw distance the slider offers, at the furthest point of the grid
   * that distance can show.
   *
   * The near plane dominates the expression, so raising the far plane barely
   * moves the answer and lowering it only hides the far half of the grid. No
   * setting rescues an epsilon: at the minimum draw distance one step is
   * already thicker than the 0.002 the build grid had.
   */
  for (const far of [
    PREVIEW_SETTING_RANGES.maxDrawDistance.min,
    FAR,
    PREVIEW_SETTING_RANGES.maxDrawDistance.max,
  ]) {
    const reach = Math.min(far, CORNER);
    check(
      `an epsilon is still too thin at ${far}`,
      depthEpsilon(NEAR, far, reach) > 0.002,
      String(depthEpsilon(NEAR, far, reach)),
    );
  }

  // Positive pushes the base *away*, which is the direction that lets the lines
  // drawn on it win; a unit is one whole depth step, so one is always enough.
  check("the floor is offset away from the camera", COPLANAR_OFFSET.factor > 0);
  check("...by at least one whole depth step", COPLANAR_OFFSET.units >= 1);

  // A 16-bit depth buffer is 256 times coarser, and the same offset answers it.
  check(
    "a coarser buffer is worse, not different",
    depthEpsilon(NEAR, FAR, CORNER, 16) > depthEpsilon(NEAR, FAR, CORNER, 24),
  );
  // Nonsense planes must not produce a NaN, which would read as "no gap at all".
  check("zero planes still answer", Number.isFinite(depthEpsilon(0, 0, 100)));

  /*
   * And the viewer has to be the thing doing it. This is the check that bites
   * on a revert: the epsilons are easy to put back, they look like care, and
   * nothing else in the app would notice.
   */
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
  check("the floor declares a polygon offset", viewer.includes("polygonOffset: true"));
  check(
    "...and nothing at y=0 is nudged apart by hand",
    !/(?:grid|groundPlane)\.position\.y\s*=/.test(viewer),
  );
}

console.log("\n--- shadow fit ---");
{
  const box = { center: { x: 32, y: 16, z: 32 }, size: { x: 64, y: 32, z: 64 } };
  const noon = fitShadow({ ...box, direction: { x: 0, y: 1, z: 0 }, mapSize: 2048 });

  check("the box covers the whole diagonal", noon.radius >= Math.hypot(64, 32, 64) / 2 - 1e-6);
  check("...and not a great deal more", noon.radius < Math.hypot(64, 32, 64));
  check("the light is above what it lights", noon.position.y > noon.target.y);
  check("the near plane is in front of it", noon.near > 0);
  check("...and the far plane past it", noon.far > noon.near + noon.radius);

  // A one-block document must not get a box smaller than the depth bias, or
  // every surface shadows itself.
  const tiny = fitShadow({
    center: { x: 0.5, y: 0.5, z: 0.5 },
    size: { x: 1, y: 1, z: 1 },
    direction: { x: 0, y: 1, z: 0 },
    mapSize: 1024,
  });
  check("a one-block document still gets a usable box", tiny.radius >= 8);

  /*
   * The camera aims at the document and stays there as the sun goes round.
   * Only the position moves, which is what keeps the shadow of a wall attached
   * to the wall.
   *
   * There is no texel snapping to check, and that is deliberate -- see the note
   * at the top of `shadow_fit.ts`. Snapping fixes crawl from a box that
   * *translates*, and this box is centred on a document that does not move.
   */
  const evening = fitShadow({ ...box, direction: { x: 0.8, y: 0.6, z: 0 }, mapSize: 2048 });
  equal("the camera keeps aiming at the document", evening.target, box.center);
  check(
    "...and only the light moves round it",
    Math.abs(evening.position.x - noon.position.x) > 1,
  );
  check(
    "the light stays the same distance out",
    Math.abs(
      Math.hypot(
        evening.position.x - box.center.x,
        evening.position.y - box.center.y,
        evening.position.z - box.center.z,
      ) -
        Math.hypot(
          noon.position.x - box.center.x,
          noon.position.y - box.center.y,
          noon.position.z - box.center.z,
        ),
    ) < 1e-6,
  );

  // A direction pointing straight along the axis the perpendicular is picked
  // from would give a zero vector, and every shadow would land at the origin.
  for (const direction of [
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: 0 },
  ]) {
    const fit = fitShadow({ ...box, direction, mapSize: 1024 });
    check(
      `a light pointing (${direction.x}, ${direction.y}, ${direction.z}) still has a place`,
      Number.isFinite(fit.position.x) &&
        Number.isFinite(fit.position.y) &&
        Number.isFinite(fit.position.z) &&
        Number.isFinite(fit.target.x),
    );
  }
}

// --- how long ago a schematic was opened ----------------------------------
console.log("\n--- recent document age ---");
{
  const NOW = 1_700_000_000_000;
  const ago = (ms: number) => openedAge(NOW - ms, NOW);
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  equal("no timestamp is no date", openedAge(0, NOW), { kind: "none" });
  equal("...and neither is a negative one", openedAge(-1, NOW), { kind: "none" });

  equal("this second is just now", ago(0), { kind: "justNow" });
  equal("...and so is 59 seconds", ago(59_000), { kind: "justNow" });

  // Each boundary, from both sides. Five thresholds, five chances to be off by
  // one, and a label that is only ever wrong by a little is a label nobody
  // notices is wrong.
  equal("one minute becomes minutes", ago(MINUTE), { kind: "minutes", count: 1 });
  equal("59 minutes is still minutes", ago(59 * MINUTE), { kind: "minutes", count: 59 });
  equal("one hour becomes hours", ago(HOUR), { kind: "hours", count: 1 });
  equal("23 hours is still hours", ago(23 * HOUR), { kind: "hours", count: 23 });
  equal("one day becomes days", ago(DAY), { kind: "days", count: 1 });
  equal("six days is still days", ago(6 * DAY), { kind: "days", count: 6 });
  equal("a week becomes a date", ago(7 * DAY), { kind: "date" });
  equal("...and so does a year", ago(365 * DAY), { kind: "date" });

  // A clock that moved backwards -- a timezone change, an NTP correction --
  // leaves a stamp in the future. "Just now" is the honest reading of a moment
  // that has not happened yet; a negative count would not be.
  equal("a future timestamp reads as just now", openedAge(NOW + DAY, NOW), { kind: "justNow" });
}

// --- the build grid --------------------------------------------------------
//
// With zero blocks there is nothing to raycast, so neither a selection nor a
// placement had a target and an empty schematic was untouchable. The grid is
// the target. The raycast itself runs from the rendering steps and cannot be
// observed in this project's browser harness, so the decision lives here and
// only the trigger stays unobservable -- the same split `selection_drag.ts`
// was written for.
console.log("\n--- build grid ---");
{
  const size = { width: 8, height: 8, length: 8 };
  const down = (x: number, z: number) => ({
    origin: { x, y: 10, z },
    direction: { x: 0, y: -1, z: 0 },
  });

  equal("a ray straight down lands on the cell under it", cellUnderRay(down(3.4, 5.7), size), {
    x: 3,
    y: 0,
    z: 5,
  });
  /*
   * `floor`, not `round`. Rounding snaps to the nearest corner, which is half a
   * block out in both axes everywhere -- and passes any test that only ever
   * points at the middle of a cell.
   */
  equal("...and at 3.9 it is still that cell, not the next", cellUnderRay(down(3.9, 0.1), size), {
    x: 3,
    y: 0,
    z: 0,
  });
  equal("a negative coordinate floors away from zero", cellUnderRay(down(-0.2, -0.2), size), {
    x: -1,
    y: 0,
    z: -1,
  });

  check("a ray parallel to the plane hits nothing", cellUnderRay({ origin: { x: 0, y: 5, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, size) === null);
  check("a ray pointing away from the plane hits nothing", cellUnderRay({ origin: { x: 0, y: 5, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, size) === null);

  /*
   * A ray grazing the plane near the horizon lands thousands of blocks out.
   * Turning that into a fill would ask for a resize nobody wanted, so it reads
   * as "not over the grid" instead.
   */
  check(
    "a graze near the horizon is refused rather than answered",
    cellUnderRay(down(MAX_GRID_REACH + 40, 0), size) === null,
  );
  check(
    "...but just inside the reach still answers",
    cellUnderRay(down(size.width - 1 + MAX_GRID_REACH - 1, 0), size) !== null,
  );

  check("a cell in the box is inside it", isInsideBox({ x: 0, y: 0, z: 0 }, size));
  check("...and the far corner is too", isInsideBox({ x: 7, y: 7, z: 7 }, size));
  check("...but one past it is not", !isInsideBox({ x: 8, y: 0, z: 0 }, size));
  check("...and neither is a negative one", !isInsideBox({ x: -1, y: 0, z: 0 }, size));

  // A click is a drag that ended where it started, and needs no special case.
  equal("a drag between two cells is the box they span", regionBetween({ x: 5, y: 0, z: 1 }, { x: 2, y: 0, z: 6 }), {
    minX: 2,
    minY: 0,
    minZ: 1,
    maxX: 5,
    maxY: 0,
    maxZ: 6,
  });
  equal("a drag that went nowhere is one cell", regionBetween({ x: 2, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }), {
    minX: 2,
    minY: 0,
    minZ: 2,
    maxX: 2,
    maxY: 0,
    maxZ: 2,
  });

  equal("nothing is drawn when the pointer is off the grid", visibleCells(null, 3), []);
  equal("a radius of 2 draws a 5x5", visibleCells({ x: 0, y: 0, z: 0 }, 2).length, 25);
  equal("the centre is fully lit", cellFade({ x: 4, y: 0, z: 4 }, { x: 4, y: 0, z: 4 }, 3), 1);
  check("...and the far corner has faded out", cellFade({ x: 7, y: 0, z: 7 }, { x: 4, y: 0, z: 4 }, 3) === 0);
  check(
    "the falloff is radial, so the square corner is dimmer than the square edge",
    cellFade({ x: 6, y: 0, z: 6 }, { x: 4, y: 0, z: 4 }, 3) <
      cellFade({ x: 6, y: 0, z: 4 }, { x: 4, y: 0, z: 4 }, 3),
  );

  /*
   * Reaching past the far side is a fill's business: `domain/grow.ts` extends
   * the document in the same transaction, so growing and filling are one undo
   * step. Reaching below the origin is not the same operation -- the grid has
   * no negative coordinates, so growing that way moves the content instead, and
   * a stray drag must not trigger it.
   */
  equal("a region inside the box just fits", placementNeeds(regionBetween({ x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 2 }), size), "fits");
  equal("...past the far side asks to grow", placementNeeds(regionBetween({ x: 1, y: 0, z: 1 }, { x: 20, y: 0, z: 2 }), size), "grows");
  /*
   * Below the origin used to be "blocked", on the reasoning that growing that
   * way moves the *content* instead. The reasoning is sound; the conclusion was
   * wrong for this app, because a fill dragged under the floor has always moved
   * the content up -- so refusing the same act to a single click left the two
   * gestures disagreeing about what the editor is. One arithmetic, in `grow.ts`.
   */
  equal("...and below the origin also grows", placementNeeds(regionBetween({ x: -1, y: 0, z: 1 }, { x: 2, y: 0, z: 2 }), size), "grows");
  equal("...as does a cell below the floor", placementNeeds(cellRegion({ x: 1, y: -1, z: 1 }), size), "grows");
  equal("a single cell inside is still just a fit", placementNeeds(cellRegion({ x: 1, y: 0, z: 1 }), size), "fits");
}

// --- where the grid sits and where the camera starts ------------------------
//
// Both used to answer "the world origin", and a schematic's origin is a corner
// of the work rather than its middle: there are no negative block coordinates,
// so three quadrants of the grid covered space no block can occupy, and
// orbiting turned around the corner instead of around the build.
console.log("\n--- framing ---");
{
  const box = (width: number, height: number, length: number) => ({ width, height, length });

  equal("nothing open leaves the grid on the origin", gridCentre(null), { x: 0, z: 0 });

  equal(
    "a box whose middle is already on a cell gets exactly its middle",
    gridCentre(box(64, 16, 64)),
    { x: 32, z: 32 },
  );

  /*
   * The snap is the whole subtlety, and it is invisible in a screenshot.
   *
   * A `GridHelper` draws its lines one cell apart *from its own centre*, so a
   * centre at 10 puts lines at 10, 18, 26 -- off every block boundary, while
   * the build-grid patch under the cursor is still drawn on integer cells. The
   * two would disagree everywhere, by a constant, which reads as a rendering
   * bug rather than as a centring one.
   */
  for (const [w, l] of [
    [20, 20],
    [1, 1],
    [13, 47],
    [255, 3],
    [7, 9],
  ]) {
    const centre = gridCentre(box(w, 8, l));
    check(
      `a ${w}x${l} box still lands on the cell grid`,
      centre.x % GRID_CELL === 0 && centre.z % GRID_CELL === 0,
      JSON.stringify(centre),
    );
    check(
      `...within half a cell of the real middle of ${w}x${l}`,
      Math.abs(centre.x - w / 2) <= GRID_CELL / 2 && Math.abs(centre.z - l / 2) <= GRID_CELL / 2,
      JSON.stringify(centre),
    );
  }

  const framed = documentFraming(box(32, 16, 48));
  equal("the camera is aimed at the middle of the box", framed.target, { x: 16, y: 8, z: 24 });

  /*
   * The establishing shot itself is unchanged -- above the box, off one corner
   * -- because an ordinary document should open looking the way it always did.
   * Only what it is measured against moved.
   */
  check("...from above it", framed.position.y > framed.target.y);
  check(
    "...and off the +x/+z corner, as it always was",
    framed.position.x > framed.target.x && framed.position.z > framed.target.z,
  );
  check(
    "...far enough out to see the whole box",
    Math.hypot(
      framed.position.x - framed.target.x,
      framed.position.y - framed.target.y,
      framed.position.z - framed.target.z,
    ) > 48,
  );

  /*
   * The reason this is measured from the box rather than from the geometry.
   * `Box3.setFromObject` of an empty document is an empty box, so the old
   * framing returned without moving anything and left the camera at wherever it
   * was mounted -- pointed at no part of a work surface that has nothing else
   * on it to navigate by.
   */
  const empty = documentFraming(box(1, 1, 1));
  check(
    "a document with nothing in it still gets a shot",
    Number.isFinite(empty.position.x) && empty.position.y > empty.target.y,
    JSON.stringify(empty),
  );

  const small = documentFraming(box(8, 8, 8));
  const large = documentFraming(box(128, 8, 8));
  check(
    "a bigger box is framed from further away",
    large.position.x - large.target.x > small.position.x - small.target.x,
  );

  /*
   * And the viewer asks this module rather than working it out again.
   *
   * The arithmetic above is only worth having if it is the arithmetic that
   * runs, and the call site is inside a `requestAnimationFrame`-driven
   * component this harness cannot mount -- so the trigger is checked the way
   * the Ctrl gate and the coplanar epsilons are, by reading the source.
   */
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
  check("the viewer asks this module where its grid goes", viewer.includes("gridCentre("));
  /*
   * And then *moves* it. Checking only for the call proves the call is there
   * and nothing about what is done with the answer -- which is the whole of
   * what a grep can say, so the grep has to name the effect as well.
   */
  check(
    "...and moves it there on both axes",
    /grid\.position\.x\s*=/.test(viewer) && /grid\.position\.z\s*=/.test(viewer),
  );
  check("...and frames its camera from it too", viewer.includes("documentFraming("));
  /*
   * The old version measured `Box3.setFromObject(loaded)`, which is an empty
   * box on an empty document -- so it returned without moving anything and
   * the camera stayed where it was mounted. Nothing else in that file frames
   * anything, so its absence is the whole rule.
   */
  check(
    "...and no longer measures the geometry to do it",
    !/setFromObject\([a-z]/.test(viewer),
  );
}

// --- a camera asked for over MCP --------------------------------------------
//
// `capture_viewport` moves the camera and then photographs the window, so the
// viewer has to put the camera where it was told, draw, and only then answer.
// All of that runs from the rendering steps, which this harness has no
// browser for -- so the arithmetic is `tests/mcp.ts`'s, and this reads the
// call sites the way the framing checks above do.
console.log("\n--- a camera asked for over MCP ---");
{
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  const aim = viewer.slice(viewer.indexOf("async function aimCamera("), viewer.indexOf("function nextFrame("));
  check("the viewer has somewhere to apply a requested camera", aim.length > 0);
  check(
    "...which moves the camera and the orbit's target to what was asked",
    /camera\.position\.set\(position\.x, position\.y, position\.z\)/.test(aim) &&
      /controls\.target\.set\(target\.x, target\.y, target\.z\)/.test(aim),
  );
  /*
   * The order is the rule. An answer sent before the frame is drawn lets main
   * photograph the old view and call it the new one, which is the whole
   * failure `capture_viewport` aiming was built to prevent.
   */
  const drawn = aim.indexOf("renderFrame()");
  const waited = aim.indexOf("await nextFrame()");
  const answered = aim.indexOf("oncameraaimed?.({ id: request.id, camera: cameraState() })");
  check(
    "...draws the frame, waits for it, and only then answers",
    drawn > 0 && waited > drawn && answered > waited,
    `${drawn} / ${waited} / ${answered}`,
  );
  check("...after the camera-mode effects have run", aim.indexOf("await tick()") >= 0 && aim.indexOf("await tick()") < drawn);
  check(
    "the render loop draws through the same function",
    /frame = requestAnimationFrame\(animate\);[\s\S]{0,8000}renderFrame\(\);/.test(viewer),
  );
  const subscription = app.slice(app.indexOf("api().onCameraAim("), app.indexOf("api().onDocumentChanged("));
  check(
    "the app leaves flight before a camera is put in place",
    subscription.includes("document.exitPointerLock()") && subscription.includes('cameraMode = "orbit"'),
  );
  check("...hands the request to the viewer", /\{cameraRequest\}/.test(app));
  check("...and relays the answer to main", app.includes("api().reportCameraAimed(reply)"));
}

// --- a patterned banner, in the inspector ------------------------------------
//
// A banner's design is edited on the banner: the inspector lists its layers,
// adds, removes and reorders them, picks among the sixteen dyes, and takes a
// pasted /give command. The block field still reads that command, and the
// hint beside it now sends a person to the inspector instead.
console.log("\n--- a patterned banner, in the inspector ---");
{
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  const tools = readFileSync(path.join(RENDERER, "lib", "SelectionTools.svelte"), "utf8");
  const inventory = readFileSync(path.join(RENDERER, "lib", "CreativeInventory.svelte"), "utf8");
  const hint = readFileSync(path.join(RENDERER, "lib", "BannerPatternHint.svelte"), "utf8");
  const panel = readFileSync(path.join(RENDERER, "lib", "InspectorPanel.svelte"), "utf8");
  const editor = readFileSync(path.join(RENDERER, "lib", "BannerPatternEditor.svelte"), "utf8");

  const parse = app.slice(app.indexOf("function parseBlock("), app.indexOf("async function changeBlockProperty("));
  check(
    "every block the app reads is taken apart by the shared splitter first",
    parse.indexOf("splitBlockInput(text)") >= 0 &&
      parse.indexOf("splitBlockInput(text)") < parse.indexOf("resolveBlockInput("),
  );
  check("...and the patterns travel with the block to main", /bannerPatterns: input\.bannerPatterns/.test(parse));

  const field = tools.indexOf('id="tool-to-block"');
  const fill = tools.indexOf("onclick={() => onfill(block)}");
  const shown = tools.indexOf('<BannerPatternHint where="place" />');
  check("the hint sits under the block field", field >= 0 && shown > field && shown < fill);
  check("...when the field holds a banner", /\{#if holdsBanner\}/.test(tools) && tools.includes("isBannerBlock("));
  check(
    "the inventory says it when banners are searched for",
    /\/banner\/i\.test\(query\)/.test(inventory) && inventory.includes('<BannerPatternHint where="place" />'),
  );
  check(
    "the hint links the editor, opening outside the window",
    /href=\{BANNER_EDITOR_URL\}/.test(hint) && /target="_blank"/.test(hint) && /rel="noreferrer"/.test(hint),
  );
  equal("...at the address the user gave", BANNER_EDITOR_URL, "https://www.planetminecraft.com/banner/");
  const place = [en["banner.hint.place.before"], en["banner.hint.editor"], en["banner.hint.place.after"]].join("");
  check(
    "...and sends a person to the inspector, not to the block field",
    place.includes("inspector") && !/block field/i.test(place),
    place,
  );
  const inside = [en["banner.hint.inspector.before"], en["banner.hint.editor"], en["banner.hint.inspector.after"]].join("");
  check("...and inside the editor, says the /give command is pasted there", inside.includes("/give"), inside);

  check(
    "the inspector mounts the pattern editor for any banner",
    /\{#if inspection\.banner\}/.test(panel) && panel.includes("<BannerPatternEditor"),
  );
  check(
    "...and leaves the design out of the one-leaf NBT rows",
    /field\.path\[0\] !== "patterns"/.test(panel) &&
      /field\.path\[0\] !== "Patterns"/.test(panel) &&
      panel.includes("{#each nbtFields as field"),
  );
  check("the layers are a numbered list", /<ol id="banner-layers"/.test(editor) && editor.includes("{index + 1}."));
  check(
    "...with a delete, an add and a move per layer",
    editor.includes("remove(index)") &&
      editor.includes("onclick={add}") &&
      editor.includes("move(index, -1)") &&
      editor.includes("move(index, 1)"),
  );
  check("...capped at what the game draws", editor.includes("rows.length >= MAX_BANNER_LAYERS"));
  check(
    "the colour picker offers the sixteen dyes, in the cloth's own colours",
    /\{#each BANNER_COLORS as dye/.test(editor) && editor.includes("DYE_HEX[dye]"),
  );
  check("a paste takes only the design out of a /give command", editor.includes("splitBlockInput(text).bannerPatterns"));
  const change = app.slice(app.indexOf("async function changeBannerPatterns("), app.indexOf("async function changeNbtValue("));
  check(
    "a change is the inspector's setState, carrying the state and the design",
    /kind: "setState"/.test(change) &&
      /bannerPatterns: patterns/.test(change) &&
      /properties: \{ \.\.\.current\.properties \}/.test(change),
  );
  check("...wired to the panel", app.includes("onchangebanner={changeBannerPatterns}"));

  const pick = app.slice(app.indexOf("async function onPickMaterial("), app.indexOf("let blockRegistry"));
  check(
    "the middle button picks a banner up with its design",
    pick.includes("response.banner?.layers") && /banner_patterns=\[/.test(pick),
  );

  // A composed cloth grows the atlas, and the icons drawn against the old one
  // were thrown away and never asked for again: the hotbar went blank.
  const icons = readFileSync(path.join(RENDERER, "lib", "block_icons.svelte.ts"), "utf8");
  const adopt = icons.slice(icons.indexOf("function adoptAtlas("), icons.indexOf("function adoptAtlas(") + 2400);
  check(
    "an atlas that replaces another makes every icon reader ask again",
    /if \(!replacing\) return;[\s\S]*generation \+= 1;/.test(adopt) &&
      /export function iconsReady\(\): boolean \{\s*void generation;/.test(icons),
  );
  /*
   * ...and "replaces" means a new layout. A newer version of the same layout
   * only added tiles, so every icon already drawn is still right; treating it
   * as a replacement re-meshed nine hundred icons whenever a document lit a
   * furnace.
   */
  check(
    "a newer version of the same atlas layout keeps the icons drawn",
    /const replacing = atlasLayout !== null && atlasLayout !== nextLayout;/.test(adopt),
  );
}

// --- drawing without a vanishing point --------------------------------------
//
// The 2.5D mode. An orthographic frustum does not widen with depth, so
// "the same view" as a perspective camera is only well defined at one
// distance -- and picking the wrong one turns a projection toggle into a
// zoom, which is what it looks like when it is wrong.
console.log("\n--- orthographic projection ---");
{
  /*
   * The frustum matches the perspective one *at the orbit target*, which is
   * the arithmetic worth stating: half the height over the distance is the
   * tangent of half the field of view, and nothing else.
   */
  const height = orthoFrustumHeight(60, 100);
  check(
    "the frustum subtends the field of view at the target",
    Math.abs(height / 2 / 100 - Math.tan(Math.PI / 6)) < 1e-9,
    String(height),
  );
  check(
    "...so twice as far out shows twice as much",
    Math.abs(orthoFrustumHeight(60, 200) - 2 * height) < 1e-9,
  );

  /*
   * Zero is reachable: fly into the middle of a build, come back to orbit,
   * and the distance is whatever is left. A zero-height frustum is a
   * degenerate projection matrix, which draws nothing and reports nothing.
   */
  check("a camera sitting on its own target still has a frustum", orthoFrustumHeight(60, 0) > 0);
  check("...and so does one behind it", orthoFrustumHeight(60, -5) > 0);

  /*
   * Height is the invariant and width follows the aspect, the same way round
   * as `PerspectiveCamera.fov` -- which is vertical too, so a wider window
   * shows more at the sides rather than less top to bottom. On a square
   * viewport the two conventions agree, which is why this is stated at 2:1.
   */
  const wide = orthoBounds(10, 2);
  equal("a wide window keeps its height", [wide.top, wide.bottom], [5, -5]);
  equal("...and gains width", [wide.left, wide.right], [-10, 10]);
  const tall = orthoBounds(10, 0.5);
  equal("a tall one keeps it too", [tall.top, tall.bottom], [5, -5]);
  equal("...and loses width", [tall.left, tall.right], [-2.5, 2.5]);
  check("a degenerate aspect still gives a usable box", orthoBounds(10, 0).right > 0);

  /*
   * One field of view, used twice. The perspective camera is constructed
   * with it and the orthographic frustum is derived from it, so a literal 60
   * left at either call site is a toggle that resizes the build.
   */
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
  check("the viewer builds its camera with the shared field of view", /PerspectiveCamera\(ORBIT_FOV/.test(viewer));
  check("...and derives the orthographic frustum from the same one", viewer.includes("orthoFrustumHeight(ORBIT_FOV"));
  check("ORBIT_FOV is the 60 the viewport always used", ORBIT_FOV === 60);

  /*
   * Flight forces perspective. Not belt-and-braces over the greyed checkbox:
   * the setting is on disk, so a window that opens with `orthographic`
   * stored and goes straight into flight never passes through the control.
   */
  check(
    "flight is drawn with a point of view whatever the setting says",
    /cameraMode === \"fly" \|\| projection !== \"orthographic"/.test(viewer),
  );
  check("...and the flight controller is bound to that camera", viewer.includes("PointerLockControls(perspective"));

  /*
   * And the epsilons stay gone.
   *
   * Orthographic depth is linear, so precision is uniform and the coplanar
   * problem is *easier* than under perspective -- which is exactly the
   * argument someone reaches for when putting a hand-picked constant back.
   * It would be safe here and wrong again one checkbox later.
   */
  const NEAR = 0.1;
  const FAR = 512;
  check(
    "orthographic depth resolves finer than the perspective far corner",
    orthoDepthEpsilon(NEAR, FAR) < depthEpsilon(NEAR, FAR, (GRID_SIZE / 2) * Math.SQRT2),
  );
  check(
    "...and does not vary with distance, because there is no 1/z in it",
    orthoDepthEpsilon(NEAR, FAR) === orthoDepthEpsilon(NEAR, FAR),
  );
  check("the floor still wins by depth-buffer steps, not by world units", COPLANAR_OFFSET.units >= 1);
}

// --- the orbit turns around what you are looking at --------------------------
//
// `controls.target` used to be written exactly twice in the app's life: the
// box centre when a document opens, and 24 blocks ahead when flight hands
// back. Nothing but a pan moved it in between, because three's dolly changes
// the radius and never the target unless `zoomToCursor` says otherwise -- and
// it defaults to false. So on a large build every rotation swung on the radius
// the whole structure was framed at, and the compass, which faithfully kept
// that target, flew over the middle of the build wherever you were standing.
//
// The pivot itself is reseated from a raycast in a pointer handler, which this
// harness cannot drive. What *is* testable is the arithmetic that keeps the
// picture still while it moves -- and that is the half that would be left out.
console.log("\n--- the orbit turns around what you are looking at ---");
{
  /*
   * Orthographic frames from the distance to the target, so moving the pivot
   * with the camera still would resize the build on screen. The visible height
   * is `2 * d * tan(fov / 2) / zoom`, so scaling `d` by `k` has to scale `zoom`
   * by `k` -- exact, rather than a correction factor.
   */
  const visible = (distance: number, zoom: number): number =>
    orthoFrustumHeight(ORBIT_FOV, distance) / zoom;

  equal("a pivot that did not move leaves the zoom alone", zoomAfterPivot(2.5, 80, 80), 2.5);
  for (const [before, after] of [
    [80, 40],
    [40, 80],
    [819, 12],
  ]) {
    const zoom = zoomAfterPivot(1.75, before, after);
    check(
      `${before} to ${after} shows the same slice of the world`,
      Math.abs(visible(after, zoom) - visible(before, 1.75)) < 1e-9,
      `${visible(after, zoom)} against ${visible(before, 1.75)}`,
    );
  }
  /*
   * The target can be reached exactly -- fly into the middle of a build and
   * come back to orbit -- and a zoom of zero or infinity is a degenerate
   * projection matrix that draws nothing and reports nothing. Same guard, and
   * the same reason, as `orthoFrustumHeight`'s clamp.
   */
  equal("a pivot reached exactly changes nothing", zoomAfterPivot(1.5, 80, 0), 1.5);
  equal("...and neither does starting from nowhere", zoomAfterPivot(1.5, 0, 80), 1.5);

  /*
   * And the pivot itself lands on the **view axis**, which is the whole of
   * why moving it disturbs nothing. OrbitControls re-aims at the target on
   * every `update()`, so a target set to the cell that was under the pointer
   * -- off to one side by however far the pointer was from the middle --
   * turns the camera to face it, before the drag that asked for it has
   * begun. Reported as the camera snapping.
   */
  {
    // Straight ahead: the depth is the distance, and the target lands exactly
    // where it was picked.
    equal(
      "a point dead ahead gives its own distance",
      pivotDepth([0, 0, 0], [0, 0, -1], [0, 0, -40]),
      40,
    );
    /*
     * Off to the side by 30 degrees: the depth is the *projection*, which is
     * shorter than the distance to it. Taking the distance instead would be
     * the same snap by a longer route -- the pivot would sit past what was
     * picked, on the axis.
     */
    const off = pivotDepth([0, 0, 0], [0, 0, -1], [40 * Math.tan(Math.PI / 6), 0, -40]);
    equal("...and one off to the side gives its projection, not its range", off, 40);
    check(
      "...which is shorter than the range itself",
      Math.hypot(40 * Math.tan(Math.PI / 6), 40) > off,
    );
    // Behind the camera is negative, which is what the caller refuses on.
    check("a point behind the camera is negative", pivotDepth([0, 0, 0], [0, 0, -1], [0, 0, 8]) < 0);
    // The camera's own position is zero, not a small positive number: the
    // guard is `> minDistance` rather than `!== 0` for exactly this.
    equal("the camera's own position is no distance at all", pivotDepth([3, 4, 5], [0, 1, 0], [3, 4, 5]), 0);
  }
  /*
   * And the wiring, which runs from a pointer event and from a click on an
   * element, neither of which this harness delivers.
   */
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
  check(
    "the wheel pulls the pivot towards the pointer",
    /next\.zoomToCursor = true;/.test(viewer),
  );
  // A pivot that moves makes reaching it easy rather than theoretical, and at
  // zero distance there is nothing left to rotate about.
  check("...and the dolly has a floor under it", /next\.minDistance = [0-9.]+;/.test(viewer));

  check(
    "the rotate press reseats the pivot",
    /event\.button === 2 &&[\s\S]{0,400}?repivotAt\(event\.clientX, event\.clientY\)/.test(viewer),
  );
  /*
   * ...along the direction the camera is already facing, and **not** to the
   * point that was picked. Written the obvious way -- `controls.target.set`
   * with the cell's own centre -- it typechecks, it rotates about the right
   * place, and it snaps the view a fraction of a second before the drag.
   * Nothing else in this file can see the difference, because both spellings
   * put the pivot on the thing under the pointer.
   */
  const repivot = viewer.slice(viewer.indexOf("function repivotAt"));
  const inRepivot = repivot.slice(0, repivot.indexOf("\n  }"));
  check(
    "...on the axis the camera is already looking down",
    /controls\.target\.copy\(camera\.position\)\.addScaledVector\(pivotForward, after\)/.test(
      inRepivot,
    ),
  );
  check(
    "...and never at the point that was picked",
    !/controls\.target\.set\(/.test(inRepivot),
  );
  // The depth is what the orthographic zoom is compensated against too, or
  // the sides would be recomputed from a distance the target no longer has.
  check(
    "...and the orthographic zoom is compensated against that same depth",
    /zoomAfterPivot\(ortho\.zoom, before, after\)/.test(inRepivot),
  );
  /*
   * The compass reseats it too, and from the **centre of the canvas** rather
   * than from the pointer -- the pointer is over the compass, which is its own
   * element and not the scene. Without this the flight still goes round
   * `controls.target`, correctly, and that target is still the middle of the
   * document: the bug survives every check written about `orbitFor` and
   * `arcBetween`, which is why it is stated here about the call site.
   */
  const fly = viewer.slice(viewer.indexOf("function flyToAxis"));
  check(
    "the compass reseats it from the middle of the canvas",
    /repivotAt\(box\.left \+ box\.width \/ 2, box\.top \+ box\.height \/ 2\)/.test(
      fly.slice(0, fly.indexOf("\n  }")),
    ),
  );
  // ...before it reads the target it is going to fly around, or it would fly
  // around the one it was replacing.
  check(
    "...before it reads the target",
    fly.indexOf("repivotAt(") < fly.indexOf("const target = controls.target;"),
  );
}

// --- the compass in the corner ----------------------------------------------
//
// A viewport that orbits freely has no other answer to which way you are
// facing, and this app's whole subject is a world with named directions:
// `facing=north` is written into the file and is not derivable from the screen.
// Everything below is consulted from `requestAnimationFrame`, which this
// harness does not run, so the decision is here and only the trigger stays
// unobservable.
console.log("\n--- compass ---");
{
  const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
  const SIZE = 100;
  const faces: Face[] = ["up", "down", "north", "south", "east", "west"];

  /*
   * With the camera unrotated it looks down its own -Z, which in world
   * terms is *north* -- so north is the direction going away into the
   * screen and **south** is the handle pointing back out at the viewer.
   * That is the way round it is easy to state backwards, and stating it
   * backwards costs nothing visible: a compass whose near and far ends
   * are swapped still looks exactly like a compass.
   */
  const reach = HANDLE_REACH * (SIZE / 2);
  equal("east goes right", projectAxis("east", IDENTITY, SIZE).x, SIZE / 2 + reach);
  equal("west goes left", projectAxis("west", IDENTITY, SIZE).x, SIZE / 2 - reach);
  /*
   * The y flip is the one worth stating. View space has y upwards, a mouse
   * event has it downwards, and a compass mirrored top to bottom still looks
   * exactly like a compass.
   */
  equal("up goes towards the top", projectAxis("up", IDENTITY, SIZE).y, SIZE / 2 - reach);
  equal("down goes to the bottom", projectAxis("down", IDENTITY, SIZE).y, SIZE / 2 + reach);
  check(
    "looking north, it is south that faces the viewer",
    projectAxis("south", IDENTITY, SIZE).depth > projectAxis("north", IDENTITY, SIZE).depth,
  );

  /*
   * A quarter turn about Y takes the camera to look west, so the handle that
   * was on the right is now the one facing the viewer. This is the check that
   * fails if the projection uses the camera's rotation rather than its inverse
   * -- everything above passes either way, because the identity is its own.
   */
  const s = Math.SQRT1_2;
  const turned: Quat = { x: 0, y: s, z: 0, w: s };
  check(
    "turning the camera turns the compass with it",
    projectAxis("east", turned, SIZE).depth > 0.99,
    String(projectAxis("east", turned, SIZE).depth),
  );

  /*
   * Each handle picks itself -- from an angle where all six are separated.
   * Axis-aligned is the degenerate case rather than the ordinary one: two
   * of the handles land on top of each other in the middle, which is the
   * tie the rule below exists for and cannot be asserted through.
   */
  const oblique: Quat = { x: -0.2, y: 0.36, z: 0.08, w: 0.906 };
  for (const face of faces) {
    const spot = projectAxis(face, oblique, SIZE);
    equal(
      `a click on ${face} picks it`,
      axisAt({ x: spot.x, y: spot.y }, oblique, SIZE),
      face,
    );
  }
  equal("the gap between handles is nothing", axisAt({ x: 50, y: 50 }, oblique, SIZE), null);
  equal("nor is a corner", axisAt({ x: 2, y: 2 }, oblique, SIZE), null);

  /*
   * Nearest the viewer wins, not nearest the pointer.
   *
   * Looking straight north, the north and south handles project to the very
   * same point -- the centre -- and the one drawn on top is south, the one
   * pointing back out of the screen. Picking by distance would be a coin
   * toss between two exact ties, and half the time a click on the handle
   * under the cursor would fly the camera to the opposite side of the
   * build.
   */
  const at = projectAxis("north", IDENTITY, SIZE);
  equal(
    "two ends of one axis resolve to the near one",
    axisAt({ x: at.x, y: at.y }, IDENTITY, SIZE),
    "south",
  );
  check(
    "...which is the one the click was actually over",
    Math.abs(projectAxis("south", IDENTITY, SIZE).x - at.x) < 1e-9,
  );

  /*
   * Clicking a handle means show me this side, so the camera lands *on* that
   * axis: north puts it north of the build looking south, and up puts it
   * overhead looking down.
   */
  const target = { x: 10, y: 4, z: 6 };
  for (const face of faces) {
    const seat = orbitFor(face, target, 50);
    const step = FACE_VECTOR[face];
    const along =
      (seat.x - target.x) * step.x +
      (seat.y - target.y) * step.y +
      (seat.z - target.z) * step.z;
    check(`looking from ${face} seats the camera on that side`, along > 49, String(along));
    check(
      `...at the distance it was already orbiting from`,
      Math.abs(Math.hypot(seat.x - target.x, seat.y - target.y, seat.z - target.z) - 50) < 0.1,
    );
  }

  /*
   * The poles lean, and it is not cosmetic. OrbitControls takes its azimuth
   * from `atan2` of the horizontal offset, which straight overhead is
   * `atan2(0, 0)` -- zero by definition rather than by intent, so the view
   * would swing to whatever azimuth zero happens to be.
   */
  for (const pole of ["up", "down"] as const) {
    const seat = orbitFor(pole, target, 50);
    const lean = Math.hypot(seat.x - target.x, seat.z - target.z);
    check(`${pole} is not exactly over the target`, lean > 0, String(lean));
    check(`...but only just`, lean < 0.5, String(lean));
  }
  check(
    "a camera already at the target still gets a seat",
    Number.isFinite(orbitFor("north", target, 0).z),
  );

  /*
   * The flight goes *around* the build, not through it. A straight line between
   * two points on a sphere is a chord: a quarter turn lerped would pass a third
   * of the way into the structure and out the other side.
   */
  const centre = { x: 0, y: 0, z: 0 };
  const east = { x: 50, y: 0, z: 0 };
  const north = { x: 0, y: 0, z: -50 };
  const half = arcBetween(centre, east, north, 0.5);
  check(
    "half way round a quarter turn is still at the orbit radius",
    Math.abs(Math.hypot(half.x, half.y, half.z) - 50) < 1e-6,
    String(Math.hypot(half.x, half.y, half.z)),
  );
  check(
    "...which a straight line would not be",
    Math.hypot((east.x + north.x) / 2, 0, (east.z + north.z) / 2) < 49,
  );
  equal("the start is the start", arcBetween(centre, east, north, 0), east);
  check("the end is the end", Math.abs(arcBetween(centre, east, north, 1).z + 50) < 1e-6);

  /*
   * Antipodal is not exotic here: it is clicking north and then south. Two
   * opposite directions span no plane, so there is no arc between them and the
   * arithmetic has to choose one rather than divide by a sine of zero.
   */
  const south = { x: 0, y: 0, z: 50 };
  const across = arcBetween(centre, north, south, 0.5);
  check(
    "reversing an axis still goes round rather than through the middle",
    Math.abs(Math.hypot(across.x, across.y, across.z) - 50) < 1e-3,
    JSON.stringify(across),
  );
  check("...over the top, not through a wall", across.y > 49, JSON.stringify(across));
  check(
    "a radius of nothing does not divide by zero",
    Number.isFinite(arcBetween(centre, centre, north, 0.5).z),
  );

  equal("the ease starts still", easeInOutCubic(0), 0);
  equal("...and finishes still", easeInOutCubic(1), 1);
  equal("...and is half way at half way", easeInOutCubic(0.5), 0.5);
  check("a tick before the start is clamped", easeInOutCubic(-1) === 0);
  check("and one after the end", easeInOutCubic(2) === 1);

  /*
   * `done` is reported rather than inferred from the position: the last frame
   * of a flight is *at* the destination, so a caller comparing coordinates
   * would either hand control back a frame early or never hand it back.
   */
  const flight = { from: east, to: north, around: centre, startedAt: 1000 };
  check("a flight that has not started is at its start", flightAt(flight, 1000).position.x > 49.9);
  check("...and is not done", !flightAt(flight, 1000).done);
  check("one past its span is done", flightAt(flight, 1000 + 421).done);
  check("...and has arrived", Math.abs(flightAt(flight, 1000 + 421).position.z + 50) < 1e-6);
  check(
    "a zero-length flight cannot divide by zero",
    flightAt(flight, 1000, 0).done && Number.isFinite(flightAt(flight, 1000, 0).position.x),
  );

  /*
   * Six handles, three axes, and the two ends of each told apart. They share a
   * colour, so drawn the same a view from due east and one from due west would
   * be the same picture.
   */
  equal("there are six handles", COMPASS_AXES.length, 6);
  equal("...three colours between them", new Set(COMPASS_AXES.map((a) => a.token)).size, 3);
  equal("...one positive end each", COMPASS_AXES.filter((a) => a.positive).length, 3);
  equal("...and a distinct letter each", new Set(COMPASS_AXES.map((a) => a.label)).size, 6);

  /*
   * And it points where the writers point. A compass a quarter turn out of step
   * with the file is invisible until somebody pastes a build into a world and
   * finds it facing the wrong way.
   */
  check(
    "north on the gizmo is north in the schematic",
    FACE_VECTOR.north.z === -1 && FACE_VECTOR.east.x === 1,
  );

  /*
   * And the viewer asks this module rather than working any of it out again.
   *
   * The click handler is sliced out and checked as a *chain* rather than the
   * file being grepped for three names: every one of those names still
   * appears in a file where the handler computes a face and drops it, which
   * was verified by writing exactly that. A grep has to name the wiring.
   */
  const viewerSource = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
  const handlerFrom = viewerSource.indexOf("function onCompassClick");
  // Two spaces is the function's own indentation; every block inside it
  // closes further in.
  const handler = viewerSource.slice(handlerFrom, viewerSource.indexOf("\n  }", handlerFrom));
  check("there is a handler for a click on the gizmo", handlerFrom > 0 && handler.length > 0);
  check("...it asks this module which handle was hit", handler.includes("axisAt("));
  check("...and does something with the answer", /flyToAxis\(\s*face\s*\)/.test(handler));
  check("the camera is seated by this module", viewerSource.includes("orbitFor("));
  check("...and flown by it", viewerSource.includes("flightAt("));
  /*
   * Drawn in the same renderer, not a second one. A browser gives a page on
   * the order of sixteen live WebGL contexts before it starts silently
   * dropping the oldest, which is why the block icons already share one --
   * spending a context on an ornament would be the worst use of it there is.
   */
  equal(
    "the gizmo costs no second WebGL context",
    viewerSource.split("new THREE.WebGLRenderer").length - 1,
    1,
  );
  check("...it is a scissored pass over the one there is", viewerSource.includes("setScissorTest(true)"));
}

// --- how the viewport is drawn ----------------------------------------------
//
// Four graphics settings, and the two halves that can be stated here: the
// preset table, which is a pure module for exactly that reason, and the shape
// of the renderer code that consumes it, read out of the source the way every
// other fact about `Viewer.svelte` is.
console.log("\n--- how the viewport is drawn ---");
{
  /*
   * `vanilla` is the identity, and has to be spelled out rather than asserted
   * loosely: a preset called neutral that moved *anything* would change the
   * look for everyone who never opens the pane, which is a change nobody
   * asked for arriving in an upgrade.
   */
  const vanilla = shaderPreset("vanilla");
  check("vanilla changes nothing about the renderer", vanilla.toneMapping === "none" && vanilla.exposure === 1);
  check("...nor about either light", vanilla.sun === 1 && vanilla.ambient === 1);
  check("...nor about the environment", vanilla.environment === 1);

  /*
   * Total, for `Projection`'s reason: `coerceSettings` spreads `preview` over
   * the defaults without validating it, and that is only safe while a junk
   * value is indistinguishable from an absent one.
   */
  check("an unknown mode is vanilla", shaderPreset("banana") === vanilla);
  check("...and so is nothing at all", shaderPreset("") === vanilla);

  /*
   * And every offered mode does something. A mode in the picker that resolved
   * to the same numbers as another would be a name with nothing behind it --
   * which is what a preset list quietly rots into.
   */
  const shapes = SHADER_MODES.map((mode) => JSON.stringify(shaderPreset(mode)));
  check("every offered mode is a different look", new Set(shapes).size === SHADER_MODES.length, shapes.join(" | "));
  check("flat has no directional light at all", shaderPreset("flat").sun === 0);

  /*
   * The multisampling level is read the same way, and its fallback is the
   * *default* rather than zero: a value this build does not recognise -- one
   * a newer build wrote, or a hand-edited file -- must not turn anti-aliasing
   * off in silence.
   */
  for (const level of AA_LEVELS) {
    check(`${level} samples is offered and kept`, antialiasSamples(level) === level);
  }
  check("a level nobody offers falls back", antialiasSamples(16) === DEFAULT_PREVIEW_SETTINGS.antialias);
  check("...and so does a string", antialiasSamples("4") === DEFAULT_PREVIEW_SETTINGS.antialias);
  check("...and the fallback is not off", antialiasSamples(undefined) !== 0);

  /*
   * The frame rate cap is read the same way, and its fallback is no cap: that
   * is the default, and a junk value has to behave like an absent one.
   */
  for (const cap of FPS_CAPS) {
    check(`a cap of ${cap} is offered and kept`, fpsCap(cap) === cap);
  }
  check("the default is no cap", DEFAULT_PREVIEW_SETTINGS.maxFps === 0);
  check("a cap nobody offers falls back to none", fpsCap(75) === 0);
  check("...and so does a negative one", fpsCap(-30) === 0);
  check("...and so does a string", fpsCap("60") === 0);

  /*
   * The context asks for the GPU the launch switch forced, and "auto" is the
   * browser's default rather than a guess. Read once, where it is made.
   */
  check("auto asks for the default GPU", webglPowerPreference("auto") === "default");
  check("high performance asks for it", webglPowerPreference("high-performance") === "high-performance");
  check("low power asks for it", webglPowerPreference("low-power") === "low-power");
  check("a junk preference asks for the default", webglPowerPreference("fast") === "default");
  {
    const viewerText = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
    check(
      "the viewport context is created with the GPU preference",
      /new THREE\.WebGLRenderer\(\{[^}]*powerPreference: webglPowerPreference\(/.test(viewerText),
    );
  }

  /*
   * One select, two settings: a preference by power, or one card by key. The
   * option value says which, so a key can never be read as a preference and
   * picking a preference clears the card.
   */
  {
    const key = "10de:249c:151e1025:a1#0";
    check("a stored card is the select's value", choiceValue("high-performance", key) === `adapter:${key}`);
    check("...and a preference without one", choiceValue("low-power", null) === "low-power");
    check("a junk card is not a value", choiceValue("auto", "the big one") === "auto");
    const picked = parseChoiceValue(`adapter:${key}`);
    check("picking a card stores it", picked.gpuAdapter === key && picked.gpuPreference === "auto");
    const pref = parseChoiceValue("high-performance");
    check("picking a preference clears the card", pref.gpuAdapter === null && pref.gpuPreference === "high-performance");
    const launch = {
      preference: "auto" as const,
      adapter: key,
      method: "luid" as const,
      luid: "0,1",
      adapterName: "RTX",
      note: null,
    };
    check("the launched card needs no restart", !gpuNeedsRestart("auto", key, launch));
    check("...and a different preference under it changes nothing", !gpuNeedsRestart("low-power", key, launch));
    check("another card does", gpuNeedsRestart("auto", "1002:1638:151e1025:c5#0", launch));
    check("...and so does going back to a preference", gpuNeedsRestart("high-performance", null, launch));
    check("memory reads in GB", formatMemory(8405385216) === "8 GB");
    check("...or MB under one", formatMemory(519847936) === "496 MB");
    check("...and says nothing when unknown", formatMemory(0) === "");
    check(
      "the pixel load follows the viewer's own sizing",
      pixelLoad(1707, 960, 1.5, 1.6, 2) === Math.floor(1707 * 3) * Math.floor(960 * 3),
    );
    check("max DPR caps the device ratio", pixelLoad(100, 100, 3, 1, 1) === 10000);
    const pane = readFileSync(path.join(RENDERER, "lib", "SettingsModal.svelte"), "utf8");
    check("the select's value is the stored choice", pane.includes("value={gpuSelectValue}") && pane.includes("return choiceValue(pref, gpuAdapter)"));
    check("...and a change writes both fields", pane.includes("onpreviewchange(parseChoiceValue(event.currentTarget.value))"));
    check("the cards are listed only where one can be chosen", pane.includes("{#if gpuChoosable && gpu?.adapters}"));
    check("...and there they replace the two presets", pane.includes('gpuChoosable ? (["auto"] as const) : GPU_PREFERENCES'));
    check("the restart is offered from main's launch, not from the setting alone", pane.includes("gpuNeedsRestart(settings.preview.gpuPreference, settings.preview.gpuAdapter, gpu.launch)"));
    check("the copied report carries what main launched and what draws", /gpuLaunch: status\?\.launch/.test(pane) && /gpuActive: status\?\.active/.test(pane));
  }

  /*
   * The loop's decision, driven by a fake display. Counted over ten seconds so
   * a rate that converges slowly, or drifts, shows up as a number.
   */
  const drawn = (hz: number, cap: number, jitter = 0): number => {
    let anchor = 0;
    let count = 0;
    for (let i = 1; i <= hz * 10; i++) {
      const wobble = jitter * (i % 2 === 0 ? 1 : -1);
      const due = frameDue(1000 + (i * 1000) / hz + wobble, anchor, cap);
      anchor = due.anchor;
      if (due.draw) count++;
    }
    return count / 10;
  };
  check("no cap draws every refresh", drawn(144, 0) === 144);
  const at60on144 = drawn(144, 60);
  check("a cap of 60 on 144Hz draws 60 a second", Math.abs(at60on144 - 60) <= 1, String(at60on144));
  const at30on60 = drawn(60, 30);
  check("a cap of 30 on 60Hz draws 30 a second", Math.abs(at30on60 - 30) <= 1, String(at30on60));
  const matched = drawn(60, 60, 0.4);
  check("a cap equal to a jittery display drops nothing", matched === 60, String(matched));
  const over = drawn(60, 144);
  check("a cap above the display changes nothing", over === 60, String(over));
  const stalled = frameDue(10_000, 1000, 60);
  check("after a stall the anchor moves to now rather than bursting", stalled.draw && stalled.anchor === 10_000);

  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");

  /*
   * The cap returns before `getDelta`, so the delta spans the skipped
   * refreshes and flight keeps its speed. After it, the camera would slow down
   * with the cap and nothing else would fail.
   */
  {
    const loop = viewer.slice(viewer.indexOf("const animate = () => {"));
    const skip = loop.indexOf("if (!due.draw) return;");
    const delta = loop.indexOf("clock.getDelta()");
    check("the frame cap is asked in the loop", skip > 0, "no early return in animate");
    check("...before the clock is read", skip > 0 && delta > skip);
  }

  /*
   * The stutter profiler. What counts as a spike is relative *and* absolute:
   * relative, or a 30 cap would be a stream of spikes; absolute, or a steady
   * 144Hz display would report every 21ms hiccup.
   */
  check("the median of an odd list is its middle", median([5, 1, 3]) === 3);
  check("...of an even one the mean of the two middles", median([4, 1, 3, 2]) === 2.5);
  check("a 300ms frame among 16ms ones is a spike", isSpike(300, 16.7));
  check("a steady 33ms frame at a 30 cap is not", !isSpike(33.3, 33.3));
  check("21ms at 144Hz is under the floor", !isSpike(21, 6.9));
  check("a window coming back from the background is a pause", !isSpike(PAUSE_MS + 1, 16.7));

  check("the heaviest phase is the culprit", culpritOf({ camera: 2, "hover raycast": 280 }, 10) === "hover raycast");
  check("...unless more time went outside the loop", culpritOf({ camera: 2, "hover raycast": 3 }, 295) === OUTSIDE);

  {
    // A fake clock: 60 steady frames, then one interval of 300ms in which the
    // loop measured 5ms, then steady again.
    const found: string[] = [];
    const profiler = new FrameProfiler({ onSpike: (spike) => found.push(spike.culprit) });
    let now = 1000;
    const frame = (gap: number, phases: Record<string, number>) => {
      profiler.beginFrame(now);
      let at = now;
      for (const [name, ms] of Object.entries(phases)) {
        profiler.phase(name, at, at + ms);
        at += ms;
      }
      now += gap;
    };
    for (let i = 0; i < 60; i++) frame(16.7, { camera: 1, "scene pass": 3 });
    frame(300, { camera: 1, "scene pass": 4 });
    for (let i = 0; i < 10; i++) frame(16.7, { camera: 1, "scene pass": 3 });
    profiler.beginFrame(now);
    check("one stall makes one spike", found.length === 1, found.join(", "));
    check("...blamed outside the loop", found[0] === OUTSIDE);
    const spike = profiler.spikes[0];
    check("...with the loop's own time kept apart", Math.abs(spike.work - 5) < 1e-9 && Math.abs(spike.outside - 295) < 1e-9);
    check(
      "...read as nobody's script when the browser named none",
      readingOf(spike).includes("GPU"),
      readingOf(spike),
    );

    // A long frame the browser reports late still joins the spike it overlaps,
    // and one from a different moment does not.
    const script: LongFrame = {
      kind: "long-animation-frame",
      start: spike.start + 20,
      duration: 250,
      scripts: [{ source: "app.js", fn: "applyDelta", invoker: "effect", ms: 240 }],
    };
    const elsewhere: LongFrame = { ...script, start: spike.start - 5000 };
    profiler.addLongFrame(script);
    profiler.addLongFrame(elsewhere);
    check("a late long frame joins the spike it overlaps", spike.longFrames.includes(script));
    check("...and one from another moment does not", !spike.longFrames.includes(elsewhere));
    check("...and then names the script", readingOf(spike).includes("script"));

    const report = profiler.report({ gpu: "test" }) as {
      context: { gpu: string };
      frames: { p50: number; max: number; count: number };
      spikes: { culprit: string }[];
      culprits: Record<string, number>;
    };
    check("the report carries its context", report.context.gpu === "test");
    check("...percentiles of the frame time", Math.abs(report.frames.p50 - 16.7) < 0.1 && report.frames.max === 300);
    check("...and the spikes by culprit", report.culprits[OUTSIDE] === 1 && report.spikes.length === 1);
    check("the worst recent frame is the stall", profiler.worst(now, 10_000)?.gap === 300);
    check("...and is gone once it is old", profiler.worst(now, 50)?.gap !== 300);
  }

  /*
   * Not diagnosing costs nothing: every hook goes through three helpers, and
   * each of them is a null check first. A hook written around them would be
   * measured whether anybody asked or not.
   */
  {
    const body = (name: string) => {
      const start = viewer.indexOf(`function ${name}(`);
      return start < 0 ? "" : viewer.slice(start, viewer.indexOf("\n  }", start));
    };
    check("stamp reads no clock without a profiler", /return profiler \? performance\.now\(\) : 0;/.test(body("stamp")));
    check("lap does nothing without one", /if \(profiler\) profiler\.phase\(/.test(body("lap")));
    check("note does nothing without one", /if \(!profiler\) return;/.test(body("note")));
    const loop = viewer.slice(viewer.indexOf("const animate = () => {"));
    check(
      "the loop opens an interval only while diagnosing",
      loop.includes("if (profiler) profiler.beginFrame(performance.now());"),
    );
  }

  /*
   * Only the animated tiles the geometry draws are played. The atlas holds
   * every animated texture the process has decoded -- 34 in the first stutter
   * report, for a document using none -- and each upload is where the loop
   * waits for the GPU.
   */
  {
    // A 64x64 atlas with three 16px tiles, and quads whose UVs are a tile's
    // rect inset half a pixel, which is what the mesher writes.
    const W = 64;
    const tiles = [
      { x: 0, y: 0, size: 16 },
      { x: 18, y: 0, size: 16 },
      { x: 36, y: 18, size: 16 },
    ];
    const quad = (tile: { x: number; y: number; size: number }): number[] => {
      const u0 = (tile.x + 0.5) / W;
      const v0 = (tile.y + 0.5) / W;
      const u1 = (tile.x + tile.size - 0.5) / W;
      const v1 = (tile.y + tile.size - 0.5) / W;
      return [u0, v0, u1, v0, u1, v1, u0, v1];
    };
    const still = { x: 36, y: 0, size: 16 };
    const used = (...quads: number[][]) => animationsUsed(new Float32Array(quads.flat()), tiles, W, W);
    check("a quad in an animated tile marks that tile", JSON.stringify(used(quad(tiles[2]))) === "[2]");
    check("a quad in a still tile marks nothing", used(quad(still)).length === 0);
    check("two quads in two tiles mark both", JSON.stringify(used(quad(tiles[0]), quad(still), quad(tiles[1]))) === "[0,1]");
    check("no geometry marks nothing", used().length === 0);
    // The half-pixel inset is inside; the tile's own edge is the padding.
    const edge = new Float32Array([18 / W, 0.5 / W, 0, 0, 0, 0, 0, 0]);
    check("a UV on a tile's outer edge is the padding, not the tile", !animationsUsed(edge, tiles, W, W).includes(1));

    const loop = viewer.slice(viewer.indexOf("function playAnimations("));
    check(
      "an animation nobody draws is not uploaded",
      /for \(const item of playing\) \{\s*if \(!item\.active\) continue;/.test(loop),
    );
    const effect = viewer.slice(viewer.indexOf("applyDelta(previous, previousVoid, previousLod, payload, map);"));
    check("the tiles drawn are recounted after a delta", /applyDelta[^]*?refreshAnimated\(\);[^]*?applied\("delta applied"\)/.test(effect));
    check("...and after a rebuild", /applyWireframe\(built\.solid, wireframe\);\s*refreshAnimated\(\);/.test(viewer));
  }

  {
    // The first upload of a tick holding the time is the GPU being behind.
    const profiler = new FrameProfiler();
    let now = 0;
    for (let i = 0; i < 40; i++) {
      profiler.beginFrame(now);
      profiler.phase(i === 30 ? "texture animations: first upload" : "scene pass", now, now + (i === 30 ? 300 : 1));
      now += i === 30 ? 301 : 17;
    }
    profiler.beginFrame(now);
    const spike = profiler.spikes[0];
    check("a first-upload spike is read as the GPU", spike !== undefined && readingOf(spike).includes("GPU"));
  }

  {
    // A slow phase is named, and the ring does not grow without end.
    const profiler = new FrameProfiler({ frames: 50 });
    let now = 0;
    for (let i = 0; i < 200; i++) {
      profiler.beginFrame(now);
      const slow = i === 150 ? 280 : 1;
      profiler.phase("hover raycast", now, now + slow);
      now += slow + 15;
    }
    profiler.beginFrame(now);
    check("a slow phase is the spike's culprit", profiler.spikes[0]?.culprit === "hover raycast");
    check("the frame ring keeps its size", profiler.recorded === 50);
  }

  /*
   * The context is created without its own anti-aliasing, and the scene is
   * drawn into a multisampled target instead. That flag is fixed for the life
   * of the context, so a setting built on it could only apply at the next
   * launch -- a live control that does nothing, which is the Stop button's
   * fault in another pane.
   */
  check("the context asks for no anti-aliasing of its own", viewer.includes("antialias: false"));
  check("...and the samples go on a render target", viewer.includes("new THREE.WebGLRenderTarget("));

  /*
   * The compass is drawn into its own multisampled square before the copy and
   * laid on by it, so it is anti-aliased like the rest. A pass that landed on
   * the canvas after the copy would be the one unaliased thing on screen.
   */
  check("the compass is drawn before the frame is copied out", viewer.indexOf("renderer.render(aaScene") > viewer.indexOf("drawCompass();"));
  check("...and laid on by the copy", viewer.indexOf("compositeCompass();") > viewer.indexOf("renderer.render(aaScene"));

  /*
   * The counter reports a whole frame, and a frame is three or four renders.
   * `info` resets itself at the start of each one unless told not to, so
   * without this the triangle count is the compass's.
   */
  check("the counter is told not to reset itself per render", viewer.includes("renderer.info.autoReset = false"));

  /*
   * The two lights are written in exactly one place. `applySky` decides what
   * the hour asks for and the preset scales it; a second site writing an
   * intensity outright is how the mode comes to be silently overruled by
   * whichever ran last.
   */
  const writes = (what: string) => (viewer.match(new RegExp(`${what}\\.intensity =`, "g")) ?? []).length;
  equal("the sun's intensity is written once", writes("sun"), 1);
  equal("...and the ambient's once", writes("ambient"), 1);

  /*
   * And global illumination needs the sky, because the environment *is* the
   * sky dome. Turning the sky off has to take it down with it, or the last one
   * built stays on the scene lighting the build from a sky nobody is drawing.
   */
  const usingEnv = viewer.slice(
    viewer.indexOf("function usingEnvironment"),
    viewer.indexOf("function usingEnvironment") + 200,
  );
  check("the environment needs the sky as well as the setting", usingEnv.includes("globalIllumination && sky"));
}

// --- invisible from the inside ----------------------------------------------
//
// The block mesh is drawn front-side only, so a wall's far face is rejected at
// the raster stage instead of being shaded and then thrown away by the depth
// test. What makes that safe is `tests/blocks.ts`: every face's winding agrees
// with the normal it declares. What makes it *narrow* is here -- the other two
// layers stay double-sided, and each has a reason a screenshot would not give
// back.
//
// Source, because a material is a fact about a renderer this harness has no
// frames from.
console.log("\n--- invisible from the inside ---");
{
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
  const between = (from: string, to: string): string =>
    viewer.slice(viewer.indexOf(from), viewer.indexOf(to));

  const opaque = between("function ensureMaterial", "function ensureBlendedMaterial");
  check("there is an opaque block material to check", opaque.length > 0);
  check("the block mesh is drawn front-side only", opaque.includes("side: THREE.FrontSide"));

  /*
   * Water is the surface of a pond seen from underneath, which is a place a
   * person in this app actually stands: single-sided it would have no ceiling.
   * The void block is the medium the work happens *inside*, so its inside is
   * the ordinary view. Neither is an oversight, so both are stated.
   */
  const water = between("function ensureBlendedMaterial", "function ensureVoidMaterial");
  const empty = between("function ensureVoidMaterial", "function shadeWithBakedLight");
  check("...the water is not, because a pond has an underside", water.includes("side: THREE.DoubleSide"));
  check("...nor is the void, which is stood inside", empty.includes("side: THREE.DoubleSide"));
}

// --- the schematic's own box -------------------------------------------------
//
// The build inside a document is not its edge: empty room at the top of a box
// looks exactly like empty space outside one, so without the cage there is no
// way to see how much is left except by running out of it.
console.log("\n--- bounds cage ---");
{
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");

  check("the viewer builds a cage for the document's box", viewer.includes("function buildBounds"));
  /*
   * It has to follow a resize, because the cage *is* the size -- and unlike the
   * grid, which only moves, it is rebuilt: a scaled cube would need its own
   * inverse to keep the edge lines an even width.
   */
  check("...and rebuilds it when the size changes", /void documentSize;[^}]*buildBounds\(\)/s.test(viewer));

  /*
   * And it is never raycast. This is the half that would go wrong silently: a
   * transparent cage around the whole build, handed to the picker, swallows
   * every click meant for a block inside it -- and the click still *does*
   * something, so it reads as the inspector picking the wrong block rather
   * than as the cage being in the way.
   *
   * Checked by requiring the block raycast to name `loaded` and nothing else,
   * which is what keeps a new decorative object out of it by default.
   */
  const casts = viewer.match(/raycaster\.intersectObjects?\([^)]*\)/g) ?? [];
  check("there are raycasts to check", casts.length > 0);
  check(
    "no raycast reaches the cage",
    casts.every((cast) => !cast.includes("bounds")),
    casts.join(" | "),
  );
  check(
    "...the block pick tests the structure alone",
    casts.some((cast) => cast.includes("intersectObject(loaded")),
  );
}

// --- a click passes through the void ----------------------------------------
//
// Empty space made of water is only usable if the pointer ignores it. The rule
// is one object: every raycast in the viewer names `loaded`, so the void living
// in a group beside it is the whole of what makes a click reach the build
// inside. Checked by reading the source, because `Mesh.raycast` runs from the
// rendering steps and this harness composites no frames.
console.log("\n--- the void block ---");
{
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");

  check("the void has a group of its own", viewer.includes("voidLoaded"));
  const casts = viewer.match(/raycaster\.intersectObjects?\([^)]*\)/g) ?? [];
  check("there are raycasts to check", casts.length > 0);
  check(
    "none of them reaches it",
    casts.every((cast) => !cast.includes("voidLoaded")),
    casts.join(" | "),
  );

  /*
   * Two layers of one chunk are two meshes under one number, so the map has to
   * be keyed on the pair. Keyed on the number alone a void chunk would evict
   * the solid chunk beside it, and the build would develop holes wherever
   * there was empty space next to it -- a delta only, so it would appear on
   * the second edit and not the first.
   */
  check("chunk meshes are keyed by layer as well as key", /chunkMeshes = new Map<string,/.test(viewer));
  check("...through one place that decides the id", viewer.includes("function meshId("));

  /*
   * A material of its own is not a nicety: the opacity is a material property,
   * and it is what forces the separate object that buys the picking rule.
   */
  check("the void draws with a material of its own", viewer.includes("function ensureVoidMaterial"));
  check("...whose opacity is the setting", /voidMaterial\.opacity = voidOpacity/.test(viewer));

  /*
   * And it casts no shadow. A document-sized volume of it would put the whole
   * build in its own shade -- and it is not there in the sense a shadow means.
   */
  /*
   * Both places that build a chunk mesh, counted rather than found.
   *
   * There are two -- the full build and the delta -- and a check that merely
   * *finds* the rule passes while one of them has lost it. That is the shape
   * of the fault this would be: the shadow appears only after an edit, and
   * only in the chunk the edit touched.
   */
  const prepared = viewer.match(/prepareMesh\(mesh, chunk\.layer\);/g) ?? [];
  equal("both places that build a chunk mesh prepare it in one place", prepared.length, 2);
  const prepare = viewer.slice(viewer.indexOf("function prepareMesh("));
  check(
    "...where neither lets the void cast a shadow or receive one",
    /mesh\.castShadow = layer === "solid";\s*mesh\.receiveShadow = layer !== "void";/.test(prepare),
  );
}

// --- undo that reaches the selection ---------------------------------------
//
// Ctrl+Z used to reach only the main process, because only the main process had
// anything to undo. So dragging a face across a build, seeing it was wrong, and
// pressing Ctrl+Z undid the last *block edit* -- destroying work in answer to a
// request to undo a highlight.
//
// The rule is one sentence: a selection is undone only while no block edit has
// landed on top of it. `undoDepth` is what makes that answerable.
console.log("\n--- selection history ---");
{
  const box = (n: number) => ({ minX: n, minY: 0, minZ: 0, maxX: n, maxY: 0, maxZ: 0 });
  const at = (n: number): SelectionState => ({ selection: box(n), anchor: { x: n, y: 0, z: 0 } });
  const none: SelectionState = { selection: null, anchor: null };

  // Nothing recorded, nothing to do -- and "none" rather than a document undo
  // that main would refuse.
  equal("an empty timeline with a clean document has nothing to undo", undoTarget(emptyTimeline(), 0, false), "none");
  equal("...but defers to the document when it has something", undoTarget(emptyTimeline(), 3, true), "document");

  // A selection made since the last block edit comes back first.
  let timeline = recordSelection(emptyTimeline(), 0, none, at(1));
  equal("a fresh selection is the thing to undo", undoTarget(timeline, 0, true), "selection");

  /*
   * ...and a block edit on top of it buries it. This is the whole feature: the
   * selection is still on the stack, but the last thing that happened was the
   * fill, so that is what Ctrl+Z takes.
   */
  timeline = recordDocumentEdit(timeline, 1);
  equal("a block edit on top takes precedence", undoTarget(timeline, 1, true), "document");
  // Undoing it puts the depth back, and the selection surfaces again.
  equal("...and once it is undone the selection surfaces", undoTarget(timeline, 0, false), "selection");

  // Restoring walks back through the recorded states.
  let stack = recordSelection(emptyTimeline(), 0, none, at(1));
  stack = recordSelection(stack, 0, at(1), at(2));
  const first = takeUndo(stack);
  equal("undo restores what was there before the last change", first?.state.selection, box(1));
  const second = takeUndo(first!.timeline);
  equal("...and then before the one before that", second?.state.selection, null);
  equal("nothing left to take", takeUndo(second!.timeline), null);

  // Redo is the mirror, and only while the depth still matches.
  const back = takeRedo(second!.timeline);
  equal("redo puts the change back", back?.state.selection, box(1));
  equal("redo knows there is one waiting", redoTarget(second!.timeline, 0, false), "selection");

  /*
   * A new change discards the redo stack, as it does in any editor: once you
   * branch, the future you branched away from is gone.
   */
  const branched = recordSelection(second!.timeline, 0, none, at(9));
  equal("a new change drops the redo stack", branched.redo.length, 0);
  equal("...and is the thing to redo nothing of", redoTarget(branched, 0, false), "none");

  /*
   * Steps stranded above the current depth go. They belong to block edits that
   * were undone and then written over -- main has already dropped its own redo,
   * and keeping ours would offer to restore a selection into a document that
   * never had it.
   */
  let stranded = recordSelection(emptyTimeline(), 2, none, at(5));
  stranded = recordDocumentEdit(stranded, 1);
  equal("a selection above the new depth is dropped", stranded.undo.length, 0);

  /*
   * The same, reached the other way: a block edit is undone -- which lowers the
   * depth without `recordDocumentEdit` ever running -- and then a new selection
   * is made. The step recorded at the higher depth belongs to a future main has
   * already dropped, so recording must drop it too.
   */
  let afterUndo = recordSelection(emptyTimeline(), 1, none, at(4));
  afterUndo = recordSelection(afterUndo, 0, none, at(6));
  equal("recording at a lower depth strands nothing above it", afterUndo.undo.length, 1);
  equal("...and what remains is the new one", afterUndo.undo[0].after.selection, box(6));

  // A change to nothing is not a change.
  equal(
    "recording the same selection twice records once",
    recordSelection(recordSelection(emptyTimeline(), 0, none, at(1)), 0, at(1), at(1)).undo.length,
    1,
  );
}

console.log("\n--- the history position does not stop at the undo cap ---");
{
  /*
   * Main's undo stack holds 200 transactions. Keyed by its length, the ordering
   * stopped moving at the cap: a selection made at 200, then a fill that left
   * the length at 200, and Ctrl+Z went to the selection, then to every
   * selection before it, and never to the blocks. Reported as undo moving the
   * selections back and not the blocks. The key is the top transaction's id,
   * which keeps rising.
   */
  const box = (n: number) => ({ minX: n, minY: 0, minZ: 0, maxX: n, maxY: 0, maxZ: 0 });
  const at = (n: number): SelectionState => ({ selection: box(n), anchor: { x: n, y: 0, z: 0 } });
  const none: SelectionState = { selection: null, anchor: null };

  const selected = recordSelection(emptyTimeline(), 200, none, at(1));
  equal("keyed by the length, a fill at the cap loses the press to the selection", undoTarget(selected, 200, true), "selection");
  equal("keyed by the id, the fill after the selection takes it", undoTarget(recordDocumentEdit(selected, 201), 201, true), "document");

  const moved = recordEditSelection(selected, 200, at(1), at(7));
  equal("a gizmo move at the cap is still one press: the blocks first", undoTarget(moved, 201, true), "document");
  equal("...and the box comes back with them", takeEditUndo(moved, 200)?.state.selection, box(1));

  // The renderer must key on the id, everywhere: one site reading the length is
  // the bug back at that site.
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8")
    .replace(/\/\*[^]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
  equal("App.svelte orders the selection history by nothing called undoDepth", app.match(/undoDepth/g)?.length ?? 0, 0);
  check(
    "...and the history position is the top transaction's id",
    /docState\?\.undoTransactionId \?\? 0/.test(app) && /docState\.undoTransactionId \?\? 0/.test(app),
  );
}

// --- the creative inventory ------------------------------------------------
//
// Nine hundred blocks is nine hundred one-block meshes if drawn naively, and
// the panel shows about sixty. So the grid is virtualised, which means the
// visible slice has to be computed from a scroll offset -- and a scroll offset
// is not something this harness can produce, so the arithmetic lives apart from
// the component and only the scrolling stays unobservable.
console.log("\n--- a gesture that moved both is one press ---");
{
  /*
   * The gizmo's move, turn and scale change the blocks *and* the box. Recorded
   * apart they cost two presses of Ctrl+Z: one to put the box back on the space
   * the blocks had left, one to put the blocks back. Reported as exactly that.
   *
   * The pairing is a step keyed to the depth *before* the edit and flagged, so
   * it does not answer `undoTarget` while the depth is up -- and `takeEditUndo`
   * hands it back the moment the document comes down to meet it.
   */
  const box = (n: number) => ({ minX: n, minY: 0, minZ: 0, maxX: n, maxY: 0, maxZ: 0 });
  const at = (n: number): SelectionState => ({ selection: box(n), anchor: { x: n, y: 0, z: 0 } });

  // Depth was 4 before the edit and is 5 after it.
  const paired = recordEditSelection(emptyTimeline(), 4, at(1), at(7));

  equal(
    "a step that rode in with an edit does not claim the press",
    undoTarget(paired, 5, true),
    "document",
  );
  equal(
    "...and is handed back once the document has come back to it",
    takeEditUndo(paired, 4)?.state.selection,
    box(1),
  );
  equal(
    "...but not at a depth it does not belong to",
    takeEditUndo(paired, 5),
    null,
  );
  /*
   * And once the document is back down at it -- undone by something that did
   * not go through `undoAnything`, which the chat panel's per-message undo does
   * -- the box is the thing left to put back, so it claims the press after all.
   * The undo side deliberately has no `withEdit` clause; the redo side does.
   */
  equal(
    "...and once the blocks are back it is the box that is left",
    undoTarget(paired, 4, true),
    "selection",
  );

  /*
   * The check that separates the pair from the ordinary case. Without it the
   * flag could be ignored everywhere and every one of these would still pass:
   * a selection somebody made on purpose has to go on claiming its own press,
   * and must not be swallowed by an undo of the edit above it.
   */
  const ordinary = recordSelection(emptyTimeline(), 4, at(1), at(7));
  equal(
    "an ordinary step at the current depth still claims it",
    undoTarget(ordinary, 4, true),
    "selection",
  );
  equal(
    "...and is not swallowed by a document undo",
    takeEditUndo(ordinary, 4),
    null,
  );

  /*
   * The redo side, which has to be asked *before* main is told -- a redo raises
   * the depth exactly as a fresh edit does, so the depth watcher clears the redo
   * stack and the step would already be gone.
   */
  const undone = takeEditUndo(paired, 4);
  equal("undoing the pair leaves it on the redo stack", undone?.timeline.redo.length, 1);
  equal(
    "...where the redo does not claim the press either",
    redoTarget(undone?.timeline ?? emptyTimeline(), 4, true),
    "document",
  );
  equal(
    "...and it comes back pointing forwards",
    takeEditRedo(undone?.timeline ?? emptyTimeline(), 4)?.state.selection,
    box(7),
  );
  equal(
    "a redo of nothing paired is nothing",
    takeEditRedo(emptyTimeline(), 4),
    null,
  );

  // A gesture that moved nothing is not a step, paired or otherwise.
  equal("a pair that changed nothing records nothing", recordEditSelection(emptyTimeline(), 4, at(1), at(1)).undo.length, 0);
}
console.log("\n--- creative inventory ---");
{
  const base = { count: 100, columns: 10, rowHeight: 50, viewportHeight: 200 };

  const top = gridWindow({ ...base, scrollTop: 0 });
  equal("at the top it starts at the first row", top.firstRow, 0);
  equal("...and knows how many rows there are", top.totalRows, 10);
  /*
   * Four rows fit; the overscan adds two below. Drawing exactly what fits shows
   * empty tiles for as long as an icon takes to build, which for a mesh made in
   * main is long enough to see.
   */
  equal("...drawing the visible rows plus overscan", top.lastRow, 4 + OVERSCAN_ROWS);

  const middle = gridWindow({ ...base, scrollTop: 250 });
  equal("scrolled down, it starts an overscan above the fold", middle.firstRow, 5 - OVERSCAN_ROWS);
  equal("...and the index follows the row", middle.firstIndex, (5 - OVERSCAN_ROWS) * 10);

  /*
   * Both ends clamp. A scroll offset can be negative during an elastic
   * overscroll and can exceed the content while the list is being refiltered
   * under the scroller -- neither is a state the grid should answer with a
   * negative row or an index past the end.
   */
  const above = gridWindow({ ...base, scrollTop: -400 });
  equal("an overscroll upwards still starts at zero", above.firstRow, 0);
  const past = gridWindow({ ...base, scrollTop: 99999 });
  check("...and one past the end never exceeds the row count", past.lastRow <= past.totalRows, String(past.lastRow));
  check("...nor the item count", past.lastIndex <= base.count, String(past.lastIndex));

  // A partly-filled last row must not ask for tiles that do not exist.
  const ragged = gridWindow({ count: 93, columns: 10, rowHeight: 50, viewportHeight: 1000, scrollTop: 0 });
  equal("a ragged last row stops at the real count", ragged.lastIndex, 93);
  equal("...but still gets a row of its own", ragged.totalRows, 10);

  // Zero columns is a layout that has not measured itself yet, not a division
  // by zero.
  const unmeasured = gridWindow({ count: 10, columns: 0, rowHeight: 0, viewportHeight: 0, scrollTop: 0 });
  check("an unmeasured grid answers something sane", Number.isFinite(unmeasured.totalRows) && unmeasured.totalRows > 0);

  equal("an empty query shows everything", inventoryBlocks(["a", "b"], "  "), ["a", "b"]);

  /*
   * Except air. It is a real id everywhere else -- every empty cell in the
   * document is air, and the writers and the agent both name it -- but there is
   * nothing to pick up and nothing to draw, so it showed as a permanently blank
   * tile that read as a failure to load. Air is placed by breaking a block.
   */
  equal(
    "air is not offered",
    inventoryBlocks(["minecraft:air", "minecraft:stone"], ""),
    ["minecraft:stone"],
  );
  equal(
    "...not even when searched for by name",
    inventoryBlocks(["minecraft:air", "minecraft:stone"], "air"),
    [],
  );
  check(
    "a query filters",
    inventoryBlocks(["minecraft:stone", "minecraft:oak_planks"], "oak").length === 1,
  );

  /*
   * And the version filter, which this module used to argue against having.
   *
   * The old comment said filtering by version would mean guessing when each
   * block was added. That is true above 1.13 and it is *not* true at the
   * Flattening: `legacy_blocks.json` enumerates every block a pre-Flattening
   * file can name, and it is the same table `buildMcEdit` refuses a save on.
   * Generalising from the hard half to the easy one let a 1.12 schematic offer
   * deepslate -- placeable, drawable, and fatal at save time.
   */
  const legacy = new Set([
    "minecraft:stone",
    "minecraft:oak_planks",
  ]);
  equal(
    "a restriction cuts the list",
    inventoryBlocks(
      ["minecraft:stone", "minecraft:deepslate", "minecraft:oak_planks"],
      "",
      legacy,
    ),
    ["minecraft:stone", "minecraft:oak_planks"],
  );
  equal(
    "...and a search cannot reach past it",
    inventoryBlocks(["minecraft:deepslate"], "deepslate", legacy),
    [],
  );
  /*
   * `null` is no restriction, and it has to be a distinct answer from an empty
   * set: the table is fetched over IPC, so there is a moment at start-up when
   * nothing has arrived. An empty set there would empty the inventory, which
   * reads as the app being broken rather than as a file not having landed.
   */
  equal(
    "no restriction is not the same as an empty one",
    inventoryBlocks(["minecraft:deepslate"], "", null),
    ["minecraft:deepslate"],
  );
  equal(
    "...and an empty set really does offer nothing",
    inventoryBlocks(["minecraft:deepslate"], "", new Set()),
    [],
  );
  // Air is out whatever the era: there is nothing to pick up.
  equal(
    "air is still excluded under a restriction",
    inventoryBlocks(["minecraft:air", "minecraft:stone"], "", legacy),
    ["minecraft:stone"],
  );

  /*
   * And the flat era supplies one now too, from `block_versions.json`. The
   * spelling is the part worth checking rather than the cut: this set is
   * intersected with `block_id_list.txt`, which is namespaced, so a set of bare
   * names would match nothing and empty the inventory for every flat document
   * -- an outage that reads as the app being broken.
   */
  {
    const at1_21_4 = blocksIn(4189);
    equal(
      "a 1.21.4 schematic is not offered a block 1.21.9 added",
      inventoryBlocks(
        ["minecraft:stone", "minecraft:copper_chain"],
        "",
        at1_21_4,
      ),
      ["minecraft:stone"],
    );
    equal(
      "...and 26.2 is offered both",
      inventoryBlocks(["minecraft:stone", "minecraft:copper_chain"], "", blocksIn(4903)),
      ["minecraft:stone", "minecraft:copper_chain"],
    );
  }


  equal("a label loses its namespace and its underscores", blockLabel("minecraft:oak_planks"), "Oak planks");
  equal("...and its block states", blockLabel("minecraft:oak_stairs[facing=north]"), "Oak stairs");
}

// --- the anchor modal does not fight the fields ------------------------------
//
// The panel edits a value main owns, so it has to mirror it in -- and the naive
// way to do that wipes whatever is half-typed. `anchor` arrives from a
// `$derived` that builds a fresh array whenever `docState` is reassigned, which
// is after every edit anywhere in the app, so its *identity* churns constantly
// while its value sits still. Mirroring on identity means the fields snap back
// mid-edit, and Move then sends the value that was already there -- an anchor
// that will not move, and a button that looks broken.
console.log("\n--- mirroring the anchor into the fields ---");
{
  const cell: [number, number, number] = [2, 0, 2];

  equal("a first arrival fills the fields", mirrorAnchor(cell, null), ["2", "0", "2"]);

  // The one that matters: same value, different array, already mirrored.
  check(
    "the same anchor arriving again leaves them alone",
    mirrorAnchor([2, 0, 2], anchorKey(cell)) === null,
  );
  check(
    "...however many times it arrives",
    mirrorAnchor([...cell] as [number, number, number], anchorKey(cell)) === null,
  );

  equal(
    "a genuinely different anchor does fill them",
    mirrorAnchor([1, 0, 1], anchorKey(cell)),
    ["1", "0", "1"],
  );
  equal("...and one axis is enough", mirrorAnchor([2, 0, 3], anchorKey(cell)), ["2", "0", "3"]);

  // Clearing empties them; an already-empty panel is left alone.
  equal(
    "removing the anchor empties the fields",
    mirrorAnchor(null, anchorKey(cell)),
    ["", "", ""],
  );
  check("...and stays empty", mirrorAnchor(null, anchorKey(null)) === null);

  // An anchor outside the build is legal, so negatives have to survive as text.
  equal("a negative coordinate survives", mirrorAnchor([-5, 3, -7], null), ["-5", "3", "-7"]);
  // And "no anchor" is not the same key as "anchor at the corner", or deleting
  // one while the other was showing would leave the old numbers in the fields.
  check("no anchor and a zero anchor are different keys", anchorKey([0, 0, 0]) !== anchorKey(null));
}

// --- what the pointer is about to hit ---------------------------------------
//
// The block outline was flight's alone, because in flight the crosshair *is*
// the pointer. In orbit there was no answer at all: you clicked a block to
// inspect it, or Shift-clicked to select it, and nothing said which block the
// ray was on until the click had already landed. The pick was being computed
// either way -- it simply was not drawn.
//
// The rule is `hoverSource`'s and is driven here rather than in the component
// because the outline is refreshed from `requestAnimationFrame`, which the
// Browser pane here often does not run at all.
console.log("\n--- the block under the pointer ---");
{
  const base = {
    cameraMode: "orbit",
    flying: false,
    loaded: true,
    pointer: { x: 120, y: 80 },
    overHandle: false,
    overGizmo: false,
    dragging: false,
  } as const;

  equal("orbit casts from the pointer", hoverSource(base), {
    kind: "pointer",
    x: 120,
    y: 80,
  });

  // Flight keeps the crosshair it always had, and only once the canvas holds
  // the pointer: before the lock, the click means "capture", not "build here".
  equal(
    "flight casts from the crosshair",
    hoverSource({ ...base, cameraMode: "fly", flying: true }),
    { kind: "crosshair" },
  );
  equal(
    "...but not before the pointer is locked",
    hoverSource({ ...base, cameraMode: "fly", flying: false }),
    { kind: "none" },
  );

  // The pointer leaving the canvas nulls `pointerAt`, and a stale outline left
  // behind would claim the ray is still somewhere it is not.
  equal(
    "a pointer that has left the canvas outlines nothing",
    hoverSource({ ...base, pointer: null }),
    { kind: "none" },
  );

  // Nothing to raycast: the empty document, where the only thing under the
  // pointer is the build grid and the build grid is not a block.
  equal("an empty document outlines nothing", hoverSource({ ...base, loaded: false }), {
    kind: "none",
  });
  equal(
    "...in flight either",
    hoverSource({ ...base, cameraMode: "fly", flying: true, loaded: false }),
    { kind: "none" },
  );

  /*
   * The two that are easy to get wrong, and both are about promising a click
   * that does something else. Over a selection face handle the cursor has
   * already become a resize cursor and the press drags the face; during a drag
   * the face is already moving. Outlining the block underneath either would be
   * a lie about what the button does.
   */
  equal(
    "a face handle takes the hover",
    hoverSource({ ...base, overHandle: true }),
    { kind: "none" },
  );
  equal("and a face drag keeps it", hoverSource({ ...base, dragging: true }), { kind: "none" });
  /*
   * A gizmo arrow says exactly the same thing, and it is a separate field
   * because it comes from a separate raycast: outlining the block behind an
   * arrow promises a click that will move the region instead.
   */
  equal(
    "a gizmo handle takes it too",
    hoverSource({ ...base, overGizmo: true }),
    { kind: "none" },
  );
  check(
    "the two handles and the drag are one question",
    pointerOnHandle({ overHandle: false, overGizmo: true, dragging: false }) &&
      pointerOnHandle({ overHandle: true, overGizmo: false, dragging: false }) &&
      pointerOnHandle({ overHandle: false, overGizmo: false, dragging: true }),
  );
  check(
    "...and an idle pointer is over none of them",
    !pointerOnHandle({ overHandle: false, overGizmo: false, dragging: false }),
  );

  // Neither of those is flight's business: there are no handles under a
  // crosshair, and a gesture in orbit must not reach across the mode switch.
  equal(
    "flight ignores all three",
    hoverSource({
      ...base,
      cameraMode: "fly",
      flying: true,
      overHandle: true,
      overGizmo: true,
      dragging: true,
    }),
    { kind: "crosshair" },
  );

  // A cell spans [x, x+1]. Getting this wrong draws the box over the block's
  // corner, which reads as a rendering glitch rather than as arithmetic.
  equal("the outline sits at the cell's centre", outlineCentre({ x: 3, y: 0, z: -2 }), {
    x: 3.5,
    y: 0.5,
    z: -1.5,
  });
}

/*
 * Which side of a surface the block is on.
 *
 * `pickBlockAt` steps a hair inwards along `-normal`, which is right only for a
 * face struck from the front. The block material is `DoubleSide` -- it has to
 * be, because a cross and every other paper-thin element in the game is one
 * quad seen from both sides -- so a ray can arrive at a face's back, and there
 * `-normal` points back out along the line of sight.
 *
 * The azalea is where it showed. Vanilla's `template_azalea` states its lid as
 * a zero-thickness element at y=16 carrying both an `up` and a `down` face, so
 * half of the block's top surface points into the cell above. Landing on the
 * `down` one put the pick one cell up: the outline drew around air, breaking it
 * did nothing, and placing went a cell too high -- reported as "placing an
 * azalea leaves an air block above it that cannot be removed".
 */
console.log("\n--- which side of a surface the block is on ---");
{
  const down: readonly [number, number, number] = [0, -1, 0];
  const up: readonly [number, number, number] = [0, 1, 0];
  // Looking down at a lid's up face: the front, and nothing moves.
  equal("a face struck from the front is left alone", facingNormal(up, down), up);
  // The same plane's down face, struck from above: its normal runs with the
  // ray, so the block is the other way.
  equal("one struck from behind is turned to face the ray", facingNormal(down, down), up);
  // And it is the *ray* that decides, not the axis: the same face seen from
  // below is a front hit again.
  equal("...decided by the ray, not by the axis", facingNormal(down, up), down);
  // A grazing ray is still on one side or the other. Exactly perpendicular
  // cannot be hit at all, and falls to the front branch rather than flipping.
  equal("a grazing hit keeps its side", facingNormal(up, [0.999, -0.01, 0]), up);
  equal("a perpendicular one is left alone", facingNormal(up, [1, 0, 0]), up);
}

/*
 * A normal with no dominant axis, and the face the ray came in through.
 *
 * `pickBlockAt` turns a hit normal into a face of the cell by taking its
 * largest component, which is exact wherever there is one -- and a coin toss
 * where there is not. A cross's planes are turned 45 degrees, so the two
 * horizontal terms are exactly equal and the vertical term is zero: the
 * winner is decided by which way a `>=` leans, and `up` and `down` can never
 * win at all.
 *
 * A chain is what that cost. Its planes run the whole height of the cell, so
 * `boxFaces` drops their `up` and `down` faces for having no area and there
 * is no end of a chain to aim at -- so a column could not be built. The next
 * chain always went in a cell beside the one clicked, carrying that sideways
 * face's axis, which is the report word for word.
 */
console.log("\n--- a normal that names no face ---");
{
  // Axis-aligned, and the lectern's desk at -22.5 degrees: both have a clear
  // winner and must keep the answer they always had.
  check("an axis-aligned normal has a dominant axis", hasDominantAxis([0, 1, 0]));
  check(
    "...and so does a tilted box, at 0.924 against 0.383",
    hasDominantAxis([0, 0.9239, 0.3827]),
  );
  // The cross. Both spellings, because the sign is what varies between the
  // two planes and neither is more of a tie than the other.
  check("a cross quad does not", !hasDominantAxis([0.7071, 0, -0.7071]));
  check("...whichever diagonal it is on", !hasDominantAxis([-0.7071, 0, -0.7071]));
  check("a zero normal has no axis either", !hasDominantAxis([0, 0, 0]));

  /*
   * `entryFace` stands in for the full-cell collision box this app does not
   * have. Named from the side the ray came *from*, so it is the face a
   * neighbour would share and a placement one step along it lands outside.
   */
  const cell = { x: 4, y: 2, z: 7 };
  const AT: readonly (readonly [
    string,
    readonly [number, number, number],
    readonly [number, number, number],
  ])[] = [
    ["down", [4.5, -10, 7.5], [0, 1, 0]],
    ["up", [4.5, 20, 7.5], [0, -1, 0]],
    ["west", [-10, 2.5, 7.5], [1, 0, 0]],
    ["east", [20, 2.5, 7.5], [-1, 0, 0]],
    ["north", [4.5, 2.5, -10], [0, 0, 1]],
    ["south", [4.5, 2.5, 20], [0, 0, -1]],
  ];
  for (const [face, origin, direction] of AT) {
    equal(
      `a ray from the ${face} side enters through it`,
      entryFace(origin, direction, cell),
      face,
    );
  }

  /*
   * The case the whole change exists for: aiming *up* at a chain from below
   * and slightly to one side. The ray is mostly vertical, so the last slab it
   * enters is the floor of the cell -- and the placement one step along
   * `down` is the cell underneath, which is the next link of the column.
   */
  equal(
    "aiming up from below and to the side still enters through the floor",
    entryFace([4.9, 0.2, 7.9], [-0.2, 0.96, -0.2], cell),
    "down",
  );
  // ...and the mirror of it, so a column can be built upwards as well.
  equal(
    "aiming down from above enters through the ceiling",
    entryFace([4.1, 9, 7.1], [0.2, -0.96, 0.2], cell),
    "up",
  );
  /*
   * A shallow, mostly-horizontal ray is a side hit and must stay one: that is
   * the answer the app already gave for a chain seen at eye level, and it was
   * the right one. Only the vertical case was unreachable.
   */
  equal(
    "a shallow ray still enters through the side",
    entryFace([-6, 2.6, 7.5], [0.99, 0.14, 0], cell),
    "west",
  );
  /*
   * A component of exactly zero is parallel to that pair of planes and offers
   * no entry at all. Without the guard the division yields an infinity, which
   * then wins the `t > best` comparison and names a face the ray never
   * crossed.
   */
  equal(
    "an axis the ray does not travel along cannot win",
    entryFace([-10, 2.5, 7.5], [1, 0, 0], cell),
    "west",
  );

  /*
   * And the wiring, which runs from a pointer event and cannot be driven
   * here. Both halves are greppable and both matter: the tie has to be asked
   * about **before** the dominant-axis block, or it decides nothing, and it
   * has to be the ray that answers rather than the normal a second time.
   */
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
  const pick = viewer.slice(viewer.indexOf("function pickBlockAt"));
  const tie = pick.indexOf("if (!hasDominantAxis(");
  const dominant = pick.indexOf("const ax = Math.abs(normal.x);");
  check("the pick asks whether the normal names a face", tie > 0);
  check(
    "...before it takes a dominant axis anyway",
    tie > 0 && dominant > 0 && tie < dominant,
    `tie at ${tie}, dominant at ${dominant}`,
  );
  check(
    "...and answers from the ray, not from the normal again",
    /entryFace\(\s*\r?\n?\s*\[raycaster\.ray\.origin/.test(pick),
  );
}

// --- a block too thin to aim at ---------------------------------------------
//
// The viewport raycasts the fused mesh, and a chain's mesh is two planes of
// zero thickness, 3 texels wide, crossed at the middle of its cell. Vanilla
// gives it a solid 3x16x3 column to click; here there was nothing to click, so
// the ray went past it and hit whatever stood behind -- and that block took
// the placement.
//
// Measured against a real document, a chain hanging from stone: from dead
// underneath the planes are edge-on and present no area at all, so the ray
// reached the stone's `down` face and the placement went into the cell the
// chain was already in; from above or to one side it reached the stone's
// *east* face and the new chain went in beside it with `axis=x`. Reported
// three times, and never actually about the placement rules.
console.log("\n--- a block too thin to aim at ---");
{
  /** One quad, as `buildMesh` lays it out: four positions, the normal four times. */
  const quad = (
    corners: readonly (readonly [number, number, number])[],
    normal: readonly [number, number, number],
  ): { positions: number[]; normals: number[] } => ({
    positions: corners.flatMap((c) => [...c]),
    normals: [0, 1, 2, 3].flatMap(() => [...normal]),
  });
  const buffers = (quads: { positions: number[]; normals: number[] }[]) => ({
    positions: new Float32Array(quads.flatMap((q) => q.positions)),
    normals: new Float32Array(quads.flatMap((q) => q.normals)),
  });

  /*
   * A chain: two planes 3/16 wide, turned 45 degrees about the cell's
   * middle, running its full height. Both diagonals, so both normals are
   * ties -- which is the whole of how this set is recognised.
   */
  const s = 0.5 - (1.5 / 16) * Math.SQRT1_2;
  const e = 0.5 + (1.5 / 16) * Math.SQRT1_2;
  const d = Math.SQRT1_2;
  const chain = buffers([
    quad([[s, 0, e], [e, 0, s], [e, 1, s], [s, 1, e]], [d, 0, d]),
    quad([[e, 0, s], [s, 0, e], [s, 1, e], [e, 1, s]], [-d, 0, -d]),
    quad([[s, 0, s], [e, 0, e], [e, 1, e], [s, 1, s]], [d, 0, -d]),
    quad([[e, 0, e], [s, 0, s], [s, 1, s], [e, 1, e]], [-d, 0, d]),
  ]);
  const found = thinBoxes(chain.positions, chain.normals);
  equal("a chain is one cell the pointer would pass through", found.length, 1);
  equal("...named by the cell it is in", found[0]?.cell, [0, 0, 0]);
  /*
   * ...and by the line it runs along, which is the axis it is *not* narrow
   * on. That is the same fact twice: what makes a chain unaimable is what
   * says which way it is strung, so the shape that qualifies also answers
   * the question a run needs answered.
   */
  equal("...and the axis it is strung along", found[0]?.axis, 1);
  /*
   * The box is the geometry's **own** extent, not a transcribed collision
   * shape: 2.12 across, which is 3 turned 45 degrees, against vanilla's
   * 3x16x3. A little narrower, and deliberately so -- it is derived from
   * what is drawn, so it cannot claim a shape the block does not have.
   */
  check(
    "...as wide as the geometry is, which is 3 texels turned 45 degrees",
    Math.abs((found[0].max[0] - found[0].min[0]) * 16 - 3 * Math.SQRT1_2) < 1e-4 &&
      Math.abs(found[0].max[1] - found[0].min[1] - 1) < 1e-6,
    `${((found[0].max[0] - found[0].min[0]) * 16).toFixed(2)} wide`,
  );

  /*
   * A **cross** is drawn exactly the same way and must not be in the set. It
   * spans its cell corner to corner, so it is 11.3 units across rather than
   * 2.1 and is already easy to hit -- and a box would make it impossible to
   * click the ground behind a flower, which is a thing people do.
   */
  const cross = buffers([
    quad([[0, 0, 1], [1, 0, 0], [1, 1, 0], [0, 1, 1]], [d, 0, d]),
    quad([[1, 0, 0], [0, 0, 1], [0, 1, 1], [1, 1, 0]], [-d, 0, -d]),
    quad([[0, 0, 0], [1, 0, 1], [1, 1, 1], [0, 1, 0]], [d, 0, -d]),
    quad([[1, 0, 1], [0, 0, 0], [0, 1, 0], [1, 1, 1]], [-d, 0, d]),
  ]);
  equal("a flower is not one of them", thinBoxes(cross.positions, cross.normals).length, 0);

  /*
   * A chain lying flat is the same thing turned, and the axis has to turn
   * with it -- reading the run as vertical whatever it was is what made a
   * sideways chain impossible to carry on, which was reported.
   */
  const flat = buffers([
    quad([[0, s, e], [0, e, s], [1, e, s], [1, s, e]], [0, d, d]),
    quad([[0, e, s], [0, s, e], [1, s, e], [1, e, s]], [0, -d, -d]),
    quad([[0, s, s], [0, e, e], [1, e, e], [1, s, s]], [0, d, -d]),
    quad([[0, e, e], [0, s, s], [1, s, s], [1, e, e]], [0, -d, d]),
  ]);
  const lying = thinBoxes(flat.positions, flat.normals);
  equal("a chain lying along x is one of them too", lying.length, 1);
  equal("...strung along x, not down", lying[0]?.axis, 0);

  // And nothing axis-aligned ever is, whatever its size: a face of a cube, a
  // slab, a fence rail all name an axis, so they are aimable by construction.
  const slab = buffers([
    quad([[0, 0.5, 0], [1, 0.5, 0], [1, 0.5, 1], [0, 0.5, 1]], [0, 1, 0]),
    quad([[0, 0, 0], [0, 0.5, 0], [0, 0.5, 1], [0, 0, 1]], [-1, 0, 0]),
  ]);
  equal("a slab is not one of them", thinBoxes(slab.positions, slab.normals).length, 0);

  /*
   * The box test itself. Six faces, and each one is a direction the ray can
   * come from -- this is what `entryFace` does on the unit cell, answering
   * for an arbitrary box and reporting the range as well.
   */
  const min: readonly [number, number, number] = [0.4, 0, 0.4];
  const max: readonly [number, number, number] = [0.6, 1, 0.6];
  for (const [label, from, towards, face] of [
    ["from below", [0.5, -3, 0.5], [0, 1, 0], "down"],
    ["from above", [0.5, 4, 0.5], [0, -1, 0], "up"],
    ["from the east", [3, 0.5, 0.5], [-1, 0, 0], "east"],
    ["from the west", [-3, 0.5, 0.5], [1, 0, 0], "west"],
    ["from the south", [0.5, 0.5, 3], [0, 0, -1], "south"],
    ["from the north", [0.5, 0.5, -3], [0, 0, 1], "north"],
  ] as const) {
    equal(
      `a ray ${label} enters by that face`,
      rayBox(from, towards, min, max)?.face,
      face,
    );
  }
  equal("...at the range it actually meets it", rayBox([0.5, -3, 0.5], [0, 1, 0], min, max)?.distance, 3);

  // A ray that misses the column entirely, which is most of them: the box is
  // a fifth of a block across.
  equal("a ray beside it is not a hit", rayBox([0.9, -3, 0.9], [0, 1, 0], min, max), null);
  /*
   * A ray that starts **inside** is not a hit either, and that one is load
   * bearing: in flight the camera passes through the build, and a box the
   * camera is standing in would be picked at zero range and beat everything
   * else on screen.
   */
  equal("...and neither is one starting inside it", rayBox([0.5, 0.5, 0.5], [0, 1, 0], min, max), null);
  // Parallel to a pair of planes, and outside them: the division would be an
  // infinity that then wins the comparison, which is `entryFace`'s own trap.
  equal("a ray parallel to it and past it misses", rayBox([0.9, 0.5, 0.5], [0, 0, 1], min, max), null);
  equal("a ray pointing away from it misses", rayBox([0.5, -3, 0.5], [0, -1, 0], min, max), null);

  /*
   * And the wiring, which needs a scene. Two things: the boxes are built
   * where the chunk's mesh is, so they are evicted exactly when it is; and
   * the pick asks for them **before** it reads the mesh hit, bounded by that
   * hit's own distance so a nearer wall still wins.
   */
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
  check(
    "the boxes ride with the chunk mesh they came from",
    /mesh\.userData\.thin = thinBoxes\(chunk\.positions, chunk\.normals\)/.test(viewer),
  );
  check(
    "...and only the solid layer gets them: nothing raycasts the void or a level of detail",
    /if \(chunk\.layer === "solid"\) \{\s*\r?\n\s*mesh\.userData\.thin/.test(viewer),
  );
  const pick = viewer.slice(viewer.indexOf("function pickBlockAt"));
  check(
    "the pick asks for a stand-in box, bounded by what the mesh found",
    /nearestThinBox\(raycaster\.ray, hit\?\.distance \?\? Infinity\)/.test(pick),
  );
  check(
    "...before it gives up on a ray the mesh missed",
    pick.indexOf("nearestThinBox(") < pick.indexOf("if (!hit || !hit.face) return null;"),
  );
}
// --- a run of chains --------------------------------------------------------
//
// The entry face is the game's own answer and it is a narrow gesture,
// measured: the ray has to cross the cell's floor inside its footprint, so
// aiming at the middle of a chain needs a look steeper than 45 degrees and a
// shallower one comes back with a side face. Reported twice as a column being
// unbuildable -- the second time as *not fixed at all*, which was fair.
//
// So the half of the block that was clicked decides which end the next one
// goes on. It is a deliberate deviation, and it is the question a slab
// already asks of `cursorY`.
//
// **Which end of *what* is the trap**, and reading the half vertically is
// the obvious way to fall into it: a chain strung along x or z could then not
// be continued at all, because a click on one would send the next above or
// below it. The box the block is picked through already knows better -- it is
// long on exactly one axis and narrow on the other two, and that axis is the
// run. Both directions are stated below for that reason.
console.log("\n--- a run of chains ---");
{
  const AT = { x: 4, y: 7, z: 9 };
  const hitting = (
    against: PlacementLook["against"],
    axis: "x" | "y" | "z",
    at: number,
  ): PlacementLook => ({
    direction: { x: 1, y: 0, z: 0 },
    against,
    cursorY: 0.5,
    run: { axis, at },
  });

  /*
   * Clicked on the west side of a chain hanging vertically, low down: `at`
   * is the cell to the west, so the chain that was hit is one step back
   * east, and the next link goes under *it* rather than beside it.
   */
  const low = continuedPlacement(AT, hitting("west", "y", 0.2), "minecraft:chain");
  equal("clicking the low half of a hanging chain sends the next one under it", low?.at, {
    x: AT.x + 1,
    y: AT.y - 1,
    z: AT.z,
  });
  equal("...against the face that gives it the vertical axis", low?.against, "down");

  const high = continuedPlacement(AT, hitting("west", "y", 0.8), "minecraft:chain");
  equal("clicking the high half sends it over the top", high?.at, {
    x: AT.x + 1,
    y: AT.y + 1,
    z: AT.z,
  });
  equal("...and against the other one", high?.against, "up");

  /*
   * **And a chain lying flat carries on flat**, which is the half that was
   * wrong: reading the half vertically whatever the run was made a sideways
   * chain impossible to extend at all. The run comes from the box, so this
   * needs no second rule -- only the axis it was already given.
   */
  const west = continuedPlacement(AT, hitting("up", "x", 0.2), "minecraft:chain");
  equal("clicking the west half of a chain strung along x carries it west", west?.against, "west");
  equal("...into the cell that way", west?.at, { x: AT.x - 1, y: AT.y - 1, z: AT.z });
  const east = continuedPlacement(AT, hitting("up", "x", 0.8), "minecraft:chain");
  equal("...and the east half carries it east", east?.against, "east");

  const north = continuedPlacement(AT, hitting("up", "z", 0.2), "minecraft:chain");
  equal("a chain along z goes north from its north half", north?.against, "north");
  const south = continuedPlacement(AT, hitting("up", "z", 0.8), "minecraft:chain");
  equal("...and south from its south half", south?.against, "south");

  /*
   * The renamed spelling, because that is the half of a rename that gets left
   * behind -- `chain` became `iron_chain` at 1.21.9 and this app offers both.
   * Asking the registry for `axis` is what covers the pair with no list.
   */
  equal(
    "...and iron_chain, which is the same block after 1.21.9",
    continuedPlacement(AT, hitting("west", "y", 0.2), "minecraft:iron_chain")?.against,
    "down",
  );
  equal(
    "...and a copper one",
    continuedPlacement(AT, hitting("west", "y", 0.2), "minecraft:waxed_copper_chain")?.against,
    "down",
  );

  /*
   * **Idempotent where the entry face already agreed.** Aiming steeply from
   * below gives `against: "down"` on its own, and the rule must then name the
   * same cell rather than stepping a second time -- which is the mistake the
   * arithmetic invites, because it walks back along `against` and then
   * forward along a face that is sometimes the very same one.
   */
  const already = continuedPlacement(AT, hitting("down", "y", 0.1), "minecraft:chain");
  equal("a face the ray already found is not stepped along twice", already?.at, AT);

  /*
   * And the guards, each of which is a way this could reach a placement it has
   * no business changing.
   */
  equal(
    "a block picked off its own geometry is left alone",
    continuedPlacement(
      AT,
      { against: "west", run: null },
      "minecraft:chain",
    ),
    null,
  );
  /*
   * A poppy is a cross exactly as a chain is, and is not replaceable, so this
   * is the guard that keeps ordinary building unchanged: stone clicked onto a
   * chain goes where it always went.
   */
  equal(
    "...and so is a block with no axis to continue",
    continuedPlacement(AT, hitting("west", "y", 0.2), "minecraft:stone"),
    null,
  );
  equal(
    "...and a click that landed on no face at all",
    continuedPlacement(AT, hitting(null, "y", 0.2), "minecraft:chain"),
    null,
  );
  /*
   * `nether_portal` carries an `axis` of `x|z` and no `y`. The guard is about
   * the *value* rather than about the block, which is what the orientation
   * arm does one layer along -- so it is refused on a vertical run and
   * allowed on a horizontal one, and stating both is what says which.
   */
  equal(
    "...and a run whose axis the held block has no value for",
    continuedPlacement(AT, hitting("west", "y", 0.2), "minecraft:nether_portal"),
    null,
  );
  equal(
    "...while one it does have is allowed",
    continuedPlacement(AT, hitting("up", "x", 0.2), "minecraft:nether_portal")?.against,
    "west",
  );

  // And the wiring: the rule has to be asked before the request is built, and
  // never for a break, whose coordinates name the block itself.
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  check(
    "the placement asks it, and a break does not",
    /const along =\s*\r?\n?\s*action === \"break\" \? null : continuedPlacement\(at, look, held\.namespacedName\)/.test(
      app,
    ),
  );
  check(
    "...and the cell it names is the one that is sent",
    /x: cell\.x,\r?\n\s*y: cell\.y,\r?\n\s*z: cell\.z,/.test(app),
  );
  check(
    "...with the face that goes with it",
    /\.\.\.\(facing\.against === null \? \{\} : \{ against: facing\.against \}\)/.test(app),
  );
  // The block is born from that same face, or it would carry the axis of the
  // side it was clicked on while standing in the cell beyond it.
  check(
    "...and the block is oriented from it too",
    /placementState\(held\.namespacedName, facing\)/.test(app),
  );
}

/*
 * The recents are main's, and the window reread them only when it opened or
 * closed something itself -- so a schematic saved here, or anything an MCP
 * client opened, saved or closed, left the start screen listing what it
 * listed at launch.
 */
console.log("\n--- the recents follow the document ---");
{
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  const listener = app.slice(app.indexOf("api().onDocumentChanged("), app.indexOf("const unsubscribeMenu"));
  check("a document announced from main rereads the recents", listener.includes("refreshRecents()"));
  const save = app.slice(app.indexOf("await api().saveDocument("), app.indexOf("t(\"task.saving\")"));
  check("...and so does a save from this window", save.includes("refreshRecents()"));
}

/*
 * In flight, Ctrl belongs to the camera.
 *
 * One sentence, enforced in three places and runnable in none of them here:
 * `menu_model.ts` stops the File menu claiming its accelerators (checked in
 * `tests/services.ts`), `App.svelte` declines every Ctrl-modified keystroke,
 * and `Hotbar.svelte` stops refusing them. Both renderer halves are a
 * `document.pointerLockElement` read inside a `window` listener, which is a
 * browser fact this harness has no browser for.
 *
 * So the source is checked, exactly as the coplanar epsilons are: not that the
 * gate works, but that it is still there and still in the one position that
 * makes it a rule rather than a habit.
 */
console.log("\n--- in flight Ctrl belongs to the camera ---");
{
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  const from = app.indexOf("function onWindowKey");
  // Two spaces, which is the function's own indentation: every block inside it
  // closes further in.
  const body = app.slice(from, app.indexOf("\n  }", from));
  check("there is a keyboard handler to gate", from > 0 && body.length > 0);

  const lines = body.split(/\r?\n/);
  const gate = lines.findIndex((line) => line.includes("document.pointerLockElement"));
  const modifier = lines.findIndex((line) => /event\.(?:ctrlKey|metaKey)/.test(line));
  check("it declines Ctrl while the pointer is locked", gate >= 0);
  /*
   * And the gate is the *first* thing in it that looks at a modifier.
   *
   * This is the half worth checking. A gate further down is a rule anything
   * written above it silently escapes, and a shortcut added above it would work
   * in flight while every other one did not -- which reads as that shortcut
   * being special rather than as the gate being in the wrong place.
   */
  check(
    "...before anything else asks about one",
    modifier === gate,
    `gate at ${gate}, first modifier at ${modifier}`,
  );
  // Blanket, not an allowlist: the point is that no Ctrl shortcut added later
  // has to be re-judged against WASD by whoever adds it.
  check("...and Ctrl and Cmd both count", /event\.ctrlKey \|\| event\.metaKey/.test(lines[gate] ?? ""));

  /*
   * The other side of the same sentence: with the lock held, Ctrl must stop
   * *suppressing* the keys the game does bind. Ctrl+3 picks the third slot
   * while sprinting, and refusing it was the mirror image of the bug above.
   */
  const hotbar = readFileSync(path.join(RENDERER, "lib", "Hotbar.svelte"), "utf8");
  check("the hotbar knows about the lock too", hotbar.includes("document.pointerLockElement"));
  check(
    "...and no longer refuses Ctrl outright",
    !/isTyping\(event\.target\) \|\| event\.ctrlKey/.test(hotbar),
  );
}

// ---------------------------------------------------------------------------
// Ctrl+A selects the schematic, not the window.
//
// The keystroke was always the app's: `onWindowKey` calls `selectAll` and
// `preventDefault`s the browser's. What handed it back were the early returns,
// and the first of them is the gate checked just above -- Ctrl in flight
// belongs to the camera, so Ctrl+A there is sprint-plus-strafe-left and the
// handler leaves before it can suppress anything. Every strafe under sprint
// highlighted every word in the app.
//
// The gate cannot go, so the fix is that there is nothing to highlight. Which
// makes the thing to check the thing the fix must *not* do: a CSS rule that
// quietly disabled a keyboard gesture would fail nothing anywhere else.
console.log("\n--- Ctrl+A selects the schematic, not the window ---");
{
  const css = readFileSync(path.join(RENDERER, "app.css"), "utf8");

  /*
   * The shell, and then the opt-ins **by name**.
   *
   * A list of selectors rather than one predicate over the file, because the
   * failure this guards against is one surface losing its selection while the
   * rest keep theirs -- and then the message has to say which.
   */
  check(
    "the shell of the window refuses text selection",
    /html,\s*\r?\nbody,\s*\r?\n#app \{[^}]*user-select: none;/.test(css),
  );
  // Sliced from the end of the previous rule rather than from the shell rule,
  // so that losing the shell fails one check by name instead of cascading
  // through every opt-in and burying it.
  const optInEnd = css.indexOf("user-select: text;");
  const optIn = css.slice(css.lastIndexOf("}", optInEnd) + 1, optInEnd);
  for (const selector of [
    "input",
    "select",
    "textarea",
    '[contenteditable="true"]',
    // A code block and the NBT dump exist to be copied, and `TraceView` writes
    // its arguments and results as `pre`/`code` too -- so both are covered
    // here rather than by a class repeated in three components.
    "pre",
    "code",
    ".selectable",
  ]) {
    check(
      `...but ${selector} still selects`,
      optIn.includes(`\n${selector},`) || optIn.includes(`\n${selector} {`),
    );
  }

  // The chat log is prose somebody copies, and it is not a form control, so it
  // is the one surface that has to say so for itself.
  const chat = readFileSync(path.join(RENDERER, "lib", "ChatPanel.svelte"), "utf8");
  check("the chat log opts back in", /class="log selectable"/.test(chat));

  /*
   * `AboutModal` keeps its own rule, and that is load-bearing now rather than
   * decorative: with the shell refusing selection, deleting that line would
   * silently make the one row in the app that exists to be pasted into a bug
   * report unselectable. A value set directly on an element beats an inherited
   * one, which is the whole mechanism these opt-ins run on.
   */
  const about = readFileSync(path.join(RENDERER, "lib", "AboutModal.svelte"), "utf8");
  check("the version row keeps its own", /\.runtime \{[^}]*user-select: text;/.test(about));

  /*
   * And the half that must not have moved: the keystroke itself.
   *
   * In orbit, with a document open and the caret outside a field, Ctrl+A still
   * means the schematic -- `preventDefault` and then `selectAll`, in that
   * order, because suppressing the browser's after selecting would be a race
   * with nothing enforcing it.
   */
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  const from = app.indexOf("function onWindowKey");
  const handler = app.slice(from, app.indexOf("\n  }", from));
  const branch = handler.slice(handler.indexOf('if (key === \"a\")'));
  check(
    "Ctrl+A still selects the whole schematic",
    /^if \(key === "a"\) \{\s*\r?\n\s*event\.preventDefault\(\);\s*\r?\n\s*selectAll\(\);/.test(
      branch,
    ),
  );
  // ...and still stands aside for a field, which is what a blanket
  // `user-select: none` would otherwise have been reached for instead of.
  check(
    "...and stands aside for a text field",
    handler.indexOf("if (editingText || hasTextSelection())") <
      handler.indexOf('if (key === \"a\")'),
  );
}

// ---------------------------------------------------------------------------
// The inspector lists what a block *may* hold, not only what it happens to
// ---------------------------------------------------------------------------
//
// The panel listed the entry's own keys, which is right for a block that came
// out of a file and useless for one that arrived bare. A campfire placed over
// MCP had an empty property bag, so the panel that exists to let you point it
// somewhere said "This block has no block states" -- about a block with four.
console.log("\n--- the inspector's block-state rows ---");
{
  const campfire = propertyRows("minecraft:campfire", {});
  equal(
    "a bare block still lists everything it may hold",
    campfire.map((row) => row.name),
    ["facing", "lit", "signal_fire", "waterlogged"],
  );
  check(
    "...with none of them set",
    campfire.every((row) => row.value === null),
  );
  check(
    "...and the legal values offered anyway",
    (campfire.find((row) => row.name === "facing")?.values ?? []).includes("east"),
  );

  const lit = propertyRows("minecraft:campfire", { lit: "false" });
  equal("what the block carries is shown as carried", lit.find((row) => row.name === "lit")?.value, "false");
  equal(
    "...and the rest is still offered",
    lit.find((row) => row.name === "signal_fire")?.value,
    null,
  );

  /*
   * The other half of the union, and the one that is easy to leave out.
   *
   * A schematic may hold a property the block does not legally have -- another
   * tool wrote it, or the block was renamed under it. Listing only what is
   * legal would hide it here while leaving it in the file, and this panel is
   * the only place it could ever be taken off.
   */
  const odd = propertyRows("minecraft:stone", { nonsense: "yes" });
  equal("a property the block should not have is still shown", odd.map((row) => row.name), ["nonsense"]);
  equal("...carrying its value", odd[0].value, "yes");
  equal("...with no values to offer for it", odd[0].values, null);

  // A block the registry does not know contributes nothing, which is exactly
  // what the panel did before any of this.
  equal("an unknown block is listed from the entry alone", propertyRows("minecraft:nonsense", {}), []);
  equal(
    "...and keeps whatever it carries",
    propertyRows("minecraft:nonsense", { a: "1" }).map((row) => row.name),
    ["a"],
  );

  // A block with genuinely no states is genuinely empty -- 346 of them are, and
  // the panel saying so is correct rather than a gap.
  equal("a block with no states has no rows", propertyRows("minecraft:stone", {}), []);

  // Sorted by name and not by whether it is set: a blank row that jumped
  // somewhere else the moment it was filled in would send the next keystroke
  // into whichever row slid into its place.
  const order = propertyRows("minecraft:campfire", { waterlogged: "true" }).map((row) => row.name);
  equal("the rows are in name order however they are set", order, [...order].sort());

  /*
   * A true-or-false state is a checkbox, and was a text field you typed the
   * word `true` into. The kind is decided from the legal values, so every
   * boolean the registry knows is one -- not a list of names somebody keeps.
   */
  const kinds = Object.fromEntries(campfire.map((row) => [row.name, row.kind]));
  equal("`lit` and `waterlogged` are booleans", [kinds.lit, kinds.waterlogged], ["boolean", "boolean"]);
  equal("...and `facing` is a choice", kinds.facing, "choice");
  equal(
    "a fence's arms are booleans too",
    propertyRows("minecraft:oak_fence", {}).filter((row) => row.kind === "boolean").map((row) => row.name),
    ["east", "north", "south", "waterlogged", "west"],
  );
  equal("a property nobody knows the values of is free text", odd[0].kind, "free");
  equal("...and so is anything on an unknown block", propertyRows("minecraft:nonsense", { a: "1" })[0].kind, "free");
  equal("a two-value property that is not true/false is a choice", propertyKind(["top", "bottom"]), "choice");

  // Unset is the box's third state, and a value from a file that is neither
  // word keeps its text field: a checkbox would overwrite it on the first click.
  const lantern = (value: string | null) => ({ name: "hanging", value, values: ["true", "false"], kind: "boolean" as const });
  check("an unset boolean is drawn as a checkbox", showsAsCheckbox(lantern(null)));
  check("...and a set one", showsAsCheckbox(lantern("false")));
  check("...but not one holding something else, which keeps its text", !showsAsCheckbox(lantern("yes")));

  for (const file of ["InspectorPanel.svelte", "BlockStateModal.svelte"]) {
    const source = readFileSync(path.join(RENDERER, "lib", file), "utf8");
    check(
      `${file} draws a boolean as a checkbox`,
      source.includes("showsAsCheckbox(row)") && source.includes('type="checkbox"'),
    );
  }
  check(
    "the inspector shows an unset boolean as the box's third state",
    readFileSync(path.join(RENDERER, "lib", "InspectorPanel.svelte"), "utf8").includes(
      "use:indeterminate={row.value === null}",
    ),
  );
}

// ---------------------------------------------------------------------------
// ...and an empty value means remove, decided in one place
// ---------------------------------------------------------------------------
//
// The panel has no separate delete verb: clearing the field takes the property
// off and the button beside a set row is a shortcut for clearing it. Two ways
// of saying "gone" is how they come to disagree, so the rule is in the handler
// and the markup only calls it. Before this, clearing the box wrote `name: ""`
// -- a property with an empty value, which is a state no block has and which
// the writers would have put into the file verbatim.
{
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  const from = app.indexOf("async function changeBlockProperty");
  check("the block-state handler is still there", from !== -1);
  const body = app.slice(from, app.indexOf("\n  }", from));
  check("an empty value deletes the property", /delete properties\[name\]/.test(body), body.slice(0, 200));
  check(
    "...rather than writing an empty one",
    !/properties\[name\] = ""/.test(body) && !/\[name\]: value\.trim\(\)/.test(body),
  );

  const panel = readFileSync(path.join(RENDERER, "lib", "InspectorPanel.svelte"), "utf8");
  check("the panel decides its rows in the module that can be checked", panel.includes("propertyRows("));
  check(
    "...and the remove button goes through the same handler as typing",
    /onchangeproperty\(row\.name, ""\)/.test(panel),
  );
}

// --- what a change of empty space converts from -----------------------------
/*
 * One function, two callers: `setSessionVoidBlock` converts with it and the
 * panel decides from it whether the button is live. Two copies of this rule is
 * how the button comes to be dead over an edit that would work -- which is
 * exactly what was reported.
 */
console.log("\n--- what a change of empty space converts from ---");
{
  /*
   * Air is always a source, whatever the setting says. This is the reported
   * case: a schematic whose empty space is *set* to barrier with its cells
   * still air -- reopened from its sidecar, or one Ctrl+Z after a conversion
   * -- looks identical, from the setting, to one already converted. Deciding
   * from the setting refused both.
   */
  equal(
    "picking the block that is already chosen still offers to convert the air",
    voidSources("minecraft:barrier", "minecraft:barrier"),
    ["minecraft:air"],
  );
  equal(
    "...and so does picking one for the first time",
    voidSources("", "minecraft:barrier"),
    ["minecraft:air"],
  );

  /*
   * The previous choice is *added* to air rather than standing in for it: a
   * conversion leaves its own block behind, so swapping barrier for
   * structure_void has to find the barrier, and air alone would not.
   */
  equal(
    "swapping one for another looks for both",
    voidSources("minecraft:barrier", "minecraft:structure_void"),
    ["minecraft:air", "minecraft:barrier"],
  );

  /*
   * The target is never a source. Converting a block into itself can only
   * change nothing, and offering it would put an empty step on the undo stack.
   */
  equal(
    "going back to air has nothing to look for",
    voidSources("", ""),
    [],
  );
  equal(
    "...and neither does undoing a swap in place",
    voidSources("minecraft:air", "minecraft:air"),
    [],
  );

  // Every spelling of air is one answer, which is what `normaliseVoidBlock` is
  // for -- so it cannot appear twice in the list, nor survive as the target.
  equal(
    "air spelled out is still air on both sides",
    voidSources("minecraft:air", "minecraft:barrier"),
    ["minecraft:air"],
  );

  /*
   * And the set those sources are looked up in has to contain air, which is
   * the half that made the first fix inert. `DocumentState.palette` leaves air
   * out on purpose -- it is the materials list, and a schematic is mostly air
   * -- so asking it alone always answered no, whatever the document held.
   *
   * It is recovered from two numbers rather than transported: `countBlocks`
   * counts every voxel whose palette index is not zero and index 0 is always
   * air, so the document holds air exactly when `blockCount` is short of the
   * volume.
   */
  {
    // Typed as the real payload rather than trimmed to what the function reads:
    // `PaletteCount` is what `DocumentState` carries, and a fixture narrower
    // than the caller is a fixture that cannot catch the caller.
    const palette: PaletteCount[] = [{ block: "minecraft:stone", count: 1 }];
    equal(
      "a document with room left in it holds air",
      [...blocksInDocument(palette, [4, 4, 4], 1)].sort(),
      ["minecraft:air", "minecraft:stone"],
    );
    equal(
      "...and one packed to the walls does not",
      [...blocksInDocument(palette, [4, 4, 4], 64)].sort(),
      ["minecraft:stone"],
    );
    /*
     * Both spellings, and this check used to say the opposite.
     *
     * A source may be bare or stated -- every preset is bare, and anything
     * somebody types may not be -- while a palette entry is always a full
     * state string. Keeping only the bare name made a *stated* source
     * unmatchable, so the button died over an edit that would have worked;
     * keeping only the full key would make every preset unmatchable.
     *
     * Holding both is `matchesBlockPattern`'s rule as a set: bare finds the
     * block in any state, stated finds only that state.
     */
    const stairs: PaletteCount[] = [
      { block: "minecraft:oak_stairs[facing=north]", count: 1 },
      { block: "minecraft:oak_stairs[facing=east]", count: 1 },
    ];
    const held = blocksInDocument(stairs, [4, 4, 4], 64);
    check(
      "a bare source finds the block whatever state it is in",
      held.has("minecraft:oak_stairs"),
      [...held].join(" "),
    );
    check(
      "...and a stated one finds that state",
      held.has("minecraft:oak_stairs[facing=east]"),
      [...held].join(" "),
    );
    check(
      "...and not a state the document does not have",
      !held.has("minecraft:oak_stairs[facing=south]"),
      [...held].join(" "),
    );

    /*
     * The two together, on the reported case: empty space *set* to barrier
     * with the cells still air. The sources say air, the document has air, so
     * the button is live -- where reading the setting called this identical to
     * the already-converted document and refused both.
     */
    const sources = voidSources("minecraft:barrier", "minecraft:barrier");
    const stillAir = blocksInDocument(palette, [4, 4, 4], 1);
    const filled: PaletteCount[] = [...palette, { block: "minecraft:barrier", count: 63 }];
    const converted = blocksInDocument(filled, [4, 4, 4], 64);
    check(
      "the setting already naming the block does not disable the button",
      sources.some((id) => stillAir.has(id)),
    );
    check(
      "...while the same setting over a converted document does",
      !sources.some((id) => converted.has(id)),
    );
  }
}


// --- the picker draws a bounded number of rows ------------------------------
/*
 * The freeze was made of DOM nodes. `rank` used to fall back to matching the
 * namespaced id, so nine of the commonest letters in English each returned all
 * 1197 blocks -- one row apiece, built and thrown away per keystroke, inside a
 * floating panel a few rows tall.
 *
 * The search fix takes the worst case from 1197 to 974, which is still too
 * many, so the picker draws a window of them. That is deliberately NOT the cap
 * its header forbids: nothing is hidden silently, because the line above the
 * list says both numbers.
 *
 * Checked as source, the way the flight gate and the framing calls are: the
 * markup is a browser fact this harness has no browser for, and what can be
 * stated here is that the rows come from the bounded list and the count line
 * from the unbounded one.
 */
console.log("\n--- the picker draws a bounded number of rows ---");
{
  const picker = readFileSync("src/renderer/src/lib/BlockPicker.svelte", "utf-8");

  check(
    "there is a limit, and it is a named constant",
    /const ROW_LIMIT = \d+;/.test(picker),
  );
  check(
    "the rows are drawn from the bounded list",
    /\{#each shown as block/.test(picker),
  );
  /*
   * And the count is not. This is the half that keeps the limit honest: report
   * `shown.length` as the total and the limit silently becomes the cap the
   * file's own header argues against.
   */
  check(
    "...while the count line reports the real number of matches",
    /blocks\.capped[^]{0,80}matches\.length/.test(picker),
  );
  check(
    "...and the keyboard cannot walk past what is drawn",
    !/matches\.length - 1/.test(picker) && /shown\.length - 1/.test(picker),
  );

  /*
   * No hover writing the highlighted row. The effect beside it writes
   * `list.scrollTop`; scrolling moves a different row under a *stationary*
   * pointer, the browser fires `mouseenter` for it, and that writes the
   * highlight again. The CSS `:hover` already draws the row under the pointer,
   * so the handler bought one nicety and cost a feedback path.
   */
  check(
    "hovering a row does not write state",
    // The attribute, not the word: the reason it is gone is written down two
    // lines above where it used to be, and a check on the word finds that.
    !/onmouseenter=/.test(picker),
  );

  /*
   * And the registry it filters is `$state.raw`. Plain `$state` on an array is
   * a deep proxy -- a signal per entry, 1197 of them, read inside a `$derived`
   * on every keystroke. It is the fault `legacyIndex` was already fixed for,
   * on the line below the one that still had it.
   */
  const app = readFileSync("src/renderer/src/App.svelte", "utf-8");
  check(
    "the block registry is raw state, not a deep proxy",
    /let blockRegistry = \$state\.raw</.test(app),
  );

  /*
   * And the list is positioned against the window rather than the field. Laid
   * out from the field it is clipped by a `ToolWindow` a few rows tall, and its
   * own margin box drives that panel's scroller -- so what it can reach, it can
   * also resize.
   */
  check(
    "the dropdown is placed against the window",
    /placePopover\(/.test(picker) && /position: fixed/.test(picker),
  );
  check(
    "...below the field it belongs to, not above it",
    /"below"/.test(picker),
  );
}

{
  /*
   * `placePopover`'s new preference, and the reason it is not merely taste: a
   * list that opens above the caret when the panel is low and below it when the
   * panel is high behaves differently after you drag its window.
   *
   * The preference is the design; the clamp is the guarantee, and only the
   * clamp is load-bearing.
   */
  const anchor = { left: 400, top: 300, width: 180, height: 24 };
  const box = {
    viewportWidth: 1280,
    viewportHeight: 800,
    popoverWidth: 320,
    popoverHeight: 240,
    margin: 8,
    gap: 4,
  };
  equal(
    "with room on both sides, above is still the default",
    placePopover(anchor, box).y,
    300 - 4 - 240,
  );
  equal(
    "...and below is taken when it is asked for",
    placePopover(anchor, box, "below").y,
    300 + 24 + 4,
  );
  /*
   * Asking for below and not fitting falls back to above rather than hanging
   * off the bottom -- a list of blocks under a field near the foot of the
   * window is the ordinary case, not an edge one.
   */
  const low = { ...anchor, top: 700 };
  equal(
    "...falling back to above when below does not fit",
    placePopover(low, box, "below").y,
    700 - 4 - 240,
  );
  /*
   * And when neither fits, the clamp still puts it on screen. That is the half
   * that is a guarantee rather than a preference.
   */
  const tall = { ...box, popoverHeight: 780 };
  const squeezed = placePopover({ ...anchor, top: 400 }, tall, "below");
  check(
    "with room nowhere it is still inside the window",
    squeezed.y >= 8 && squeezed.y <= 800 - 8,
    String(squeezed.y),
  );
}


// --- `bind:this` writes null ------------------------------------------------
/*
 * The rule, and the freeze it cost.
 *
 * `bind:this` sets its binding to **`null`** when the element goes away. Three
 * of them were declared `| undefined` and guarded with `=== undefined`, so at
 * exactly the moment the element vanished the guard was false and the next line
 * read a property off `null` -- inside the effect flush, where Svelte has
 * nowhere to put it. The scheduler is left broken and takes every effect in the
 * window with it, while the viewport keeps drawing from its own
 * `requestAnimationFrame` chain and main keeps answering. Navigable and
 * completely dead, twice reported that way.
 *
 * The type was a lie `tsc` could not catch: it validated a comparison that can
 * never be true. Declared honestly, `=== undefined` no longer compiles.
 *
 * Which is not enough on its own, and that is why this check exists rather than
 * being redundant with the compiler. `tsc` catches the *mismatch*; put the
 * declaration and the guard back **together** and it is silent again -- verified
 * by doing exactly that. A consistent pair of wrong answers compiles clean and
 * freezes the window, so the thing that has to be refused is the declaration.
 */
console.log("\n--- `bind:this` writes null ---");
{
  function svelteFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) found.push(...svelteFiles(full));
      else if (entry.endsWith(".svelte")) found.push(full);
    }
    return found;
  }

  /*
   * Named rather than skipped. `Viewer`'s two are declared non-nullable and
   * are not in a conditional, so they exist for the whole life of the component
   * and are only ever read from `onMount` and from handlers bound to them --
   * never after the element is gone. Making them `| null` would add a `!` at
   * every use across a 140 kB file and buy nothing.
   */
  const UNCONDITIONAL = new Set(["canvas", "container"]);

  const offenders: string[] = [];
  const compared: string[] = [];
  for (const file of svelteFiles(RENDERER)) {
    /*
     * Comments stripped first, and that is not fastidiousness: the whole reason
     * these sites are recognisable is that somebody wrote down what went wrong,
     * quoting the guard that was there. A scan that read prose would find the
     * explanation and call it the fault.
     */
    const source = readFileSync(file, "utf-8")
      .replace(/\/\*[^]*?\*\//g, " ")
      .replace(/<!--[^]*?-->/g, " ")
      .replace(/(^|[^:])\/\/.*/g, "$1");
    const name = path.basename(file);
    for (const match of source.matchAll(/bind:this=\{(\w+)\}/g)) {
      const bound = match[1];
      if (UNCONDITIONAL.has(bound)) continue;
      /*
       * The declaration, in either form this codebase uses: a rune for the ones
       * an effect reads, a plain `let` for the ones only a handler does.
       */
      const declared = new RegExp(
        `let ${bound}(?:\\s*[:=]\\s*\\$state<([^>]*)>|\\s*:\\s*([^;=]*))`,
      ).exec(source);
      const type = declared === null ? null : (declared[1] ?? declared[2] ?? "");
      if (type !== null && /undefined/.test(type)) {
        offenders.push(`${name}: ${bound} is ${type.trim()}`);
      }
      if (new RegExp(`\\b${bound}\\s*[!=]==\\s*undefined`).test(source)) {
        compared.push(`${name}: ${bound}`);
      }
    }
  }

  equal(
    "no `bind:this` binding is declared undefined",
    offenders.join(", "),
    "",
  );
  /*
   * And nothing compares one against `undefined`. Once the declarations are
   * honest `tsc` refuses this on its own -- so this half is here to say *why*,
   * and to catch the pair arriving together in a file nobody has typed yet.
   */
  equal(
    "...and none is compared against it",
    compared.join(", "),
    "",
  );

  /*
   * The two that were reported, by name, so a regression says which. Both
   * unmount their list the moment a query matches nothing -- typing `aa` in a
   * block field, or `zzzz` after Ctrl+K.
   */
  for (const [file, binding] of [
    ["BlockPicker.svelte", "list"],
    ["CommandPalette.svelte", "list"],
  ] as const) {
    const source = readFileSync(path.join(RENDERER, "lib", file), "utf-8")
      .replace(/\/\*[^]*?\*\//g, " ");
    check(
      `${file} guards its list against null`,
      new RegExp(`${binding} === null`).test(source),
    );
  }
}


// --- what a block may hold depends on the era -------------------------------
//
// A 1.12.2 schematic showed `waterlogged` on its fences, stairs, slabs and
// panes. The property is 1.13's; the document is from a version with no such
// idea. Reported exactly that way.
//
// The inspector lists the union of what the entry carries and what the game
// says it may carry, and the second half was asking the **modern registry** --
// which has nothing true to say about a numeric `ID:DATA` block. Before 1.13
// the authority is `legacy_blocks.json`, which is the same table the MCEdit
// writer decides the save on, so what the panel offers is what the file can
// hold.
console.log("\n--- what a block may hold depends on the era ---");
{
  const table = JSON.parse(
    readFileSync(path.join(here, "..", "resources", "legacy_blocks.json"), "utf8"),
  ) as { blocks: Record<string, string> };
  const legacy = buildLegacyIndex(table.blocks);

  /*
   * The fact underneath all of it, stated once: the property is not in the
   * table anywhere. Not an accident of the data -- it is the era.
   */
  const anyWaterlogged = [...legacy.properties.values()].some((held) => held.has("waterlogged"));
  check("no pre-Flattening block holds waterlogged", !anyWaterlogged);

  /*
   * The four families it was reported on. Each is checked from both sides,
   * because a rule that returned nothing at all would pass the first half.
   */
  for (const [name, wanted] of [
    ["minecraft:oak_fence", ["east", "north", "south", "west"]],
    ["minecraft:oak_stairs", ["facing", "half", "shape"]],
    ["minecraft:stone_slab", ["type"]],
    ["minecraft:oak_door", ["facing", "half", "hinge", "open", "powered"]],
  ] as const) {
    const rows = propertyRows(name, {}, legacy).map((row) => row.name);
    equal(`${name.replace("minecraft:", "")} holds exactly its legacy states`, rows, [...wanted]);
  }

  /*
   * ...and the flat era is untouched, which is the half that says the fix is a
   * rule about versions rather than a property nobody may see.
   */
  check(
    "a flat document still offers waterlogged on a stair",
    propertyRows("minecraft:oak_stairs", {}, null).some((row) => row.name === "waterlogged"),
  );

  /*
   * What the entry *carries* is always listed, whatever the era says. That is
   * what lets somebody see a property another tool wrote and delete it -- and
   * it is why the registry half being wrong was a bug rather than a mercy.
   */
  check(
    "a state the file carries is shown even where the era denies it",
    propertyRows("minecraft:oak_fence", { waterlogged: "true" }, legacy).some(
      (row) => row.name === "waterlogged" && row.value === "true",
    ),
  );

  /*
   * A block that era cannot name at all contributes nothing rather than
   * falling back to the registry. Falling back is the claim the change exists
   * to stop making, so an unlisted block is the case that would silently undo
   * it.
   */
  equal(
    "a block the era never had offers none of the registry's states",
    propertyRows("minecraft:lantern", {}, legacy).map((row) => row.name),
    [],
  );
}

// --- the right button opens, and Shift places -------------------------------
//
// The split is the game's, and the *decision* is main's -- the renderer holds
// no schematic, so it cannot know whether the cell under the crosshair opens.
// What lives here is only which verb the click sends, which is a browser fact
// this harness has no browser for. So it is read out of the source, the way the
// flight-mode modifier gate is.
//
// Shift is already the descend key in flight, so sneak-to-place costs nothing
// and collides with nothing -- and that is the whole reason this arrangement is
// available at all rather than needing a key nobody uses.
console.log("\n--- the right button opens, and Shift places ---");
{
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf-8");
  check(
    "the right button dispatches on Shift",
    /onbuild\(\s*event\.shiftKey \? "place" : "use"/.test(viewer),
  );
  /*
   * And the left one is untouched. A gesture that started opening things on
   * the *break* button would be a very fast way to lose a build, and it is one
   * character away.
   */
  check(
    "the left button still breaks",
    /event\.button === 0\)\s*\{\s*\n?\s*onbuild\("break"/.test(viewer.replace(/\r/g, "")),
  );
}

// --- the picture a copy leaves behind ------------------------------------------
//
// Ctrl+C arms a translucent copy of what is held, drawn where Ctrl+V would put
// it, and the gizmo's arrows then carry that box rather than the blocks -- so
// «copy, move, paste, move, paste» is one gesture repeated until the selection
// is dropped. None of this is drivable here: there is no canvas and no preload
// bridge, so it is read out of the source the way the framing call site and the
// flight-mode key gate already are.
console.log("\n--- the picture a copy leaves behind ---");
{
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf-8");
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf-8");

  /*
   * The mode is armed by the copy; the picture arrives afterwards. Written the
   * other way round -- mesh first, state after -- a mesh that failed would
   * leave the arrows moving blocks with no ghost anywhere on screen, which is
   * a different gesture happening in silence.
   */
  const arm = app.slice(
    app.indexOf("async function armStamp"),
    app.indexOf("async function armGhost"),
  );
  check("the stamp is armed at all", arm.length > 0);
  check(
    "the copy arms the mode before the picture is asked for",
    arm.indexOf("stamp = armed") < arm.indexOf("await api()"),
    "a mesh that failed would silently change what the next drag did",
  );
  check(
    "...and the picture is the clipboard's, not a region's",
    arm.includes("api().clipboardMesh()") && !arm.includes("regionMesh"),
    "a cut has emptied that region by the time the ghost is asked for",
  );
  check(
    "...and a late answer cannot overwrite a newer copy",
    arm.includes("stamp !== armed"),
  );

  /*
   * With a stamp armed the arrows carry the box. Both halves, because either
   * alone is a working app doing the wrong thing: without the early return a
   * second ghost is fetched and drawn over this one, and without the branch in
   * `commitMove` the release moves the original -- which is precisely what
   * copying it somewhere else must not do.
   */
  const ghost = app.slice(
    app.indexOf("async function armGhost"),
    app.indexOf("function movePivot"),
  );
  check(
    "a stamp is already the ghost, so no region is fetched for it",
    ghost.indexOf("if (stamp !== null) return;") >= 0 &&
      ghost.indexOf("if (stamp !== null) return;") < ghost.indexOf("regionMesh"),
  );
  const commit = app.slice(
    app.indexOf("async function commitMove"),
    app.indexOf("async function gizmoTransform"),
  );
  check("the move commit is found at all", commit.length > 0);
  check(
    "a stamped move carries the box and asks main for nothing",
    commit.indexOf("if (stamp !== null) {") >= 0 &&
      commit.indexOf("if (stamp !== null) {") < commit.indexOf("api().moveRegion"),
    "the original would move instead of being stamped somewhere else",
  );

  /*
   * And what is aimed at the selection goes when the selection does, from one
   * place. Seven of the eight sites that drop a selection had already
   * forgotten the pivot, so an eighth line was never the answer.
   */
  const clearAt = app.indexOf("function clearSelection");
  check(
    "clearing the selection does not spell the rule out again",
    clearAt >= 0 && !app.slice(clearAt, clearAt + 200).includes("pivot = null"),
  );
  check(
    "...because one effect owns it",
    /\$effect\(\(\) => \{\s*if \(selection !== null\) return;\s*if \(pivot !== null\) pivot = null;\s*if \(stamp !== null\) stamp = null;/.test(
      app.replace(/\r/g, ""),
    ),
  );

  /*
   * The ghost stands at the corner a paste lands on, and a drag hands the
   * position back when it ends -- without which a cancelled stamp drag would
   * leave the picture wherever the pointer let go of it.
   */
  check("the stamp is drawn when no move ghost is up", app.includes("ghost={moving ?? stamp}"));
  check("...at the selection's corner", app.includes("ghostAt={selection"));
  const endDrag = viewer.slice(
    viewer.indexOf("function endGizmoDrag"),
    viewer.indexOf("function updateHover"),
  );
  check(
    "a drag hands the ghost's position back when it ends",
    endDrag.includes("ghostGroup?.position.set(ghostHome"),
  );

  /*
   * A move ghost lives as long as its drag, and it used to live until a commit.
   * Released without moving a block, or released before its mesh arrived, it
   * stood at the corner of every selection after it until the app restarted.
   */
  {
    const requests = ghostRequests();
    const late = grabGhost(requests);
    releaseGhost(requests);
    check("a mesh that arrives after the release is refused", !ghostStillWanted(requests, late));
    const first = grabGhost(requests);
    const second = grabGhost(requests);
    check(
      "...a second press makes the first one's mesh stale",
      !ghostStillWanted(requests, first) && ghostStillWanted(requests, second),
    );
  }
  const releaseAt = endDrag.indexOf("ongizmorelease?.()");
  check(
    "every gizmo drag ends by releasing its ghost, whether or not it committed",
    releaseAt >= 0 && !endDrag.slice(0, releaseAt).includes("return"),
    "a press released without moving a block commits nothing",
  );
  check("...and the app is listening", app.includes("ongizmorelease={endGhost}"));
  const armMove = app.slice(app.indexOf("async function armGhost"), app.indexOf("function adoptEditedSelection"));
  check(
    "the move mesh is accepted only for the drag that asked for it",
    armMove.includes("ghostStillWanted(ghostFetch, token)") && !armMove.includes("|| !selection)"),
    "a move takes the selection along, so asking for one proves nothing",
  );
  check(
    "...and a dropped selection takes the move ghost with it too",
    /if \(selection !== null\) return;[^}]*releaseGhost\(ghostFetch\);\s*if \(moving !== null\) moving = null;/.test(
      app.replace(/\r/g, ""),
    ),
  );

  /*
   * And the toolbar's third clipboard control, which can only mean something
   * where empty space is not air: air is never stored in a clipboard, so a
   * paste never writes it and there is nothing to leave alone. Disabled and
   * reading as pressed rather than hidden -- both halves, because either one
   * alone is a lie. A live control that does nothing is the Stop button's
   * fault; an unpressed one would claim a paste was about to stamp air.
   */
  const bar = readFileSync(path.join(RENDERER, "lib", "GizmoBar.svelte"), "utf-8");
  check(
    "the skip toggle is dead where it could do nothing",
    bar.includes("disabled={busy || emptyIsAir}"),
  );
  check(
    "...and says so by reading as pressed rather than by vanishing",
    bar.includes("aria-pressed={emptyIsAir || skipEmpty}"),
  );
}

console.log("\n--- a burst of mesh requests is one request, then one more ---");
{
  /*
   * The second stutter report: fifty mesh requests left at once, each answered
   * in turn with a full rebuild and the atlas, the last one 29 s late. Only the
   * latest state is worth drawing.
   */
  let runs = 0;
  let release: () => void = () => {};
  const refresh = coalesce(async () => {
    runs++;
    await new Promise<void>((resolve) => (release = resolve));
  });
  const first = refresh();
  const burst = Array.from({ length: 50 }, () => refresh());
  check("a call while one runs does not start another", runs === 1, String(runs));
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  check("fifty calls during it collapse into one more run", runs === 2, String(runs));
  release();
  await Promise.all([first, ...burst]);
  check("...and nothing runs after that", runs === 2, String(runs));
  let settledEarly = false;
  const late = refresh().then(() => (settledEarly = true));
  check("a call after everything settled runs again", runs === 3, String(runs));
  check("...and its promise waits for that run", !settledEarly);
  release();
  await late;

  const failing = coalesce(async () => {
    throw new Error("main said no");
  });
  let rejected = false;
  await failing().catch(() => (rejected = true));
  check("a failure reaches the caller", rejected);
  let again = false;
  await failing().catch(() => (again = true));
  check("...and the next call starts afresh", again);

  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf-8");
  check(
    "every mesh refresh goes through the coalescer",
    app.includes("const refreshDocument = coalesce(fetchDocumentMesh);") &&
      !/async function refreshDocument\(/.test(app),
  );
}

// A chip holds a block's spelling as text, and the state editor rewrites one
// property of it. A banner's design is full of the commas a naive split cuts
// on, so the round trip is stated with one in it.
console.log("\n--- a block field that holds several blocks ---");
{
  const banner = 'minecraft:red_banner[rotation=4,banner_patterns=[{pattern:"mojang",color:"white"}]]';
  const spelling = readSpelling(banner);
  equal("a chip's spelling is taken apart", spelling, {
    name: "minecraft:red_banner",
    properties: { rotation: "4" },
    bannerPatterns: '[{pattern:"mojang",color:"white"}]',
  });
  check("...and put back as it was", spelling !== null && writeSpelling(spelling) === banner);
  equal(
    "states come back in one order, whatever order they were typed in",
    canonicalBlock("oak_stairs[half=top,facing=east]", null),
    "minecraft:oak_stairs[facing=east,half=top]",
  );
  equal("half a command is kept as typed rather than lost", readSpelling("oak_stairs[facing="), null);

  const table = JSON.parse(
    readFileSync(path.join(here, "..", "resources", "legacy_blocks.json"), "utf8"),
  ) as { blocks: Record<string, string> };
  equal(
    "an ID:DATA typed on a legacy document becomes the block it means",
    canonicalBlock("35:14", buildLegacyIndex(table.blocks)),
    "minecraft:red_wool",
  );
  equal("...and on a flat one stays what was typed", canonicalBlock("35:14", null), "35:14");

  /*
   * The panel reads top to bottom the way the sentence does -- replace these
   * with those -- and that order is the whole of what was asked for. It used to
   * be the other way round, with a button saying "Replace with the block above".
   */
  const tools = readFileSync(path.join(here, "..", "src", "renderer", "src", "lib", "SelectionTools.svelte"), "utf8");
  const replaceAt = tools.indexOf('id="tool-from-block"');
  const withAt = tools.indexOf('id="tool-to-block"');
  check("Replace comes before With in the selection panel", replaceAt !== -1 && withAt !== -1 && replaceAt < withAt);
  check("...with the swap between them", tools.indexOf("onclick={onswap}") > replaceAt && tools.indexOf("onclick={onswap}") < withAt);
  check("...and the Replace field has no weights to show", /id="tool-from-block"[\s\S]{0,80}weights=\{false\}/.test(tools));

  /*
   * A mix's text is not a block. Asking main for an icon of it would intern a
   * block called `70%stone,30%andesite`, so the bar asks for its first block.
   */
  const hotbar = readFileSync(path.join(here, "..", "src", "renderer", "src", "lib", "Hotbar.svelte"), "utf8");
  check("the hotbar asks for the icon of a mix's first block", hotbar.includes("requestBlockIcons(slots.map(iconOf))"));

  /*
   * The chips are typed into through the ordinary picker, and a choice has to
   * reach a different place from a keystroke -- or every letter would add a
   * chip.
   */
  const field = readFileSync(path.join(here, "..", "src", "renderer", "src", "lib", "BlockMixField.svelte"), "utf8");
  check("the chip field adds a chip on a choice, not on a keystroke", /onchange=\{\(text\) => \(draft = text\)\}\s*onpick=\{add\}/.test(field));
}

// --- the materials, as an inventory ------------------------------------------
//
// What the selection is made of, as slots with an icon and a count in the
// corner. The count is short enough for the corner and the hover has the exact
// one; what a click means is a table, stated here rather than found in a
// handler.
console.log("\n--- the materials, as an inventory ---");
{
  equal(
    "a count is exact while it fits the corner",
    [0, 7, 64, 940, 9999].map(formatCount),
    ["0", "7", "64", "940", "9999"],
  );
  equal(
    "...and shortened past it",
    [10_000, 12_345, 100_000, 999_999, 1_000_000, 1_250_000].map(formatCount),
    ["10k", "12.3k", "100k", "999k", "1M", "1.2M"],
  );
  /*
   * Rounding would send these to the next unit up -- `100.0k`, `1000k`,
   * `10.0M` -- which is the wrong unit as well as more than there is.
   */
  equal(
    "a count is truncated, never rounded up into the next unit",
    [99_999, 999_999, 9_999_999].map(formatCount),
    ["99.9k", "999k", "9.9M"],
  );

  const click = (button: number, ctrl = false, shift = false) => ({ button, ctrl, shift });
  /*
   * A plain click used to put the block in With. It lights the block up in
   * the viewport now, which is the question the list raises -- where is it --
   * and With and Replace are filled by dragging a slot onto them.
   */
  equal(
    "a plain click lights the block up, Ctrl lights several",
    [materialAction(click(0), false), materialAction(click(0, true), false)],
    ["glow", "addGlow"],
  );
  const foot = { block: "minecraft:red_bed[facing=north,part=foot]", pair: ["minecraft:red_bed[facing=north,part=head]"] };
  const stone = { block: "minecraft:stone", pair: [] };
  equal("a click lights that block alone", nextGlow([foot], stone, false), [stone]);
  equal("...and puts it out when it was the only one lit", nextGlow([stone], stone, false), []);
  equal("...but lights it alone when others were lit with it", nextGlow([foot, stone], stone, false), [stone]);
  equal("Ctrl adds a block to what is lit", nextGlow([foot], stone, true), [foot, stone]);
  equal("...and takes one out", nextGlow([foot, stone], foot, true), [stone]);
  equal(
    "a lit bed looks for both halves, each spelling once",
    glowPatterns([foot, stone, { block: foot.block, pair: foot.pair }]),
    [foot.block, foot.pair[0], "minecraft:stone"],
  );
  equal(
    "Shift is Replace, Ctrl+Shift adds to it",
    [materialAction(click(0, false, true), false), materialAction(click(0, true, true), false)],
    ["replace", "addReplace"],
  );
  /*
   * The right button read the slot by putting it in With and opening its
   * states there: two things at once, and the second is the chip's. Now it
   * pins the slot's reading open, and the states stay a right-click on the
   * chip in With.
   */
  equal("the right button pins what there is to know about the slot", materialAction(click(2), false), "info");
  /*
   * Air cannot be held -- `coerceHotbar` refuses a slot of it -- so a plain
   * click means the one thing air is for in that panel.
   */
  equal("a plain click on air fills Replace, rather than lighting every empty cell", materialAction(click(0), true), "replace");
  equal("...Ctrl still adds it to With, which makes a ruin", materialAction(click(0, true), true), "addWith");
  equal("...and air has no states to open", materialAction(click(2), true), "none");
  // Its two-letter stand-in would read "AI", so a chip of it is an empty slot.
  equal(
    "a chip knows air when it holds it, and only air",
    ["air", "minecraft:air", "minecraft:cave_air", "minecraft:stone"].map(isAirBlock),
    [true, true, false, false],
  );

  /*
   * A slot that is a whole bed stands for its foot and its head. Replace has
   * to name both, or replacing the beds leaves their heads behind.
   */
  const bedPair = tryParseMix(
    withBlocksAdded(
      "",
      ["minecraft:red_bed[facing=north,part=foot]", "minecraft:red_bed[facing=north,part=head]"],
      null,
    ),
  );
  equal(
    "a whole bed goes into a field as both of its halves",
    bedPair?.entries.map((entry) => entry.block),
    ["minecraft:red_bed[facing=north,part=foot]", "minecraft:red_bed[facing=north,part=head]"],
  );

  equal("adding to an empty field gives that block alone", withBlockAdded("", "stone", null), "minecraft:stone");
  const two = tryParseMix(withBlockAdded("minecraft:stone", "dirt", null));
  check(
    "adding to one block makes a mix of two, each on an equal footing",
    two !== null &&
      two.entries.map((entry) => `${entry.weight}%${entry.block}`).join(",") === "1%minecraft:stone,1%minecraft:dirt",
  );
  check("...with a seed of its own, so two mixes are not one pattern", two !== null && two.distribution.seed !== 0);

  const slots = readFileSync(path.join(RENDERER, "lib", "MaterialsInventory.svelte"), "utf8");
  check("the corner of a slot carries the short count", slots.includes("{formatCount(slot.count)}"));
  check("...and the hover the exact one", /count=\{hoveredSlot\?\.count \?\? null\}/.test(slots));
  check("the slots are drawn from the rows, air among them", /materialRows\(palette, air,/.test(slots));

  const tools = readFileSync(path.join(RENDERER, "lib", "SelectionTools.svelte"), "utf8");
  check(
    "the pinned reading is a pinned tooltip that closes itself",
    /<BlockTooltip[\s\S]{0,400}pinned\s[\s\S]{0,80}onclose=\{\(\) => \(pinned = null\)\}/.test(slots),
  );
  const tooltip = readFileSync(path.join(RENDERER, "lib", "BlockTooltip.svelte"), "utf8");
  check(
    "...and its Escape goes no further, or the window's would drop the selection",
    /window\.addEventListener\("keydown", onKey, true\)/.test(tooltip) &&
      /event\.stopPropagation\(\);\s*onclose\?\.\(\)/.test(tooltip),
  );

  /*
   * A slot dragged onto a field fills it, as the slot's click on that field
   * would, and Ctrl adds. What it carries is the block and its pair, so the
   * field decides: With takes the foot, Replace both halves.
   */
  const bed = { block: "minecraft:red_bed[part=foot]", pair: ["minecraft:red_bed[part=head]"] };
  equal("a dragged block comes back as it went", decodeDragged(encodeDragged(bed)), bed);
  equal(
    "...and text that is not one is no block",
    [decodeDragged("minecraft:stone"), decodeDragged("{}"), decodeDragged('{"block":"  "}')],
    [null, null, null],
  );
  check("a slot is dragged, air is not", slots.includes("draggable={!slot.air}"));
  check(
    "a drop on Replace adds to the list, never replaces it",
    tools.includes('onMaterial(dragged, "addReplace")') && !tools.includes("(dragged, add)"),
  );
  check("...and so does a drop on With", tools.includes('onMaterial(dragged, "addWith")'));
  const field = readFileSync(path.join(RENDERER, "lib", "BlockMixField.svelte"), "utf8");
  const fieldDrop = field.slice(field.indexOf("function drop("), field.indexOf("function edit("));
  check(
    "a field takes only a block, and takes it from the text box under it",
    fieldDrop.indexOf("dragged === null) return;") !== -1 &&
      fieldDrop.indexOf("dragged === null) return;") < fieldDrop.indexOf("event.stopPropagation();"),
  );
  const hotbar = readFileSync(path.join(RENDERER, "lib", "Hotbar.svelte"), "utf8");
  check(
    "a hotbar slot takes the block and not its pair: holding a foot places the bed",
    hotbar.includes("onassign(index, dragged.block);"),
  );
  check(
    "...and rises over the creative inventory to be dropped on",
    /\.hotbar\.raised \{\s*z-index: 101;/.test(hotbar) &&
      /\.scrim \{[^}]*z-index: 100;/.test(readFileSync(path.join(RENDERER, "lib", "CreativeInventory.svelte"), "utf8")),
  );
  const appSource = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  check("...while it is open", appSource.includes("raised={inventoryOpen}"));
  check(
    "air is never put in a hotbar slot by a drop",
    /onassign=\{\(slot, block\) => \{\s*\/\/[^\n]*\n\s*if \(isAirBlock\(block\)\) return;/.test(appSource),
  );
  check(
    "the creative inventory's tiles are dragged too",
    readFileSync(path.join(RENDERER, "lib", "CreativeInventory.svelte"), "utf8").includes(
      "startBlockDrag(event.dataTransfer, { block, pair: [] })",
    ),
  );

  /*
   * A face drag moves the selection many times a second, and a count is a walk
   * over every cell of it -- so one count in flight, after the selection holds
   * still.
   */
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  check("the selection's materials are counted one request at a time", app.includes("coalesce(fetchMaterials)"));
  check(
    "...once the selection has held still",
    /setTimeout\(\(\) => \{[\s\S]{0,300}refreshMaterials\(\)/.test(app),
  );
  /*
   * The list is drawn in the Selection tab of the docked panel: the
   * selection's, or with nothing selected the whole schematic's, which main
   * counts with a bed as one bed where `DocumentState.palette` counts the
   * states the file holds. With the panel put away or another tab up, the
   * list is not on screen, and nothing is asked for.
   */
  check(
    "nothing is counted while the list is not on screen",
    app.includes('if (dockCollapsed || dockTab !== "selection" || docState === null) {'),
  );
  check("...and nothing is read off the document's state", !app.includes("documentMaterials("));
  const replaceArm = tools.slice(tools.indexOf('case "replace":'), tools.indexOf('case "state":'));
  check(
    "Replace takes a slot's other half with it",
    (replaceArm.match(/\[material, \.\.\.slot\.pair\]/g) ?? []).length === 2,
  );

  /*
   * The bar over the slots: states merged, a search, an order. A long list
   * -- a redstone build is a slot per wire shape and power -- is read by
   * name as often as by count.
   */
  const palette = [
    { block: "minecraft:vine[east=true,north=false]", count: 3 },
    { block: "minecraft:vine[east=false,north=true]", count: 2 },
    { block: "minecraft:stone", count: 4 },
    { block: "minecraft:piston[extended=true,facing=up]", count: 1, pair: ["minecraft:piston_head[facing=up,short=false,type=normal]"] },
    { block: "minecraft:piston[extended=false,facing=up]", count: 1 },
  ];
  const listed = (options: Partial<{ unify: boolean; sort: "countDesc" | "countAsc" | "nameAsc" | "nameDesc"; query: string }>, air = 7) =>
    materialRows(palette, air, { unify: false, sort: "countDesc", query: "", ...options }).map(
      (row) => row.block.replace(/^minecraft:/, "") + " " + row.count,
    );
  equal("most first, air last", listed({}), [
    "stone 4",
    "vine[east=true,north=false] 3",
    "vine[east=false,north=true] 2",
    "piston[extended=false,facing=up] 1",
    "piston[extended=true,facing=up] 1",
    "air 7",
  ]);
  equal("fewest first, and air is still last", listed({ sort: "countAsc" }).at(-1), "air 7");
  equal("by name, either way", [listed({ sort: "nameAsc" })[0], listed({ sort: "nameDesc" })[0]], [
    "piston[extended=false,facing=up] 1",
    "vine[east=true,north=false] 3",
  ]);
  equal("merged, a block is one slot whatever its states", listed({ unify: true }), [
    "vine 5",
    "stone 4",
    "piston 2",
    "air 7",
  ]);
  const mergedPiston = materialRows(palette, 0, { unify: true, sort: "countDesc", query: "" }).find(
    (row) => row.block === "minecraft:piston",
  );
  equal(
    "...and keeps a pair whose other half is another block",
    mergedPiston?.pair,
    ["minecraft:piston_head[facing=up,short=false,type=normal]"],
  );
  equal("a search matches the states too", listed({ query: "east=true" }), ["vine[east=true,north=false] 3"]);
  equal(
    "...reads a space as an underscore",
    materialRows([{ block: "minecraft:oak_slab[type=top]", count: 1 }], 0, {
      unify: false,
      sort: "countDesc",
      query: "oak slab",
    }).length,
    1,
  );
  equal("...ignores the namespace", listed({ query: "minecraft:stone" }), ["stone 4"]);
  equal("...and finds air when asked for it", listed({ query: "air" }), ["air 7"]);
  equal("no air slot when there is none", listed({}, 0).includes("air 0"), false);

  const inventory = readFileSync(path.join(RENDERER, "lib", "MaterialsInventory.svelte"), "utf8");
  check("the slots are the rows the bar asks for", inventory.includes("materialRows(palette, air, { unify, sort, query })"));
  check(
    "the merge and the order are settings, the search is not",
    app.includes("patchUi({ materialsUnify: unify })") && app.includes("patchUi({ materialsSort: sort })") &&
      !/patchUi\(\{[^}]*query/.test(app),
  );
}

// --- a block dragged onto the viewport is not a file ----------------------------
//
// Chromium hands an image dragged from inside the page over as a file called
// `download.png`, and the viewport opened what it was handed: pulling a
// material's icon onto the canvas said "download.png cannot be opened as a
// schematic".
console.log("\n--- a block dragged onto the viewport is not a file ---");
await (async () => {
  equal(
    "a file from outside is a file, and only that",
    [
      isFileDrop(["Files"], false),
      isFileDrop(["text/plain"], false),
      isFileDrop(["Files", BLOCK_MIME], false),
      isFileDrop(["Files"], true),
      isFileDrop(undefined, false),
    ],
    [true, false, false, false, false],
  );

  // A window stand-in: the listeners are all the tracker touches.
  const listeners = new Map<string, (() => void)[]>();
  const fake = {
    addEventListener: (type: string, listener: () => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type: string, listener: () => void) =>
      listeners.set(type, (listeners.get(type) ?? []).filter((each) => each !== listener)),
  };
  const fire = (type: string): void => (listeners.get(type) ?? []).forEach((listener) => listener());
  const drags = trackPageDrags(fake as unknown as Window);
  equal("no drag is from the page until one starts", drags.fromPage(), false);
  fire("dragstart");
  equal("a drag that starts in the page is from the page", drags.fromPage(), true);
  fire("dragend");
  equal("...until it ends", drags.fromPage(), false);
  fire("dragstart");
  fire("drop");
  equal("a drop's own listeners still see it as the page's", drags.fromPage(), true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  equal("...and it is over once they have run, with no dragend", drags.fromPage(), false);
  fire("dragstart");
  fire("pointermove");
  equal("the next pointer move ends one that lost its dragend", drags.fromPage(), false);
  drags.dispose();
  fire("dragstart");
  equal("disposed, it hears nothing", drags.fromPage(), false);

  const css = readFileSync(path.join(RENDERER, "app.css"), "utf8");
  check("no picture in the window can be dragged out as a file", /img\s*\{\s*-webkit-user-drag:\s*none;/.test(css));
  const page = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  const drop = page.slice(page.indexOf("async function onDrop("), page.indexOf("async function resolveRecovery("));
  check(
    "the drop asks before it reads a file",
    drop.indexOf("if (!fileDragged(event)) return;") !== -1 &&
      drop.indexOf("if (!fileDragged(event)) return;") < drop.indexOf("dataTransfer?.files"),
  );
  const enter = page.slice(page.indexOf("function onDragEnter("), page.indexOf("function onDragOver("));
  check("...and so does the highlight", enter.includes("if (!fileDragged(event)) return;"));
})();

// --- when a block arrived, as far as the table can see -------------------------
//
// The version table starts at the Flattening, so a block it dates to its first
// release may be far older. The hover said oak stairs arrived in 1.13.
console.log("\n--- when a block arrived, as far as the table can see ---");
{
  const floor = versionTableFloor();
  equal("the table starts at 1.13", versionNameOf(floor), "JE_1_13");
  equal("oak stairs come out of it at its floor", versionRangeOf("minecraft:oak_stairs")?.since, floor);
  check(
    "...while a block that really arrived later does not",
    (versionRangeOf("minecraft:pale_oak_planks")?.since ?? floor) > floor,
  );
  const tooltip = readFileSync(path.join(RENDERER, "lib", "BlockTooltip.svelte"), "utf8");
  check(
    "the hover says 'or earlier' for a block at the floor",
    /atFloor\s*\?\s*t\("blockInfo\.sinceOrEarlier"/.test(tooltip) && /atFloor\s*\?\s*t\("blockInfo\.until"/.test(tooltip),
  );
}

// --- the distribution, in the With field -------------------------------------
//
// Its labels are assembled from templates -- `mix.kind.${kind}` -- which the
// catalogue's own check above cannot see, so the table is walked here: every
// kind, every parameter and every option has its words.
console.log("\n--- the distribution, in the With field ---");
{
  const catalogue = en as Record<string, string>;
  const wanted: string[] = [];
  for (const kind of DISTRIBUTION_KINDS) {
    wanted.push(`mix.kind.${kind}`, `mix.kindHint.${kind}`);
    for (const spec of DISTRIBUTION_PARAMS[kind]) {
      wanted.push(`mix.param.${spec.key}`, `mix.paramHint.${spec.key}`);
      if (spec.type === "choice") for (const option of spec.options) wanted.push(`mix.option.${option}`);
    }
  }
  const missing = [...new Set(wanted)].filter((key) => catalogue[key] === undefined);
  check("every distribution, parameter and option has its words", missing.length === 0, missing.join(", "));

  const field = readFileSync(path.join(RENDERER, "lib", "BlockMixField.svelte"), "utf8");
  const setKind = field.slice(field.indexOf("function setKind("), field.indexOf("function setParam("));
  check(
    "choosing another distribution keeps the seed and drops the old one's parameters",
    /distribution: \{ kind, seed \}/.test(setKind),
  );
  check(
    "a parameter typed in goes through the same reading as the spelling",
    /function setParam\([\s\S]{0,400}normalizeDistribution\(/.test(field),
  );

  /*
   * A gradient by hand runs from one end of the document to the other, which
   * is only true if the hand is told where the ends are.
   */
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  check("a block placed by hand takes its shares over the document's box", /pickAt\(mix, at\.x, at\.y, at\.z, frame\)/.test(app));

  /*
   * The map beside the parameters. Its arithmetic is `distribution_map.ts`'s
   * and is checked against `pickAt` in `tests/session.ts`; what is checked here
   * is that the field draws it, over the frame a fill covers.
   */
  const planeWords = MAP_PLANES.flatMap((plane) => [`mix.map.plane.${plane}`, `mix.map.planeHint.${plane}`]);
  equal("every plane of the map has its words", planeWords.filter((key) => catalogue[key] === undefined), []);
  const mixBlock = field.slice(field.indexOf("{#if weights && mix.entries.length > 1}"), field.indexOf("<BlockTooltip"));
  check("a mix shows the map of its distribution", /<DistributionPreview \{mix\} \{frame\}/.test(mixBlock));
  check(
    "...opened with the parameters, and only while there are some",
    /expanded=\{tuning && specs\.length > 0\}/.test(mixBlock),
  );
  const preview = readFileSync(path.join(RENDERER, "lib", "DistributionPreview.svelte"), "utf8");
  check(
    "...drawn by the shared sampler over the frame it was given",
    /distributionMap\(\{ mix, frame: box, plane, level \}\)/.test(preview),
  );
  const tools = readFileSync(path.join(RENDERER, "lib", "SelectionTools.svelte"), "utf8");
  check("the With field's map is drawn over what a fill covers", /frame=\{mapFrame\}/.test(tools));
  check("...and the schematic is the frame with nothing selected", /documentSize=\{docState\?\.size \?\? null\}/.test(app));

  // A block's colour on the map is its icon's, the transparent margin left out.
  equal("an icon's colour is the average of what is drawn", averageColour([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255]), [128, 0, 128]);
  equal("...weighted by how opaque each pixel is", averageColour([200, 0, 0, 255, 0, 0, 200, 85]), [150, 0, 50]);
  equal("...and nothing for an icon with nothing in it", averageColour([9, 9, 9, 0]), null);
}


// --- several areas, one selection --------------------------------------------
//
// The active area is `selection` and the rest sit beside it, in an order that
// does not reshuffle: making the third area active leaves it third.
console.log("\n--- several areas, one selection ---");
{
  const box = (x: number, width = 1) => ({ minX: x, minY: 0, minZ: 0, maxX: x + width - 1, maxY: 0, maxZ: 0 });
  const xs = (list: readonly { minX: number }[]) => list.map((area) => area.minX);

  let set = single(box(0, 4));
  set = withArea(set, box(10));
  set = withArea(set, box(20));
  equal("an added area goes at the end of the list", xs(areaList(set)), [0, 10, 20]);
  equal("...and becomes the active one", [set.active?.minX, activeIndex(set)], [20, 2]);

  const first = activated(set, 0);
  equal("activating an area leaves the list in its order", xs(areaList(first)), [0, 10, 20]);
  equal("...and moves only which one is active", [first.active?.minX, activeIndex(first)], [0, 0]);

  // Removing the active area hands the role to the one listed before it.
  const dropped = withoutArea(set, 2);
  equal("removing the active area keeps the rest", xs(areaList(dropped)), [0, 10]);
  equal("...and the one before it becomes active", dropped.active?.minX, 10);
  const other = withoutArea(first, 1);
  equal("removing another area leaves the active one active", [other.active?.minX, xs(areaList(other))], [
    0,
    [0, 20],
  ]);
  equal("removing the last area leaves no selection", withoutArea(single(box(0)), 0), NO_AREAS);

  // Nested areas: the click means the small one drawn inside the large one.
  const nested = withArea(single(box(0, 10)), box(3));
  equal("a click inside nested areas finds the smallest", areaAt(nested, { x: 3, y: 0, z: 0 }), 1);
  equal("...and one only the large area holds finds that", areaAt(nested, { x: 7, y: 0, z: 0 }), 0);
  equal("...and a click outside every area finds none", areaAt(nested, { x: 30, y: 0, z: 0 }), -1);

  equal("the bounds hold every area", areaBounds(set), { minX: 0, minY: 0, minZ: 0, maxX: 20, maxY: 0, maxZ: 0 });
  equal("cells are counted over the union", areaCells(withArea(single(box(0, 4)), box(2, 4))), 6);
  equal(
    "a translation moves every area and keeps the active one",
    [xs(areaList(mapAreas(set, (area) => ({ ...area, minX: area.minX + 1, maxX: area.maxX + 1 })))), activeIndex(set)],
    [[1, 11, 21], 2],
  );

  // Main refuses an edit naming more than MAX_BOXES, so the set stops there.
  let full = single(box(0));
  for (let i = 1; i <= MAX_BOXES + 5; i += 1) full = withArea(full, box(i * 2));
  equal("the set never holds more areas than an edit may name", areaList(full).length, MAX_BOXES);

  /*
   * A rigid map about one origin: two areas mirrored about the middle of
   * their bounds trade places, and that is what main does with the mask.
   */
  const pair = [box(0, 2), box(6, 2)];
  const bounds = { minX: 0, minY: 0, minZ: 0, maxX: 7, maxY: 0, maxZ: 0 };
  equal(
    "two areas mirrored about their bounds trade places",
    xs(pair.map((area) => transformedRegion(area, gizmoOrigin(bounds, null), { kind: "mirror", axis: "x" }))),
    [6, 0],
  );

  // Alt is about which areas, and a miss with it does nothing.
  const intent = (hit: boolean, shift: boolean, alt: boolean) => clickIntent({ hit, shift, ctrl: false, alt });
  equal("Shift+Alt on a block adds an area", intent(true, true, true), "add");
  equal("Alt on a block takes one away", intent(true, false, true), "remove");
  equal("...and a miss with Alt clears nothing", [intent(false, true, true), intent(false, false, true)], [
    "ignore",
    "ignore",
  ]);
  equal("without Alt a click is what it was", [intent(true, false, false), intent(false, true, false)], [
    "pick",
    "clear",
  ]);

  /*
   * The wiring, read from the source because the gestures run from a viewport
   * this harness cannot drive.
   */
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
  check(
    "Alt released after an Alt+click is kept from the menu bar",
    /event\.key === "Alt" && altClicked\)[\s\S]{0,80}event\.preventDefault\(\)/.test(viewer),
  );
  check("...and a press with Alt is what arms that", /if \(event\.altKey\) altClicked = true;/.test(viewer));
  check(
    "a sweep decides at the press whether it adds",
    (viewer.match(/sweepAdds = event\.altKey;/g) ?? []).length === 2,
  );
  check(
    "a face drag resizes the active area and leaves the others",
    /onselectionchange\(next, "resize"\)/.test(viewer),
  );

  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  const now = app.slice(app.indexOf("function selectionNow"), app.indexOf("function restoreSelection"));
  check(
    "with no active area a step records no other areas",
    /others: selection === null \? \[\]/.test(now),
  );
  const dropping = app.slice(app.indexOf("if (selection !== null) return;"));
  check(
    "dropping the selection drops the other areas with it",
    /if \(otherAreas\.length > 0\) otherAreas = \[\];/.test(dropping.slice(0, 900)),
  );
  for (const verb of ["async function fillSelection", "async function replaceInSelection", "async function deleteSelection", "async function copySelection"]) {
    const from = app.indexOf(verb);
    check(`${verb.split(" ").pop()} sends every area`, from !== -1 && app.slice(from, from + 600).includes("areasForIpc()"));
  }
}


// --- Delete leaves the document's empty space --------------------------------
//
// A break has always written the empty space; Delete wrote the word air, so
// with water chosen it left a dry pocket where breaking the same blocks one by
// one left water. Read from the source: the fill crosses IPC, and this harness
// makes no round trip.
console.log("\n--- Delete leaves the document's empty space ---");
{
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  const from = app.indexOf("async function deleteSelection");
  const body = from === -1 ? "" : app.slice(from, from + 700);
  check("Delete fills with the empty space block", /parseBlock\(docState\?\.voidBlock \|\| "minecraft:air"\)/.test(body));
  check("...and not with air written out", !body.includes('singleMix({ namespacedName: "minecraft:air" })'));
}

// --- the frame costs less ----------------------------------------------------
//
// The third stutter report: a still scene drew sixty frames a second, each one
// resolving a multisampled target three times (sky, scene, compass) and
// redrawing the shadow map, and every edit threw the shadow map away. The
// decision is `render_demand.ts`; the rest is read from the source, because
// the loop runs from `requestAnimationFrame`, which this harness has no
// frames from.
console.log("\n--- the frame costs less ---");
{
  const base = { now: 10_000, activeAt: 0, animated: false, pending: false, always: false };
  check("a still scene draws nothing", !shouldDraw(base));
  check("activity draws", shouldDraw({ ...base, activeAt: 10_000 }));
  check("...for a little while after it", shouldDraw({ ...base, activeAt: 10_000 - SETTLE_MS + 1 }));
  check("...and then stops", !shouldDraw({ ...base, activeAt: 10_000 - SETTLE_MS }));
  check("an animated texture's new frame draws", shouldDraw({ ...base, animated: true }));
  check("work left for a later frame draws", shouldDraw({ ...base, pending: true }));
  check("always draw draws", shouldDraw({ ...base, always: true }));

  const watch = new ViewWatch();
  check("the first view counts as a move", watch.moved([1, 2, 3]));
  check("the same view does not", !watch.moved([1, 2, 3]));
  check("any number differing does", watch.moved([1, 2, 3.0000001]));
  check("...once", !watch.moved([1, 2, 3.0000001]));
  check("a view of another length does", watch.moved([1, 2]));

  check("the counter is idle once nothing has drawn for its window", counterIdle(1000, 400, 500));
  check("...not before", !counterIdle(1000, 600, 500));
  check("...and not before the first frame", !counterIdle(1000, 0, 500));

  // The working copy may be CRLF, and every pattern below spells a newline.
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8").replace(/\r\n/g, "\n");
  const stripped = viewer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const between = (from: string, to: string): string => {
    const start = stripped.indexOf(from);
    return start === -1 ? "" : stripped.slice(start, stripped.indexOf(to, start + from.length));
  };

  /*
   * One resolve per frame. three resolves a multisampled target at the end of
   * every `render()` into it, so the world -- sky included -- is one render,
   * and the compass has a target of its own.
   */
  const frame = between("function renderFrame(): void {", "onMount(");
  check("the frame binds the scene's target once", (frame.match(/setRenderTarget\(aaTarget\)/g) ?? []).length === 1);
  check("...and draws the world in one render", (frame.match(/renderer\.render\(scene, camera\)/g) ?? []).length === 1);
  check("...with no pass of the sky's own", frame.length > 0 && !frame.includes("render(skyScene"));
  check("the compass draws into its own target when anti-aliased", /setRenderTarget\(compassTarget\)/.test(between("function drawCompass", "function compositeCompass")));
  check("the targets do not resolve their depth", (stripped.match(/resolveDepthBuffer: false/g) ?? []).length === 2);
  /*
   * In the world's pass the sun, the moon and the stars are drawn after every
   * opaque object, being transparent, so they are kept behind the world by
   * depth: on the far plane, tested against what the world wrote.
   */
  const farPlane = between("function atFarPlane", "function buildSky");
  check("a sky body is pushed onto the far plane", farPlane.includes("gl_Position.z = gl_Position.w;"));
  check("...and depth-tested there", farPlane.includes("material.depthTest = true"));
  check("...which is all three of them", (between("function buildSky", "function skyImage").match(/atFarPlane\(/g) ?? []).length === 2);
  check("the environment is still built from the sky alone", /skyScene\.add\(skyGroup\);\s*const built = pmrem\.fromScene\(skyScene/.test(stripped));

  /*
   * The shadow map is drawn on request, through one function, and kept across
   * edits: only a new resolution reallocates it.
   */
  check("the shadow map does not redraw itself", stripped.includes("renderer.shadowMap.autoUpdate = false"));
  check(
    "...and one function asks for it",
    (stripped.match(/shadowMap\.needsUpdate = true/g) ?? []).length === 1 &&
      /function shadowsStale\(\): void \{\s*if \(renderer\) renderer\.shadowMap\.needsUpdate = true;/.test(stripped),
  );
  check("aiming the light asks for it", /camera\.updateProjectionMatrix\(\);\s*shadowsStale\(\);\s*\}/.test(between("function placeShadow", "$effect")));
  check("every payload asks for it", (between("const payload = mesh;", "</script>").match(/shadowsStale\(\)/g) ?? []).length === 3);
  const shadowEffect = between("renderer.shadowMap.enabled = shadows;", "function shadowsStale");
  check("the map is reallocated only for a new resolution", /if \(sun\.shadow\.mapSize\.x !== shadowQuality[\s\S]*sun\.shadow\.map\?\.dispose\(\);/.test(shadowEffect));
  check("...and the effect does not follow the document's size", shadowEffect.includes("untrack(placeShadow)"));
  check("the document's size is one array while its numbers hold", /const documentSize = \$derived\.by/.test(stripped) && stripped.includes("documentSize: documentSizeProp = null"));

  const resizeBody = between("function resize(): void {", "const AA_RESIZE_MS");
  check("a resize reallocates the targets later, not at once", resizeBody.includes("sizeAaTargetSoon();") && !resizeBody.includes("sizeAaTarget();"));
  check(
    "the pixel ratio follows the display it is on",
    stripped.includes("renderer.setPixelRatio(Math.min(deviceRatio, maxDpr) * renderScale)") &&
      stripped.includes("window.matchMedia(`(resolution: ${deviceRatio}dppx)`)"),
  );
  check("no vector is allocated per frame for the viewport", !between("function drawCompass", "function compositeCompass").includes("new THREE.Vector2"));

  /*
   * The loop: the interval is closed before the decision, so a refresh that
   * draws nothing is still a short interval rather than part of one long one;
   * and nothing that follows the pointer runs unless the frame is drawn.
   */
  const loop = between("const animate = () => {", "animate();");
  const opened = loop.indexOf("profiler.beginFrame");
  const decided = loop.indexOf("shouldDraw(");
  check("the profiler's interval closes before the decision", opened > 0 && decided > opened);
  check("...which comes before the hover and the frame", decided > 0 && loop.indexOf("updateHover(") > decided && loop.indexOf("renderFrame();") > decided);
  check("the camera is compared, not announced", /view\.moved\(viewNumbers\(camera\)\)/.test(loop));

  /*
   * Every prop that is not a callback asks for a frame. A prop added and left
   * out of the list is a picture that stops updating, which is the failure
   * drawing on demand invites.
   */
  const props = viewer.slice(viewer.indexOf("  const {\n    mesh,"), viewer.indexOf("}: Props = $props();"));
  const locals = [...props.matchAll(/^\s{4}(\w+)(?::\s*(\w+))?(?:\s*=[^,\n]*)?,$/gm)]
    .map((match) => match[2] ?? match[1])
    .filter((name) => !/^on[a-z]/.test(name));
  const invalidation = between("void [\n      mesh,", "invalidate();\n  });");
  const missing = locals.filter((name) => !new RegExp(`\\b${name}\\b`).test(invalidation));
  check("every prop is read by the invalidation effect", locals.length > 30 && missing.length === 0, `${locals.length} props; missing: ${missing.join(", ")}`);

  /*
   * The glow: a mask drawn before the scene's target is bound, so the frame
   * still binds that target once; an outline laid on the canvas, never into
   * the multisampled target, under the compass; and a scene of its own that
   * no raycast, light or shadow reaches.
   */
  const maskAt = frame.indexOf("drawGlowMask();");
  check("the glow's mask is drawn before the scene's target is bound", maskAt > 0 && maskAt < frame.indexOf("setRenderTarget(aaTarget)"));
  check(
    "...its outline after the anti-aliased copy, under the compass",
    /render\(aaScene, aaCamera\);\s*compositeGlow\(\);\s*compositeCompass\(\);/.test(frame),
  );
  const plainAt = frame.indexOf("if (aaTarget === null) {");
  check(
    "...and without anti-aliasing after the scene pass, under the compass",
    plainAt > frame.indexOf("renderer.render(scene, camera)") &&
      frame.indexOf("compositeGlow();", plainAt) > plainAt &&
      frame.indexOf("compositeGlow();", plainAt) < frame.indexOf("drawCompass();"),
  );
  check(
    "the mask has no depth buffer and no samples to resolve",
    /new THREE\.WebGLRenderTarget\([^;]*\{\s*depthBuffer: false,\s*stencilBuffer: false,\s*\}\)/.test(
      between("function drawGlowMask", "function compositeGlow"),
    ),
  );
  check(
    "no raycast reaches the glow",
    !(viewer.match(/raycaster\.intersectObjects?\([^)]*\)/g) ?? []).some((cast) => /glow/i.test(cast)),
  );
  check(
    "the shell is never put in the world's scene",
    !/\bscene\.add\(glow/.test(stripped) && !/loaded\??\.add\(glow/.test(stripped),
  );
  check("the glow stands where the chunks stand", /glowGroup\?\.position\.set\(frame\[0\], frame\[1\], frame\[2\]\)/.test(between("function placeChunks", "function pickBlockAt")));
  check("the mask follows a resize on the targets' delay", resizeBody.includes("sizeGlowTargetSoon();"));

  const appGlow = readFileSync(path.join(RENDERER, "App.svelte"), "utf8").replace(/\r\n/g, "\n");
  const escapeGlow = appGlow.indexOf('event.key === "Escape" && glow !== null');
  check(
    "Escape puts the glow out before it drops the selection",
    escapeGlow > 0 && escapeGlow < appGlow.indexOf('event.key === "Escape" && selection !== null'),
  );
  check(
    "a glow lit from the list goes with the selection, one a model lit stays",
    /if \(selection !== null\) return;[\s\S]*?if \(glow !== null && glow\.scope === "selection"\) glow = null;\n {2}\}\);/.test(appGlow),
  );
  check("a model's glow reaches the window", appGlow.includes("api().onGlow("));
  check(
    "the glow's colour is in all three palettes",
    (readFileSync(path.join(RENDERER, "app.css"), "utf8").match(/--glow: #/g) ?? []).length === 3,
  );
}

// --- a click in creative mode is never dropped -------------------------------
//
// Hand placement went through `runDocument`, which holds `busy` until the new
// mesh has arrived, and `onBuild` returns while `busy` is set: every click
// during that round trip was lost. It has its own road now, queued and not
// waiting for the picture. Read from the source, because the round trip is
// main's and this harness makes none.
console.log("\n--- a click in creative mode is never dropped ---");
{
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8").replace(/\r\n/g, "\n");
  const build = app.slice(app.indexOf("async function onBuild("), app.indexOf("function queueBuild("));
  check("a placement by hand goes through the build queue", build.includes("await queueBuild(label, () =>"));
  check("...and not through runDocument", !build.includes("runDocument("));
  const apply = app.slice(app.indexOf("async function applyBuild("), app.indexOf("async function applyBuild(") + 1400);
  check(
    "the queue asks for the redraw without waiting for it",
    apply.includes("void refreshDocument()") && !apply.includes("await refreshDocument()"),
  );
  check("...and holds no busy flag that would drop the next click", !apply.includes("busy = true"));
  check("clicks run in order, one after another", /buildQueue = buildQueue\.then\(\(\) => applyBuild\(doing, call\)\);/.test(app));
}


// --- levels of detail -------------------------------------------------------
//
// `lod.ts` decides which level each region and chunk shows. The rule is a
// screen-space error with a tenth of hysteresis, a change of level is crossed
// in a quarter of a second with two complementary dithers, and up close --
// the document as R frames it -- nothing changes at all.
console.log("\n--- levels of detail ---");
{
  for (const [x, y, z] of [
    [0, 0, 0],
    [3, -2, 7],
    [-5, 1, -9],
    [100, 40, -100],
  ] as const) {
    equal(`the key of (${x}, ${y}, ${z}) is main's`, packKey(x, y, z), chunkKey(x, y, z));
    equal(`...and reads back as main reads it`, unpackKey(chunkKey(x, y, z)), chunkCoords(chunkKey(x, y, z)));
  }
  equal("a chunk's region floors negative coordinates", unpackKey(regionOfChunk(packKey(-1, 0, 5))), [-1, 0, 1]);

  // A camera at the origin looking down -z: its view matrix is the identity.
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const view = (over: Partial<LodView> = {}): LodView => ({
    view: identity,
    perspective: true,
    fovDeg: 60,
    orthoHeight: 0,
    near: 0.1,
    heightPx: 1000,
    offset: [0, 0, 0],
    ...over,
  });
  const box = (z0: number, z1: number): LodBox => ({ minX: -1, minY: -1, minZ: z0, maxX: 1, maxY: 1, maxZ: z1 });

  equal("a box in front is as deep as its nearest corner", nearestDepth(view(), box(-20, -10)), 10);
  equal("a camera inside a box sees it at the near plane: the full mesh", nearestDepth(view(), box(-5, 5)), 0.1);
  equal(
    "...and the group's offset is where the chunks stand",
    nearestDepth(view({ offset: [0, 0, -5] }), box(-20, -10)),
    15,
  );
  check(
    "a pixel covers 2 z tan(fov / 2) / H at depth z",
    Math.abs(worldPerPixel(view(), 100) - (2 * 100 * Math.tan(Math.PI / 6)) / 1000) < 1e-12,
  );
  equal(
    "orthographic, the same at any depth",
    [worldPerPixel(view({ perspective: false, orthoHeight: 50 }), 1), worldPerPixel(view({ perspective: false, orthoHeight: 50 }), 1000)],
    [0.05, 0.05],
  );

  check("a level is taken a tenth before the threshold", allowed(1.79, 2, false) && !allowed(1.81, 2, false));
  check("...and kept until a tenth past it", allowed(2.19, 2, true) && !allowed(2.21, 2, true));

  const levels = { shapes: true, coarse: true };
  const region = (z0: number, z1: number, lod2: number | null, lod3: number | null, shapes: number | null = 0.25): LodRegion => ({
    key: packKey(0, 0, 0),
    box: box(z0, z1),
    lod2,
    lod3,
    chunks: [{ key: packKey(0, 0, 0), box: box(z0, z1), shapes }],
  });
  // At depth d a pixel is 0.0011547 d: level 2 (2 blocks) is taken past
  // ~962 at two pixels, level 3 (4 blocks) past ~1925, level 1 (0.25) past ~120.
  equal("near, a region shows its chunks", regionTarget(view(), region(-110, -100, 2, 4), 2, levels, 0), 0);
  equal("far, level 2", regionTarget(view(), region(-1110, -1000, 2, 4), 2, levels, 0), 2);
  equal("farther, level 3", regionTarget(view(), region(-3100, -3000, 2, 4), 2, levels, 0), 3);
  equal("a level not held is passed over", regionTarget(view(), region(-3100, -3000, 2, null), 2, levels, 0), 2);
  equal(
    "coarse levels switched off leave the chunks",
    regionTarget(view(), region(-3100, -3000, 2, 4), 2, { shapes: true, coarse: false }, 0),
    0,
  );
  const chunk = { key: packKey(0, 0, 0), box: box(-140, -130), shapes: 0.25 };
  equal("a chunk far enough shows level 1", chunkTarget(view(), chunk, 2, levels, 0), 1);
  equal("...one nearer, the full mesh", chunkTarget(view(), { ...chunk, box: box(-60, -50) }, 2, levels, 0), 0);
  equal("...one with no level 1, the full mesh at any distance", chunkTarget(view(), { ...chunk, shapes: null }, 2, levels, 0), 0);
  equal("...and with level 1 switched off", chunkTarget(view(), chunk, 2, { shapes: false, coarse: true }, 0), 0);

  // The crossing, in time.
  const selector = new LodSelector();
  const out = new Map<string, LodDraw>();
  const solid = `solid:${packKey(0, 0, 0)}`;
  const lod3 = `lod3:${packKey(0, 0, 0)}`;
  selector.choose(view(), [region(-3100, -3000, 2, 4)], 2, levels, 0, out);
  equal("the first look settles at once", [...out.entries()], [[lod3, null]]);
  check("...with nothing crossing", !selector.fading);
  selector.choose(view(), [region(-110, -100, 2, 4)], 2, levels, 1000, out);
  check("coming close starts a crossing", selector.fading);
  const start = [out.get(lod3), out.get(solid)];
  check(
    "...the coarse level on one side and the chunks on the other, with one t",
    JSON.stringify(start) === JSON.stringify([{ t: 1, coarse: true }, { t: 1, coarse: false }]),
    JSON.stringify(start),
  );
  selector.choose(view(), [region(-110, -100, 2, 4)], 2, levels, 1000 + FADE_MS / 2, out);
  const half = [out.get(lod3), out.get(solid)] as LodDraw[];
  check("halfway, both at one half", half[0]?.t === 0.5 && half[1]?.t === 0.5, JSON.stringify(half));
  let complement = true;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        if (keepsPixel({ t, coarse: true }, x, y) === keepsPixel({ t, coarse: false }, x, y)) complement = false;
      }
    }
  }
  check("every pixel is drawn by exactly one side of a crossing", complement);
  check("the dither's thresholds are sixteen, none of them 0 or 1", BAYER_4X4.length === 16 && BAYER_4X4.every((v) => v > 0 && v < 1));
  selector.choose(view(), [region(-110, -100, 2, 4)], 2, levels, 1000 + FADE_MS, out);
  equal("a quarter of a second later only the chunks are drawn", [...out.entries()], [[solid, null]]);
  check("...and nothing is crossing", !selector.fading);
  selector.choose(view(), [region(-110, -100, 2, 4)], 2, levels, 5000, out);
  check("a still camera draws one level of everything", [...out.values()].every((how) => how === null));

  const gone = new LodSelector();
  gone.choose(view(), [region(-1110, -1000, 2, null, null)], 2, levels, 0, out);
  gone.choose(view(), [region(-1110, -1000, null, null, null)], 2, levels, 10, out);
  equal("a level whose mesh went is left at once, not crossed from", [...out.entries()], [[solid, null]]);
  check("...with nothing crossing", !gone.fading);

  /*
   * The report, as a check: a small build framed by R, and closer, is drawn
   * in full -- at the default two pixels, even with every chunk holding the
   * worst stand-in there is and a viewport only 600 pixels tall.
   */
  const size = { width: 21, height: 24, length: 22 };
  const framing = documentFraming(size);
  for (const [label, scale] of [
    ["as R frames it", 1],
    ["and from half as far", 0.5],
  ] as const) {
    const camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1.6, 0.1, 2048);
    camera.position.set(
      framing.target.x + (framing.position.x - framing.target.x) * scale,
      framing.target.y + (framing.position.y - framing.target.y) * scale,
      framing.target.z + (framing.position.z - framing.target.z) * scale,
    );
    camera.lookAt(framing.target.x, framing.target.y, framing.target.z);
    camera.updateMatrixWorld();
    const chunks = [];
    for (let cx = 0; cx < 2; cx += 1) {
      for (let cy = 0; cy < 2; cy += 1) {
        for (let cz = 0; cz < 2; cz += 1) {
          chunks.push({
            key: packKey(cx, cy, cz),
            box: {
              minX: cx * 16,
              minY: cy * 16,
              minZ: cz * 16,
              maxX: Math.min(size.width, cx * 16 + 16),
              maxY: Math.min(size.height, cy * 16 + 16),
              maxZ: Math.min(size.length, cz * 16 + 16),
            },
            shapes: 0.2832,
          });
        }
      }
    }
    const pavilion: LodRegion = {
      key: packKey(0, 0, 0),
      box: { minX: 0, minY: 0, minZ: 0, maxX: size.width, maxY: size.height, maxZ: size.length },
      lod2: 2,
      lod3: 4,
      chunks,
    };
    const small = new LodSelector();
    const stats = small.choose(
      {
        view: camera.matrixWorldInverse.elements,
        perspective: true,
        fovDeg: ORBIT_FOV,
        orthoHeight: 0,
        near: 0.1,
        heightPx: 600,
        offset: [0, 0, 0],
      },
      [pavilion],
      2,
      levels,
      0,
      out,
    );
    equal(`a 21x24x22 build ${label} is drawn in full`, [stats.full, stats.shapes, stats.lod2, stats.lod3], [8, 0, 0, 0]);
  }

  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
  const casts = viewer.match(/raycaster\.intersectObjects?\([^)]*\)/g) ?? [];
  check("no raycast reaches a level of detail", casts.length > 0 && !casts.some((cast) => cast.includes("lodLoaded")));
  const frame = viewer.slice(viewer.indexOf("function renderFrame("));
  const probeAt = frame.indexOf("shadowsFromFullDetail()");
  check(
    "the shadow map is drawn from the full chunks before the scene pass",
    probeAt > 0 && probeAt < frame.indexOf("renderer.render(scene, camera)"),
  );
  const probe = viewer.slice(viewer.indexOf("function shadowsFromFullDetail("));
  check(
    "...with every full chunk shown and every level hidden",
    /mesh\.visible = layer === "solid";/.test(probe.slice(0, 1200)),
  );
  check(
    "a delta that brings only levels leaves the shadow map as it was",
    viewer.includes("if (moved || touchesFullMesh(payload)) shadowsStale();"),
  );
  check(
    "the crossing and tint copies have programs of their own",
    viewer.includes('variant.customProgramCacheKey = () => (fade ? "lod-fade" : "lod-tint");'),
  );
  check(
    "...and dither as keepsPixel does, from its own table",
    viewer.includes("uLodCoarse > 0.5 ? lodThreshold >= uLodFade : lodThreshold < uLodFade") &&
      viewer.includes("BAYER_4X4.map"),
  );
  const demand = viewer.slice(viewer.indexOf("const pending ="), viewer.indexOf("const pending =") + 300);
  check("a crossing keeps frames coming until it ends", demand.includes("lodSelector.fading"));

  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  check(
    "asking for other levels reaches main",
    ["lodMode", "lodShapes", "lodCoarse", "lodAutoTriangles"].every((field) => app.includes(`patch.${field} !== undefined`)),
  );
  check(
    "...while the pixels and the tint stay the viewer's",
    !app.includes("patch.lodPixels !== undefined") && !app.includes("patch.lodTint !== undefined"),
  );
  check("levels still queued in main are asked for again", app.includes('if (mesh?.lod.state !== "pending") return;'));

  const modal = readFileSync(path.join(RENDERER, "lib", "SettingsModal.svelte"), "utf8");
  check(
    "the level-of-detail pane has every control",
    ['id="lod-mode"', 'id="lod-pixels"', 'id="lod-auto"', "lodShapes:", "lodCoarse:", "lodTint:", "lodStatusLine"].every(
      (part) => modal.includes(part),
    ),
  );
  check("...and the threshold is disabled outside Automatic, not hidden", modal.includes('disabled={lod.mode !== "auto"}'));
}

// --- Icons are drawn, not typed ---------------------------------------------
/*
 * The browse button beside every block field drew its `⊞` off to the right of
 * its own box. Two faults, and both are a glyph's: a character is laid out by
 * the font's metrics rather than by the drawing, and a fixed-width button that
 * kept the global `8px 14px` padding had a content box narrower than nothing.
 *
 * So icons are `<Icon>`s now, and this refuses the old way coming back one
 * button at a time: no button may be labelled by a symbol character, an emoji
 * or a character entity. Text that merely contains one -- "64×64" in a size
 * option -- is not a button's whole label and is left alone.
 */
console.log("\n--- Icons ---");
{
  const svelteFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? svelteFiles(full) : full.endsWith(".svelte") ? [full] : [];
    });
  /** Drops `{...}` expressions, nested ones included, so an attribute's `>` cannot end the tag. */
  const withoutExpressions = (text: string): string => {
    let out = "";
    let depth = 0;
    for (const character of text) {
      if (character === "{") depth += 1;
      else if (character === "}") depth = Math.max(0, depth - 1);
      else if (depth === 0) out += character;
    }
    return out;
  };
  const symbol = /&#x[0-9a-f]+;|&times;|[←-⯿…‹›×]|[\u{1f300}-\u{1faff}]/iu;
  const offenders: string[] = [];
  for (const file of svelteFiles(RENDERER)) {
    const source = readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    let at = 0;
    while ((at = source.indexOf("<button", at)) >= 0) {
      const end = source.indexOf("</button>", at);
      if (end < 0) break;
      const tag = withoutExpressions(source.slice(at, end));
      const label = tag.slice(tag.indexOf(">") + 1).replace(/<[^>]*>/g, "").trim();
      if (symbol.test(label)) offenders.push(`${path.relative(RENDERER, file)}: ${label.slice(0, 30)}`);
      at = end;
    }
  }
  check("no button is labelled by a glyph", offenders.length === 0, offenders.join("; "));

  /*
   * The check has to be able to fail, and a walk that matched nothing would
   * pass forever: the button that was reported is the one it must see.
   */
  const seen = withoutExpressions('<button class="browse" onclick={() => x > 1}>&#x229E;</button>');
  check(
    "...and the walk does see a glyph through an attribute holding a `>`",
    symbol.test(seen.slice(seen.indexOf(">") + 1).replace(/<[^>]*>/g, "")),
  );

  const css = readFileSync(path.join(RENDERER, "app.css"), "utf8");
  const rule = css.slice(css.indexOf("button.icon {"), css.indexOf("}", css.indexOf("button.icon {")));
  check(
    "an icon button centres what it holds and gives up the global padding",
    rule.includes("place-items: center") && rule.includes("padding: 0"),
  );

  const mix = readFileSync(path.join(RENDERER, "lib", "BlockMixField.svelte"), "utf8");
  const browse = mix.slice(mix.indexOf("  .browse {"), mix.indexOf("}", mix.indexOf("  .browse {")));
  check(
    "...and so does the browse button beside a block field, where it was reported",
    browse.includes("place-items: center") && browse.includes("padding: 0"),
  );
}

// --- the creative tools ----------------------------------------------------
//
// The rules are `creative_tools.ts`'s, a plain module because the gestures run
// from the viewer's loop and pointer handlers, which this harness composites no
// frames for. The geometry under them is `shapes.ts`', held to WorldEdit in
// `tests/session.ts`; here are the counts that say the tools ask it the
// right question.
console.log("\n--- the creative tools ---");
{
  const settings = DEFAULT_CREATIVE_SETTINGS;
  equal(
    "B steps through the tools and comes back round",
    [nextTool("place"), nextTool("brush"), nextTool("shape"), nextTool("walls"), nextTool("terrain"), nextTool("smooth"), nextTool("erode")],
    ["brush", "shape", "walls", "terrain", "smooth", "erode", "place"],
  );
  equal(
    "the brushes are held strokes -- paint, terrain, smooth, erode -- and the corner tools and the hand are not",
    (["place", "brush", "shape", "walls", "terrain", "smooth", "erode"] as const).map((tool) => takesStroke(tool)),
    [false, true, false, false, true, true, true],
  );
  equal(
    "...each spaced by its own radius",
    (["brush", "terrain", "smooth", "erode"] as const).map((tool) => strokeRadius(settings, tool)),
    [settings.brush.radius, settings.terrain.radius, settings.smooth.radius, settings.erode.radius],
  );
  equal("only the shape and walls tools take corners", [takesCorners("place"), takesCorners("brush"), takesCorners("shape"), takesCorners("walls")], [false, false, true, true]);

  // The brush is centred on the block aimed at, VoxelSniper's ball brush.
  const ball = brushSpec({ shape: "sphere", radius: 3, mode: "all" }, { x: 10, y: 10, z: 10 }, false);
  equal("a brush is centred on the block aimed at", ball.box, { minX: 7, minY: 7, minZ: 7, maxX: 13, maxY: 13, maxZ: 13 });
  equal("...and a sphere of radius 3 is //sphere 3", shapeCells(ball).count, 179);
  const standing = brushSpec({ shape: "sphere", radius: 3, mode: "all" }, { x: 10, y: 0, z: 10 }, true);
  equal(
    "on the build grid it stands on the floor, so a stroke there never reaches below the origin",
    [standing.box.minY, standing.box.maxY],
    [0, 6],
  );
  const disc = brushSpec({ shape: "disc", radius: 3, mode: "all" }, { x: 0, y: 4, z: 0 }, true);
  equal("a disc is one layer, the one aimed at, standing or not", [disc.box.minY, disc.box.maxY, disc.kind, disc.axis], [4, 4, "cylinder", "y"]);
  equal("...and is //cyl 3 one block tall", shapeCells(disc).count, 37);
  const cube = brushSpec({ shape: "cube", radius: 1, mode: "all" }, { x: 0, y: 0, z: 0 }, false);
  equal("a cube brush is every cell of its box", [cube.kind, shapeCells(cube).count], ["box", 27]);
  equal("a brush of radius 0 is one block", shapeCells(brushSpec({ shape: "sphere", radius: 0, mode: "all" }, { x: 2, y: 2, z: 2 }, false)).count, 1);

  // Half a radius between touches, never less than a block.
  equal("the stroke's spacing is half the radius, at least one block", [strokeSpacing(0), strokeSpacing(1), strokeSpacing(4), strokeSpacing(9)], [1, 1, 2, 4.5]);
  check("the first touch of a stroke always lands", shouldTouch(null, { x: 0, y: 0, z: 0 }, 8));
  check("...a radius-0 brush touches every next cell", shouldTouch({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0));
  check("...but not the cell it is already on", !shouldTouch({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0));
  check("...a radius-4 brush waits for two blocks", !shouldTouch({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, 4) && shouldTouch({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 4));

  /*
   * A stroke never lands on what it has already reached, or a held button
   * grows spheres towards the camera off the near side of the last one --
   * which it did, in the app, until this rule.
   */
  {
    const touch = brushSpec({ shape: "sphere", radius: 2, mode: "all" }, { x: 10, y: 10, z: 10 }, false);
    const trail = [reachOf(touch)];
    check("the top of a sphere just painted is reached: the next touch does not land on it", reached(trail, { x: 10, y: 12, z: 10 }));
    check("...nor does the floor of a crater just rubbed out, a block past it", reached(trail, { x: 10, y: 7, z: 10 }));
    check("...but open ground two blocks past the edge is free", !reached(trail, { x: 10, y: 10, z: 14 }));
    check("...and a stroke with no touches has reached nothing", !reached([], { x: 10, y: 10, z: 10 }));
  }

  // Two corners.
  equal(
    "corners on one level build as tall as the tool is set",
    cornerBox({ x: 5, y: 3, z: 9 }, { x: 0, y: 3, z: 0 }, 4),
    { minX: 0, minY: 3, minZ: 0, maxX: 5, maxY: 6, maxZ: 9 },
  );
  equal(
    "a corner clicked higher up builds taller",
    cornerBox({ x: 0, y: 3, z: 0 }, { x: 5, y: 12, z: 5 }, 4),
    { minX: 0, minY: 3, minZ: 0, maxX: 5, maxY: 12, maxZ: 5 },
  );
  equal(
    "...but ground a block uneven still builds the set height, not two blocks",
    cornerBox({ x: 0, y: 4, z: 0 }, { x: 5, y: 3, z: 5 }, 4),
    { minX: 0, minY: 3, minZ: 0, maxX: 5, maxY: 6, maxZ: 5 },
  );
  const walls = cornerSpec("walls", settings, { x: 9, y: 0, z: 0 }, { x: 0, y: 0, z: 9 });
  equal("the walls tool builds //walls, 10x4x10 being 144 cells", [walls.kind, shapeCells(walls).count], ["walls", 144]);
  const thick = cornerSpec("walls", { ...settings, walls: { ...settings.walls, thickness: 2 } }, { x: 0, y: 0, z: 0 }, { x: 9, y: 0, z: 9 });
  equal("...two thick, 256", shapeCells(thick).count, 256);
  const pyramid = cornerSpec(
    "shape",
    { ...settings, shape: { ...settings.shape, kind: "pyramid", height: 3 } },
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 4 },
  );
  equal("the shape tool draws its kind between the corners: //pyramid 3", shapeCells(pyramid).count, 35);
  equal("each tool writes in its own mode", [toolMode("brush", { ...settings, brush: { ...settings.brush, mode: "empty" } }), toolMode("walls", { ...settings, walls: { ...settings.walls, mode: "filled" } })], ["empty", "filled"]);

  const first = cornerClick(null, { x: 1, y: 2, z: 3 });
  equal("the first right-click fixes a corner and builds nothing", [first.corner, first.build], [{ x: 1, y: 2, z: 3 }, null]);
  const second = cornerClick(first.corner, { x: 4, y: 2, z: 6 });
  equal("...the second builds between the two and starts over", [second.corner, second.build], [null, [{ x: 1, y: 2, z: 3 }, { x: 4, y: 2, z: 6 }]]);

  // The keys, by physical key.
  const key = (code: string, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {}, flying = true) =>
    creativeKey({ code, ctrlKey: mods.ctrl === true, altKey: mods.alt === true, metaKey: mods.meta === true }, flying);
  equal("[ and ] by position, with AltGr held as an Italian keyboard needs", [key("BracketLeft", { ctrl: true, alt: true }), key("BracketRight", { ctrl: true, alt: true }), key("BracketLeft")], ["smaller", "bigger", "smaller"]);
  equal("B cycles, Ctrl held for a sprint included", [key("KeyB"), key("KeyB", { ctrl: true })], ["cycle", "cycle"]);
  equal("...but Ctrl+B is the sidebar's while the keyboard is not flying", key("KeyB", { ctrl: true }, false), null);
  equal("...and nothing else is a tool key", [key("KeyZ"), key("Tab"), key("KeyB", { meta: true })], [null, null, null]);
  equal("[ and ] size the brush, and how tall a shape or a wall stands", [resized(settings, "brush", 1).brush.radius, resized(settings, "shape", -1).shape.height, resized(settings, "walls", 2).walls.height], [3, 4, 6]);
  equal("...inside their ranges", [resized({ ...settings, brush: { ...settings.brush, radius: 0 } }, "brush", -1).brush.radius, resized({ ...settings, walls: { ...settings.walls, height: 1 } }, "walls", -1).walls.height], [0, 1]);
  equal("...and the block in your hand has no size", resized(settings, "place", 1), settings);
  equal("[ and ] size the terrain brush's radius", resized(settings, "terrain", 2).terrain.radius, settings.terrain.radius + 2);
  equal(
    "...and the smooth and erode brushes', each its own",
    [resized(settings, "smooth", -1).smooth.radius, resized(settings, "erode", 1).erode.radius],
    [settings.smooth.radius - 1, settings.erode.radius + 1],
  );

  /*
   * The erode brush is VoxelSniper's sphere, which is not WorldEdit's: radius
   * 1 is the cell and its six faces, where //sphere 1 is nineteen.
   */
  {
    const one = erodeGhost({ x: 0, y: 0, z: 0 }, 1).cells()!;
    const two = erodeGhost({ x: 5, y: 5, z: 5 }, 2).cells()!;
    equal("the erode brush's ghost is VoxelSniper's sphere: 7 cells at radius 1, 33 at 2", [one.count, two.count], [7, 33]);
    equal("...the same geometry wherever it stands", erodeGhost({ x: 9, y: 1, z: -4 }, 2).key, erodeGhost({ x: 0, y: 0, z: 0 }, 2).key);
    const reach = sphereReach({ x: 0, y: 10, z: 0 }, 2);
    check("...and a touch has reached its sphere and a block round it, not two", reach(0, 13, 0) && !reach(0, 14, 0));
    const flat = smoothSpec({ radius: 3, footprint: "disc", iterations: 4 }, { x: 4, y: 7, z: 4 });
    equal("the smooth brush's ghost is its columns, one layer on the cell aimed at", [flat.box.minY, flat.box.maxY, shapeCells(flat).count], [7, 7, 37]);
  }

  /*
   * The terrain: a stroke reaches the columns it laid, at every height --
   * the next aim is on the ground just laid, which may be far above or below
   * the cell the touch was aimed at.
   */
  {
    const reach = columnReach({ x: 10, y: 5, z: 10 }, 3, "disc");
    check("a terrain touch has reached its columns at any height", reach(10, 200, 10) && reach(12, -40, 11));
    check("...and a block past its footprint", reach(14, 5, 10));
    check("...but not two blocks past it", !reach(15, 5, 10));
    check("...and a square reaches its corners where a disc does not", columnReach({ x: 0, y: 0, z: 0 }, 3, "square")(4, 0, 4) && !reach(14, 5, 14));

    const terrain = { ...settings.terrain, radius: 3, footprint: "disc" as const };
    const ghost = terrainGhost(terrain, { x: 40, y: 9, z: -7 }, [0, 0, 0]);
    const cells = ghost.cells()!;
    equal("the terrain's ghost is one cell a column, //cyl 3's 37 columns", cells.count, 37);
    const top = heightField(terrain.field);
    let misplaced = 0;
    const w = 7;
    const h = ghost.box.maxY - ghost.box.minY + 1;
    for (let dx = -3; dx <= 3; dx += 1) {
      for (let dz = -3; dz <= 3; dz += 1) {
        if (!inFootprint("disc", dx, dz, 3)) continue;
        const y = top(40 + dx, -7 + dz) - ghost.box.minY;
        if (cells.mask[(dx + 3) * h * w + y * w + (dz + 3)] !== 1) misplaced += 1;
      }
    }
    equal("...each at the height the edit will lay it", misplaced, 0);
    const moved = terrainGhost(terrain, { x: 45, y: 9, z: -7 }, [5, 0, 0]);
    equal(
      "...read in the content, so a growth below the origin moves the landscape with it",
      [moved.box.minY, moved.box.maxY, [...moved.cells()!.mask]],
      [ghost.box.minY, ghost.box.maxY, [...cells.mask]],
    );
    check("...and a ghost that moved is a ghost rebuilt", ghost.key !== terrainGhost(terrain, { x: 41, y: 9, z: -7 }, [0, 0, 0]).key);
  }

  /*
   * The ghost is the outside of the cells, wound so its front faces outwards:
   * every triangle's normal has to point from a cell in the shape to a cell
   * that is not. A face wound backwards, or an inner face left in, fails here.
   */
  const ghostOf = (cells: ReturnType<typeof shapeCells>) => {
    const faces = ghostFaces(cells);
    const win = cells.window!;
    const h = win.maxY - win.minY + 1;
    const l = win.maxZ - win.minZ + 1;
    const w = win.maxX - win.minX + 1;
    const inside = (x: number, y: number, z: number) =>
      x >= 0 && y >= 0 && z >= 0 && x < w && y < h && z < l && cells.mask[x * h * l + y * l + z] === 1;
    let wrong = 0;
    for (let i = 0; i < faces.length; i += 9) {
      const a = [faces[i], faces[i + 1], faces[i + 2]];
      const b = [faces[i + 3], faces[i + 4], faces[i + 5]];
      const c = [faces[i + 6], faces[i + 7], faces[i + 8]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const centre = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3);
      const behind = centre.map((p, k) => Math.floor(p - n[k] * 0.25));
      const front = centre.map((p, k) => Math.floor(p + n[k] * 0.25));
      if (!inside(behind[0], behind[1], behind[2]) || inside(front[0], front[1], front[2])) wrong += 1;
    }
    return { triangles: faces.length / 9, wrong };
  };
  const one = ghostOf(shapeCells({ kind: "box", box: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 } }));
  equal("a ghost of one cell is its six faces", one, { triangles: 12, wrong: 0 });
  const pair = ghostOf(shapeCells({ kind: "box", box: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0, maxZ: 0 } }));
  equal("...two cells side by side are ten, the shared face is not drawn", pair, { triangles: 20, wrong: 0 });
  const hollow = ghostOf(shapeCells({ kind: "sphere", box: { minX: 0, minY: 0, minZ: 0, maxX: 8, maxY: 8, maxZ: 8 }, hollow: true }));
  check("...and every face of a hollow sphere faces out of it, inside and out", hollow.triangles > 0 && hollow.wrong === 0, JSON.stringify(hollow));
  const surface = ghostOf(terrainGhost({ ...settings.terrain, radius: 6 }, { x: 3, y: 0, z: 3 }, [0, 0, 0]).cells()!);
  check("...and so does every face of a terrain's stepped surface", surface.triangles > 0 && surface.wrong === 0, JSON.stringify(surface));
  const sphere = ghostOf(erodeGhost({ x: 0, y: 0, z: 0 }, 4).cells()!);
  check("...and of the erode brush's sphere", sphere.triangles > 0 && sphere.wrong === 0, JSON.stringify(sphere));

  // Wired where it has to be, which only the source can say.
  const viewer = readFileSync(path.join(RENDERER, "lib", "Viewer.svelte"), "utf8");
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8");
  const casts = viewer.match(/raycaster\.intersectObjects?\([^)]*\)/g) ?? [];
  check("no raycast reaches the creative ghost", casts.every((cast) => !cast.includes("creative")), casts.join(" | "));
  check("a stroke begins at the press", /onstroke\(\{ phase: "begin"/.test(viewer));
  check(
    "...for every tool that strokes, the terrain as well as the brush",
    /takesStroke\(creative\.settings\.tool\) &&[\s\S]{0,200}stroke === null/.test(viewer),
  );
  check(
    "...and ends when the pointer is let go of, whatever let go of it",
    /fly\.addEventListener\("unlock", \(\) => \{[^}]*endStroke\(\)/s.test(viewer),
  );
  check("in flight the camera follows a growth below the origin", viewer.includes('moved && cameraMode === "fly" && camera'));
  check(
    "the bar is flight's alone",
    /\{#if docState && cameraMode === "fly"\}\s*<CreativeToolBar/.test(app),
  );
  check(
    "...and so is the tool the viewer is told about",
    /creative=\{docState && cameraMode === "fly"\s*\?\s*\{ settings: creative, corner: cornerAt, frame: docState\.frame \}\s*:\s*null\}/.test(app),
  );
  check(
    "leaving flight forgets a first corner, not only Escape",
    /const onPointerLock = \(\) => \{[^}]*if \(!pointerLocked\) cornerAt = null;/s.test(app),
  );
  const escapeCorner = app.indexOf('event.key === "Escape" && cornerAt !== null');
  check("...and Escape does too, before the glow and the selection", escapeCorner >= 0 && escapeCorner < app.indexOf('event.key === "Escape" && glow !== null'));
}

// --- the design system: one palette per theme, scales, base components -----
console.log("\n--- design system ---");
{
  const css = readFileSync(path.join(RENDERER, "app.css"), "utf8").replace(/\r\n/g, "\n");
  /** The custom properties declared directly in the block that opens at `opener`. */
  const tokens = (opener: string): Map<string, string> => {
    const start = css.indexOf(opener);
    const body = css.slice(start + opener.length, css.indexOf("\n}", start));
    return new Map([...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]));
  };
  const dark = tokens(":root {");
  const light = tokens(':root[data-theme="light"] {');
  const system = tokens(':root:not([data-theme="dark"]) {');

  check("the dark palette was found", dark.size > 40, String(dark.size));
  equal("the system light palette is the explicit one, value for value", [...system], [...light]);
  const colour = (value: string): boolean => /^(#|rgb)/.test(value);
  const unthemed = [...dark].filter(([name, value]) => colour(value) && !light.has(name)).map(([name]) => name);
  equal("every colour the dark palette names, the light one names too", unthemed, []);

  const scales = [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--space-${n}`),
    ...["xs", "sm", "md", "lg", "xl", "2xl"].map((n) => `--text-${n}`),
    "--radius",
    "--control-h",
    "--bevel",
    "--z-window",
    "--z-popover",
    "--z-modal",
    "--z-toast",
    "--z-top",
    "--shadow-raised",
    "--shadow-float",
    "--shadow-modal",
    "--font-body",
    "--font-pixel",
  ];
  equal("the scales are all declared", scales.filter((name) => !dark.has(name)), []);
  check("a control is at least WCAG 2.2's 24px target", parseFloat(dark.get("--control-h") ?? "0") >= 24);

  /*
   * Contrast, computed from the palette rather than claimed in a comment: a
   * token edited tomorrow fails here by name. 4.5:1 for text, 3:1 for the
   * edges that tell a control apart and for the focus ring (WCAG 1.4.3,
   * 1.4.11).
   */
  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string): number => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const pairs: [string, string, number][] = [
    ["--text", "--bg-panel", 4.5],
    ["--text", "--bg", 4.5],
    ["--text", "--bg-input", 4.5],
    ["--text", "--bg-raised", 4.5],
    ["--text-dim", "--bg-panel", 4.5],
    ["--text-dim", "--bg", 4.5],
    ["--text-dim", "--bg-input", 4.5],
    ["--accent-contrast", "--accent", 4.5],
    ["--text", "--accent-dim", 4.5],
    ["--danger", "--bg-panel", 4.5],
    ["--warn", "--bg-panel", 4.5],
    ["--ok", "--bg-panel", 4.5],
    // Emerald as words: a name in the chat, a link, the selection chip. The
    // accent itself is 4.3:1 on the light theme's stone, which is why this
    // token exists.
    ["--accent-text", "--bg-panel", 4.5],
    ["--accent-text", "--bg-input", 4.5],
    // A trace's failure and a receipt's counts sit in a well, not on the slab.
    ["--danger", "--bg-input", 4.5],
    ["--ok", "--bg-input", 4.5],
    ["--field-edge", "--bg-panel", 3],
    ["--accent", "--bg-panel", 3],
    ["--accent", "--bg", 3],
  ];
  for (const [name, palette] of [["dark", dark], ["light", light]] as const) {
    const weak = pairs
      .map(([fg, bg, need]) => [fg, bg, need, ratio(palette.get(fg)!, palette.get(bg)!)] as const)
      .filter(([, , need, got]) => !(got >= need))
      .map(([fg, bg, need, got]) => `${fg} on ${bg} ${got.toFixed(2)} < ${need}`);
    equal(`every pair reads in the ${name} theme`, weak, []);
    check(`...and the white count on a slot, in the ${name} theme`, ratio(palette.get("--slot-text")!, palette.get("--slot")!) >= 4.5);
  }

  const rule = (selector: string): string => {
    const start = css.indexOf(`\n${selector} {`);
    return start < 0 ? "" : css.slice(start, css.indexOf("\n}", start));
  };
  const raised = "border-color: var(--bevel-hi) var(--bevel-lo) var(--bevel-lo) var(--bevel-hi)";
  const pressed = "border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo)";
  check("a button is a raised slab", rule("button").includes(raised) && rule("button").includes("min-height: var(--control-h)"));
  check("...that sinks while it is held down", rule("button:active:not(:disabled)").includes(pressed));
  check("every dialog is drawn by app.css's .modal", rule(".modal").includes(raised));
  const drawnLocally = readdirSync(path.join(RENDERER, "lib"))
    .filter((name) => name.endsWith(".svelte"))
    .filter((name) => {
      const source = readFileSync(path.join(RENDERER, "lib", name), "utf8").replace(/\r\n/g, "\n");
      const start = source.indexOf("\n  .modal {\n");
      if (start < 0) return false;
      const block = source.slice(start, source.indexOf("\n  }\n", start));
      return /\n    (border|border-radius|background|box-shadow): /.test(block);
    });
  equal("...and no component draws its own", drawnLocally, []);

  // app.css's `button` rules are one element above a component's single
  // class: `button:hover:not(:disabled)` is (0,2,1) and `.compass`, once
  // Svelte has scoped it, is (0,2,0). So a button that draws itself -- a
  // transparent hit area, a red dot, a slot -- is painted `--bg-hover` under
  // the pointer unless it says otherwise, and a `height` below the control
  // height is overruled by the `min-height` beside it. Both arrived with the
  // design system and were reported as a grey disc over the compass.
  const scopedSpecificity = (selector: string): [number, number, number] => {
    const score: [number, number, number] = [0, 0, 0];
    for (const part of selector.split(/\s*[\s>+~]\s*/).filter(Boolean)) {
      if (part.startsWith(":global")) continue;
      const flat = part.replace(/:not\(([^)]*)\)/g, " $1");
      score[0] += (flat.match(/#[\w-]+/g) ?? []).length;
      score[1] += (flat.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length + 1;
      score[2] += (flat.match(/(^|[\s(])[a-z][\w-]*/g) ?? []).length;
    }
    return score;
  };
  const beatsHover = ([a, b, c]: [number, number, number]): boolean => a > 0 || b > 2 || (b === 2 && c > 1);
  const repaintedOnHover: string[] = [];
  const stretchedToControl: string[] = [];
  const svelteFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? svelteFiles(full) : name.endsWith(".svelte") ? [full] : [];
    });
  for (const file of svelteFiles(RENDERER)) {
    const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const at = source.indexOf("<style>");
    if (at < 0) continue;
    const name = path.basename(file, ".svelte");
    // What each button in the markup is called, and whether it is also an
    // `icon`, whose global rules already own its hover and its height.
    const buttons = [...source.slice(0, at).matchAll(/<button\b[\s\S]*?>/g)].map((tag) => {
      const names = new Set<string>();
      for (const flag of tag[0].matchAll(/class:([\w-]+)/g)) names.add(flag[1]);
      const list = tag[0].match(/class=["{`]([^"}`]*)/)?.[1] ?? "";
      for (const word of list.split(/\s+/)) if (/^[\w-]+$/.test(word)) names.add(word);
      return names;
    });
    const wearing = (classes: string[]): Set<string>[] =>
      buttons.filter((names) => classes.length > 0 && classes.every((c) => names.has(c)));
    const rules = [...source.slice(at).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)].map(
      (match) => ({ selector: match[1].trim(), body: match[2] }),
    );
    const elsewhere = (classes: string[], test: (selector: string, body: string) => boolean): boolean =>
      rules.some((other) =>
        other.selector.split(",").some((one) => classes.every((c) => one.includes(`.${c}`)) && test(one, other.body)),
      );
    for (const { selector, body } of rules) {
      if (/:hover|:active|:disabled/.test(selector)) continue;
      for (const one of selector.split(",").map((s) => s.trim())) {
        const last = one.split(/\s+|>/).pop() ?? "";
        const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
        const worn = wearing(classes);
        if (worn.length === 0 || beatsHover(scopedSpecificity(one))) continue;
        if (worn.every((names) => names.has("icon"))) continue;
        if (/(^|[;\s])background(-color)?:/.test(body) && !worn.every((names) => names.has("primary"))) {
          if (!elsewhere(classes, (s, b) => s.includes(":hover") && /background/.test(b))) {
            repaintedOnHover.push(`${name} ${one}`);
          }
        }
        const height = body.match(/(?:^|[;\s])height:\s*([\d.]+)px/);
        if (height && Number(height[1]) < 28 && !elsewhere(classes, (_s, b) => /min-height/.test(b))) {
          stretchedToControl.push(`${name} ${one}`);
        }
      }
    }
  }
  equal("a button that draws its own background keeps it under the pointer", repaintedOnHover, []);
  equal("...and one drawn smaller than a control is not stretched back to it", stretchedToControl, []);

  const main = readFileSync(path.join(RENDERER, "main.ts"), "utf8");
  check(
    "both faces ship with the app, imported before the sheet that names them",
    main.indexOf("@fontsource/atkinson-hyperlegible") >= 0 &&
      main.indexOf("@fontsource/pixelify-sans") >= 0 &&
      main.indexOf("@fontsource/pixelify-sans") < main.indexOf('"./app.css"'),
  );
  // An inlined font is a data: URL, and the CSP refuses data: for fonts.
  check(
    "...and no font is inlined as a data: URL",
    /assetsInlineLimit: \(file\) => \(\/\\\.\(woff2\?/.test(readFileSync(path.join(here, "..", "electron.vite.config.ts"), "utf8")),
  );
}

// --- what the UX audit found, each pinned where a tidy-up would undo it -----
console.log("\n--- audit fixes ---");
{
  const css = readFileSync(path.join(RENDERER, "app.css"), "utf8");
  const lib = (name: string): string => readFileSync(path.join(RENDERER, "lib", name), "utf8");
  check(
    "the keyboard's focus ring is the app's, in the accent, for every control",
    /^:focus-visible \{\s*outline: 2px solid var\(--accent\);/m.test(css),
  );
  check(
    "a slot is dark in all three palettes, so the white count reads on it",
    (css.match(/--slot: #/g) ?? []).length === 3 && /background: var\(--slot\);/.test(lib("MaterialsInventory.svelte")),
  );
  check(
    "empty space as air over air has words of its own, not \"holds .\"",
    /sources\.length === 0\s*\?\s*t\("void\.replaceAir"\)/.test(lib("VoidBlockModal.svelte")),
  );
  const scrims = ["ConvertModal", "DimensionsModal", "VoidBlockModal", "VersionsModal", "NbtModal", "AnchorModal"].filter(
    (name) => !lib(`${name}.svelte`).includes("<Modal"),
  );
  equal("every modal's scrim is on the modal tier, over the bar and the chat", scrims, []);
  check(
    "the format select is as wide as its words, not as the row",
    /\.format \{[^}]*width: auto;/.test(lib("ChatComposer.svelte")),
  );
  const viewer = lib("Viewer.svelte");
  check(
    "the floor fades into the horizon last, where the dome's colour lands",
    /#include <dithering_fragment>[\s\S]{0,200}mix\(gl_FragColor\.rgb, uHorizon, fade\)/.test(viewer),
  );
  // Interpolated across one quad twenty thousand blocks wide, a distance is
  // the same ten thousand everywhere, and the whole floor came out as sky.
  check(
    "...measuring the distance per fragment, not interpolating it",
    viewer.includes("distance(vGroundPosition, cameraPosition)") && !/varying float vGround/.test(viewer),
  );
  check(
    "the bounds caption is a line of the diagnostics, not a strip under the hotbar",
    !readFileSync(path.join(RENDERER, "App.svelte"), "utf8").includes("viewport.bounds") &&
      /\{#if meshBounds\}[\s\S]{0,200}viewport\.bounds/.test(viewer),
  );
}

// --- the shell: docked panels, a bar in three thirds, a status bar ----------
console.log("\n--- shell ---");
{
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8").replace(/\r\n/g, "\n");
  const lib = (name: string): string =>
    readFileSync(path.join(RENDERER, "lib", name), "utf8").replace(/\r\n/g, "\n");

  // The tools dock to the edges; the settings-like windows float. The user's
  // choice in the UX audit, and the one floating tool window left is settings.
  equal("one floating tool window is left", (app.match(/<ToolWindow\n/g) ?? []).length, 1);
  check("...and it is the creative tool's options", /<ToolWindow\n\s*title=\{t\("creative\.optionsTitle"/.test(app));
  check(
    "the selection, the inspector and the terrain are tabs of the docked panel",
    /<DockPanel[\s\S]*\{#snippet selectionTab\(\)\}[\s\S]*<SelectionTools[\s\S]*\{#snippet inspectorTab\(\)\}[\s\S]*<InspectorPanel[\s\S]*\{#snippet terrainTab\(\)\}[\s\S]*<TerrainPanel/.test(
      app,
    ),
  );
  // A snippet binds its name in the parent's markup, so one called
  // `selection` would shadow the selection every prop inside it is passed.
  check("no tab's snippet is named after something the app holds", !/\{#snippet (selection|inspector|terrain)\(\)/.test(app));
  check(
    "the terrain is a tab of its own, not a section at the foot of the selection's tools",
    !lib("SelectionTools.svelte").includes("TerrainOptions") && lib("TerrainPanel.svelte").includes("<TerrainOptions"),
  );

  // The gesture brings the tab up, as it used to bring the windows back.
  check("a click asks for the inspector's tab", app.includes('if (inspection !== null) dockTab = "inspector";'));
  check(
    "a region brings up the tools' tab, only on the way into one",
    /if \(region && !hadRegion\) dockTab = "selection";\s*hadRegion = region;/.test(app),
  );

  // The bar: the document, how you look at it, what you can do about it.
  check(
    "the bar is three thirds, the middle one in the middle of the window",
    /\.navbar \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\);/.test(app),
  );
  check(
    "the document's own settings are one menu beside its name, not five buttons",
    !app.includes('class="nbt-open"') && lib("DocumentBar.svelte").includes("<DocumentMenu"),
  );
  const opens: [string, RegExp][] = [
    ["version", /case "version":\s*mcVersionOpen = true;/],
    ["dimensions", /case "dimensions":\s*dimensionsOpen = true;/],
    ["void", /case "void":[\s\S]{0,200}voidOpen = true;/],
    ["anchor", /case "anchor":\s*anchorOpen = true;/],
    ["nbt", /case "nbt":\s*void openNbtPanel\(\);/],
  ];
  equal(
    "...and each of its items opens its own dialog",
    opens.filter(([, pattern]) => !pattern.test(app)).map(([item]) => item),
    [],
  );
  const menu = lib("DocumentMenu.svelte");
  check(
    "the menu is a menu to a screen reader, and Escape stays its own",
    menu.includes('aria-haspopup="menu"') &&
      menu.includes('role="menuitem"') &&
      /event\.key === "Escape"[\s\S]{0,200}event\.stopPropagation\(\)/.test(menu),
  );
  check(
    "Convert is reached from File and from the start screen",
    app.includes("api().onMenuConvert(() => (convertOpen = true))") &&
      app.includes("onconvert={() => (convertOpen = true)}") &&
      /<button class="action" onclick=\{onconvert\}>/.test(lib("StartScreen.svelte")),
  );
  // Every scrim is on the modal tier and the start screen comes later in the
  // document, so it painted over the dialogs it had just opened.
  check(
    "the start screen steps aside for the dialogs it opens",
    /const startVisible = \$derived\(\s*docState === null && recovery === null && !startDismissed && schematicDialog === null && !convertOpen,/.test(
      app,
    ),
  );

  // The status bar is a row of the window, not an overlay of the viewport.
  check(
    "the status bar is the grid's third row",
    /main :global\(\.status-bar\) \{\s*grid-column: 1 \/ -1;\s*grid-row: 3;/.test(app) &&
      !/position: (absolute|fixed)/.test(lib("StatusBar.svelte")),
  );

  // Two docked panels, two splitters, each the other's mirror.
  check(
    "a panel on the left is as wide as the pointer is far from the left edge",
    lib("SidebarSplitter.svelte").includes('side === "left" ? event.clientX : window.innerWidth - event.clientX'),
  );
  check(
    "...and each splitter leaves room for the other panel",
    app.includes("reserve={sidebarCollapsed ? 0 : sidebarWidth}") && app.includes("reserve={docked ? dockWidth : 0}"),
  );

  // A menu at the leading end of a bar lines up with its button.
  const window1440 = { viewportWidth: 1440, viewportHeight: 900, popoverWidth: 300, popoverHeight: 200, margin: 8, gap: 4 };
  equal(
    "a popover aligned to the start hangs from the control's left edge",
    placePopover({ left: 60, top: 8, width: 90, height: 28 }, window1440, "below", "start"),
    { x: 60, y: 40 },
  );
  equal(
    "...where hanging leftwards would only have pinned it to the margin",
    placePopover({ left: 60, top: 8, width: 90, height: 28 }, window1440, "below").x,
    8,
  );

  // One frame for the With field's map and the Terrain tab's picture.
  const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) =>
    ({ minX, minY, minZ, maxX, maxY, maxZ });
  equal("with nothing selected, the frame is the schematic", mapFrameOf(null, [], [10, 4, 6]), box(0, 0, 0, 9, 3, 5));
  equal(
    "...and with areas selected, the box round all of them",
    mapFrameOf(box(2, 0, 2, 4, 1, 4), [box(2, 0, 2, 4, 1, 4), box(8, 3, 0, 9, 5, 1)], [10, 6, 6]),
    box(2, 0, 0, 9, 5, 4),
  );
  equal("...and nothing at all without a schematic", mapFrameOf(null, [], null), null);
}

// --- the chat: the right-hand docked panel, in the inventory's material -----
console.log("\n--- chat ---");
{
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8").replace(/\r\n/g, "\n");
  const css = readFileSync(path.join(RENDERER, "app.css"), "utf8").replace(/\r\n/g, "\n");
  const lib = (name: string): string =>
    readFileSync(path.join(RENDERER, "lib", name), "utf8").replace(/\r\n/g, "\n");
  const styleOf = (source: string): string => source.slice(source.indexOf("<style>"));
  const chat = lib("ChatPanel.svelte");
  const composer = lib("ChatComposer.svelte");
  const conversations = lib("ConversationPicker.svelte");
  const models = lib("ModelPicker.svelte");

  // The two edges of the window are one piece of furniture.
  check(
    "both docked panels stand on app.css's strip",
    css.includes("\n.panel-head {") &&
      chat.includes('<header class="panel-head">') &&
      lib("DockPanel.svelte").includes('<div class="panel-head">'),
  );
  check(
    "...the tools' three tabs and the conversation are one kind of tab",
    css.includes("\n.panel-tab {") &&
      lib("DockPanel.svelte").includes('class="panel-tab"') &&
      conversations.includes('class="panel-tab current trigger"'),
  );
  check(
    "the chat is put away from its own strip, as the tools' panel is",
    chat.includes("onclick={oncollapse}") && app.includes("oncollapse={toggleSidebar}"),
  );

  // Every surface of the chat picks from the scales: no rounded corner, no
  // colour of its own, no font size outside the type scale.
  const files = ["ChatPanel", "ChatComposer", "ConversationPicker", "TraceView", "ModelPicker", "Markdown"];
  const offScale = files.flatMap((name) => {
    const style = styleOf(lib(`${name}.svelte`));
    const faults: string[] = [];
    if (/border-radius:(?!\s*var\(--radius\))/.test(style)) faults.push(`${name}: a radius`);
    if (/#[0-9a-fA-F]{3,8}\b/.test(style)) faults.push(`${name}: a colour`);
    if (/font-size:\s*\d/.test(style)) faults.push(`${name}: a font size`);
    return faults;
  });
  equal("the chat draws with the design system's scales and nothing else", offScale, []);
  check(
    "emerald words take the text green, which reads on the light stone",
    (css.match(/--accent-text: #/g) ?? []).length === 3 &&
      /\.chip \{[^}]*color: var\(--accent-text\);/.test(composer) &&
      /\.markdown :global\(a\) \{\s*color: var\(--accent-text\);/.test(lib("Markdown.svelte")),
  );

  // The box is what you type into, so the ring goes round the box.
  check(
    "the composer's focus ring is drawn round the whole field",
    /\.composer:has\(textarea:focus-visible\) \{\s*outline: 2px solid var\(--accent\);/.test(composer),
  );
  const stop = composer.match(/<button class="send danger"[^>]*>/)?.[0] ?? "";
  check("Stop is the redstone slab, and never disabled", stop.includes("onclick={onstop}") && !stop.includes("disabled"));

  // A turn: the name, the machinery under it, what changed.
  check(
    "going back sits on the name's line and takes no room of its own",
    /<div class="who">[\s\S]*?class="icon restore"[\s\S]*?<\/div>/.test(chat),
  );
  check(
    "a receipt shows the blocks in slots, asking for their pictures",
    chat.includes('<span class="slot">') &&
      chat.includes("requestBlockIcons(receiptBlocks)") &&
      chat.includes(".filter((block) => !isAir(block))"),
  );
  check("the trace is a well in the slab", lib("TraceView.svelte").includes('<div class="trace sunken" class:live>'));

  // The two popovers: on their tier, said to a screen reader, and Escape
  // stays theirs -- the window's own drops the selection.
  for (const [name, source] of [
    ["the conversation list", conversations],
    ["the model picker", models],
  ] as const) {
    check(
      `${name} is on the popover tier`,
      /\.popover \{[^}]*z-index: var\(--z-popover\);/.test(source),
    );
    check(
      `...says it opens and whether it is open`,
      source.includes('aria-haspopup="dialog"') && source.includes("aria-expanded={open}"),
    );
    check(
      `...and keeps its Escape from the window`,
      /event\.key === "Escape"[\s\S]{0,160}event\.stopPropagation\(\)/.test(source) ||
        /event\.key !== "Escape"[\s\S]{0,160}event\.stopPropagation\(\)/.test(source),
    );
  }
  check(
    "...from the button as well, where a click leaves the focus",
    /event\.key === "Escape" && open/.test(conversations) &&
      models
        .slice(models.indexOf('class="trigger"'), models.indexOf("</button>", models.indexOf('class="trigger"')))
        .includes("onkeydown={onPanelKey}"),
  );
  // Measured: the effect that focuses the list ran before the popover's
  // `visibility: hidden` came off, and the browser refused it in silence.
  check(
    "the list takes the focus only once it is visible",
    /focused = true;[\s\S]{0,80}void tick\(\)\.then\(/.test(conversations),
  );
}

// --- the tool panels: the left dock's three tabs, in the inventory's material -
console.log("\n--- tool panels ---");
{
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8").replace(/\r\n/g, "\n");
  const css = readFileSync(path.join(RENDERER, "app.css"), "utf8").replace(/\r\n/g, "\n");
  const lib = (name: string): string =>
    readFileSync(path.join(RENDERER, "lib", name), "utf8").replace(/\r\n/g, "\n");
  const styleOf = (source: string): string =>
    source.slice(source.indexOf("<style>")).replace(/\/\*[\s\S]*?\*\//g, "");

  // Every surface of the three tabs, and of the window the creative options
  // float in, picks from the scales: no corner, colour, size or stacking
  // level of its own, and emerald as words is the text green.
  const panels = [
    "DockPanel",
    "SelectionTools",
    "MaterialsInventory",
    "BlockMixField",
    "BlockPicker",
    "DistributionPreview",
    "BlockTooltip",
    "BannerPatternHint",
    "InspectorPanel",
    "BannerPatternEditor",
    "TerrainPanel",
    "TerrainOptions",
    "TerrainPreview",
    "CreativeOptions",
    "ToolWindow",
  ];
  const offScale = panels.flatMap((name) => {
    const style = styleOf(lib(`${name}.svelte`));
    const faults: string[] = [];
    if (/border-radius:(?!\s*var\(--radius(-round)?\))/.test(style)) faults.push(`${name}: a radius`);
    if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(style)) faults.push(`${name}: a colour`);
    if (/font-size:\s*\d/.test(style)) faults.push(`${name}: a font size`);
    if (/z-index:\s*\d/.test(style)) faults.push(`${name}: a stacking level`);
    if (/(^|[;\s{])color: var\(--accent\)/.test(style)) faults.push(`${name}: the accent as text`);
    return faults;
  });
  equal("the tool panels draw with the design system's scales and nothing else", offScale, []);

  // The count on a slot, as the game prints a stack.
  const inventory = lib("MaterialsInventory.svelte");
  check(
    "a slot's count is in the pixel face, in the slot's own white with its hard shadow",
    inventory.includes('<span class="count pixel"') &&
      /\.count \{[^}]*color: var\(--slot-text\);[^}]*text-shadow: [^;]*var\(--slot-text-shadow\);/.test(inventory),
  );
  check(
    "...and that white is a token in all three palettes",
    (css.match(/--slot-text: #/g) ?? []).length === 3 && (css.match(/--slot-text-shadow: #/g) ?? []).length === 3,
  );

  // Four choices of a few, one control.
  check("a choice of a few is app.css's one segmented control", css.includes("\n.segmented {"));
  for (const [name, source] of [
    ["the camera switch", app],
    ["a creative tool's options", lib("CreativeOptions.svelte")],
    ["the terrain's options", lib("TerrainOptions.svelte")],
    ["a map's plane", lib("DistributionPreview.svelte")],
  ] as const) {
    check(
      `...worn by ${name}, with no look of its own`,
      /class="[^"]*\bsegmented\b/.test(source) && !/\n\s*\.segmented[\s{]/.test(styleOf(source)),
    );
  }

  // With nothing selected the list is the whole schematic's: how you find
  // the one stray block, in a panel that is always there.
  const tools = lib("SelectionTools.svelte");
  check(
    "with nothing selected the list is the schematic's",
    /regions: scope === "selection" \? areasForIpc\(\) : null/.test(app) &&
      !/dockTab !== "selection" \|\| selection === null/.test(app),
  );
  check(
    "...drawn with or without a selection, ahead of the fields that need one",
    tools.indexOf("<MaterialsInventory") > 0 && tools.indexOf("<MaterialsInventory") < tools.indexOf("{#if !none}"),
  );
  check(
    "...and an answer is shown only for the question it answered",
    /selectionMaterials\.scope !== materialsScope/.test(app),
  );
  const click = (button: number, ctrl = false, shift = false) => ({ button, ctrl, shift });
  equal(
    "with no fields beside the list a click only lights a block, Shift included",
    [materialAction(click(0, false, true), false, false), materialAction(click(0, true, true), false, false)],
    ["glow", "addGlow"],
  );
  equal(
    "...air does nothing, having no field to go to",
    [materialAction(click(0), true, false), materialAction(click(0, true), true, false)],
    ["none", "none"],
  );
  equal("...and the right button still reads the slot", materialAction(click(2), false, false), "info");
  check(
    "...and the hint under it says so",
    inventory.includes('fields ? t("materials.hint") : t("materials.hintDocument")'),
  );
  check(
    "a glow lit from the schematic's list lights the whole schematic",
    /wanted\.scope === "document" \? null/.test(app) && /const scope = materialsScope;/.test(app),
  );
  check(
    "...and goes when a selection takes the list's place",
    /if \(selection !== null && glow !== null && glow\.scope === "document"\) glow = null;/.test(app),
  );

  // A block is shown as a block wherever the panels name one.
  const inspector = lib("InspectorPanel.svelte");
  check(
    "the inspector shows the block in a slot, with a name to read and the id to type",
    inspector.includes('<span class="slot">') &&
      inspector.includes("blockLabel(inspection.block)") &&
      inspector.includes("requestBlockIcons([block])"),
  );
  check(
    "...and so does a block's hover",
    lib("BlockTooltip.svelte").includes('<span class="slot">') && lib("BlockTooltip.svelte").includes("blockLabel(block)"),
  );
  check(
    "a field's blocks sit in slots, and the ring goes round the whole field",
    /\.tile \{[^}]*background: var\(--slot\);/.test(lib("BlockMixField.svelte")) &&
      /\.chips:has\(:global\(input:focus-visible\)\) \{\s*outline: 2px solid var\(--accent\);/.test(lib("BlockMixField.svelte")),
  );
  check(
    "the floating options window is on the window tier, over the hotbar and the bars",
    /\.tool-window \{[^}]*z-index: var\(--z-window\);/.test(lib("ToolWindow.svelte")),
  );
}

// --- dialogs and settings ----------------------------------------------------
console.log("\n--- dialogs and settings ---");
{
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8").replace(/\r\n/g, "\n");
  const css = readFileSync(path.join(RENDERER, "app.css"), "utf8").replace(/\r\n/g, "\n");
  const lib = (name: string): string =>
    readFileSync(path.join(RENDERER, "lib", name), "utf8").replace(/\r\n/g, "\n");
  const styleOf = (source: string): string =>
    source.slice(source.indexOf("<style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  const scriptOf = (source: string): string => source.slice(0, source.indexOf("</script>"));

  // One component does what a dialog does. Ten skeletons had drifted: three
  // ways of handling Escape, the pointer-lock release in six of them, a
  // backdrop that closed on any click in some.
  const modal = lib("Modal.svelte");
  check("the dialog's scrim is the modal tier", /\.scrim \{[^}]*z-index: var\(--z-modal\);/.test(modal));
  check("...it lets go of the pointer lock on the way in", modal.includes("document.exitPointerLock()"));
  check(
    "...takes the keyboard, so the window's shortcuts never fire from inside it",
    /function onKey\(event: KeyboardEvent\): void \{\s*\/\/[^\n]*\n\s*event\.stopPropagation\(\);/.test(modal),
  );
  check(
    "...leaves an Escape something inside already took",
    /if \(event\.key === "Escape"\) \{\s*if \(event\.defaultPrevented\) return;/.test(modal),
  );
  check(
    "...keeps Tab inside itself",
    /else if \(event\.key === "Tab" && dialog !== null\) \{\s*keepFocusInside\(dialog, event\);/.test(modal),
  );
  check("...gives the focus back to what opened it", /opener\.focus\(\{ preventScroll: true \}\)/.test(modal));
  check(
    "...and closes from the backdrop only for a press that began there",
    modal.includes("pressedOnScrim = event.target === event.currentTarget") &&
      modal.includes("if (pressedOnScrim && event.target === event.currentTarget) onclose();"),
  );

  const dialogs = [
    "AboutModal",
    "AnchorModal",
    "ConvertModal",
    "DimensionsModal",
    "NbtModal",
    "SchematicDialog",
    "SettingsModal",
    "VersionModal",
    "VersionsModal",
    "VoidBlockModal",
  ];
  const ownSkeleton = dialogs.filter((name) => {
    const source = lib(name + ".svelte");
    return (
      !source.includes('import Modal from "./Modal.svelte";') ||
      !source.includes("<Modal") ||
      source.includes('class="scrim"') ||
      source.includes("exitPointerLock") ||
      /event\.key === "Escape"/.test(scriptOf(source))
    );
  });
  equal("every dialog is a Modal, with no scrim, Escape or pointer lock of its own", ownSkeleton, []);

  // A local ".primary" painted the accent flat over app.css's bevelled one.
  const libDir = path.join(RENDERER, "lib");
  const flatPrimary = readdirSync(libDir)
    .filter((name) => name.endsWith(".svelte"))
    .filter((name) => /\n\s*(button)?\.primary\s*\{/.test(styleOf(lib(name))));
  equal("no component paints its own confirming button", flatPrimary, []);

  // The dialogs pick from the scales, as the tool panels do.
  const surfaces = [...dialogs, "Modal", "BlockStateModal", "CommandPalette", "VersionList", "ApiKeysSection"];
  const offScale = surfaces.flatMap((name) => {
    const style = styleOf(lib(name + ".svelte"));
    const faults: string[] = [];
    if (/border-radius:(?!\s*var\(--radius(-round)?\))/.test(style)) faults.push(name + ": a radius");
    if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(style)) faults.push(name + ": a colour");
    if (/font-size:\s*\d/.test(style)) faults.push(name + ": a font size");
    if (/z-index:\s*\d/.test(style)) faults.push(name + ": a stacking level");
    if (/(^|[;\s{])color: var\(--accent\)/.test(style)) faults.push(name + ": the accent as text");
    return faults;
  });
  equal("the dialogs draw with the design system's scales and nothing else", offScale, []);
  check(
    "the block-state editor is a popover, on the popover tier",
    /\.modal \{[^}]*z-index: var\(--z-popover\);/.test(lib("BlockStateModal.svelte")),
  );
  check(
    "the command palette wears the dialogs' slab",
    /class="palette modal"/.test(lib("CommandPalette.svelte")),
  );

  // The start screen opens dialogs, and Ctrl+, opens Settings over it: both
  // have to land on top of it.
  const tier = (name: string): number => Number(new RegExp(name + ": (\\d+);").exec(css)?.[1] ?? NaN);
  check("the start screen is a tier of its own, under every dialog", tier("--z-screen") < tier("--z-modal"));
  check("...and the screens wear it", /\.screen \{[^}]*z-index: var\(--z-screen\);/.test(lib("Screen.svelte")));
  check(
    "the empty space field chooses a block when one is picked, not on every keystroke",
    lib("VoidBlockModal.svelte").includes("onchange={(next) => (typed = next)}") &&
      /onpick=\{\(next\) => \{\s*typed = null;\s*onblock\(next\);/.test(lib("VoidBlockModal.svelte")),
  );
  check(
    "an Escape that closes a block list stays with the list, not the dialog around it",
    /event\.key === "Escape" && open\) \{\s*\/\/[^\n]*\n\s*event\.preventDefault\(\);\s*open = false;/.test(
      lib("BlockPicker.svelte"),
    ),
  );

  // Settings: ten panes in four groups, each control in one of them.
  const settings = lib("SettingsModal.svelte");
  const panes = [...settings.matchAll(/\{ id: "(\w+)", key: "settings\.\w+" \}/g)].map((match) => match[1]);
  equal(
    "the settings are ten panes in a fixed order",
    panes,
    ["general", "updates", "scene", "lighting", "textures", "performance", "lod", "diagnostics", "providers", "mcp"],
  );
  equal(
    "...in four groups",
    [...settings.matchAll(/key: "(settings\.group\.\w+)"/g)].map((match) => match[1]),
    ["settings.group.app", "settings.group.viewport", "settings.group.performance", "settings.group.connections"],
  );
  const drawn = panes.filter((id) => id !== "providers" && !settings.includes('category === "' + id + '"'));
  equal("...and every pane has something in it", drawn, []);
  for (const key of ["preview.ambientOcclusion", "preview.showGrid", "preview.wireframe", "preview.showFps"]) {
    equal("..." + key + " is in exactly one place", settings.split('t("' + key + '")').length - 1, 1);
  }
  check(
    "the frame counter and the stutter report are diagnostics, not graphics",
    settings.indexOf('t("preview.showFps")') > settings.indexOf('category === "diagnostics"') &&
      settings.indexOf('t("preview.copyStutterReport")') > settings.indexOf('category === "diagnostics"'),
  );

  // What rebuilds says so beside its name -- and the list is App's, so a
  // setting that starts rebuilding there and is not badged here fails.
  const from = app.indexOf("const rebuilds =");
  const rebuilding = [...app.slice(from, app.indexOf(";", from)).matchAll(/patch\.(\w+) !== undefined/g)]
    .map((match) => match[1])
    .filter((field) => !field.startsWith("lod"));
  check("App's rebuild list was found", rebuilding.length >= 6, rebuilding.join(", "));
  const badged = (field: string): boolean =>
    field === "biomeColor" || field === "waterColor"
      ? settings.includes('t("preview.biomeColors")} {@render mesh()}')
      : new RegExp("\\(" + field + "\\) => onpreviewchange\\(\\{ " + field + " \\}\\),[\\s\\S]{0,160}?false,\\s*true,\\s*\\)\\}").test(
          settings,
        );
  equal("every setting that rebuilds the preview carries the badge", rebuilding.filter((field) => !badged(field)), []);
  check("...and so does the resource pack", settings.includes('t("preview.resourcePack")} {@render mesh()}'));
  check(
    "the level-of-detail legend is painted from the viewport's own table",
    settings.includes('style:background={tintColour("lod1")}') &&
      lib("Viewer.svelte").includes("LOD_TINT_AMOUNT,") &&
      !/const LOD_TINT\b/.test(lib("Viewer.svelte")),
  );
  check(
    "the open schematic's level-of-detail state comes first, not under six controls",
    settings.indexOf("lodStatusLine}") < settings.indexOf('id="lod-mode"'),
  );
}

// --- the start screen --------------------------------------------------------
console.log("\n--- the start screen ---");
{
  const app = readFileSync(path.join(RENDERER, "App.svelte"), "utf8").replace(/\r\n/g, "\n");
  const lib = (name: string): string =>
    readFileSync(path.join(RENDERER, "lib", name), "utf8").replace(/\r\n/g, "\n");
  const styleOf = (source: string): string =>
    source.slice(source.indexOf("<style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  const scriptOf = (source: string): string => source.slice(0, source.indexOf("</script>"));
  const screen = lib("Screen.svelte");
  const start = lib("StartScreen.svelte");

  // The window's resting state, so the app's commands work from it: Ctrl+K
  // and Ctrl+, are the window's, a plain key stays on the screen. A dialog
  // stops every key, and a start screen that did would lose both.
  check(
    "a Ctrl chord goes through a screen to the window, a plain key stays on it",
    /\} else if \(!\(event\.ctrlKey \|\| event\.metaKey\)\) \{\s*\/\/[^\n]*\n\s*event\.stopPropagation\(\);/.test(screen) &&
      !/function onKey\(event: KeyboardEvent\): void \{\s*event\.stopPropagation\(\);/.test(screen),
  );
  check(
    "...keeps Tab inside itself, as a dialog does",
    /if \(event\.key === "Tab"\) \{\s*event\.stopPropagation\(\);\s*if \(card !== null\) keepFocusInside\(card, event\);/.test(screen),
  );
  check(
    "...and one that cannot be put away has no close button and ignores Escape and the backdrop",
    /\{#if ondismiss !== undefined\}\s*<button class="icon close"/.test(screen) &&
      /if \(ondismiss === undefined \|\| event\.defaultPrevented\) return;/.test(screen) &&
      screen.includes("if (ondismiss !== undefined && pressedOnScrim && event.target === event.currentTarget) ondismiss();"),
  );
  check(
    "the start screen is a screen, with no scrim or Escape of its own",
    start.includes('import Screen from "./Screen.svelte";') &&
      /<Screen title=\{t\("app\.title"\)\}[^>]*\{ondismiss\}/.test(start) &&
      !/event\.key === "Escape"/.test(scriptOf(start)) &&
      !start.includes('class="start"'),
  );
  // The question about lost work is what launch shows in the start screen's
  // place. It was a card in the middle of the viewport with the bar, the chat
  // and the gear all live around it.
  const recovery = /\{#if recovery\}[\s\S]*?\{\/if\}/.exec(app)?.[0] ?? "";
  check(
    "the recovery question is a screen too, with two answers and no way to dismiss it",
    /<Screen\s+role="alertdialog"/.test(recovery) &&
      !recovery.includes("ondismiss") &&
      recovery.includes("resolveRecovery(true)") &&
      recovery.includes("resolveRecovery(false)"),
  );
  check("...and its old card is gone from the viewport", !/\.recovery \{/.test(styleOf(app)));

  // Four ways in, each a tile. The chat's was a sentence asking the reader to
  // close the screen and go and type; pressing the tile does both.
  const tile = (handler: string): string => new RegExp('<button class="action( primary)?" onclick=\\{' + handler + "\\}[^>]*>").exec(start)?.[0] ?? "";
  check(
    "New, Open, Convert and the chat are four tiles, New the lit one",
    tile("onnew").includes("primary") && [tile("onopen"), tile("onconvert"), tile("ondescribe")].every((tag) => tag !== "" && !tag.includes("primary")),
  );
  check(
    "...New and Open wait for the app, Convert and the chat never do",
    tile("onnew").includes("disabled={busy}") &&
      tile("onopen").includes("disabled={busy}") &&
      !tile("onconvert").includes("disabled") &&
      !tile("ondescribe").includes("disabled"),
  );
  check(
    "the chat's tile puts the screen away, brings the chat back and puts the caret in it",
    /function describeInChat\(\): void \{\s*startDismissed = true;\s*if \(sidebarCollapsed\) toggleSidebar\(\);\s*composerFocus \+= 1;/.test(app) &&
      app.includes("ondescribe={describeInChat}") &&
      app.includes("focusRequest={composerFocus}") &&
      lib("ChatPanel.svelte").includes("{focusRequest}") &&
      /\$effect\(\(\) => \{\s*if \(focusRequest > 0\) input\?\.focus\(\);/.test(lib("ChatComposer.svelte")),
  );
  // The hint said ".schem or .schematic" for two releases after a drop
  // learned to open four formats.
  const opened = [...(/const SCHEMATIC_EXTENSIONS = \[([^\]]*)\]/.exec(app)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  equal(
    "the start screen and the drop overlay name every format a drop opens",
    opened.filter((extension) => !en["start.openHint"].includes(extension) || !en["viewport.dropTypes"].includes(extension)),
    [],
  );
  check("...and there are four of them to name", opened.length === 4);
  check(
    "the bar offers no way back to the start screen while the recovery question holds its place",
    app.includes("startvisible={startVisible || recovery !== null}"),
  );
  // Ctrl+K from the start screen, then Escape: the focus was left on the
  // page, and the screen's own keys with it.
  const palette = lib("CommandPalette.svelte");
  check(
    "the command palette gives the focus back to what had it, unless something has taken it since",
    /const opener = document\.activeElement instanceof HTMLElement \? document\.activeElement : null;\s*return \(\) => \{/.test(palette) &&
      palette.includes("(now === null || now === document.body || now === input)") &&
      palette.indexOf("const opener = document.activeElement") < palette.indexOf("input?.focus();"),
  );
  check(
    "the loading screen is the top tier, over the start screen",
    /\.startup \{[^}]*z-index: var\(--z-top\);/.test(lib("StartupScreen.svelte")),
  );

  const offScale = ["Screen", "StartScreen", "StartupScreen"].flatMap((name) => {
    const style = styleOf(lib(name + ".svelte"));
    const faults: string[] = [];
    if (/border-radius:(?!\s*var\(--radius(-round)?\))/.test(style)) faults.push(name + ": a radius");
    if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(style)) faults.push(name + ": a colour");
    if (/font-size:\s*\d/.test(style)) faults.push(name + ": a font size");
    if (/z-index:\s*\d/.test(style)) faults.push(name + ": a stacking level");
    if (/(^|[;\s{])color: var\(--accent\)/.test(style)) faults.push(name + ": the accent as text");
    if (/backdrop-filter/.test(style)) faults.push(name + ": a blur");
    return faults;
  });
  equal("the launch screens draw with the design system's scales and nothing else", offScale, []);
}

console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
