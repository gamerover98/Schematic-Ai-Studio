---
name: mc-vanilla-rules
description: Find how vanilla Minecraft decides a block's state when it is placed or when a neighbour changes, and transcribe that rule into this app's placement and connection tables. Use when a block placed by hand lands in the wrong state, when a neighbour-derived property (a rail's shape, a fence's arms, a wire's sides, a dripstone's thickness) never changes or changes wrongly, or when adding a rule for a family that has none.
---

# Giving a block the state the game would give it

A block state has three authors in the game, and this app has one place for
each of them:

| who decides | vanilla's method | here |
|---|---|---|
| the **click** -- where the player looked, which face was hit | `getStateForPlacement(BlockPlaceContext)` | `orientPlacement` in `src/shared/block_orientation.ts` |
| the **neighbours** -- what is beside, above, below | `updateShape`, `neighborChanged`, and helpers such as `RailState` | `connectedState` in `src/shared/block_connections.ts` |
| the **document at the click** -- a second cell, a merge, a refusal | `useItemOn`, `canBeReplaced`, `setPlacedBy` | `applyEdit`'s `setBlock` arm in `src/main/services/session.ts` |

Choosing the wrong one is the commonest mistake, and it is not cosmetic. A rule
put in `orientPlacement` runs only from the hand, so a fill, a paste and every
agent tool never see it. A rule put in `connectedState` runs from
`runTransaction` on every edit, so it overwrites a state somebody typed into the
inspector unless the edit says `setState`. A rule that needs another cell of the
document cannot live in `shared/` at all, because `shared/` has no document.

`src/main/domain/connect.ts` is the fourth file, and it decides **which cells**
`connectedState` is asked about. It is not where a rule goes; it is where a new
*offset* goes.

## The sources

| source | what it gives | trust |
|---|---|---|
| the game's own code, read in a decompile of the client of the vendored release (Mojang mappings) | the rule, in its order, with its edge cases | authoritative for the release it came from |
| `mappings.dev/<version>/net/minecraft/world/level/block/<Class>.html` | the class's methods and fields by name, per version | confirms the method you are reading exists and is still called that |
| `minecraft.wiki/w/<Block>`, its *Placement* or *Usage* section and *History* | the behaviour in prose, and when it changed | corroboration, never the transcription |

**Read and transcribe, never vendor.** Decompiled code is not redistributable,
for the same reason the block models are not (`mc-block-models`). What lands in
this repo is a rule written in TypeScript in this codebase's terms, with the
method it came from named in the comment.

**Two sources that agree.** The code says what happens; the wiki says the same
thing in a sentence. Where they disagree, the code at the vendored release wins,
and the comment says what the wiki got wrong. Quote the wiki's sentence in the
comment -- a short quote, in guillemets, as `block_connections.ts` does -- so the
next reader can find it.

The release to read is the one `resources/block_states.json` is pinned to. A
rule read from an older client is a rule for an older game, and this app writes
schematics for the newest one by default.

## Transcribing into a pass with no memory

`deriveConnections` is **one sweep over the neighbours' names and properties**,
not a fixed point, and it remembers nothing between edits. Vanilla often does
remember:

- a rail keeps the list of neighbours it is joined to, and one already joined at
  both ends ignores a third (`RailState.canConnectTo`);
- a wire carries a power level that comes from the whole circuit;
- a dripstone's thickness is a chain through the block in front of it.

There are two honest answers, and the file shows both:

1. **Read the rule as the answer it settles on**, if that answer depends on a
   bounded window. `dripstoneThickness` reads three cells and gets what the
   chain would settle on, so a column of any length comes out right.
2. **Read it statelessly and write down where it differs.** `railShape` knows
   only who is next door, so a rail laid against a finished line turns the line
   into a junction where the game would leave it alone. That is stated in the
   comment, beside the rule, as a deviation.

What is never an answer is a rule that reads a property the pass itself just
wrote and hopes the order works out. The sweep's order is the order of a `Set`.

**Power is not simulated.** A rule with a powered and an unpowered branch takes
the unpowered one, and says so. A file keeps the state it arrived with until
something near it is edited.

## The cells a rule may read

`Neighbours` carries:

