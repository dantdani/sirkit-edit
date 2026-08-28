/**
 * B06.3 — envelope-exclusive lineage authority, legacy migration, and
 * quarantine atomicity (mandatory tests 1–6, 14–17; 7–13 live in
 * app/lib/project/__tests__/b06-3-mark-sanitization.test.tsx; 18 = the
 * existing B01–B06.2 suites).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import { createEmptyBoard } from "../../pcb/types";
import { createPersistenceEnvelope, InMemoryAtomicProjectStore, validatePersistenceEnvelope, type AtomicProjectStore } from "../persistence";
import { computeProjectRevision } from "../revision";
import { schematicStateDigest, toCanonicalSchematic } from "../schematic-model";
import { envelopeLineage } from "../schematic-projection";
import { buildLineageRecoveryEvidence, renderLineageRecoveryEvidence } from "../schematic-replay-evidence";
import { SchematicEditorSession, type SchematicCanonicalMark } from "../schematic-session";
import type { CanonicalProjectState, EngineeringOperation } from "../types";

const SCOPE = { tenantId: "tenant-b063", projectId: "project-b063", branchId: "main" } as const;
const FOREIGN_LINEAGE = "lin1-feedfacefeedface";

function baseState(): SchematicState {
  return {
    components: [
      { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
      { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
    ],
    kicadComponents: [],
    wires: [],
    netLabels: [],
  };
}

const SET_R1 = (value: string): EngineeringOperation =>
  ({ operationId: `op:r1:${value}`, schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value } });

/** Seed a durable head at sequence 1 and return everything a test needs. */
async function seeded(projectId: string, store = new InMemoryAtomicProjectStore()) {
  const seeder = new SchematicEditorSession({ ...SCOPE, projectId }, { store });
  const stale = baseState();
  await seeder.openForProject(stale, null);
  const edited = await seeder.execute(stale, { commandId: "schematic.set-property", label: "Seed edit", buildOperations: () => [SET_R1("42k")] });
  if (!edited.ok) throw new Error("seed edit rejected");
  const mark = edited.headMark!;
  seeder.dispose();
  const envelope = (await store.load(projectId, "main"))!;
  return { store, stale, edited: edited.state, mark, envelope };
}

/** Wrap a store so preserveEnvelope fails until `heal()` is called. */
function failingQuarantine(inner: InMemoryAtomicProjectStore): { store: AtomicProjectStore; heal: () => void } {
  let fail = true;
  const store: AtomicProjectStore = {
    load: inner.load.bind(inner),
    initialize: inner.initialize.bind(inner),
    commit: inner.commit.bind(inner),
    backup: inner.backup.bind(inner),
    restore: inner.restore.bind(inner),
    preserveEnvelope: async (projectId, branchId, label) => {
      if (fail) throw new Error("QUARANTINE_IO_FAILURE");
      return inner.preserveEnvelope(projectId, branchId, label);
    },
  };
  return { store, heal: () => { fail = false; } };
}

// ─── Lineage authentication (tests 1–4) ──────────────────────────────────────

