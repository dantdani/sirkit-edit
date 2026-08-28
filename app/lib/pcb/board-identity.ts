/**
 * B13.1 §B — the ONE canonical PCB board-instance identity + physical-binding
 * scope defaults, shared by the physical-binding WRITE path (PcbEditor sync
 * identity → `bind_atomic_selection`) and the component-authority READ path
 * (the /api/chat authority loader). Before B13.1 these used two different
 * string formulas (`board:${projectId}` vs `${projectId}:${branchId}`), so a
 * binding written in production could never be found by the chat read path
 * (B13.1 counterexample R3). There is now exactly one formula and one set of
 * scope defaults; neither side may restate them.
 */

/** The durable board-instance id for a project's primary board. */
export function pcbBoardInstanceId(projectId: string): string {
  return `board:${projectId}`;
}

/** The hierarchy path the physical-binding creator defaults to
 *  (`bindAtomicSelection` → `["root"]`). The read path must match exactly. */
export const PCB_BOARD_HIERARCHY_PATH: readonly string[] = Object.freeze(["root"]);

/** The assembly variant the physical-binding creator defaults to
 *  (`bindAtomicSelection` → `"variant-default"`). */
export const PCB_BOARD_ASSEMBLY_VARIANT_ID = "variant-default";
