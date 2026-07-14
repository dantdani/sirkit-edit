/** Shared inspector helpers (PCB Stage 17 Phase B). */

import type { PcbBoard } from "@/app/lib/pcb/types";

/** Net display name — never a bare id unless the net is unnamed. */
export function netLabel(board: PcbBoard, netId: number): string {
  if (netId === 0) return "unconnected";
  const net = board.nets.find((n) => n.id === netId);
  return net && net.name !== "" ? net.name : `net ${netId}`;
}

/** Shared display text across a multi-selection: value or '—' when mixed. */
export function sharedText(values: string[]): string {
  if (values.length === 0) return "—";
  return values.every((v) => v === values[0]) ? values[0] : "—";
}