describe("B06.3 §1 — the envelope is the exclusive lineage authority", () => {
  it("1. THE missed case: a foreign-lineage mark with the EXACT head sequence and digest conflicts — never rebase-local-newer", async () => {
    const { store, envelope, mark } = await seeded("p-foreign-head");
    const foreignMark: SchematicCanonicalMark = { lineageId: FOREIGN_LINEAGE, headSequence: mark.headSequence, canonicalStateDigest: mark.canonicalStateDigest };
    const projection = baseState();
    projection.components[0].value = "999k"; // differing projection content
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-foreign-head" }, { store });
    const outcome = await editor.openForProject(projection, foreignMark);
    expect(outcome.status).toBe("projection-conflict");
    if (outcome.status !== "projection-conflict") throw new Error("unreachable");
    expect(outcome.reason).toBe("foreign-lineage-mark");
    expect(editor.lifecycle).toBe("conflicted");
    // The durable head was not touched and no rebase happened.
    const untouched = await store.load("p-foreign-head", "main");
    expect(untouched?.integrityManifest.envelopeDigest).toBe(envelope.integrityManifest.envelopeDigest);
    expect(editor.events.filter((event) => event.kind === "rebased")).toEqual([]);
  });

  it("2. a foreign-lineage mark naming a REAL older log position still conflicts — never verified-older evidence", async () => {
    const { store, envelope } = await seeded("p-foreign-older");
    const genesisDigest = envelope.transactionLog[0].transaction.baseRevision.canonicalStateDigest;
    const foreignMark: SchematicCanonicalMark = { lineageId: FOREIGN_LINEAGE, headSequence: 0, canonicalStateDigest: genesisDigest };
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-foreign-older" }, { store });
    const outcome = await editor.openForProject(baseState(), foreignMark);
    expect(outcome.status).toBe("projection-conflict");
    if (outcome.status !== "projection-conflict") throw new Error("unreachable");
    expect(outcome.reason).toBe("foreign-lineage-mark");
  });

  it("3+4. projection equal to the head with a foreign mark RESUMES on the envelope lineage; the mark never selects the executor lineage", async () => {
    const { store, envelope, edited, mark } = await seeded("p-foreign-resume");
    const durableLineage = envelopeLineage(envelope);
    expect(durableLineage).toBe(mark.lineageId); // sanity: commit carried it forward
    const foreignMark: SchematicCanonicalMark = { lineageId: FOREIGN_LINEAGE, headSequence: mark.headSequence, canonicalStateDigest: mark.canonicalStateDigest };
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-foreign-resume" }, { store });
    const outcome = await editor.openForProject(edited, foreignMark);
    expect(outcome.status).toBe("resumed");
    expect(editor.lifecycle).toBe("ready");
    // The executor lineage is the ENVELOPE's, never the mark's.
    expect(editor.lineageId).toBe(durableLineage);
    expect(editor.lineageId).not.toBe(FOREIGN_LINEAGE);
    // The discard was recorded, and the next head mark carries the envelope lineage.
    expect(editor.events.some((event) => event.detail.includes("FOREIGN"))).toBe(true);
    expect(editor.headMark()?.lineageId).toBe(durableLineage);
  });
});

// ─── Envelope lineage validation + legacy migration (tests 5–6) ──────────────

