/**
 * [B16-A F4] Derive the SOURCE netlist for RC01 parity from the authoritative
 * schematic synchronization snapshot — never from the board under test.
 *
 * Reproduced defect: qualification certified "schematic parity" against
 * `boardToSourceNetlist(board)`, a netlist projected from the routed board
 * itself, so the certificate compared the board with itself and passed by
 * construction; the same board-derived netlist was sealed into the release
 * authority. Parity now reads the snapshot the last committed synchronization
 * plan was applied from (durably stored, digest-bound), so a board that lost
 * a net, gained a footprint, or moved an endpoint FAILS RC01.
 *
 * Only `applicable` components are intended on the board (the synchronization
 * engine materializes exactly those); every snapshot pin is an intended
 * logical endpoint; net endpoint keys use the same canonical encoding the
 * synchronization wrote onto the board (`schematicEndpointKey`), so stable net
 * identity recomputed by parity equals the identity the board carries.
 */

import { canonicalEndpointSet, schematicEndpointKey } from "../pcb/integrity";
import type { PcbNetlist } from "../pcb/netlist-bridge";
import type { PcbSyncAuthoritativeSnapshot } from "./types";

export function snapshotToSourceNetlist(snapshot: Pick<PcbSyncAuthoritativeSnapshot, "components" | "nets">): PcbNetlist {
  const components = snapshot.components
    .filter((component) => component.applicability === "applicable")
    .map((component) => ({
      id: component.componentInstanceId,
      ref: component.referenceDesignator,
      ...(component.value !== undefined ? { value: component.value } : {}),
      pins: [...component.pins].map((pin) => ({ number: pin.number, ...(pin.name !== undefined ? { name: pin.name } : {}) })).sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0)),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const nets = [...snapshot.nets]
    .sort((a, b) => (a.stableNetId < b.stableNetId ? -1 : a.stableNetId > b.stableNetId ? 1 : 0))
    .map((net, index) => {
      const members = [...net.members].sort((a, b) => (a.componentInstanceId < b.componentInstanceId ? -1 : a.componentInstanceId > b.componentInstanceId ? 1 : a.pinNumber < b.pinNumber ? -1 : a.pinNumber > b.pinNumber ? 1 : 0));
      return {
        id: index + 1,
        name: net.displayName,
        endpointKeys: canonicalEndpointSet(members.map((member) => schematicEndpointKey(member.componentInstanceId, member.pinNumber))),
        nodes: members.map((member) => ({ componentId: member.componentInstanceId, pinNumber: member.pinNumber })),
      };
    });

  return { components, nets };
}
