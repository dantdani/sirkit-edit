/**
 * [B22-C] Durable, digest-bound evidence (discovery D22-12, D22-13; 9.5 items 23, 24; OD-141..OD-143). One silent durable aggregate,
 * `computation.evidence.v1`, on the durable-workflow substrate, scoped by tenant/project/branch: a validated typed summary, the
 * runtime profile's id and digest, the input bound to the server's SHA-256 of the submitted, validated snapshot ("bound to a
 * submitted snapshot", never authority), the SHA-256 of each raw artifact, the `diagnostic_only` and `environment_dependent` labels,
 * no outbox effect. Its `durableWorkflowDigest` is taken over an explicit encoding in which a non-finite or absent value is a closed
 * state, never a number (CD-10 digests a not-evaluated NaN band as `null`; the substrate refuses a non-finite number). Every append
 * is a compare-and-set on the aggregate revision and idempotent; every load re-verifies the record and document digests. The
 * repository is injected, as the B21 orchestration store's is.
 *
 * Test-first: the store module did not exist on b4c7be7 (every case red); case 1's substrate facts are the pre-edit counterexample.
 * In-memory repository only: no database, no network, no process.
 *
 * [B22-C review] Case 3 adds the alterations only one load check catches each (tests-5); case 8 pins that a run names each model
 * library by the SHA-256 of the text its deck carries, in the manifest and in the evidence (tests-4). Both were green on the reviewed
 * tree, and each was proved by a deliberate source breakage. The job store binds the server-derived scope into the snapshot it hashes
 * (coverage-7; `b22-c-job-store-terminal` case 6).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { durableWorkflowDigest } from "@/app/lib/durable-workflow/stable";
import type { DurableAggregateIdentity, DurableAggregateRecord, DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { collectProductionFiles } from "@/app/lib/project/__tests__/_import-gate-helpers";
import type { ComputationEvidenceDocument } from "@/app/lib/computation/evidence-store";
import { createSimulationProject } from "@/app/lib/spice/project";
import { estimateRunPlan } from "@/app/lib/spice/run-plan";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";
import type { CanonicalSimulationIr, RunRecord } from "@/app/lib/spice/types";

const SCOPE = { tenantId: "tenant-b22c", projectId: "project-b22c", branchId: "main" };
const AT = "2026-10-02T00:00:00.000Z";
const hex = (character: string): string => character.repeat(64);
async function store() {
  return import("@/app/lib/computation/evidence-store");
}
type Evidence = Awaited<ReturnType<typeof store>>;
function document(evidence: Evidence, overrides: Record<string, unknown> = {}): ComputationEvidenceDocument {
  return {
    schema: "sirkit.computation-evidence.v1",
    kind: "spice-run",
    subjectId: "run_b22c",
    labels: ["diagnostic_only", "environment_dependent"],
    authority: "evidence_only",
    input: { binding: "bound to a submitted snapshot", snapshotSha256: hex("1") },
    profile: { profileId: "ngspice-local-diagnostic", profileDigest: hex("2"), installDigest: `sirkit-install-tree-sha256/1:${hex("3")}`, seed: "1" },
    modelLibraries: [{ id: "model-1", contentRef: `artifact://sha256/${hex("8")}` }],
    rawArtifacts: [{ role: "executed-netlist", sha256: hex("4"), bytes: null }, { role: "ngspice-ascii-raw", sha256: hex("5"), bytes: 1024 }],
    summary: {
      scalars: [{ name: "VOUT", unit: "V", status: "pass", value: evidence.encodeEvidenceNumber(2.5) }, { name: "GAIN", unit: "dB", status: "not-evaluated", value: evidence.encodeEvidenceNumber(Number.NaN) }],
      waveforms: [{ name: "v(out)", unit: "V", xName: "time", xUnit: "s", points: 3, valuesSha256: hex("6") }],
    },
    ...overrides,
  } as ComputationEvidenceDocument;
}

describe("[B22-C] the computation evidence aggregate (D22-12, D22-13; OD-141..OD-143)", () => {
  it("1. an explicit encoding: finite, NaN, +Infinity, -Infinity and absent are closed states, so the SHA-256 digest never sees a raw non-finite number (pre-edit: the substrate throws DW_NON_FINITE_NUMBER and JSON writes CD-10's NaN band as null)", async () => {
    expect(() => durableWorkflowDigest({ band: { lower: Number.NaN } })).toThrow("DW_NON_FINITE_NUMBER");
    expect(JSON.stringify({ lower: Number.NaN, upper: Number.POSITIVE_INFINITY })).toBe('{"lower":null,"upper":null}');
    const evidence = await store();
    expect(evidence.encodeEvidenceNumber(1.5)).toEqual({ state: "finite", value: 1.5 });
    expect(evidence.encodeEvidenceNumber(-0)).toEqual({ state: "finite", value: 0 });
    expect(evidence.encodeEvidenceNumber(Number.NaN)).toEqual({ state: "nan" });
    expect(evidence.encodeEvidenceNumber(Number.POSITIVE_INFINITY)).toEqual({ state: "positive_infinity" });
    expect(evidence.encodeEvidenceNumber(Number.NEGATIVE_INFINITY)).toEqual({ state: "negative_infinity" });
    expect(evidence.encodeEvidenceNumber(undefined)).toEqual({ state: "absent" });
    expect(evidence.encodeEvidenceNumber(null)).toEqual({ state: "absent" });
    expect(evidence.encodeEvidenceNumber("1")).toEqual({ state: "absent" });
    // the waveform values' text: one token per value, a closed word for a non-finite one; never "null"
    expect(evidence.evidenceValuesText([0, 1e-3], [Number.NaN, Number.NEGATIVE_INFINITY])).toBe("x:0,0.001;y:nan,-inf");
    expect(evidence.evidenceValuesText([1], [Number.POSITIVE_INFINITY])).not.toContain("null");
    const valid = document(evidence);
    expect(evidence.validateEvidenceDocument(valid)).toEqual([]);
    expect(evidence.evidenceDocumentDigest(valid)).toBe(durableWorkflowDigest(valid));
    expect(evidence.evidenceDocumentDigest(valid)).toMatch(/^dw1-[0-9a-f]{64}$/);
  });

  it("2. append and load: a validated document is written as a compare-and-set on the revision and idempotently; load and history re-verify every digest", async () => {
    const evidence = await store();
    expect(evidence.COMPUTATION_EVIDENCE_AGGREGATE_TYPE).toBe("computation.evidence.v1");
    const repository = new InMemoryDurableWorkflowRepository();
    const evidenceStore = evidence.createComputationEvidenceStore(repository);
    const first = document(evidence);
    const appended = await evidenceStore.append({ scope: SCOPE, evidenceId: "run_b22c", expectedRevision: 0, document: first, at: AT });
    expect(appended).toMatchObject({ ok: true, revision: 1, replayed: false, documentDigest: durableWorkflowDigest(first) });
    // the same append again is a replay, never a second revision
    expect(await evidenceStore.append({ scope: SCOPE, evidenceId: "run_b22c", expectedRevision: 0, document: first, at: AT })).toMatchObject({ ok: true, revision: 1, replayed: true });
    // another document at a stale revision is refused, nothing written
    const second = document(evidence, { subjectId: "run_b22c", rawArtifacts: [{ role: "executed-netlist", sha256: hex("7"), bytes: null }] });
    expect(await evidenceStore.append({ scope: SCOPE, evidenceId: "run_b22c", expectedRevision: 0, document: second, at: AT })).toEqual({ ok: false, code: "stale_revision", currentRevision: 1 });
    expect(await evidenceStore.append({ scope: SCOPE, evidenceId: "run_b22c", expectedRevision: 1, document: second, at: AT })).toMatchObject({ ok: true, revision: 2, replayed: false });
    const loaded = await evidenceStore.load(SCOPE, "run_b22c");
    expect(loaded).toMatchObject({ revision: 2, documentDigest: durableWorkflowDigest(second), at: AT });
    expect(loaded!.document).toEqual(second);
    expect((await evidenceStore.history(SCOPE, "run_b22c")).map((entry) => entry.revision)).toEqual([1, 2]);
    expect(await evidenceStore.load(SCOPE, "run_absent")).toBeNull();
  });

  it("3. digest re-verified on load: a record whose document or record digest was altered at rest is refused with one closed error", async () => {
    const evidence = await store();
    const repository = new InMemoryDurableWorkflowRepository();
    await evidence.createComputationEvidenceStore(repository).append({ scope: SCOPE, evidenceId: "run_b22c", expectedRevision: 0, document: document(evidence), at: AT });
    const altered = (change: (record: DurableAggregateRecord<Record<string, unknown>>) => void): DurableWorkflowRepository => new Proxy(repository, {
      get(target, property, receiver) {
        if (property !== "loadHead" && property !== "history") return Reflect.get(target, property, receiver);
        return async (identity: DurableAggregateIdentity) => {
          const value = property === "loadHead" ? await target.loadHead<Record<string, unknown>>(identity) : await target.history<Record<string, unknown>>(identity);
          for (const record of Array.isArray(value) ? value : value ? [value] : []) change(record);
          return value;
        };
      },
    });
    const editedDocument = altered((record) => { ((record.payload.document as Record<string, unknown>).summary as { scalars: Array<{ value: unknown }> }).scalars[0]!.value = { state: "finite", value: 9 }; });
    await expect(evidence.createComputationEvidenceStore(editedDocument).load(SCOPE, "run_b22c")).rejects.toThrow(/^EVIDENCE_DIGEST_MISMATCH: /);
    await expect(evidence.createComputationEvidenceStore(editedDocument).history(SCOPE, "run_b22c")).rejects.toThrow(/^EVIDENCE_DIGEST_MISMATCH: /);
    const editedDigest = altered((record) => { record.recordDigest = `dw1-${hex("0")}`; });
    await expect(evidence.createComputationEvidenceStore(editedDigest).load(SCOPE, "run_b22c")).rejects.toThrow(/^EVIDENCE_DIGEST_MISMATCH: /);
    const relabelled = altered((record) => { (record.payload.document as Record<string, unknown>).labels = ["validated"]; record.payload.documentDigest = durableWorkflowDigest(record.payload.document); record.recordDigest = durableWorkflowDigest(record.payload); });
    await expect(evidence.createComputationEvidenceStore(relabelled).load(SCOPE, "run_b22c")).rejects.toThrow(/^EVIDENCE_DIGEST_MISMATCH: /);
    // [B22-C review] tests-5: the alterations that only one check catches each. The unaltered record loads, so each refusal below is
    // the alteration's: a document edited to another VALID value with only the record digest recomputed (the stale document digest
    // alone disagrees); a document naming another subject with both digests recomputed; a payload naming another evidence id or
    // another revision with its record digest recomputed
    expect((await evidence.createComputationEvidenceStore(altered(() => undefined)).load(SCOPE, "run_b22c"))?.revision).toBe(1);
    const staleDocumentDigest = altered((record) => { ((record.payload.document as Record<string, unknown>).summary as { scalars: Array<{ value: unknown }> }).scalars[0]!.value = { state: "finite", value: 9 }; record.recordDigest = durableWorkflowDigest(record.payload); });
    const otherSubject = altered((record) => { (record.payload.document as Record<string, unknown>).subjectId = "run_other"; record.payload.documentDigest = durableWorkflowDigest(record.payload.document); record.recordDigest = durableWorkflowDigest(record.payload); });
    const otherEvidenceId = altered((record) => { record.payload.evidenceId = "run_other"; record.recordDigest = durableWorkflowDigest(record.payload); });
    const otherRevision = altered((record) => { record.payload.revision = 7; record.recordDigest = durableWorkflowDigest(record.payload); });
    for (const [label, repositoryAltered] of [["stale document digest", staleDocumentDigest], ["another subject", otherSubject], ["another evidence id", otherEvidenceId], ["another revision", otherRevision]] as const) {
      await expect(evidence.createComputationEvidenceStore(repositoryAltered).load(SCOPE, "run_b22c"), label).rejects.toThrow(/^EVIDENCE_DIGEST_MISMATCH: /);
      await expect(evidence.createComputationEvidenceStore(repositoryAltered).history(SCOPE, "run_b22c"), label).rejects.toThrow(/^EVIDENCE_DIGEST_MISMATCH: /);
    }
  });

  it("4. an unvalidated document is refused before anything is written: a missing or an authority label, a raw number, another binding text, a non-hex digest, an unknown key", async () => {
    const evidence = await store();
    const repository = new InMemoryDurableWorkflowRepository();
    const evidenceStore = evidence.createComputationEvidenceStore(repository);
    const valid = document(evidence);
    const refused: Array<[string, unknown]> = [
      ["one label", { ...valid, labels: ["diagnostic_only"] }],
      ["an authority label", { ...valid, labels: ["diagnostic_only", "environment_dependent", "authoritative"] }],
      ["authority claimed", { ...valid, authority: "authoritative" }],
      ["a raw NaN", { ...valid, summary: { ...valid.summary, scalars: [{ name: "VOUT", unit: "V", status: "pass", value: Number.NaN }] } }],
      ["a raw number", { ...valid, summary: { ...valid.summary, scalars: [{ name: "VOUT", unit: "V", status: "pass", value: 2.5 }] } }],
      ["another binding text", { ...valid, input: { binding: "bound to the schematic", snapshotSha256: hex("1") } }],
      ["a non-hex snapshot digest", { ...valid, input: { binding: "bound to a submitted snapshot", snapshotSha256: "fnv-1234" } }],
      ["a non-hex raw digest", { ...valid, rawArtifacts: [{ role: "ngspice-ascii-raw", sha256: "abc", bytes: 1 }] }],
      ["an unknown key", { ...valid, verdict: "pass" }],
      ["an unknown role", { ...valid, rawArtifacts: [{ role: "gerber", sha256: hex("4"), bytes: 1 }] }],
    ];
    for (const [label, candidate] of refused) {
      expect(evidence.validateEvidenceDocument(candidate).length, label).toBeGreaterThan(0);
      const result = await evidenceStore.append({ scope: SCOPE, evidenceId: "run_b22c", expectedRevision: 0, document: candidate as typeof valid, at: AT });
      expect(result.ok, label).toBe(false);
      expect((result as { code: string }).code, label).toBe("invalid_document");
    }
    expect(await repository.history({ scope: SCOPE, aggregateType: "computation.evidence.v1", aggregateKey: evidence.evidenceAggregateKey(SCOPE, "run_b22c") })).toEqual([]);
  });

  it("5. silent and scoped: no outbox effect is ever written, another branch or project reads nothing, and two evidence ids never share a replay", async () => {
    const evidence = await store();
    const repository = new InMemoryDurableWorkflowRepository();
    const evidenceStore = evidence.createComputationEvidenceStore(repository);
    await evidenceStore.append({ scope: SCOPE, evidenceId: "run_a", expectedRevision: 0, document: document(evidence, { subjectId: "run_a" }), at: AT });
    await evidenceStore.append({ scope: SCOPE, evidenceId: "run_b", expectedRevision: 0, document: document(evidence, { subjectId: "run_b" }), at: AT });
    expect(await repository.listOutbox({})).toEqual([]);
    expect(await evidenceStore.load({ ...SCOPE, branchId: "feature" }, "run_a")).toBeNull();
    expect(await evidenceStore.load({ ...SCOPE, projectId: "other" }, "run_a")).toBeNull();
    expect((await evidenceStore.load(SCOPE, "run_b"))!.document.subjectId).toBe("run_b");
    // a document must name the evidence id it is appended under
    expect(await evidenceStore.append({ scope: SCOPE, evidenceId: "run_c", expectedRevision: 0, document: document(evidence, { subjectId: "run_a" }), at: AT })).toMatchObject({ ok: false, code: "invalid_document" });
    expect(evidence.evidenceScopeKey(SCOPE, "run_a")).not.toBe(evidence.evidenceScopeKey(SCOPE, "run_b"));
  });

  it("6. the input is bound to the server's SHA-256 of the submitted snapshot: key order is irrelevant, any change is another digest, and a non-finite number is encoded, never thrown", async () => {
    const evidence = await store();
    const digest = evidence.submittedSnapshotDigest({ project: { id: "p", revision: 1 }, runPlanId: "plan", parts: [] });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.submittedSnapshotDigest({ runPlanId: "plan", parts: [], project: { revision: 1, id: "p" } })).toBe(digest);
    expect(evidence.submittedSnapshotDigest({ project: { id: "p", revision: 2 }, runPlanId: "plan", parts: [] })).not.toBe(digest);
    expect(evidence.submittedSnapshotDigest({ value: Number.NaN })).not.toBe(evidence.submittedSnapshotDigest({ value: null }));
    expect(evidence.submittedSnapshotDigest({ value: Number.NaN })).toBe(createHash("sha256").update(evidence.canonicalEvidenceText({ value: Number.NaN })).digest("hex"));
    expect(evidence.EVIDENCE_INPUT_BINDING).toBe("bound to a submitted snapshot");
  });

  it("7. the unwired CD-10 tables are not reused: no production module reads or writes them, and the store reaches the substrate only through the injected repository", { timeout: 120_000 }, () => {
    const users = [...collectProductionFiles(process.cwd())].filter(([path, source]) => path !== "app/lib/db/schema.ts" && /\b(simulationRuns|simulationWaveformArtifacts|simulationReadinessReports|simulationCampaigns|modelSimulationProjectStates)\b/.test(source)).map(([path]) => path);
    expect(users).toEqual([]);
    const source = readFileSync(join(process.cwd(), "app/lib/computation/evidence-store.ts"), "utf8");
    const imports = [...source.matchAll(/^import [^;]* from "([^"]+)";/gm)].map((match) => match[1]);
    expect(imports.filter((path) => /durable-workflow\/(runtime|server-repository)|\/db\//.test(path!))).toEqual([]);
    expect(source).not.toMatch(/outbox: \[[^\]]/);
  });

  it("8. [B22-C review] tests-4: a run names each model library by the SHA-256 of the text its deck carries - the manifest's checksum (`emittedModelText`, not `transformedContent ?? originalContent`) and the evidence's content reference", async () => {
    const evidence = await store();
    const { createRunManifest } = await import("@/app/lib/spice/server/manifest");
    const { emittedModelText } = await import("@/app/lib/spice/netlist");
    const project = createSimulationProject(dividerSchematic());
    const test = project.tests[0]!;
    const runPlan = project.runPlans[0]!;
    const runPoint = estimateRunPlan(project, runPlan.id).runPoints[0]!;
    const analysis = test.analyses.find((candidate) => candidate.id === runPoint.analysisId)!;
    const NEWLINE = String.fromCharCode(10);
    // a model whose text ends with blank lines, and one whose transformedContent is "" (the deck emits the original, trimmed)
    const trailing = { id: "model-trailing", originalContent: `.model DT D(Is=1e-14)${NEWLINE}${NEWLINE}`, transformedContent: undefined };
    const blank = { id: "model-blank", originalContent: "  .model DB D(Is=2e-14)  ", transformedContent: "" };
    const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
    const runner = { profileId: "ngspice-local-diagnostic", installDigest: null, labels: ["diagnostic_only", "environment_dependent"], seed: "1", hostAddedEnvironment: [], profileDigest: hex("2") };
    const manifest = createRunManifest({ project, test, runPlan, runPoint, analysis, ir: { models: [trailing, blank] } as unknown as CanonicalSimulationIr, netlist: "* b22-c deck", simulatorVersion: "ngspice-46 (b22-c fake)", runner });
    for (const model of [trailing, blank]) {
      expect(manifest.modelChecksums[model.id], model.id).toBe(sha(emittedModelText(model)));
      expect(manifest.modelChecksums[model.id], model.id).not.toBe(sha(model.transformedContent ?? model.originalContent)); // the inputs tell the two rules apart
    }
    const built = evidence.buildSpiceRunEvidence({ run: { id: "run_b22c", status: "completed", waveforms: [], scalars: [], manifest } as unknown as RunRecord, snapshotSha256: hex("1") });
    expect(built.ok).toBe(true);
    expect(built.ok && built.document.modelLibraries).toEqual([{ id: "model-blank", contentRef: `artifact://sha256/${sha(emittedModelText(blank))}` }, { id: "model-trailing", contentRef: `artifact://sha256/${sha(emittedModelText(trailing))}` }]);
  });
});
