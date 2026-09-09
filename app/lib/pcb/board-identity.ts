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

/** [B16-C.1] a DERIVED board revision's id: the lineage root plus its generation.
 *  Generation 0 is the root itself (`board:<project>`); each derivation appends
 *  the next generation so the old routed board, its qualification authority and
 *  its release ledger (all keyed by the old id) stay immutable and addressable. */
export function pcbDerivedBoardInstanceId(rootBoardId: string, generation: number): string {
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("PS_BOARD_GENERATION_INVALID");
  return `${rootBoardId}@r${generation}`;
}

/** The lineage root and generation encoded in a board id (`board:p` → gen 0; `board:p@r3` → gen 3). */
export function pcbBoardLineageOf(boardId: string): { rootBoardId: string; generation: number } {
  const match = /^(.*)@r(\d{1,6})$/.exec(boardId);
  if (!match) return { rootBoardId: boardId, generation: 0 };
  return { rootBoardId: match[1]!, generation: Number(match[2]) };
}

/** [B16.1C] the durable design id for a project's primary design — the key the
 *  manufacturing authority and release ledger are scoped by. Before B16.1C the
 *  editor restated this formula as an inline literal; there is now one formula. */
export function pcbDesignInstanceId(projectId: string): string {
  return `design:${projectId}`;
}

/** The hierarchy path the physical-binding creator defaults to
 *  (`bindAtomicSelection` → `["root"]`). The read path must match exactly. */
export const PCB_BOARD_HIERARCHY_PATH: readonly string[] = Object.freeze(["root"]);

/** The assembly variant the physical-binding creator defaults to
 *  (`bindAtomicSelection` → `"variant-default"`). */
export const PCB_BOARD_ASSEMBLY_VARIANT_ID = "variant-default";
