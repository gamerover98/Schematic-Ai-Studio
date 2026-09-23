/**
 * A block as a person or a model writes it, split into the block and what
 * rides along with it.
 *
 * `minecraft:oak_stairs[facing=east]` has always been the whole of it: a name
 * and its states. A patterned banner is not -- its patterns live in a block
 * entity, not in the state -- and the spelling people actually have for one is
 * the `/give` command a banner editor produces:
 *
 * ```
 * /give @p minecraft:magenta_banner[banner_patterns=[{"pattern":"mojang","color":"orange"}]] 1
 * ```
 *
 * That is an *item* with a data component, and pasting it where a block goes is
 * exactly what should work. So this takes it apart: the block and its states
 * go on down the ordinary path, and the pattern list comes back as text for
 * `main/pipeline/banner_nbt.ts` to read.
 *
 * ## Why it cannot split on commas
 *
 * Every other reader of a block id here splits the brackets on `,` and `=`,
 * which is right for states and wrong the moment a value is a list: the
 * patterns above are full of both. So this scans with a depth counter over
 * brackets and braces and skips quoted text -- the same scan `mcfunction.ts`
 * does for `setblock`'s block argument, for the same reason.
 *
 * ## What it refuses
 *
 * Anything it would otherwise have to drop. A component that is not
 * `banner_patterns`, an NBT key that is not a pattern list, text after the
 * block: each is refused by name, because a banner that silently lost its
 * custom name, or a chest that silently lost what somebody pasted into it,
 * looks exactly like a success.
 *
 * In `shared/` because the renderer's block field and main's tools both take
 * this spelling, and two copies of a scanner like this disagree about quotes.
 */

export class BlockInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockInputError";
  }
}

export interface BlockInput {
  /** The block and its states, in the spelling every other reader takes. */
  readonly block: string;
  /**
   * The pattern list as written -- SNBT, `[{pattern:...,color:...},...]` -- or
   * `null` when none was given.
   */
  readonly bannerPatterns: string | null;
}

const COMPONENT = /^(?:minecraft:)?banner_patterns$/;

/**
 * The index just past the bracket that closes the one at `open`, honouring
 * nesting and quotes. `-1` if it never closes.
 */
function closing(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth += 1;
    else if (c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** `text` cut at every top-level `separator`, trimmed. */
function topLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth += 1;
    else if (c === "]" || c === "}") depth -= 1;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter((part) => part !== "");
}

/** Where `separator` first appears outside brackets and quotes, or `-1`. */
function firstTopLevel(text: string, separator: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth += 1;
    else if (c === "]" || c === "}") depth -= 1;
    else if (c === separator && depth === 0) return i;
  }
  return -1;
}

