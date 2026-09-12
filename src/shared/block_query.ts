/**
 * What a typed block search means, decided once.
 *
 * Two places search the block registry -- the picker and the creative
 * inventory in the renderer, and `list_blocks` for the agent and MCP in main --
 * and they have to agree about what a query is, or a name one of them finds is
 * missing from the other. It is in `shared/` for `block_orientation.ts`'s
 * reason: neither process may import out of the other.
 *
 * **A space is an underscore.** Every block name is spelled with underscores
 * and none contains a space, so `oak slab` matched nothing at all while
 * `oak_slab` found the slab -- the spelling a person types first was the one
 * guaranteed to fail. A run of spaces is one underscore, so `oak  slab` is not
 * a different, empty search.
 *
 * **The namespace is stripped from the query rather than matched in the id.**
 * Every block here is `minecraft:something`, so matching the namespaced id made
 * every letter of `minecraft:` return the whole registry; CLAUDE.md has the
 * numbers. Pasting a full id is still a real thing to do, and this is what it
 * means.
 */
export function blockQuery(raw: string): string {
  const typed = raw.trim().toLowerCase();
  const bare = typed.startsWith("minecraft:") ? typed.slice("minecraft:".length) : typed;
  return bare.trim().replace(/\s+/g, "_");
}
