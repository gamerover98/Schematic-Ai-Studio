/**
 * `use:indeterminate={flag}` -- the checkbox's third state, which has no HTML
 * attribute.
 *
 * A block-state row can be true, false, or **not set**, and the third is a
 * real answer: the property is absent from the entry and the game fills in its
 * own default. A plain checkbox has two states and would show "not set" as
 * "false", which is a claim about the block it cannot back up. `indeterminate`
 * is the browser's own spelling of "neither", and it exists only as a DOM
 * property -- writing it as an attribute does nothing -- so it is set here.
 *
 * Clicking an indeterminate box clears the flag and checks it, so the first
 * click on an unset row writes `true`: the change handler reads `checked`.
 */
export function indeterminate(node: HTMLInputElement, value: boolean): { update: (next: boolean) => void } {
  node.indeterminate = value;
  return {
    update(next: boolean): void {
      node.indeterminate = next;
    },
  };
}