const unquote = (key: string): string => key.trim().replace(/^(["'])(.*)\1$/, "$2");

/**
 * A `/give` command reduced to its item.
 *
 * The command is `give <target> <item> [count]`, with or without the slash, and
 * the target may carry a selector's own brackets (`@a[distance=..5]`). Anything
 * that does not start with `give` is returned untouched, so this is safe to run
 * on every block somebody types.
 */
export function stripGiveCommand(text: string): string {
  const trimmed = text.trim();
  const match = /^\/?give\s+/i.exec(trimmed);
  if (match === null) return trimmed;
  let rest = trimmed.slice(match[0].length);

  // The target: a selector, possibly with brackets, or a player name.
  const selector = /^@[a-z]/i.exec(rest);
  let targetEnd: number;
  if (selector !== null) {
    targetEnd = 2;
    if (rest[2] === "[") {
      targetEnd = closing(rest, 2);
      if (targetEnd === -1) throw new BlockInputError("The /give command's target selector is never closed.");
    }
  } else {
    const space = rest.search(/\s/);
    targetEnd = space === -1 ? rest.length : space;
  }
  rest = rest.slice(targetEnd).trim();
  if (rest === "") throw new BlockInputError("The /give command names no item.");

  // A trailing count, after the item and whatever brackets it carries. Anchored
  // at the end and preceded by whitespace, so it cannot be inside them.
  const count = /\s+\d+\s*$/.exec(rest);
  if (count !== null) rest = rest.slice(0, count.index);
  return rest.trim();
}

/**
 * Splits a block as written into the block and its banner patterns.
 *
 * Three spellings of the patterns are read, because three are in circulation:
 * the 1.20.5 item component above, `/setblock`'s block-entity NBT
 * (`magenta_banner{patterns:[...]}`), and the 1.13 to 1.20.4 item NBT
 * (`magenta_banner{BlockEntityTag:{Patterns:[...]}}`). Integer colours in the
 * last two are the modern numbering, which is the only numbering a `/give` for
 * a block named like this ever used -- a pre-Flattening one names
 * `minecraft:banner`, which is not a block this app offers.
 */
export function splitBlockInput(raw: string): BlockInput {
  const text = stripGiveCommand(raw);
  const bracket = firstOf(text, "[");
  const brace = firstOf(text, "{");
  const nameEnd = Math.min(
    bracket === -1 ? text.length : bracket,
    brace === -1 ? text.length : brace,
  );
  const name = text.slice(0, nameEnd).trim();
  let at = nameEnd;

  const states: string[] = [];
  let bannerPatterns: string | null = null;
  const takePatterns = (value: string, where: string): void => {
    if (bannerPatterns !== null) {
      throw new BlockInputError(`The banner patterns are given twice (again ${where}).`);
    }
    if (!value.startsWith("[")) {
      throw new BlockInputError("banner_patterns must be a list: [{pattern:\"...\",color:\"...\"}, ...].");
    }
    bannerPatterns = value;
  };

  if (text[at] === "[") {
    const end = closing(text, at);
    if (end === -1) throw new BlockInputError(`The [ after ${name} is never closed.`);
    for (const entry of topLevel(text.slice(at + 1, end - 1), ",")) {
      const eq = firstTopLevel(entry, "=");
      if (eq === -1) {
        throw new BlockInputError(`${entry} inside ${name}[...] has no value; write it as name=value.`);
      }
      const key = entry.slice(0, eq).trim();
      const value = entry.slice(eq + 1).trim();
      if (COMPONENT.test(key)) {
        takePatterns(value, "as a component");
      } else if (key.startsWith("!") || key.includes(":") || /^[[{"']/.test(value)) {
        throw new BlockInputError(
          `${key} is not something this app can place with a block. The one component it reads is ` +
            `banner_patterns; everything else inside the brackets has to be a block state, like facing=north.`,
        );
      } else {
        states.push(`${key}=${value}`);
      }
    }
    at = end;
  }

  if (text[at] === "{") {
    const end = closing(text, at);
    if (end === -1) throw new BlockInputError(`The { after ${name} is never closed.`);
    readNbt(text.slice(at, end), takePatterns);
    at = end;
  }

  const trailing = text.slice(at).trim();
  if (trailing !== "") {
    throw new BlockInputError(`Unexpected ${JSON.stringify(trailing)} after the block ${name}.`);
  }

  return {
    block: states.length === 0 ? name : `${name}[${states.join(",")}]`,
    bannerPatterns,
  };
}

/** The first `char` outside quotes, or `-1`. Brackets are what is being looked for. */
function firstOf(text: string, char: string): number {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === char) return i;
  }
  return -1;
}

/**
 * The patterns out of an NBT compound, in either of the two places they live.
 *
 * `{patterns:[...]}` and `{Patterns:[...]}` are the block entity itself, as
 * `/setblock` writes it; `{BlockEntityTag:{...}}` is the item carrying one, as a
 * `/give` before 1.20.5 does.
 */
function readNbt(compound: string, takePatterns: (value: string, where: string) => void): void {
  for (const entry of topLevel(compound.slice(1, -1), ",")) {
    const colon = firstTopLevel(entry, ":");
    if (colon === -1) throw new BlockInputError(`${entry} in the block's NBT has no value.`);
    const key = unquote(entry.slice(0, colon));
    const value = entry.slice(colon + 1).trim();
    if (key === "patterns" || key === "Patterns") {
      takePatterns(value, "in the NBT");
    } else if (key === "BlockEntityTag" && value.startsWith("{")) {
      readNbt(value, takePatterns);
    } else {
      throw new BlockInputError(
        `${key} is not something this app can place with a block. Of a block's NBT it reads the ` +
          `banner patterns and nothing else.`,
      );
    }
  }
}
