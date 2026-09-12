/**
 * [B18-C review] The ONE fill-normalized semantic board digest — moved
 * verbatim from `editor-adapter.ts` (which re-exports it, so every existing
 * caller keeps its import): the board with zone-fill DERIVED state normalized
 * away. `applyDerived` zone refills change board content without a history
 * entry, and every geometry operation re-marks zone fills dirty inside the
 * canonical kernel, so lineage drift AND "did exactly this change land" are
 * both decided in this domain. Pure: the granted-execution builder, the
 * ritual and the editor session share this single formula.
 */
import type { PcbBoard } from "../pcb/types";
import { engineeringDigest } from "./stable";

export function canonicalLineageDigest(board: PcbBoard): string {
  const normalized = {
    ...board,
    zones: board.zones.map((zone) => ({
      ...zone,
      fill: [],
      dirty: false,
      fillState: undefined,
      fillHash: undefined,
    })),
  };
  return engineeringDigest({ schema: "sirkit.b03-lineage.v1", board: normalized });
}
