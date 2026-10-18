/**
 * [PR-M, 2026-10-18] Section M2 (the fixture-runtime half of M2.4/M2.5): the publication review's catalog dependencies under the
 * FIXTURE runtime - its committed catalog lives in the fixture container (no database), so the two-person publication of an acquired
 * part writes there:
 *
 *  - `publish` runs the SAME `validatePortableSnapshotForPublication` the database transaction runs first (identity re-derivation, the
 *    two different humans, every blob re-hashed and re-parsed, confidential blobs refused, the mapping re-verified), then records the
 *    snapshot and writes the links into the container's catalog parts - never repointing a value, never a link without footprint and
 *    mapping - and, when asked, ONE discovery part (`discoveryPartOf`, the database path's projection);
 *  - the link targets, the authoring identity (a fresh catalog: none) and the offer cache (empty: no distributor in the fixture) are the
 *    container's.
 * Reachable only when `fixtureRuntimeEnabled()` (the container throws otherwise). Withdrawal is not supported here (it refuses).
 */
import { createHash } from "node:crypto";
import { validatePortableSnapshotForPublication, discoveryPartOf, DISCOVERY_LIBRARY_PREFIX } from "../atomic/server-repository";
import { canonicalExactMpn } from "../atomic/identity";
import { normalizeValueKey } from "../atomic/value-key";
import type { AtomicPublicationDeps, AtomicLinkTarget } from "../atomic/publication-review";
import { categorizeLib } from "../kicad/categories";
import type { CachedPart } from "../parts-cache";
import { fixtureContainer } from "./container";

const sameMpn = (a: string, b: string | null): boolean => { try { return b !== null && canonicalExactMpn(a) === canonicalExactMpn(b); } catch { return false; } };
/** A deterministic, UUID-shaped id for a discovery part (the fixture catalog's ids are stable names). */
function discoveryId(revisionId: string): string {
  const hex = createHash("sha256").update(`fixture-discovery:${revisionId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function fixturePublicationCatalogDeps(): Pick<AtomicPublicationDeps, "loadObservations" | "loadIdentity" | "loadLinkTargets" | "publish" | "withdraw"> {
  return {
    loadObservations: async () => [],
    loadIdentity: async () => ({ manufacturerId: null, exactPartId: null, logicalPartId: null, latestRevision: 0 }),
    loadLinkTargets: async (partIds) => {
      const parts = fixtureContainer().catalog.cachedParts;
      const out = new Map<string, AtomicLinkTarget>();
      for (const id of partIds) {
        const part = parts.get(id);
        if (part) out.set(id, { partId: id, mpn: part.mpn, library: part.libraryName, name: part.name, linkedValueKeys: Object.keys(part.atomicAssignments ?? {}).sort() });
      }
      return out;
    },
    publish: async (input) => {
      validatePortableSnapshotForPublication(input.snapshot, input.requiredProfile, { actorId: input.actorId, actorRole: input.actorRole });
      if (typeof input.reason !== "string" || !input.reason.trim()) throw new Error("Publication reason is required");
      const catalog = fixtureContainer().catalog;
      const { snapshot } = input;
      const revisionId = snapshot.atomicRevision.id;
      const auditId = `audit_fixture_${revisionId.slice(-24)}`;
      if (catalog.snapshots.has(revisionId)) return { revisionId, auditId }; // an identical re-publish: the original stands
      const footprint = snapshot.footprint, mapping = snapshot.mapping;
      const assignment = footprint && mapping ? { revisionId, symbolVersionId: snapshot.symbol.versionId, footprintVersionId: footprint.versionId, mappingCertificateId: mapping.id, footprintFullName: `${footprint.origin.libraryNickname}:${footprint.footprintName}`, approved: true } : null;
      const writes: Array<[string, CachedPart]> = [];
      for (const link of input.links) {
        if (!assignment) throw new Error("Atomic part links require a published footprint and mapping certificate");
        const part = catalog.cachedParts.get(link.partId);
        if (!part) throw new Error(`Atomic part link names no catalog part ${link.partId}`);
        if (part.mpn && part.mpn.trim() !== "" && !sameMpn(part.mpn, snapshot.exactPart?.exactMpn ?? null)) throw new Error("a link must name the exact part");
        const key = normalizeValueKey(link.valueKey);
        if (Object.hasOwn(part.atomicAssignments ?? {}, key)) throw new Error("a publication never repoints a link");
        writes.push([part.id, { ...part, atomicAssignments: { ...(part.atomicAssignments ?? {}), [key]: assignment } as CachedPart["atomicAssignments"] }]);
      }
      if (input.discovery) {
        const discovery = discoveryPartOf(snapshot);
        if (!discovery || !assignment) throw new Error("A discovery row needs a published symbol, footprint and mapping certificate");
        const id = discoveryId(revisionId);
        writes.push([id, { id, name: discovery.name, description: discovery.description, mpn: discovery.mpn, manufacturer: discovery.manufacturer, datasheet: discovery.datasheet, footprintHint: discovery.footprintHint, mainCategory: categorizeLib(discovery.sourceLibrary), libraryName: `${DISCOVERY_LIBRARY_PREFIX}${discovery.sourceLibrary}`, pins: discovery.pins, symbolRaw: discovery.symbolRaw, properties: discovery.properties, atomicAssignments: { [input.discovery.valueKey]: assignment } as CachedPart["atomicAssignments"] }]);
      }
      catalog.snapshots.set(revisionId, structuredClone(snapshot));
      for (const [id, part] of writes) catalog.cachedParts.set(id, part);
      return { revisionId, auditId };
    },
    withdraw: async () => { throw new Error("Withdrawal is not supported by the fixture runtime's catalog"); },
  };
}
