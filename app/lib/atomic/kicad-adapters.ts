import type { AtomicPartRevision, PortableAtomicSnapshot } from "./types";
import type { CachedPart } from "@/app/lib/parts-cache";
import type { PinPadMappingContract } from "@/app/lib/pcb/pin-pad-mapping";

export interface KicadAtomicPartView {
  id: string;
  name: string;
  symbolLibrary: string;
  symbolName: string;
  footprintLibrary: string | null;
  footprintName: string | null;
  fields: Record<string, string>;
  assetHashes: Record<string, string>;
  licenseIds: string[];
}

export interface KicadHttpPart {
  id: string;
  name: string;
  symbolIdStr: string;
  description: string;
  keywords: string;
  exclude_from_bom: "False";
  exclude_from_board: "False";
  exclude_from_sim: "False";
  footprint_filters: string[];
  fields: Record<string, { value: string; visible?: "True" | "False" }>;
}

/** Common exact field mapping used by both KiCad database and HTTP views. */
export function toKicadAtomicPart(snapshot: PortableAtomicSnapshot): KicadAtomicPartView {
  const revision = snapshot.atomicRevision;
  if (revision.publicationState !== "published") throw new Error("Only published atomic revisions are visible to KiCad adapters");
  const name = snapshot.exactPart?.exactMpn ?? snapshot.genericDevice?.name;
  if (!name) throw new Error("Atomic snapshot has no display identity");
  if (snapshot.footprint && (!snapshot.mapping || snapshot.mapping.state !== "approved")) {
    throw new Error("Footprint cannot be exposed without an approved exact mapping certificate");
  }
  return {
    id: revision.id,
    name,
    symbolLibrary: snapshot.symbol.origin.libraryNickname,
    symbolName: snapshot.symbol.symbolName,
    footprintLibrary: snapshot.footprint?.origin.libraryNickname ?? null,
    footprintName: snapshot.footprint?.footprintName ?? null,
    fields: {
      Value: name,
      Manufacturer: snapshot.manufacturer?.canonicalName ?? "",
      MPN: snapshot.exactPart?.exactMpn ?? "",
      Footprint: snapshot.footprint ? `${snapshot.footprint.origin.libraryNickname}:${snapshot.footprint.footprintName}` : "",
      SirkitAtomicRevision: revision.id,
      SirkitSymbolVersion: snapshot.symbol.versionId,
      SirkitFootprintVersion: snapshot.footprint?.versionId ?? "",
      SirkitMappingCertificate: snapshot.mapping?.id ?? "",
    },
    assetHashes: {
      symbol: snapshot.symbol.contentHash,
      ...(snapshot.footprint ? { footprint: snapshot.footprint.contentHash } : {}),
      ...Object.fromEntries(snapshot.models.map((model, index) => [`model${index}`, model.contentHash])),
    },
    licenseIds: [...revision.licenseIds].sort(),
  };
}

/** KiCad's official HTTP-library response shape (all scalar values are strings). */
export function toKicadHttpPart(snapshot: PortableAtomicSnapshot): KicadHttpPart {
  const view = toKicadAtomicPart(snapshot);
  const footprint = view.fields.Footprint;
  return {
    id: view.id,
    name: view.name,
    symbolIdStr: `${view.symbolLibrary}:${view.symbolName}`,
    description: snapshot.genericDevice?.description ?? "Sirkit evidence-backed atomic component revision",
    keywords: snapshot.exactPart ? "exact manufacturer part atomic" : "generic device atomic",
    exclude_from_bom: "False",
    exclude_from_board: "False",
    exclude_from_sim: "False",
    footprint_filters: footprint ? [footprint] : [],
    fields: {
      value: { value: view.name },
      reference: { value: snapshot.symbol.properties.Reference ?? "U" },
      footprint: { value: footprint, visible: "False" },
      Manufacturer: { value: view.fields.Manufacturer, visible: "False" },
      MPN: { value: view.fields.MPN, visible: "False" },
      SirkitAtomicRevision: { value: view.fields.SirkitAtomicRevision, visible: "False" },
      SirkitSymbolVersion: { value: view.fields.SirkitSymbolVersion, visible: "False" },
      SirkitFootprintVersion: { value: view.fields.SirkitFootprintVersion, visible: "False" },
      SirkitMappingCertificate: { value: view.fields.SirkitMappingCertificate, visible: "False" },
    },
  };
}

