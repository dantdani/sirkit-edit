/**
 * [B18-E E16] The fixture runtime's COMPONENT-AUTHORITY seams.
 *
 * Every other durable seam has had a fixture branch since B16-C — the binding repository, the atomic catalog, the durable
 * workflow store, the router. Two did not: `/api/chat`'s component-authority source and its replacement pin-facts source
 * are both gated on `DATABASE_URL`, which the fixture launchers deliberately blank. So in every browser run the component
 * authority resource was never sealed, and BOTH `sirkit.component-authority.inspect` and
 * `sirkit.schematic.propose-component-replacement` were withheld from the model with
 * "required resource(s) component-authority-records cannot be supplied for this run" — scenario 4 could not be reached in
 * the real application at all.
 *
 * These are not new facts. They are the SAME server-owned reads production performs, over the stores the fixture runtime
 * already fills: the in-memory physical-binding repository the component-review flow commits into, and the committed
 * blinker catalog's published atomic snapshots. Nothing here invents a binding, a part, an approval or a certificate: a
 * component with no durable binding still resolves to no authority, and an unapproved mapping still yields no facts.
 *
 * Reachable ONLY under `fixtureRuntimeEnabled()` (non-production runtime, local_dev auth); every accessor throws
 * otherwise, and the resolvers that call them check the same gate first.
 */
import type { KicadPin, KicadPinType } from "@/app/lib/kicad/types";
import type { AtomicPartRevision, MappingCertificate, PortableAtomicSnapshot, SymbolAssetVersion } from "@/app/lib/atomic/types";
import { loadPublishedPortableSnapshot } from "@/app/lib/atomic/server-catalog";
import { PostgresPhysicalBindingRepository } from "@/app/lib/physical-binding/server-repository";
import type { AtomicRevisionConfirmation, ComponentAuthoritySourceDeps } from "@/app/lib/engineering/component-authority-source";
import type { PublishedSymbolPinFacts } from "@/app/lib/engineering/replacement-pin-facts";
import { fixtureRuntimeEnabled } from "../mode";

const KICAD_PIN_TYPES: ReadonlySet<string> = new Set([
  "input", "output", "bidirectional", "tri_state", "passive", "free", "unspecified",
  "power_in", "power_out", "open_collector", "open_emitter", "no_connect",
]);

/** The published symbol pin in the planner's shape — the same projection the production SQL adapter performs. */
function toKicadPin(pin: SymbolAssetVersion["pins"][number]): KicadPin {
  return {
    number: pin.number,
    name: pin.name,
    type: (KICAD_PIN_TYPES.has(pin.electricalType) ? pin.electricalType : "unspecified") as KicadPinType,
    position: { x: pin.position.x, y: pin.position.y },
    orientation: pin.orientation,
    length: pin.length,
    ...(pin.unit !== undefined ? { unit: pin.unit } : {}),
    ...(pin.bodyStyle !== undefined ? { bodyStyle: pin.bodyStyle } : {}),
    ...(pin.hidden ? { hidden: true } : {}),
    ...(pin.stacked ? { stacked: true } : {}),
  };
}

/** The primary CAD bundle of a published revision, as production picks it. */
function primaryBundle(revision: AtomicPartRevision): AtomicPartRevision["cadBundles"][number] | undefined {
  return revision.cadBundles.find((bundle) => bundle.disposition === "primary_approved") ?? revision.cadBundles[0];
}

/** The snapshot's APPROVED mapping certificate for its primary bundle, or undefined — an unapproved one is never used. */
function approvedMapping(snapshot: PortableAtomicSnapshot): MappingCertificate | undefined {
  const bundle = primaryBundle(snapshot.atomicRevision);
  const mapping = snapshot.mapping;
  if (!bundle || !mapping) return undefined;
  if (bundle.mappingCertificateId && mapping.id !== bundle.mappingCertificateId) return undefined;
  return mapping.state === "approved" ? mapping : undefined;
}

function assertFixture(): void {
  if (!fixtureRuntimeEnabled()) throw new Error("FIXTURE_RUNTIME_DISABLED");
}

/**
 * The fixture component-authority source: durable bindings from the in-memory repository the review flow commits into,
 * and atomic confirmation from the committed catalog's published snapshots. Identical in shape to production's; the only
 * difference is where the rows live.
 */
export function fixtureComponentAuthoritySource(): ComponentAuthoritySourceDeps {
  assertFixture();
  const repository = new PostgresPhysicalBindingRepository(); // its own constructor returns the fixture store
  return {
    bindings: {
      loadForComponent: async (scope) => repository.findForComponentVariant({
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        branchId: scope.branchId,
        boardInstanceId: scope.boardInstanceId,
        componentInstanceId: scope.componentInstanceId,
        hierarchyPath: [...scope.hierarchyPath],
        assemblyVariantId: scope.assemblyVariantId,
      }),
    },
    atomic: async (atomicPartRevisionId): Promise<AtomicRevisionConfirmation | null> => {
      const snapshot = await loadPublishedPortableSnapshot(atomicPartRevisionId);
      if (!snapshot || snapshot.atomicRevision.id !== atomicPartRevisionId) return null;
      const mapping = approvedMapping(snapshot);
      if (!snapshot.exactPart || !snapshot.footprint || !mapping) return null;
      return {
        atomicPartRevisionId: snapshot.atomicRevision.id,
        published: true,
        exactMpn: snapshot.exactPart.exactMpn,
        manufacturerId: snapshot.exactPart.manufacturerId,
        symbolAssetVersionId: snapshot.symbol.versionId,
        footprintAssetVersionId: snapshot.footprint.versionId,
        mappingCertificateId: mapping.id,
      };
    },
  };
}

/** The fixture published-pin-facts source — the same bounded projection production reads out of the database. */
export function fixtureReplacementPinFactsSource(): { loadPinFacts(atomicPartRevisionId: string): Promise<PublishedSymbolPinFacts | null> } {
  assertFixture();
  return {
    loadPinFacts: async (atomicPartRevisionId) => {
      const snapshot = await loadPublishedPortableSnapshot(atomicPartRevisionId);
      if (!snapshot || snapshot.atomicRevision.id !== atomicPartRevisionId) return null;
      const mapping = approvedMapping(snapshot);
      const symbol = snapshot.symbol;
      if (!mapping || !symbol || !Array.isArray(symbol.pins) || symbol.pins.length === 0) return null;
      if (mapping.symbolVersionId !== symbol.versionId) return null;
      return {
        atomicPartRevisionId: snapshot.atomicRevision.id,
        symbolAssetVersionId: symbol.versionId,
        pins: symbol.pins.map(toKicadPin),
        certificate: {
          id: mapping.id,
          symbolVersionId: mapping.symbolVersionId,
          footprintVersionId: mapping.footprintVersionId,
          symbolPinIds: [...mapping.symbolPinIds],
          missingTerminalIds: [...mapping.missingTerminalIds],
          missingSymbolPinIds: [...mapping.missingSymbolPinIds],
          missingPadNumbers: [...mapping.missingPadNumbers],
          ambiguous: [...mapping.ambiguous],
          state: "approved",
        },
        symbolPinIds: symbol.pins.map((pin) => pin.id),
      };
    },
  };
}
