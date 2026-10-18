/**
 * [PR-M, 2026-10-18] Section M2 (design M2.3): the durable object store - deduplicated by bytes inside a scope, versioned by source in
 * its provenance, re-hashed on every read, scoped (a foreign scope, an unknown and a malformed hash are the SAME refusal), and refusing
 * content whose retention or licence the append-only history could not honour.
 */
import { describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { CAD_OBJECT_AGGREGATE, CadObjectStoreError, DurableAcquiredObjectStore, lineEndingsOf } from "@/app/lib/acquisition/cad-object-store";
import { CAD_KICAD_LIBRARY_LICENSE } from "@/app/lib/acquisition/cad-source-registry";
import { sha256 } from "@/app/lib/atomic/stable";
import { SYMBOL_1N4001 } from "./_m2-fixtures";

const SCOPE = { tenantId: "local", projectId: "p-m2-objects", branchId: "main" };
const FOREIGN = { tenantId: "other", projectId: "p-m2-objects", branchId: "main" };
const AT = "2026-10-18T10:00:00.000Z";
const provenance = (sourceId: "fixture-kicad" | "kicad-bundled", locator: string) => ({ sourceId, registryVersion: "1.0.0", locator, ref: "90c39c3880f0062a56b5944d428edc846968d72b", retrievedAt: AT });

async function code(run: () => Promise<unknown>): Promise<string | null> {
  try { await run(); return null; } catch (error) { return error instanceof CadObjectStoreError ? error.code : `unexpected: ${String(error)}`; }
}

describe("[PR-M M2.3] the acquired object store", () => {
  it("stores, re-reads (re-hashed) and deduplicates by bytes; a second source adds provenance, not a copy", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableAcquiredObjectStore(repository);
    const first = await store.put(SCOPE, { text: SYMBOL_1N4001, kind: "symbol", mediaType: "application/x-kicad-symbol", license: CAD_KICAD_LIBRARY_LICENSE, retention: "indefinite", provenance: provenance("fixture-kicad", "https://cad-fixture.sirkit.test/kicad-symbols/Diode.kicad_symdir/1N4001.kicad_sym"), committedAt: AT });
    expect(first.created).toBe(true);
    expect(first.object.sha256).toBe(sha256(SYMBOL_1N4001));
    expect(first.object.provenance[0]!.lineEndings).toBe("lf");
    const again = await store.put(SCOPE, { text: SYMBOL_1N4001, kind: "symbol", mediaType: "application/x-kicad-symbol", license: CAD_KICAD_LIBRARY_LICENSE, retention: "indefinite", provenance: provenance("fixture-kicad", "https://cad-fixture.sirkit.test/kicad-symbols/Diode.kicad_symdir/1N4001.kicad_sym"), committedAt: AT });
    expect(again).toMatchObject({ created: false });
    expect(again.object.provenance).toHaveLength(1);
    const second = await store.put(SCOPE, { text: SYMBOL_1N4001, kind: "symbol", mediaType: "application/x-kicad-symbol", license: CAD_KICAD_LIBRARY_LICENSE, retention: "indefinite", provenance: provenance("kicad-bundled", "data/kicad-symbols/Diode.kicad_symdir/1N4001.kicad_sym"), committedAt: AT });
    expect(second.created).toBe(false);
    expect(second.object.provenance.map((row) => row.sourceId)).toEqual(["fixture-kicad", "kicad-bundled"]);
    const read = await store.get(SCOPE, first.object.sha256);
    expect(read.text).toBe(SYMBOL_1N4001);
    expect((await repository.history({ scope: SCOPE, aggregateType: CAD_OBJECT_AGGREGATE, aggregateKey: `acquired-object:${first.object.sha256}` })).length).toBe(2); // one record for the bytes, one for the added provenance
  });

  it("a foreign scope, an unknown hash and a malformed hash are the same refusal", async () => {
    const store = new DurableAcquiredObjectStore(new InMemoryDurableWorkflowRepository());
    const { object } = await store.put(SCOPE, { text: SYMBOL_1N4001, kind: "symbol", mediaType: "application/x-kicad-symbol", license: CAD_KICAD_LIBRARY_LICENSE, retention: "indefinite", provenance: provenance("fixture-kicad", "https://cad-fixture.sirkit.test/x"), committedAt: AT });
    expect(await code(() => store.get(FOREIGN, object.sha256))).toBe("CAD_OBJECT_NOT_FOUND");
    expect(await code(() => store.get(SCOPE, "0".repeat(64)))).toBe("CAD_OBJECT_NOT_FOUND");
    expect(await code(() => store.get(SCOPE, "../x"))).toBe("CAD_OBJECT_NOT_FOUND");
    expect(await store.has(FOREIGN, object.sha256)).toBe(false);
  });

  it("a stored record whose bytes do not hash to its key is refused on read (CAD_OBJECT_INTEGRITY)", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableAcquiredObjectStore(repository);
    const { object } = await store.put(SCOPE, { text: SYMBOL_1N4001, kind: "symbol", mediaType: "application/x-kicad-symbol", license: CAD_KICAD_LIBRARY_LICENSE, retention: "indefinite", provenance: provenance("fixture-kicad", "https://cad-fixture.sirkit.test/x"), committedAt: AT });
    await repository.commit({ scope: SCOPE, scopeKey: "tamper", idempotencyKey: "tamper-1", operations: [{ aggregateType: CAD_OBJECT_AGGREGATE, aggregateKey: `acquired-object:${object.sha256}`, expectedRevision: 1, payload: { ...object, text: `${SYMBOL_1N4001} ` } }], outbox: [], result: {}, committedAt: AT });
    expect(await code(() => store.get(SCOPE, object.sha256))).toBe("CAD_OBJECT_INTEGRITY");
  });

  it("refuses content whose retention or licence the append-only store cannot honour", async () => {
    const store = new DurableAcquiredObjectStore(new InMemoryDurableWorkflowRepository());
    expect(await code(() => store.put(SCOPE, { text: "x", kind: "datasheet", mediaType: "text/plain", license: CAD_KICAD_LIBRARY_LICENSE, retention: "bounded", provenance: provenance("fixture-kicad", "x"), committedAt: AT }))).toBe("CAD_OBJECT_RETENTION_REFUSED");
    expect(await code(() => store.put(SCOPE, { text: "x", kind: "datasheet", mediaType: "text/plain", license: { ...CAD_KICAD_LIBRARY_LICENSE, id: "license_private", exportDisposition: "private_review_only" }, retention: "indefinite", provenance: provenance("fixture-kicad", "x"), committedAt: AT }))).toBe("CAD_OBJECT_LICENCE_REFUSED");
  });

  it("records the line endings the bytes were stored with", () => {
    expect(lineEndingsOf("a\r\nb\r\n")).toBe("crlf");
    expect(lineEndingsOf("a\nb\n")).toBe("lf");
    expect(lineEndingsOf("a\r\nb\n")).toBe("mixed");
  });
});