/** Bridge an exact portable snapshot into existing renderer/exporter consumers. */
export function atomicSnapshotToCachedPart(snapshot: PortableAtomicSnapshot): CachedPart {
  const revision = snapshot.atomicRevision;
  const mapping = snapshot.mapping;
  const footprint = snapshot.footprint;
  const footprintFullName = footprint ? `${footprint.origin.libraryNickname}:${footprint.footprintName}` : null;
  const explicitMappings: NonNullable<PinPadMappingContract["mappings"]> = [];
  const mappedPinNumbers = new Set<string>();
  if (mapping?.state === "approved") {
    for (const entry of mapping.entries) {
      for (const pinId of entry.symbolPinIds) {
        const pin = snapshot.symbol.pins.find((item) => item.id === pinId);
        if (!pin || mappedPinNumbers.has(pin.number)) continue;
        mappedPinNumbers.add(pin.number);
        const mappingKind = entry.classification === "exposed_thermal"
          ? "exposed-pad" as const
          : entry.classification === "nc" || entry.classification === "dnc" || entry.classification === "nu"
            ? "intentional-no-connect" as const
            : entry.internallyCommonGroup ? "internally-common" as const : "electrical" as const;
        explicitMappings.push({ symbolPinNumber: pin.number, padNumbers: entry.logicalPadNumbers, mappingKind, provenance: "library-explicit" });
      }
    }
  }
  const pinPadMapping: PinPadMappingContract | undefined = mapping?.state === "approved"
    ? { mappings: explicitMappings }
    : undefined;
  return {
    id: revision.id,
    name: snapshot.exactPart?.exactMpn ?? snapshot.genericDevice?.name ?? revision.logicalPartId,
    description: snapshot.genericDevice?.description ?? null,
    mpn: snapshot.exactPart?.exactMpn ?? null,
    manufacturer: snapshot.manufacturer?.canonicalName ?? null,
    datasheet: null,
    footprintHint: mapping?.state === "approved" ? footprintFullName : null,
    mainCategory: snapshot.genericDevice?.category ?? snapshot.family?.publishedName ?? "Atomic component",
    libraryName: snapshot.symbol.origin.libraryNickname,
    pins: snapshot.symbol.pins.map((pin) => ({
      number: pin.number,
      name: pin.name,
      type: pin.electricalType as CachedPart["pins"][number]["type"],
      position: pin.position,
      orientation: pin.orientation,
      length: pin.length,
      unit: pin.unit,
      bodyStyle: pin.bodyStyle,
      hidden: pin.hidden,
      stacked: pin.stacked,
    })),
    symbolRaw: snapshot.symbol.rawSymbolSExpression,
    properties: snapshot.symbol.properties,
    pinPadMapping,
    atomicAssignment: mapping?.state === "approved" && footprint
      ? {
          revisionId: revision.id,
          symbolVersionId: snapshot.symbol.versionId,
          footprintVersionId: footprint.versionId,
          mappingCertificateId: mapping.id,
          footprintFullName: footprintFullName!,
          approved: true,
        }
      : undefined,
  };
}

export function paginateKicadAtomicParts(
  snapshots: PortableAtomicSnapshot[],
  input: { after?: string; limit: number },
): { items: KicadAtomicPartView[]; nextCursor: string | null } {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
  const sorted = snapshots.map(toKicadAtomicPart).sort((a, b) => a.id.localeCompare(b.id));
  const eligible = input.after ? sorted.filter((item) => item.id > input.after!) : sorted;
  const items = eligible.slice(0, limit);
  return { items, nextCursor: eligible.length > limit ? items[items.length - 1]?.id ?? null : null };
}

export interface AtomicProjectExportManifest {
  schemaVersion: 1;
  generator: "sirkit";
  revisionIds: string[];
  assets: Array<{ kind: "symbol" | "footprint" | "model"; versionId: string; contentHash: string; rawContentObjectId: string; licenseId: string; bytes: number }>;
}

/** Exact export manifest; actual raw bytes are retrieved by content object ID. */
export function buildAtomicProjectExportManifest(snapshots: PortableAtomicSnapshot[]): AtomicProjectExportManifest {
  const assets = new Map<string, AtomicProjectExportManifest["assets"][number]>();
  for (const snapshot of snapshots) {
    const all = [snapshot.symbol, ...(snapshot.footprint ? [snapshot.footprint] : []), ...snapshot.models];
    for (const asset of all) {
      const blob = snapshot.assetBlobs.find((item) => item.id === asset.rawContentObjectId);
      if (!blob || blob.contentHash !== asset.contentHash) throw new Error(`Portable export is missing exact bytes for ${asset.versionId}`);
      assets.set(asset.versionId, {
        kind: asset.kind,
        versionId: asset.versionId,
        contentHash: asset.contentHash,
        rawContentObjectId: asset.rawContentObjectId,
        licenseId: asset.origin.licenseId,
        bytes: blob.bytes,
      });
    }
  }
  return {
    schemaVersion: 1,
    generator: "sirkit",
    revisionIds: [...new Set(snapshots.map((snapshot) => snapshot.atomicRevision.id))].sort(),
    assets: [...assets.values()].sort((a, b) => a.versionId.localeCompare(b.versionId)),
  };
}

export interface KicadDatabaseLibraryConfig {
  readonly: true;
  table: "atomic_part_revisions";
  keyColumn: "id";
  visibilityPredicate: "publication_state = 'published'";
  fields: Record<string, string>;
}

export function kicadDatabaseLibraryConfig(): KicadDatabaseLibraryConfig {
  return {
    readonly: true,
    table: "atomic_part_revisions",
    keyColumn: "id",
    visibilityPredicate: "publication_state = 'published'",
    fields: {
      Value: "revision_data.identity.displayName",
      Footprint: "revision_data.primaryCadBundle.footprintFullName",
      SirkitAtomicRevision: "id",
      SirkitSemanticHash: "semantic_hash",
    },
  };
}

export function revisionAssetIds(revision: AtomicPartRevision): string[] {
  return revision.cadBundles.flatMap((bundle) => [bundle.symbolVersionId, ...(bundle.footprintVersionId ? [bundle.footprintVersionId] : []), ...bundle.modelVersionIds]).sort();
}
