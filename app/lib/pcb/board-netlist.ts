/**
 * Derive the source-side PcbNetlist from an authoritative PcbBoard.
 *
 * The board carries the conserved source identity that pcb-sync wrote: each
 * footprint's `pinPadMappings` records the schematic endpoint it materializes,
 * and each net's `endpointKeys` records its canonical membership. RC01 parity
 * recomputes stable net identity from exactly this material, so deriving the
 * netlist here (rather than re-reading browser schematic state) keeps the
 * manufacturing gate server-owned end to end.
 */

import { canonicalEndpointSet } from "./integrity";
import type { PcbNetlist } from "./netlist-bridge";
import type { PcbBoard } from "./types";

export function boardToSourceNetlist(board: PcbBoard): PcbNetlist {
  const components = board.footprints
    .map((footprint) => ({
      id: footprint.syncIdentity?.componentInstanceId ?? footprint.id,
      ref: footprint.ref,
      pins: [...(footprint.pinPadMappings ?? [])]
        .map((mapping) => ({ number: mapping.symbolPinNumber }))
        .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
    }))
    .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));

  const nets = board.nets
    .filter((net) => net.id !== 0)
    .map((net) => {
      const endpointKeys = canonicalEndpointSet(net.endpointKeys ?? []);
      return {
        id: net.id,
        name: net.name,
        endpointKeys,
        nodes: endpointKeys.map((key) => {
          const [componentId, pinNumber] = key.split("::");
          return { componentId: decodeURIComponent(componentId ?? ""), pinNumber: decodeURIComponent(pinNumber ?? "") };
        }),
      };
    })
    .sort((a, b) => a.id - b.id);

  return { components, nets };
}
