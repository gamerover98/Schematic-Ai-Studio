---
name: mc-banner-patterns
description: Look up Minecraft banner patterns — their ids, their pre-1.20.5 codes, the release each arrived in, what each looks like — and the NBT each era stores them in, and vendor them into this app's table. Use when a banner draws without its design or with the wrong one, when a design is refused for a version it exists in, when a new Minecraft release adds a banner pattern, when list_banner_patterns describes a design wrongly, or when `resources/banner_patterns.json` needs refreshing.
---

# Knowing what a banner can carry

A banner's design is not a block state. It is a list of layers in the banner's
**block entity**, each a design and a dye colour, drawn bottom to top. Three
places in this app depend on knowing the designs:

- the renderer composes `entity/banner/<id>.png` into the cloth;
- the placement path and `set_banner_patterns` write the list in the spelling
  the schematic's version reads;
- `list_banner_patterns` tells a model what each design *looks like*, so it can
  design a banner without seeing one.

## The shape of it

```
resources/banner_patterns.json     the data, with provenance   ← you edit this
scripts/gen-banner-patterns.mjs    JSON → the table            ← you run this
src/shared/banner_patterns.ts      the table, plus the lookups (hand-written)
src/main/pipeline/banner_nbt.ts    reading and writing the three spellings
```

The generator replaces only what is between the two markers and is idempotent:
run twice, the second run writes nothing.

## The three spellings, and where their boundaries come from

| | a layer | the list | colours |
|---|---|---|---|
| 1.8 to 1.12.2 | `{Pattern:"moj",Color:14}` | `Patterns`, plus `Base` | `15 - dye` |
| 1.13 to 1.20.4 | `{Pattern:"moj",Color:1}` | `Patterns` | the dye's number |
| 1.20.5 on | `{pattern:"minecraft:mojang",color:"orange"}` | `patterns` | the dye's name |

The boundaries are **where the game's datafixers are registered**, not what a
changelog says: `BlockEntityBannerColorFix` at schema 1451 (the inversion, and
the Flattening moving the colour into the block's name) and
`BannerPatternFormatFix` at 3818. Read them in `DataFixers.java`; they are
`formats.invertedColorsBefore` and `formats.namedPatternsFrom` in the JSON.

## How this skill's trust rule differs from its siblings

The file has three kinds of fact, and they earn trust three ways.

**Ids, codes and colours are the game's code, and mechanically checked.**
Transcribe them from a decompiled client:

- ids and their order: `BannerPatterns.bootstrap`;
- codes: `BannerPatternFormatFix.PATTERN_ID_MAP`;
- colour order: `ExtraDataFixUtils.dyeColorIdToName`.

`tests/blocks.ts` holds its own transcription of `PATTERN_ID_MAP` and requires
every row to agree with it, and composes every id against the bundled pack and
requires it to change the flag -- a misspelled id composes to a plain banner.

**`since` is history, and needs two sources.** A wrong one refuses a design in
a version that has it, or lets a file claim a design its game cannot read.
The two that have agreed so far:

- minecraft.wiki's `Banner` and `Banner_Pattern` history sections -- careful,
  the second is the history of the *pattern items*, which is not the history
  of the designs;
- whether `assets/minecraft/textures/entity/banner/<id>.png` exists in each
  release's assets (`InventivetalentDev/minecraft-assets/<tag>`), which is the
  game's own answer. It says 1.20.5 for flow and guster, which were behind the
  `update_1_21` experiment until 1.21 -- the table records the release a design
  can be made in *without* experiments.

The label must be one `resources/mc_versions.json` has; the generator refuses
anything else. 1.8.8 is this app's oldest release and stands for "since banners".

**`name` and `description` are prose.**

- `name` is `en_us.json`'s `block.minecraft.banner.<id>.white` with `White `
  taken off; a single source is enough, since it is the game's own file.
- `description` fails no check anywhere, and a model builds on it. Write it
  **looking at the texture's front window** -- `u 1..21, v 1..41` of a 64-wide
  sheet -- and say where the design is *as the front of the banner shows it*.
  The front reads that window unmirrored, with `u 1` on the viewer's left:
  `stripe_left` is on the left. The names are heraldic and are not a guide:
  `diagonal_left` is the *top-left* half, `stripe_downleft` runs from the top
  right to the bottom left.

A quick look at every design's coverage, from the bundled pack:

```bash
node -e '
const {PNG}=require("pngjs");const AdmZip=require("adm-zip");
const zip=new AdmZip("resources/Faithful 64x - Release 14.zip");
for (const e of zip.getEntries().filter(e=>/entity\/banner\/[a-z_]+\.png$/.test(e.entryName))) {
  const p=PNG.sync.read(e.getData()), s=p.width/64; console.log(e.entryName);
  for (let v=1;v<41;v+=2){let r="";for(let u=1;u<21;u++){const i=((v*s)*p.width+u*s)*4;r+=p.data[i+3]>127?"#":".";}console.log(r);}
}'
```

## What reads this downstream

- **The MCP wire**: `list_banner_patterns` answers with every row, the colours,
  and the Planet Minecraft editor's address (`BANNER_EDITOR_URL`), and
  `set_banner_patterns` takes its `enum`s from the table. A new design reaches
  a model with no code change.
- **The renderer**: `ModelBaker.bannerCloth` composes `entity/banner/<id>` for
  each layer. A design the pack lacks is drawn without that layer and warned
  about once.
- **Placement and version changes**: `patternExistsIn` and `missingLayers`
  refuse a design the schematic's version does not have, and
  `restateBanners` rewrites every banner when the version changes, counting
  the layers the target cannot hold into the same refusal a lost block gets.

## Doing it

1. **A new release adds a design.** Read `BannerPatterns.java` in a decompiled
   client of that release for the id. It has no code if it arrived after
   1.20.4, which is every design from now on.
2. **Date it from both sources** above; the label must be in
   `resources/mc_versions.json` (refresh that first with `mc-versions` if the
   release is missing).
3. **Look at the texture** and write the description from what is on the front.
4. **Take the name** from that release's `en_us.json`.
5. **Run the generator**, twice:

   ```bash
   node scripts/gen-banner-patterns.mjs
   ```

6. **Verify with the suites** rather than trusting the run:

   ```bash
   npx tsx tests/blocks.ts
   npx tsx tests/formats.ts
   npx tsx tests/mcp.ts
   ```

   `tests/blocks.ts` counts the designs (`BANNER_PATTERNS.length`); raise that
   number deliberately, in the same change.

## Notes worth having

- **A legacy banner with no `Base` is black in the game**, not white. That is
  why every legacy banner this app writes carries one.
- **Before the Flattening, a dye's number is its damage value**: 4 is lapis
  lazuli, which is blue. The modern numbering calls 4 yellow.
- **`base` is a design** -- a full field -- and is how a banner's colour is
  repainted under later layers. It has always had the code `b`.
- **The game draws at most sixteen layers**, and a loom makes at most six.
