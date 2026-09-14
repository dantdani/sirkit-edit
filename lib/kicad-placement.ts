/**
 * [B19-E E5 review] One "place a KiCad part" click as a canonical `schematic.add-component` command: the instance at the click,
 * its reference minted against the serialized head the command executes on, and, for "Use published exact revision", the exact
 * identity the Build Library resolved from the part's fresh selectable link (identity only: authority still needs the reviewed
 * physical binding downstream). A plain placement carries no identity. Pure: the page runs `recipe` through its graph command.
 */
import type { KicadComponentInstance, Rotation, SchematicState } from "@/lib/schematic-types";
import type { AdoptedAtomicIdentity } from "@/lib/build-auto-layout";
import { normalizeValueKey } from "@/app/lib/atomic/value-key";

export interface KicadPlacementInput {
  id: string;
  partId: string;
  x: number;
  y: number;
  rotation: Rotation;
  value: string;
  /** the reference for the new instance, given the head's existing instances */
  refDesFor(existing: readonly KicadComponentInstance[]): string;
  /** the adopted exact identity; null for a plain Place */
  exactIdentity: AdoptedAtomicIdentity | null;
}

export function kicadPlacementCommand(input: KicadPlacementInput): { label: string; recipe: (state: SchematicState) => { kicadComponents: KicadComponentInstance[] } } {
  // [B19-E E5 review follow-up] the identity was resolved for one value: a placement of any other value (e.g. "" before the part
  // cache has filled) carries no revision
  const adopted = input.exactIdentity && normalizeValueKey(input.exactIdentity.forValue) === normalizeValueKey(input.value) ? input.exactIdentity : null;
  const identity = adopted
    ? { atomicPartRevisionId: adopted.atomicPartRevisionId, symbolAssetVersionId: adopted.symbolAssetVersionId, footprintAssetVersionId: adopted.footprintAssetVersionId, mappingCertificateId: adopted.mappingCertificateId }
    : {};
  return {
    label: adopted ? "Placed part (published exact revision)" : "Placed part",
    recipe: (state) => {
      const existing = state.kicadComponents ?? [];
      const instance: KicadComponentInstance = { id: input.id, partId: input.partId, x: input.x, y: input.y, rotation: input.rotation, refDes: input.refDesFor(existing), value: input.value, ...identity };
      return { kicadComponents: [...existing, instance] };
    },
  };
}