describe("B06.3 §2 — envelope lineage validation and migration", () => {
  function canonicalProject(state: SchematicState, projectId: string): CanonicalProjectState {
    return { schemaVersion: "sirkit.engineering.v1", ...SCOPE, projectId, pcb: createEmptyBoard(), schematic: toCanonicalSchematic(state), pinnedAssets: [] };
  }

  it("5. an invalid envelope lineage fails integrity validation (format check + digest binding)", async () => {
    const project = canonicalProject(baseState(), "p-lineage-validate");
    const malformed = createPersistenceEnvelope({ project, revision: computeProjectRevision(project), transactionLog: [], buildId: "b063-test", lineageId: "not-a-lineage" });
    expect(validatePersistenceEnvelope(malformed)).toContain("INVALID_LINEAGE_ID");
    await expect(new InMemoryAtomicProjectStore().restore(malformed)).rejects.toThrow(/INVALID_LINEAGE_ID/);
    // Tampering a VALID lineage breaks the envelope digest.
    const valid = createPersistenceEnvelope({ project, revision: computeProjectRevision(project), transactionLog: [], buildId: "b063-test", lineageId: "lin1-1234567890abcdef" });
    const tampered = structuredClone(valid);
    (tampered as { lineageId?: string }).lineageId = "lin1-feedfacefeedface";
    expect(validatePersistenceEnvelope(tampered)).toContain("ENVELOPE_DIGEST_MISMATCH");
  });

  it("6. legacy envelopes migrate deterministically and DURABLY (quarantined, recorded, stable across reloads); marks are never lineage authority for them", async () => {
    // Build a LEGACY envelope (no lineageId) holding a seeded head.
    const { store, envelope, edited, mark } = await seeded("p-legacy");
    const legacy = createPersistenceEnvelope({
      project: structuredClone(envelope.canonicalSnapshot),
      revision: structuredClone(envelope.snapshotRevision),
      transactionLog: structuredClone(envelope.transactionLog),
      buildId: "legacy-build",
    });
    expect(legacy.lineageId).toBeUndefined();
    await store.restore(legacy);

    // First open with a FOREIGN mark: migration derives the lineage from the
    // envelope's OWN genesis — the mark plays no part. (Deterministic
    // derivation legitimately RECOVERS the original lineage id, since the
    // genesis digest is the same content the original derivation used.)
    const foreignMark: SchematicCanonicalMark = { lineageId: FOREIGN_LINEAGE, headSequence: mark.headSequence, canonicalStateDigest: mark.canonicalStateDigest };
    const first = new SchematicEditorSession({ ...SCOPE, projectId: "p-legacy" }, { store });
    const outcome = await first.openForProject(edited, foreignMark);
    // Projection EQUALS the head → resume on the migrated envelope lineage.
    expect(outcome.status).toBe("resumed");
    const migratedLineage = first.lineageId;
    expect(migratedLineage).not.toBe(FOREIGN_LINEAGE);
    expect(migratedLineage).toBe(mark.lineageId); // recovered the true lineage, mark-independent
    const migratedEnvelope = (await store.load("p-legacy", "main"))!;
    expect(envelopeLineage(migratedEnvelope)).toBe(migratedLineage);
    expect(validatePersistenceEnvelope(migratedEnvelope)).toEqual([]);
    expect(migratedEnvelope.migrationHistory.some((entry) => entry.migrationId === "b06.3-lineage-backfill" && entry.toVersion === migratedLineage)).toBe(true);
    const quarantinedAfterMigration = store.quarantined("p-legacy", "main").length;
    expect(quarantinedAfterMigration).toBeGreaterThanOrEqual(1);
    first.dispose();

    // Second open: the SAME migrated lineage resumes, with no re-migration.
    const second = new SchematicEditorSession({ ...SCOPE, projectId: "p-legacy" }, { store });
    const again = await second.openForProject(edited, second.headMark() ?? null);
    expect(again.status).toBe("resumed");
    expect(second.lineageId).toBe(migratedLineage);
    expect(store.quarantined("p-legacy", "main").length).toBe(quarantinedAfterMigration);
  });
});

// ─── Quarantine atomicity (tests 14–17) ──────────────────────────────────────

