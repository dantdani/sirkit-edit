/**
 * [B19-D I5d rows 27b, 27c, 38, 47, 49] What publication and resolution trust about a snapshot.
 *
 *  - row 49: `resolvePermittedPath` read path variables through the prototype (`${constructor}`), resolved a relative path
 *    against the process working directory, and rejected a legitimate `..foo` directory as an escape.
 *  - row 38: a mapping certificate approved one pad claimed by two terminals, an entry that silently reclassified a terminal
 *    as no-connect, and an unmapped terminal of unknown classification; publication trusted the certificate's `state`.
 *  - row 27c: publication trusted the snapshot's `normalizedSearchKey` and accepted an exact MPN with invisible characters.
 *  - row 27b: identity resolution folded compatibility characters (NFKC), so a long-s `ſ` resolved as `S`, and a Cyrillic
 *    letter was reported as a merely incomplete MPN. (Row 27b was missing from the batch table; it lands here.)
 *  - row 47: publication compared a blob's DECLARED hash with the asset, never the blob's bytes.
 */
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db/client", () => ({ getDb: () => { throw new Error("publication validation must not touch the database"); } }));
const served = vi.hoisted(() => ({ snapshot: null as unknown }));
vi.mock("@/app/lib/atomic/server-catalog", () => ({ loadPublishedPortableSnapshot: vi.fn(async () => structuredClone(served.snapshot)) }));

import { IngestSecurityError, resolvePermittedPath } from "../security";
import { buildMappingCertificate } from "../mapping";
import { validatePortableSnapshotForPublication } from "../server-repository";
import { resolveExactIdentity } from "@/app/lib/component-selection/identity";
import type { ManufacturerTerminal } from "../types";
import { footprintAsset, makeFixtureCatalog, packageProof, symbolAsset, TEST_NOW } from "./fixtures";

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof IngestSecurityError ? error.code : `not-ingest:${String(error)}`;
  }
  return undefined;
}

describe("[B19-D I5d row 49] resolvePermittedPath", () => {
  const root = path.resolve("b19-d-library-root");
  const policy = { roots: [root], variables: { LIB: root }, extensions: [".step"] };

  it("a prototype name is not a path variable", () => {
    expect(codeOf(() => resolvePermittedPath("${constructor}/x.step", policy))).toBe("unknown_path_variable");
  });

  it("a relative path is refused instead of resolving against the working directory", () => {
    expect(codeOf(() => resolvePermittedPath("parts/x.step", { ...policy, roots: [process.cwd()] }))).toBe("relative_path");
  });

  it("a directory named '..foo' inside the root is not an escape", () => {
    const inside = path.join(root, "..foo", "x.step");
    expect(resolvePermittedPath(inside, policy)).toBe(inside);
  });

  it("baselines: a variable path inside the root resolves; '..' escapes are refused", () => {
    expect(resolvePermittedPath("${LIB}/a/x.step", policy)).toBe(path.join(root, "a", "x.step"));
    expect(codeOf(() => resolvePermittedPath("${LIB}/../x.step", policy))).toBe("path_escape");
  });
});

