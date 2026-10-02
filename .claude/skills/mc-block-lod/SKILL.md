---
name: mc-block-lod
description: Write the simpler stand-in a complex block is drawn with at a distance (level 1 of the viewport's levels of detail), and measure it. Use when tests/blocks.ts says a shape over the face budget has no stand-in or lists it as "straightened", after transcribing a new block with more than 48 faces, or when a block visibly changes when the camera moves away from it.
---

# A block's stand-in for the middle distance

At a distance the viewport may draw a chunk's complex blocks with a few boxes
instead of their full model: **level 1** of the levels of detail. The full
mesh stays where it was -- the pointer picks it and the shadow map is drawn
from it -- so a stand-in only ever changes what is *seen*, and only where what
it leaves out is smaller on screen than the quality setting (2 pixels by
default). `renderer/src/lib/lod.ts` makes that choice; `CLAUDE.md` has the
whole mechanism under "Levels of detail".

This skill is for writing one. `mc-block-models` is for the full shape, and
comes first.

## When a block needs one

When its shape has more than `LOD_FACE_BUDGET` faces (48, eight boxes) in any
state. Counted, not listed: `shapeFaceCount` in `block_shapes.ts`, and
`tests/blocks.ts` walks every state of every offered id and fails on a shape
over the budget with no stand-in. Today four families cross it: the copper
golem statues (54-66 faces), the cauldrons (58-59), lit candles (56) and a
fence joined on four sides (54).

A shape over the budget with no hand-written stand-in falls back to
`straightenedLod` -- its biggest boxes, straightened -- and the suite lists it
as *straightened*. That is a stopgap, not an answer: it keeps the textures of
boxes that may have been tilted, and nobody chose what it leaves out.

## What a stand-in may be

Only simpler, and `tests/blocks.ts` holds every one of these:

- **fewer faces** than the full shape, in every state;
- **inside the full shape's own box** (`placedExtent` of its boxes): a
  stand-in that sticks out is a block that grows when the camera leaves;
- **turned only by quarter turns**: an axis-aligned box keeps the `cullFace`
  that lying on the cell boundary earns it, so stand-ins next to each other
  hide their shared faces as full blocks do;
- **covering every side the full shape covers** (`shapeCoversFace`), or the
  neighbours would hide less behind it than they do behind the block;
- **drawn like any block**: UVs inside the tile, something painted, faces
  wound the way they point.

## Writing one

In the level-of-detail section at the end of `block_shapes.ts`:

1. **Read the full shape** and decide what a distance takes away first: parts
   a unit or two across, gaps between parts, planes. Those go, or merge into
   the part beside them.
2. **Keep what makes the silhouette.** The statue's antenna is two units wide
   and stands half a block above the head; left out, it was the stand-in's
   whole error (0.50 blocks, four times anything else). It keeps a box.
3. **Borrow the full model's pictures.** A stand-in box wears the texture
   window of the biggest part it replaces -- `ModelCube.uvSize` cuts the
   window from that part's own size, so a merged box reads the body's patch of
   the sheet and not the empty corners around it. Never paint a new picture.
4. **Write it as a `ShapeBuilder`** and register it in `LOD_SHAPES`, keyed on
   the builder that draws the full shape -- so it covers exactly the blocks
   that builder covers, with no second list of names.

`statueLod`, `fenceLod`, `candleLod` and `cauldronLod` are the examples, each
a different move: merging parts into the box they occupy, filling a gap,
dropping planes, and lowering walls onto the floor their feet stood on.

## Measuring it

```bash
npx tsx tests/blocks.ts
```

The level-of-detail section prints `measured error in blocks` per block:
`lodShapeError`, the Hausdorff distance between the block and its stand-in as
solids, sampled on the surfaces that can be seen. **That number is what
decides how far away the stand-in may be shown** -- the viewer turns it into
pixels at the camera's distance -- so a smaller error means it is used nearer
and saves more. The statues are 0.09-0.28 blocks, candles 0.25, cauldrons
0.19, fences 0.09; the suite fails a stand-in at half a block or more.

When one number is far above the rest, it is one part: find which, and keep
it as a box of its own.

Then look at it in the app, which is the check no number replaces:

1. Settings -> Level of detail: **Always**, and **Colour each level**.
2. Build a patch of the block, move away until its chunk turns green.
3. Turn the tint off and compare a capture with the levels on and off at that
   distance (or `capture_viewport` twice over MCP). They must read as the same
   object; what changes should be the finest texture, not the shape.

## Must not

- **Invent detail.** A stand-in is made of the full model's own parts and
  pictures, as the full shape is made of vanilla's.
- **Leave the full shape's box**, tilt a box off a quarter turn, or cover less
  than the block covers.
- **Give one to a block within the budget.** It saves nothing and costs a
  second copy of its chunk; the suite refuses it.
- **Make the error smaller by measuring differently.** It is what keeps the
  switch invisible; a number made small is a switch somebody sees.

## What reads this downstream

Not the MCP wire: geometry never leaves the process. `capture_viewport`
photographs what is drawn, though, and a capture from far away may show the
stand-ins -- which is one more reason they must read as the block.