- the six faces;
- the eight diagonals `${side}_up` and `${side}_down` (redstone, rails);
- `up_up` and `down_down` (pointed dripstone).

`null` and `undefined` both mean air or outside the document, which is how the
mesher treats them too.

A rule that needs a cell outside that set needs a new offset in `connect.ts`,
and **it goes in `AROUND`, the same list**, not in a list beside it. That list
is also how the pass decides which cells an edit made stale: the cells a rule
reads are exactly the cells to revisit when one of them changes. Two lists is
how a rule comes to update only when something unrelated is edited next to it.

## Guards that are not optional

- **`hasProperty` before every write.** `connectedState`'s `put` does it; a rule
  that writes around `put` writes states the game refuses.
- **The legal value, not only the property.** A powered rail has `shape`, and
  `south_east` is not one of its values. Ask `legalValuesFor` where a family is
  narrower than the property's name suggests.
- **A placement goes under what the user spelled out.** `placementState` merges
  `orientPlacement` beneath the request, because `oak_stairs[facing=north]`
  typed into a field is an instruction.
- **An isolated block keeps what its placement chose.** If the neighbour rule
  has an answer for "no neighbours", it decides the shape of every first block
  of a run. Rails keep their shape there (vanilla's own fallback); the tripwire
  keeps its arms (a stated deviation). Without that, a run laid east starts
  with a block lying across it.
- **The block entity survives.** `connect.ts` puts it back after a write; a new
  pass that writes elsewhere has to do the same, or deriving a property empties
  a chest.

## Checks to write

1. **`tests/blocks.ts`, the rule with literals.** Every direction by name,
   because the mistake a table of four invites is a swapped pair, and a block
   facing the wrong way still looks like a block facing. The negative cases
   beside them: what must *not* change. Where a family has narrower values, a
   walk over every arrangement of the cells it reads, requiring every answer to
   be legal.
2. **`tests/session.ts`, the rule in a real document.** Build the arrangement
   for real with `applyEdit`. This is the only check that sees the stale-cell
   half: a block-level check passes a hand-made `Neighbours` and cannot know
   whether `connect.ts` revisits the cell. Sabotage it to be sure -- walk
   `OFFSETS` instead of `AROUND` and the check must fail.
3. **The legacy era, if the family existed before 1.13.** Build it in a
   `"mcedit"` document at 1.12.2, save, and read the `Blocks` and `Data` bytes
   back. `legacy_blocks.json` spells each metadata value as a state, and the
   MCEdit writer matches the **whole** state, so a rule that writes one property
   too many is written as the base block and reported in `degraded`.
4. **Placement**, with `orientPlacement` and a `PlacementLook`, if the click
   decides anything.

## What not to do

- **Do not refuse a placement because the game would.** A torch on sand, a
  flower on stone: faithful and useless in an editor. The one exception is
  redstone dust in mid-air, because its *appearance* lies (see `CLAUDE.md`).
- **Do not remove blocks.** Vanilla drops an unsupported vine or rail. This pass
  changes properties and never ids.
- **Do not put a rule in the renderer.** It holds no schematic, and a rule there
  would reach the hand and nothing else.
- **Do not decide by name what the registry can answer.** `hasProperty(name,
  "axis")` found eleven pillars a list of names had missed.

## Rules transcribed so far

| rule | vanilla | where |
|---|---|---|
| rail shape, climbing, the south-east rule | `RailState.place`, `BaseRailBlock.getStateForPlacement` | `railShape`, `orientPlacement` |
| redstone wire sides, climbing a step | `RedStoneWireBlock.getConnectingSide` | `redstoneSide` |
| pointed dripstone thickness | `PointedDripstoneBlock.calculateDripstoneThickness` | `dripstoneThickness` |
| vine faces, hanging | `VineBlock.canSupportAtFace` | `connectedState`, `hangingVineTarget` |
| tripwire arms | `TripWireBlock.shouldConnectTo` | `tripwireSides` |
| stair corners | `StairBlock.getStairsShape` | `stairsShape` |
| double chests | `ChestBlock.getConnectedDirection` | `chestType` |
| bell attachment | `BellBlock.getStateForPlacement` | `orientPlacement` |
| sign, banner and head rotation | `RotationSegment.convertToSegment` | `rotationSegment` |

Add a row when a rule lands.
