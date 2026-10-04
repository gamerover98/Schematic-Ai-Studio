---
name: mc-building-tools
description: Look up how WorldEdit, VoxelSniper and Axiom define their building tools (spheres, cylinders, pyramids, walls, faces, smoothing, erosion, brushes) and transcribe them into this app's shape and terrain code with reference counts the suites can hold. Use when adding or changing a shape, a brush, a terrain smoothing or erosion tool, or when a drawn shape does not match what the same command makes in the game.
---

# Building tools the way builders already know them

People who build in Minecraft have used WorldEdit for over a decade, and
VoxelSniper for terrain. A sphere here should look like `//sphere`, a hollow
cylinder like `//hcyl`, an erode brush like VoxelSniper's. So the rule is
**transcribed, not invented**, and the transcription is checked against a port
of the original rather than against a description of it.

| tool | here |
|---|---|
| shapes: which cells | `src/shared/shapes.ts` (`shapeCells`, `shapeContains`, `hollowAxes`) |
| shapes: writing them | `applyEdit`'s `shape` arm in `src/main/services/session.ts`, `writeMix` with a `CellSet` |
| shapes over MCP and in the chat | `draw_shape` in `src/main/agent/tools.ts` (`TOOL_SPECS`) |
| a brush stroke as one undo | `TransactionOptions.mergeKey`, `commit` in `src/main/domain/history.ts` |
| terrain from a noise | `src/shared/terrain.ts` (the surface), `src/main/domain/terrain.ts` (the layers), `generate_terrain` in `TOOL_SPECS` |
| smooth, erode | `smoothHeights` and `erodeCells` in `src/main/domain/terrain.ts`, ported from the sources below and held to a second port in `tests/session.ts`; `smooth_terrain` and `erode` in `TOOL_SPECS` |

## Sources and the two-source rule

1. **The code.** WorldEdit's `EditSession.java`
   (`worldedit-core/src/main/java/com/sk89q/worldedit/EditSession.java`,
   EngineHub/WorldEdit on GitHub, `master`) for the shapes;
   `math/convolution/HeightMap.java`, `HeightMapFilter.java` and
   `GaussianKernel.java` for `//smooth`. VoxelSniper's `ErodeBrush.java`
   (KevinDaGame/VoxelSniper-Reimagined, `master`) for erosion.
   Fetch the raw file with `curl` and read the method; do not trust a summary.
2. **The documentation**, as the second source:
   `worldedit.enginehub.org/en/latest/usage/generation/` and
   `.../usage/regions/regionops/` for WorldEdit, a VoxelSniper wiki page for the
   erosion presets.

Behaviour needs both to agree. **Where they disagree the code wins and the
disagreement is written down**, because the docs paraphrase: the generation
page says a pyramid's base is "twice the height", and the code makes it
`2s - 1` -- that is the paraphrase rounding, not a second behaviour.

The numbers in the tables below were produced by a literal port of the Java
(the same loops, the same early exits). `tests/session.ts` carries that port,
and compares every shape cell for cell, with these counts written out beside
it so a mistake in the port cannot confirm itself.

## The shapes

WorldEdit names a shape by a centre block and a radius. Here a shape is the one
**inscribed in a box** (inclusive), and WorldEdit's are the boxes
`centre ± radius`. A box can be even-sized, which WorldEdit cannot say; on odd
boxes the two are identical.

### Sphere and ellipsoid -- `makeSphere`

```java
radiusX += 0.5; ...                       // so radius r spans 2r + 1 blocks
xn = x / radiusX; ...                     // x is the cell's offset from the centre cell
if (xn*xn + yn*yn + zn*zn > 1) skip;      // inclusive: <= 1 is in
hollow: skip if (x+1, y, z), (x, y+1, z) and (x, y, z+1) are all inside
```

Here: a cell is in when `sum(((2*(p - min) - (n - 1)) / n)^2) <= 1` over the
three axes, `n` the box's size. For `n = 2r + 1` that is the line above exactly.
No cell of an odd box lands on the surface (odd squares over odd squares never
sum to exactly 1), so the inclusive edge decides nothing there.

Docs: `//sphere [-r] <pattern> <radius>[,<radius>,<radius>]` -- radii in the
order north-south, up-down, east-west. The centre is the block above the one
you stand on; `-r` raises it by the radius.

| radius | 0 | 1 | 2 | 3 | 4 | 5 | 8 |
|---|---|---|---|---|---|---|---|
| `//sphere` | 1 | 19 | 81 | 179 | 389 | 739 | 2553 |
| `//hsphere` | 1 | 18 | 54 | 98 | 186 | 278 | 690 |

Ellipsoid radii 3,1,2: 61 cells, hollow 46.

### Cylinder -- `makeCylinder`

The sphere's rule over the two horizontal axes, every layer from `pos.y` up for
`height` layers (a negative height extends down). Hollow checks only `x+1` and
`z+1`: **an open tube, no caps.**

Docs: `//cyl <pattern> <radiusEW>[,<radiusNS>] [height]`, from your feet up;
height 1 is a circle.

| radius, height 1 | 0 | 1 | 2 | 3 | 4 | 5 | 8 |
|---|---|---|---|---|---|---|---|
| `//cyl` | 1 | 9 | 21 | 37 | 69 | 97 | 225 |
| `//hcyl` | 1 | 8 | 12 | 16 | 24 | 28 | 48 |