describe("[B19-D I5d row 38] a mapping certificate refuses conflicting pin data", () => {
  const terminal = (id: string, published: string, classification: ManufacturerTerminal["classification"] = "electrical"): ManufacturerTerminal =>
    ({ id, publishedIdentifier: published, function: id, classification, evidenceIds: ["evidence_fixture"] });
  const threePin = () => ({
    symbol: symbolAsset("symbolv_three", [{ number: "1", name: "VDD" }, { number: "2", name: "GND" }, { number: "3", name: "OUT" }]),
    footprint: footprintAsset("footprintv_three", [{ number: "1" }, { number: "2" }, { number: "3" }]),
  });

  it("case B: one pad claimed by two terminals is not approved and names the pad", () => {
    const { symbol, footprint } = threePin();
    const certificate = buildMappingCertificate({
      exactPartId: "exact_fixture", symbol, footprint,
      terminals: [terminal("VDD", "1"), terminal("GND", "2"), terminal("OUT", "3")],
      mapping: [
        { manufacturerTerminalId: "VDD", symbolPinNumbers: ["1"], logicalPadNumbers: ["1"], evidenceIds: ["evidence_fixture"] },
        { manufacturerTerminalId: "GND", symbolPinNumbers: ["2"], logicalPadNumbers: ["1", "2"], evidenceIds: ["evidence_fixture"] },
        { manufacturerTerminalId: "OUT", symbolPinNumbers: ["3"], logicalPadNumbers: ["3"], evidenceIds: ["evidence_fixture"] },
      ],
      packageProof: packageProof(footprint.versionId, ["evidence_fixture"], 3),
    });
    expect(certificate.state).not.toBe("approved");
    expect(certificate.ambiguous.join("\n")).toMatch(/pad 1\b/);
  });

  it("case D: an entry that reclassifies an electrical terminal as no-connect is not approved", () => {
    const { symbol, footprint } = threePin();
    const certificate = buildMappingCertificate({
      exactPartId: "exact_fixture", symbol, footprint,
      terminals: [terminal("VDD", "1"), terminal("GND", "2"), terminal("OUT", "3")],
      mapping: [
        { manufacturerTerminalId: "VDD", symbolPinNumbers: ["1"], logicalPadNumbers: ["1"], classification: "nc", evidenceIds: ["evidence_fixture"] },
        { manufacturerTerminalId: "GND", symbolPinNumbers: ["2"], logicalPadNumbers: ["2"], evidenceIds: ["evidence_fixture"] },
        { manufacturerTerminalId: "OUT", symbolPinNumbers: ["3"], logicalPadNumbers: ["3"], evidenceIds: ["evidence_fixture"] },
      ],
      packageProof: packageProof(footprint.versionId, ["evidence_fixture"], 3),
    });
    expect(certificate.state).not.toBe("approved");
  });

  it("case F: an unmapped terminal of unknown classification is not approved", () => {
    const symbol = symbolAsset("symbolv_two", [{ number: "1", name: "VDD" }, { number: "2", name: "GND" }]);
    const footprint = footprintAsset("footprintv_two", [{ number: "1" }, { number: "2" }]);
    const certificate = buildMappingCertificate({
      exactPartId: "exact_fixture", symbol, footprint,
      terminals: [terminal("VDD", "1"), terminal("GND", "2"), terminal("OUT", "3", "unknown")],
      mapping: [
        { manufacturerTerminalId: "VDD", symbolPinNumbers: ["1"], logicalPadNumbers: ["1"], evidenceIds: ["evidence_fixture"] },
        { manufacturerTerminalId: "GND", symbolPinNumbers: ["2"], logicalPadNumbers: ["2"], evidenceIds: ["evidence_fixture"] },
      ],
      packageProof: packageProof(footprint.versionId),
    });
    expect(certificate.state).not.toBe("approved");
  });

  it("baselines: a clean three-terminal map approves; an internally common pair may share a pad", () => {
    const { symbol, footprint } = threePin();
    const clean = buildMappingCertificate({
      exactPartId: "exact_fixture", symbol, footprint,
      terminals: [terminal("VDD", "1"), terminal("GND", "2"), terminal("OUT", "3")],
      mapping: ["1", "2", "3"].map((number, index) => ({ manufacturerTerminalId: ["VDD", "GND", "OUT"][index]!, symbolPinNumbers: [number], logicalPadNumbers: [number], evidenceIds: ["evidence_fixture"] })),
      packageProof: packageProof(footprint.versionId, ["evidence_fixture"], 3),
    });
    expect(clean.state).toBe("approved");
    const shared = buildMappingCertificate({
      exactPartId: "exact_fixture", symbol, footprint,
      terminals: [terminal("GND_A", "1"), terminal("GND_B", "1"), terminal("VDD", "2"), terminal("OUT", "3")],
      mapping: [
        { manufacturerTerminalId: "GND_A", symbolPinNumbers: ["1"], logicalPadNumbers: ["1"], internallyCommonGroup: "gnd", evidenceIds: ["evidence_fixture"] },
        { manufacturerTerminalId: "GND_B", symbolPinNumbers: ["1"], logicalPadNumbers: ["1"], internallyCommonGroup: "gnd", evidenceIds: ["evidence_fixture"] },
        { manufacturerTerminalId: "VDD", symbolPinNumbers: ["2"], logicalPadNumbers: ["2"], evidenceIds: ["evidence_fixture"] },
        { manufacturerTerminalId: "OUT", symbolPinNumbers: ["3"], logicalPadNumbers: ["3"], evidenceIds: ["evidence_fixture"] },
      ],
      packageProof: packageProof(footprint.versionId, ["evidence_fixture"], 3),
    });
    expect(shared.state).toBe("approved");
  });

  it("publication re-verifies the certificate: an entry moved onto another entry's pad is refused", () => {
    const fixture = makeFixtureCatalog();
    const snapshot = structuredClone(fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW));
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).not.toThrow(); // baseline
    snapshot.mapping!.entries[1]!.logicalPadNumbers = [...snapshot.mapping!.entries[0]!.logicalPadNumbers];
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).toThrow(/mapping/);
  });
});