describe("B06.3 §3 — quarantine must succeed before any overwrite", () => {
  it("14+15. a failed quarantine prevents the overwrite, keeps the conflict actionable, and claims nothing", async () => {
    const inner = new InMemoryAtomicProjectStore();
    const { envelope, mark } = await seeded("p-qfail", inner);
    const { store } = failingQuarantine(inner);
    const projection = baseState();
    projection.components[0].value = "999k";
    const foreignMark: SchematicCanonicalMark = { lineageId: FOREIGN_LINEAGE, headSequence: mark.headSequence, canonicalStateDigest: mark.canonicalStateDigest };
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-qfail" }, { store });
    const conflicted = await editor.openForProject(projection, foreignMark);
    expect(conflicted.status).toBe("projection-conflict");

    const keepLocal = await editor.resolveConflictKeepLocal(projection);
    expect(keepLocal.status).toBe("projection-conflict");
    if (keepLocal.status !== "projection-conflict") throw new Error("unreachable");
    expect(keepLocal.reason).toBe("quarantine-failed");
    expect(keepLocal.detail).toContain("NOT applied");
    // Primary untouched; still conflicted; no quarantine entry claimed.
    expect((await inner.load("p-qfail", "main"))?.integrityManifest.envelopeDigest).toBe(envelope.integrityManifest.envelopeDigest);
    expect(editor.lifecycle).toBe("conflicted");
    expect(inner.quarantined("p-qfail", "main")).toEqual([]);
    // Another recovery choice remains available (adopt canonical works —
    // resuming replaces nothing, so no quarantine is needed).
    const adopt = await editor.resolveConflictAdoptCanonical();
    expect(adopt.status).toBe("recovered-canonical");
  });

  it("16+17. after healing, retry succeeds: quarantine happens BEFORE replacement and preserves the exact prior head", async () => {
    const inner = new InMemoryAtomicProjectStore();
    const { envelope, mark } = await seeded("p-qretry", inner);
    const { store, heal } = failingQuarantine(inner);
    const projection = baseState();
    projection.components[0].value = "999k";
    const foreignMark: SchematicCanonicalMark = { lineageId: FOREIGN_LINEAGE, headSequence: mark.headSequence, canonicalStateDigest: mark.canonicalStateDigest };
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-qretry" }, { store });
    await editor.openForProject(projection, foreignMark);
    const failed = await editor.resolveConflictKeepLocal(projection);
    expect(failed.status).toBe("projection-conflict");
    expect(editor.lifecycle).toBe("conflicted");

    heal();
    const retried = await editor.resolveConflictKeepLocal(projection);
    expect(retried.status).toBe("rebased-local-newer");
    expect(editor.lifecycle).toBe("ready");
    // The quarantine holds the EXACT prior head, and the primary now holds
    // the fresh lineage from the kept projection.
    const quarantined = inner.quarantined("p-qretry", "main");
    expect(quarantined.map((entry) => entry.integrityManifest.envelopeDigest)).toContain(envelope.integrityManifest.envelopeDigest);
    const replaced = (await inner.load("p-qretry", "main"))!;
    expect(replaced.snapshotRevision.headSequence).toBe(0);
    expect(schematicStateDigest(projection)).toBe(schematicStateDigest({ components: (replaced.canonicalSnapshot.schematic as { components: SchematicState["components"] }).components, wires: [], kicadComponents: [], netLabels: [] }));
  });

  it("a session with a store lacking preserveEnvelope refuses to overwrite an existing envelope", async () => {
    const inner = new InMemoryAtomicProjectStore();
    const { mark } = await seeded("p-nopreserve", inner);
    const bare: AtomicProjectStore = {
      load: inner.load.bind(inner),
      initialize: inner.initialize.bind(inner),
      commit: inner.commit.bind(inner),
      backup: inner.backup.bind(inner),
      restore: inner.restore.bind(inner),
      // no preserveEnvelope
    };
    const projection = baseState();
    projection.components[0].value = "999k";
    const foreignMark: SchematicCanonicalMark = { lineageId: FOREIGN_LINEAGE, headSequence: mark.headSequence, canonicalStateDigest: mark.canonicalStateDigest };
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-nopreserve" }, { store: bare });
    await editor.openForProject(projection, foreignMark);
    const refused = await editor.resolveConflictKeepLocal(projection);
    expect(refused.status).toBe("projection-conflict");
    expect(editor.lifecycle).toBe("conflicted");
  });
});

// ─── Evidence pinning ────────────────────────────────────────────────────────

describe("B06.3 §4 — evidence matches the implementation", () => {
  it("lineage-recovery-fixtures.json is exactly what the decision table and mark-patch contract produce today", () => {
    const committedPath = resolve(process.cwd(), "artifacts/ai-control-plane-b06-3/lineage-recovery-fixtures.json");
    expect(existsSync(committedPath), "run: npx tsx scripts/generate-b06-schematic-artifacts.ts").toBe(true);
    expect(readFileSync(committedPath, "utf8").replaceAll("\r\n", "\n")).toBe(renderLineageRecoveryEvidence());
    const evidence = buildLineageRecoveryEvidence();
    const byId = new Map(evidence.scenarios.map((scenario) => [scenario.scenarioId, scenario.decision]));
    expect(byId.get("conflict-foreign-mark-head-exact")).toEqual({ action: "conflict", reason: "foreign-lineage-mark", markStatus: "foreign-discarded" });
    expect(byId.get("conflict-foreign-mark-older-verified-position")?.action).toBe("conflict");
    expect(byId.get("resume-discards-foreign-mark")).toEqual({ action: "resume", markStatus: "foreign-discarded" });
    expect(byId.get("recover-when-lineage-unverifiable")?.action).toBe("recover-canonical");
    const persistence = new Map(evidence.markPersistence.map((entry) => [entry.lifecycle, entry.result]));
    expect(persistence.get("ready")).toBe("saves-mark");
    expect(persistence.get("hydrating")).toBe("clears-mark");
    expect(persistence.get("conflicted")).toBe("clears-mark");
    expect(persistence.get("unavailable")).toBe("clears-mark");
    expect(persistence.get("unopened")).toBe("untouched");
  });
});