Here a cylinder may also lie along x or z (`axis`); WorldEdit's only stands.

### Pyramid -- `makePyramid`

```java
for (y = 0; y <= height; ++y) { size--; for x, z in 0..size:
    if ((filled && x <= size && z <= size) || x == size || z == size) set (±x, y, ±z) }
```

Layer `y` is a square of half-width `s - 1 - y`: the base is `2s - 1` across,
`s` layers tall, one block in on every side per layer. Hollow keeps only each
layer's ring: **no floor.**

Here: one block in on every side per layer from the box's floor, until nothing
is left or the box ends -- so a long footprint is a hipped roof, and a short box
cuts it flat.

| size | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| `//pyramid` | 1 | 10 | 35 | 84 | 165 |
| `//hpyramid` | 1 | 9 | 25 | 49 | 81 |

### Faces and walls -- `makeCuboidFaces`, `makeCuboidWalls`

`//faces` (`//outline`): all six faces of the selection. `//walls`: "a hollow
shell of the selection without a ceiling and floor". Both one block thick.

Here: `box` with `hollow` is `//faces`, and `walls` is a box hollowed across x
and z only. 10x4x10 walls are 144 cells; two thick, 256.

### Thickness

WorldEdit's hollow shapes are one block thick; its cone (`makeCone`) takes a
`thickness` and tests the cell `thickness` steps outwards on each axis. Here
every shape does that: a cell is in the shell when the cell `thickness` steps
away along one of the shape's hollow axes is outside it. Every shape is convex,
so that one look stands for every step in between, and at thickness 1 it is
WorldEdit's own test.

## Terrain

### `//smooth` -- `HeightMap.applyFilter`

- A heightmap of the selection: per column, the highest block matching the
  mask (`getHighestTerrainBlock`).
- Filtered `iterations` times by a **Gaussian kernel, radius 5, sigma 1.0**
  (`new HeightMapFilter(new GaussianKernel(5, 1.0))` in `RegionCommands`). The
  kernel is `exp(-(x^2 + y^2) / (2 sigma^2))`, normalised to sum 1 over the
  11x11 square. At the edge a sample outside the data is read from the column
  itself. Each result is `floor(sum + 0.5)`.
- Applied per column by **stretching what is there**, not by filling: growing,
  the old top block goes to the new height and every cell below copies from
  `floor(y * scale)` with `scale = (cur - minY) / (new - minY)`; shrinking, the
  same from the bottom, the top block kept, the rest of the column set to air.
  Liquids at the top are left alone.
- Docs: works on a heightmap, good for surface terrain, "not suitable for
  smoothing caves, walls, or objects".

### Erode -- VoxelSniper `ErodeBrush`

Two passes inside a sphere of the brush size, each repeated:

- **erosion**: a solid cell with at least `erosionFaces` of its six neighbours
  empty or liquid becomes air;
- **fill**: an empty or liquid cell with at least `fillFaces` solid neighbours
  takes the commonest neighbouring material.

Each iteration reads the state the previous one left (`BlockChangeTracker`).
Presets `(erosionFaces, erosionRecursion, fillFaces, fillRecursion)`:

| preset | values |
|---|---|
| none | 0, 1, 0, 1 |
| melt | 2, 1, 5, 1 |
| fill | 5, 1, 2, 1 |
| smooth | 3, 1, 3, 1 |
| lift | 6, 0, 1, 1 |
| floatclean | 6, 1, 6, 1 |

The arrow runs the preset, the gunpowder its inverse (erosion and fill swapped).
The modes are corroborated by the VoxelSniper guides (melt pushes land away,
fill pulls it out, smooth rounds edges, lift raises, floatclean removes
floating blocks); the numbers are the code's, and FastAsyncVoxelSniper's copy
(IntellectualSites/FastAsyncVoxelSniper, `brush/type/ErodeBrush.java`) gives the
same five. VoxelSniper's sphere is `d^2 <= r^2`, not WorldEdit's `r + 0.5`;
the `none` preset (0, 1, 0, 1) inverts a sphere and is not offered here.

## Rules for transcribing a tool

- **Port the loop, then compare.** Write the Java as TypeScript line for line
  inside the test, run both over a range of sizes, and require the same cells.
  A count alone can agree by accident.
- **Write a few counts out by hand** beside the comparison, from the tables
  here.
- **Never invent a shape's look.** Where this app generalises (an even box, a
  cylinder lying down, a thicker shell), say so in the module header and keep
  the WorldEdit case exact.
- **One transaction per gesture.** A shape is one undo step; a brush stroke is
  one step however many touches (`mergeKey`).
- **What it grows into** follows the edit it is closest to: a shape that writes
  into empty space grows the document like a fill; one that only rewrites
  existing blocks (`mode: "filled"`) does not, like `replace`.

## What reads this downstream

- **The MCP wire and the in-app chat**: `draw_shape`'s description names the
  WorldEdit equivalents and the hollow rules. Change a rule here and that
  sentence has to change with it -- it is prose and no test reads it.
- **The renderer** (F7): the creative tools draw the same `shapeCells` as a
  ghost before anything is written, which is why the geometry is in `shared/`.