describe("[B19-D I5d row 27c] publication recomputes exact-part identity", () => {
  it("a normalizedSearchKey that is not the exact MPN's is refused", () => {
    const fixture = makeFixtureCatalog();
    const snapshot = structuredClone(fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW));
    snapshot.exactPart!.normalizedSearchKey = "OTHERPART";
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).toThrow(/normalizedSearchKey/);
  });

  it("an exact MPN with an invisible character is refused", () => {
    const fixture = makeFixtureCatalog();
    const snapshot = structuredClone(fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW));
    snapshot.exactPart!.exactMpn = "FX-100\u200B-QFN";
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).toThrow(/invisible|confusable/);
  });
});

describe("[B19-D I5d row 27b] identity resolution does not fold confusable characters", () => {
  const snapshotFor = (mpn: string) => {
    const fixture = makeFixtureCatalog();
    const snapshot = structuredClone(fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW));
    snapshot.exactPart!.exactMpn = mpn;
    snapshot.exactPart!.normalizedSearchKey = mpn.replace(/[^A-Z0-9]/g, "");
    return snapshot;
  };
  const resolve = (mpn: string) => resolveExactIdentity({ manufacturerId: "manufacturer_fixture", mpn, snapshots: [snapshotFor("BAT54S")], now: TEST_NOW.toISOString() });

  it("a long-s spelling is not the exact part", () => {
    expect(resolve("BAT54\u017F").state).not.toBe("exact");
  });

  it("a Cyrillic letter is a conflict, not an incomplete MPN", () => {
    expect(resolve("BAT54\u0421").state).toBe("conflict");
  });

  it("case policy (OD-34): ASCII case folds, so 'bat54s' is the exact part; the published spelling is exact (baselines)", () => {
    expect(resolve("bat54s").state).toBe("exact");
    expect(resolve("BAT54S").state).toBe("exact");
  });
});

describe("[B19-D I5d row 47] publication recomputes blob hashes", () => {
  it("a footprint blob whose bytes changed under the same declared hash is refused", () => {
    const fixture = makeFixtureCatalog();
    const snapshot = structuredClone(fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW));
    const blob = snapshot.assetBlobs.find((item) => item.id === snapshot.footprint!.rawContentObjectId)!;
    blob.content = `${blob.content} (pad "1" smd rect (at 5 5) (size 9 9))`;
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).toThrow(/hash/);
  });

  it("PCB materialization refuses footprint bytes that do not hash to their declared digest (blinker NE555, real KiCad bytes)", async () => {
    const { blinkerCatalog, BLINKER_PART_IDS } = await import("@/app/lib/fixture-runtime/blinker/catalog");
    const { AtomicPcbSyncResourceProvider } = await import("@/app/lib/pcb-sync/providers");
    const catalog = blinkerCatalog();
    const revisionId = catalog.revisionFor(BLINKER_PART_IDS.timer, "NE555")!;
    const snapshot = structuredClone(catalog.snapshots.get(revisionId)!);
    const result = { resolvedBinding: { bindingRevisionId: "binding-1", exactPartIdentity: { atomicPartRevisionId: revisionId }, footprintAsset: { assetVersionId: snapshot.footprint!.versionId, contentDigest: snapshot.footprint!.contentHash }, pinPadMapping: { mappingCertificateId: snapshot.mapping!.id } } };
    const component = { componentInstanceId: "u1", pins: [] };
    const provider = new AtomicPcbSyncResourceProvider();
    served.snapshot = snapshot;
    expect(await provider.materialize(component as never, result as never)).not.toBeNull(); // baseline
    const tampered = structuredClone(snapshot);
    const blob = tampered.assetBlobs.find((item) => item.id === tampered.footprint!.rawContentObjectId)!;
    blob.content = blob.content.replace(/\(size [0-9.]+ [0-9.]+\)/, "(size 9 9)");
    expect(blob.content).not.toBe(snapshot.assetBlobs.find((item) => item.id === snapshot.footprint!.rawContentObjectId)!.content);
    served.snapshot = tampered;
    expect(await provider.materialize(component as never, result as never)).toBeNull();
  });
});
