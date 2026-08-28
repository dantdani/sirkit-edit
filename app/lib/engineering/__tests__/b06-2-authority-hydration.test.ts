/**
 * B06.2 — executor authority enforcement and hydration consistency closure.
 *
 *  §1  Executor-level authority gate (mandatory tests 1–7): forged
 *      operations are tested DIRECTLY against the executor, never via the
 *      planner.
 *  §2  Projection-mark validation + decision table (8–14).
 *  §3  Hydration lifecycle with a controllable DEFERRED store (15–19).
 *  §4  Serialized delete/replacement planning (20–21).
 *  §5  Storage availability and corruption (22–25).
 *  §6  Evidence pinning. (26 — regression suites — runs as the existing
 *      B01–B06.1 suites.)
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import type { KicadPin } from "../../kicad/types";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { CanonicalExecutor } from "../executor";
import { createEditorSessionChannel } from "../interactive-channel.internal";
import { createEmptyBoard } from "../../pcb/types";
import { InMemoryAtomicProjectStore, type AtomicProjectStore } from "../persistence";
import { computeProjectRevision } from "../revision";
import { consumeReplacementAuthority } from "../schematic-authority.internal";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic } from "../schematic-model";
import { planSchematicDelete, planSchematicReplacement } from "../schematic-plans";
import { decideProjectionReconciliation, validateSchematicCanonicalMark } from "../schematic-projection";
import { buildRecoveryEvidence, fixtureAuthorityBundle, renderRecoveryEvidence } from "../schematic-replay-evidence";
import { SchematicEditorSession } from "../schematic-session";
import { EngineeringTransactionService } from "../transaction-service";
import type { CanonicalProjectState, EngineeringActor, EngineeringOperation, ProjectPersistenceEnvelope } from "../types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SCOPE = { tenantId: "tenant-b062", projectId: "project-b062", branchId: "main" } as const;
const HUMAN: EngineeringActor = { actorId: "owner", actorKind: "human", sessionId: "s1", role: "project_admin" };

function pin(number: string, name: string, xMm: number): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 };
}
const PART_A_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const PART_B_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];

function baseState(): SchematicState {
  return {
    components: [
      { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
      { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
    ],
    kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "10k" }],
    wires: [{ id: "w1", vertices: [{ x: 130, y: 100 }, { x: 280, y: 100 }] }],
    netLabels: [{ id: "l1", position: { x: 320, y: 100 }, name: "VOUT", kind: "label", orientation: 0 }],
  };
}

function projectFor(state: SchematicState, scope: { tenantId: string; projectId: string; branchId: string } = SCOPE): CanonicalProjectState {
  return { schemaVersion: "sirkit.engineering.v1", ...scope, pcb: createEmptyBoard(), schematic: toCanonicalSchematic(state), pinnedAssets: [] };
}

async function openExecutor(state: SchematicState) {
  const service = await EngineeringTransactionService.open(projectFor(state), { buildId: "b062-test", store: new InMemoryAtomicProjectStore() });
  const executor = new CanonicalExecutor(service, ACTION_COVERAGE_REGISTRY, { interactiveChannel: createEditorSessionChannel("b062 test") });
  return { service, executor };
}

/** A DIRECTLY FORGED replacement operation (never from the planner). */
function forgedReplaceOp(overrides?: Partial<{ authorityGrantId: string; consumedAuthorityResources: Array<{ resourceId: string; contentDigest: string }> }>): EngineeringOperation {
  return {
    operationId: "op:forged", schemaVersion: 1, units: "px", kind: "schematic_replace_component",
    componentId: "u1-id", expectedCurrentPartId: "lib:part-a",
    replacement: { partId: "lib:part-b", atomicPartRevisionId: "rev-forged", symbolAssetVersionId: "sym-forged", mappingCertificateId: "cert-forged" },
    pinMapping: [{ fromPin: "1", toPin: "1" }, { fromPin: "2", toPin: "2" }],
    wireEndpointMoves: [], netLabelMoves: [],
    ...overrides,
  };
}

function executeRequest(service: EngineeringTransactionService, operations: EngineeringOperation[], idempotencyKey = "forge-1") {
  return {
    commandId: "schematic.replace-component",
    actor: HUMAN,
    expectedRevision: service.currentRevision(),
    idempotencyKey,
    reason: "B06.2 authority test",
    operations,
    provenance: { source: "ui" as const },
  };
}

function grantFor(state: SchematicState, scope: { tenantId: string; projectId: string; branchId: string } = SCOPE) {
  const consumed = consumeReplacementAuthority({
    bundle: fixtureAuthorityBundle(state, scope),
    scope,
    expectedCanonicalRevision: computeProjectRevision(projectFor(state, scope)).canonicalStateDigest,
    componentId: "u1-id",
    targetPartId: "lib:part-b",
    target: { atomicPartRevisionId: "rev-new", mappingCertificateId: "cert-new", selectionRecordId: "sel-new" },
  });
  if (!consumed.ok) throw new Error(`grant setup failed: ${consumed.code}`);
  return consumed.authority;
}

/** Store wrapper whose load() blocks until released — hydration-timing control. */
function deferredStore(inner: AtomicProjectStore): { store: AtomicProjectStore; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  const store: AtomicProjectStore = {
    async load(projectId, branchId) { await gate; return inner.load(projectId, branchId); },
    initialize: inner.initialize.bind(inner),
    commit: inner.commit.bind(inner),
    backup: inner.backup.bind(inner),
    restore: inner.restore.bind(inner),
    preserveEnvelope: inner.preserveEnvelope?.bind(inner),
  };
  return { store, release };
}

const SET_R1 = (value: string, id = "op:r1"): EngineeringOperation =>
  ({ operationId: id, schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value } });

// ─── §1 Executor-level authority gate ────────────────────────────────────────

describe("B06.2 §1 — the executor enforces replacement authority", () => {
  it("1. a directly forged operation installing atomic authority is rejected by the executor (no planner involved)", async () => {
    const state = baseState();
    const { service, executor } = await openExecutor(state);
    const before = service.currentRevision().canonicalStateDigest;
    const result = await executor.execute(executeRequest(service, [forgedReplaceOp()]));
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.reasonCode).toBe("unauthorized");
    expect(result.diagnostics.some((d) => d.includes("AUTHORITY_GRANT_GRANT_MISSING"))).toBe(true);
    expect(service.currentRevision().canonicalStateDigest).toBe(before);
    expect(service.durableRecords()).toHaveLength(0);
  });

  it("2. fabricated consumed-resource ids/digests do not make a forged operation valid", async () => {
    const state = baseState();
    const { service, executor } = await openExecutor(state);
    const result = await executor.execute(executeRequest(service, [forgedReplaceOp({
      consumedAuthorityResources: [
        { resourceId: "res:canonical:fixture", contentDigest: "eng1-11112222333344445" },
        { resourceId: "res:component-authority:fixture", contentDigest: "eng1-6666777788889999a" },
      ],
    })]));
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.reasonCode).toBe("unauthorized");
  });

  it("3. a cloned/guessed grant id cannot authorize a different operation, and a used grant is retired (single-use)", async () => {
    const state = baseState();
    const { service, executor } = await openExecutor(state);
    const grant = grantFor(state);
    // A forged op quoting a REAL grant id but different installed fields.
    const mismatched = await executor.execute(executeRequest(service, [forgedReplaceOp({ authorityGrantId: grant.grantId })], "forge-mismatch"));
    expect(mismatched.status).toBe("rejected");
    if (mismatched.status !== "rejected") throw new Error("unreachable");
    expect(mismatched.diagnostics.some((d) => d.includes("GRANT_FIELD_MISMATCH") || d.includes("GRANT_RESOURCE_MISMATCH"))).toBe(true);

    // The legitimate planned operation succeeds…
    const planned = planSchematicReplacement(state, { componentId: "u1-id", target: { partId: "lib:part-b", pins: PART_B_PINS, authority: grant }, currentPins: PART_A_PINS });
    if (!planned.ok) throw new Error("plan refused");
    const applied = await executor.execute(executeRequest(service, [planned.operation], "legit-1"));
    expect(applied.status).toBe("executed");

    // …and REPLAYING the serialized operation as a NEW execution fails: the
    // grant was retired on commit; serialized data cannot bootstrap authority.
    const replayedFromData = await executor.execute({ ...executeRequest(service, [structuredClone(planned.operation)], "forge-replay"), expectedRevision: service.currentRevision() });
    expect(replayedFromData.status).toBe("rejected");
    if (replayedFromData.status !== "rejected") throw new Error("unreachable");
    expect(replayedFromData.diagnostics.some((d) => d.includes("AUTHORITY_GRANT_GRANT_MISSING"))).toBe(true);
  });

  it("4. wrong-component, wrong-part, wrong-scope, and wrong-revision grants are rejected at execution", async () => {
    const state = baseState();
    const { service, executor } = await openExecutor(state);
    const grant = grantFor(state);
    const legit = planSchematicReplacement(state, { componentId: "u1-id", target: { partId: "lib:part-b", pins: PART_B_PINS, authority: grant }, currentPins: PART_A_PINS });
    if (!legit.ok || legit.operation.kind !== "schematic_replace_component") throw new Error("plan refused");

    // Wrong component / wrong part: mutate the serialized op relative to the grant.
    const wrongComponent = { ...structuredClone(legit.operation), componentId: "u2-id" } as EngineeringOperation;
    const wrongComponentResult = await executor.execute(executeRequest(service, [wrongComponent], "wc"));
    expect(wrongComponentResult.status === "rejected" && wrongComponentResult.diagnostics.some((d) => d.includes("GRANT_COMPONENT_MISMATCH"))).toBe(true);

    const wrongPartOp = structuredClone(legit.operation);
    if (wrongPartOp.kind === "schematic_replace_component") wrongPartOp.replacement = { ...wrongPartOp.replacement, partId: "lib:part-z" };
    const wrongPartResult = await executor.execute(executeRequest(service, [wrongPartOp], "wp"));
    expect(wrongPartResult.status === "rejected" && wrongPartResult.diagnostics.some((d) => d.includes("GRANT_PART_MISMATCH"))).toBe(true);

    // Wrong scope: a grant consumed for ANOTHER project executed here.
    const foreignGrant = grantFor(state, { tenantId: "tenant-b062", projectId: "someone-else", branchId: "main" });
    const foreignPlanned = planSchematicReplacement(state, { componentId: "u1-id", target: { partId: "lib:part-b", pins: PART_B_PINS, authority: foreignGrant }, currentPins: PART_A_PINS });
    if (!foreignPlanned.ok) throw new Error("plan refused");
    const foreignResult = await executor.execute(executeRequest(service, [foreignPlanned.operation], "ws"));
    expect(foreignResult.status === "rejected" && foreignResult.diagnostics.some((d) => d.includes("GRANT_SCOPE_MISMATCH"))).toBe(true);

    // Wrong revision: advance the head, then execute a grant pinned to the old head.
    const staleGrant = grantFor(state);
    const stalePlanned = planSchematicReplacement(state, { componentId: "u1-id", target: { partId: "lib:part-b", pins: PART_B_PINS, authority: staleGrant }, currentPins: PART_A_PINS });
    if (!stalePlanned.ok) throw new Error("plan refused");
    const moved = await executor.execute({ commandId: "schematic.set-property", actor: HUMAN, expectedRevision: service.currentRevision(), idempotencyKey: "adv", reason: "advance", operations: [SET_R1("3k")], provenance: { source: "ui" } });
    expect(moved.status).toBe("executed");
    const staleResult = await executor.execute({ ...executeRequest(service, [stalePlanned.operation], "wr"), expectedRevision: service.currentRevision() });
    expect(staleResult.status === "rejected" && staleResult.diagnostics.some((d) => d.includes("GRANT_REVISION_MISMATCH"))).toBe(true);
  });

  it("5. without a grant, a replacement may not install or retain ANY atomic field (catalog-unverified clears them)", async () => {
    const withStale = baseState();
    withStale.kicadComponents![0].atomicPartRevisionId = "rev-old";
    const { service, executor } = await openExecutor(withStale);
    // A single forged field is enough to trip the gate.
    const oneField: EngineeringOperation = { ...forgedReplaceOp(), operationId: "op:one" };
    if (oneField.kind === "schematic_replace_component") oneField.replacement = { partId: "lib:part-b", selectionRecordId: "sel-forged" };
    const forged = await executor.execute(executeRequest(service, [oneField], "one-field"));
    expect(forged.status === "rejected").toBe(true);
    // The catalog-unverified planner path executes and CLEARS stale authority.
    const planned = planSchematicReplacement(withStale, { componentId: "u1-id", target: { partId: "lib:part-b", pins: PART_B_PINS, authority: { status: "catalog-unverified" } }, currentPins: PART_A_PINS });
    if (!planned.ok) throw new Error("plan refused");
    const applied = await executor.execute(executeRequest(service, [planned.operation], "catalog-1"));
    expect(applied.status).toBe("executed");
    const schematic = fromCanonicalSchematic(service.currentProject().schematic as never);
    expect(schematic.kicadComponents![0].partId).toBe("lib:part-b");
    expect(schematic.kicadComponents![0].atomicPartRevisionId).toBeUndefined();
  });

  it("6+7. an approved grant permits exactly its replacement, idempotent retry replays, and durable undo/redo remain valid", async () => {
    const state = baseState();
    const store = new InMemoryAtomicProjectStore();
    const editor = new SchematicEditorSession(SCOPE, { store });
    await editor.openForProject(state, null);
    const grant = grantFor(state);
    const planned = planSchematicReplacement(state, { componentId: "u1-id", target: { partId: "lib:part-b", pins: PART_B_PINS, authority: grant }, currentPins: PART_A_PINS });
    if (!planned.ok) throw new Error("plan refused");
    const applied = await editor.execute(state, { commandId: "schematic.replace-component", label: "Verified replace", idempotencyKey: "vr-1", buildOperations: () => [planned.operation] });
    if (!applied.ok) throw new Error(`apply rejected: ${applied.diagnostics.join(",")}`);
    expect(applied.state.kicadComponents![0].atomicPartRevisionId).toBe("rev-new");
    // Idempotent retry of the SAME action replays without a live grant.
    const retried = await editor.execute(applied.state, { commandId: "schematic.replace-component", label: "Verified replace", idempotencyKey: "vr-1", buildOperations: () => [planned.operation] });
    expect(retried.ok && retried.status === "idempotent_replay").toBe(true);
    // Durable undo restores the original identity; redo re-applies — both via
    // the verified replay contract, no live grant required.
    await editor.reconcileHistoryStep("undo", state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");
    await editor.reconcileHistoryStep("redo", applied.state);
    expect(editor.events.at(-1)?.kind).toBe("redo-reconciled");
  });
});

// ─── §2 Projection marks and the decision table ──────────────────────────────

describe("B06.2 §2 — validated projection marks", () => {
  async function seededStore(): Promise<{ store: InMemoryAtomicProjectStore; edited: SchematicState; envelope: ProjectPersistenceEnvelope; markSeq1: { lineageId: string; headSequence: number; canonicalStateDigest: string } }> {
    const store = new InMemoryAtomicProjectStore();
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-marks" }, { store });
    await editor.openForProject(baseState(), null);
    const edited = await editor.execute(baseState(), { commandId: "schematic.set-property", label: "Edit", buildOperations: () => [SET_R1("42k")] });
    if (!edited.ok) throw new Error("seed edit rejected");
    const mark = edited.headMark!;
    editor.dispose();
    const envelope = (await store.load("p-marks", "main"))!;
    return { store, edited: edited.state, envelope, markSeq1: mark };
  }

  it("8. a fabricated high-sequence mark cannot overwrite the canonical head (conflict preserves both)", async () => {
    const { store, envelope } = await seededStore();
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-marks" }, { store });
    const outcome = await editor.openForProject(baseState(), { lineageId: "lin1-ffffffffffffffff", headSequence: 99, canonicalStateDigest: "eng1-ffffffffffffffff" });
    expect(outcome.status).toBe("projection-conflict");
    expect(editor.lifecycle).toBe("conflicted");
    // The durable head is intact.
    const untouched = await store.load("p-marks", "main");
    expect(untouched?.integrityManifest.envelopeDigest).toBe(envelope.integrityManifest.envelopeDigest);
  });

  it("9+10. foreign-lineage and same-sequence/wrong-digest marks fail closed as conflicts", async () => {
    const { store, markSeq1 } = await seededStore();
    // Same sequence, wrong digest (foreign/divergent lineage evidence).
    const editorA = new SchematicEditorSession({ ...SCOPE, projectId: "p-marks" }, { store });
    const outcomeA = await editorA.openForProject(baseState(), { ...markSeq1, canonicalStateDigest: "eng1-dddddddddddddddd" });
    expect(outcomeA.status).toBe("projection-conflict");
    editorA.dispose();
    // Older sequence whose digest matches no recorded log position.
    const editorB = new SchematicEditorSession({ ...SCOPE, projectId: "p-marks" }, { store });
    const outcomeB = await editorB.openForProject(baseState(), { lineageId: markSeq1.lineageId, headSequence: 0, canonicalStateDigest: "eng1-dddddddddddddddd" });
    expect(outcomeB.status).toBe("projection-conflict");
  });

  it("11. malformed marks are downgraded to untrusted projection data (validated, never cast)", async () => {
    expect(validateSchematicCanonicalMark({ lineageId: "", headSequence: 1, canonicalStateDigest: "eng1-aaaaaaaaaaaaaaaa" })).toBeNull();
    expect(validateSchematicCanonicalMark({ lineageId: "lin1-aaaaaaaaaaaaaaaa", headSequence: -1, canonicalStateDigest: "eng1-aaaaaaaaaaaaaaaa" })).toBeNull();
    expect(validateSchematicCanonicalMark({ lineageId: "lin1-aaaaaaaaaaaaaaaa", headSequence: 1.5, canonicalStateDigest: "eng1-aaaaaaaaaaaaaaaa" })).toBeNull();
    expect(validateSchematicCanonicalMark({ lineageId: "lin1-aaaaaaaaaaaaaaaa", headSequence: 1, canonicalStateDigest: "not-a-digest" })).toBeNull();
    expect(validateSchematicCanonicalMark("garbage")).toBeNull();
    // Runtime: a malformed mark behaves as ABSENT → canonical recovery, not conflict.
    const { store } = await seededStore();
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-marks" }, { store });
    const outcome = await editor.openForProject(baseState(), { lineageId: 42, headSequence: "9", canonicalStateDigest: null });
    expect(outcome.status).toBe("recovered-canonical");
  });

  it("12+13. a genuinely stale verified mark recovers canonical; a matching mark with later legacy edits rebases", async () => {
    const { store, edited, envelope, markSeq1 } = await seededStore();
    // Verified-older: a mark naming the ACTUAL genesis digest at sequence 0.
    const genesisDigest = envelope.transactionLog[0].transaction.baseRevision.canonicalStateDigest;
    const editorA = new SchematicEditorSession({ ...SCOPE, projectId: "p-marks" }, { store });
    const outcomeA = await editorA.openForProject(baseState(), { lineageId: markSeq1.lineageId, headSequence: 0, canonicalStateDigest: genesisDigest });
    expect(outcomeA.status).toBe("recovered-canonical");
    if (outcomeA.status !== "recovered-canonical") throw new Error("unreachable");
    expect(outcomeA.reason).toBe("verified-older-mark");
    editorA.dispose();
    // Matching mark + later legacy edits → documented rebase path.
    const legacy = structuredClone(edited);
    legacy.components.push({ id: "R99", type: "resistor", x: 700, y: 700, rotation: 0, value: "9k" });
    const editorB = new SchematicEditorSession({ ...SCOPE, projectId: "p-marks" }, { store });
    const outcomeB = await editorB.openForProject(legacy, markSeq1);
    expect(outcomeB.status).toBe("rebased-local-newer");
    expect(editorB.lifecycle).toBe("ready");
  });

  it("14. a projection ahead of the durable envelope preserves BOTH sides as a conflict; explicit choices resolve it", async () => {
    const { store, edited, markSeq1 } = await seededStore();
    const ahead = { ...markSeq1, headSequence: 5, canonicalStateDigest: "eng1-eeeeeeeeeeeeeeee" };
    const projection = structuredClone(edited);
    projection.components[0].value = "999k";
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-marks" }, { store });
    const outcome = await editor.openForProject(projection, ahead);
    expect(outcome.status).toBe("projection-conflict");
    if (outcome.status !== "projection-conflict") throw new Error("unreachable");
    // Canonical side is readable from the outcome; projection side untouched
    // in the caller's hands. Resolve by adopting canonical:
    const resolved = await editor.resolveConflictAdoptCanonical();
    expect(resolved.status).toBe("recovered-canonical");
    if (resolved.status !== "recovered-canonical") throw new Error("unreachable");
    expect(editor.confirmAdoption(resolved.state)).toBe(true);
    expect(editor.lifecycle).toBe("ready");
    expect(editor.headMark()?.headSequence).toBe(1);
  });
});

// ─── §3 Hydration lifecycle (deferred store timing) ──────────────────────────

describe("B06.2 §3 — hydration gating", () => {
  it("15+16+17. commands during hydration mutate nothing; a stale pre-recovery click can never rebase backward; ready requires adoption", async () => {
    const inner = new InMemoryAtomicProjectStore();
    // Seed a canonical head at sequence 1 (newer than the stale projection).
    const seeder = new SchematicEditorSession({ ...SCOPE, projectId: "p-race" }, { store: inner });
    const stale = baseState();
    await seeder.openForProject(stale, null);
    const seeded = await seeder.execute(stale, { commandId: "schematic.set-property", label: "Edit", buildOperations: () => [SET_R1("42k")] });
    if (!seeded.ok) throw new Error("seed rejected");
    seeder.dispose();

    const { store, release } = deferredStore(inner);
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-race" }, { store });
    const opening = editor.openForProject(stale, null); // will resolve AFTER release()
    expect(editor.lifecycle).toBe("hydrating");

    // A user command lands while openForProject is UNRESOLVED.
    const duringHydration = await editor.execute(stale, { commandId: "schematic.set-property", label: "Race click", buildOperations: () => [SET_R1("666k")] });
    expect(duringHydration.ok).toBe(false);
    if (duringHydration.ok) throw new Error("unreachable");
    expect(duringHydration.reasonCode).toBe("session_not_ready");
    expect(duringHydration.message).toContain("loading");

    release();
    const outcome = await opening;
    expect(outcome.status).toBe("recovered-canonical");
    if (outcome.status !== "recovered-canonical") throw new Error("unreachable");

    // 17: not ready (and no head mark) until the UI proves adoption.
    expect(editor.lifecycle).toBe("hydrating");
    expect(editor.headMark()).toBeNull();
    const beforeAdoption = await editor.execute(outcome.state, { commandId: "schematic.set-property", label: "Too early", buildOperations: () => [SET_R1("1k")] });
    expect(beforeAdoption.ok).toBe(false);
    expect(editor.confirmAdoption(baseState())).toBe(false); // wrong state cannot fake adoption
    expect(editor.confirmAdoption(outcome.state)).toBe(true);
    expect(editor.lifecycle).toBe("ready");

    // 16: the STALE pre-recovery snapshot is permanently refused — no rebase.
    const staleClick = await editor.execute(stale, { commandId: "schematic.set-property", label: "Stale click", buildOperations: () => [SET_R1("666k")] });
    expect(staleClick.ok).toBe(false);
    if (staleClick.ok) throw new Error("unreachable");
    expect(staleClick.diagnostics).toContain("STALE_PRE_RECOVERY_SNAPSHOT");
    expect(editor.headMark()?.headSequence).toBe(1);
    expect(editor.events.filter((e) => e.kind === "rebased")).toEqual([]);
    // The canonical head still holds the seeded edit.
    const probe = await editor.execute(outcome.state, { commandId: "schematic.set-property", label: "probe", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(probe.state.components.find((c) => c.id === "R1")?.value).toBe("42k");
  });

  it("18. disposal (project switching) invalidates queued and future commands of the previous session", async () => {
    const inner = new InMemoryAtomicProjectStore();
    const { store, release } = deferredStore(inner);
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-switch" }, { store });
    const opening = editor.openForProject(baseState(), null);
    editor.dispose(); // switch projects while hydration is in flight
    release();
    await opening.catch(() => undefined); // the queued open may reject — it must not throw unhandled
    expect(editor.lifecycle).toBe("unavailable");
    const late = await editor.execute(baseState(), { commandId: "schematic.set-property", label: "Late", buildOperations: () => [SET_R1("5k")] });
    expect(late.ok).toBe(false);
    if (late.ok) throw new Error("unreachable");
    expect(late.reasonCode).toBe("session_unavailable");
  });

  it("19. pending AI proposals are discarded on hydration and project switch (page wiring)", () => {
    const source = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");
    // B07.4 — hydration runs the explicit project-transition reset, which
    // owns the pendingTier1/recovery clears (plus the rest of the transient
    // project state).
    const resetBody = source.slice(source.indexOf("const resetTransientProjectState"), source.indexOf("const installProject"));
    expect(resetBody).toContain("setPendingTier1(null)");
    expect(resetBody).toContain("setSchematicRecovery(null)");
    // [B12.2] the hydration body lives in installProject (the WINNING
    // transition's install); hydrateProject routes EVERY entry point through
    // the serialized transition coordinator.
    const installBody = source.slice(source.indexOf("const installProject"), source.indexOf("const hydrateProject"));
    expect(installBody).toContain("resetTransientProjectState(record)");
    expect(installBody).toContain("schematicSessionRef.current?.dispose()");
    const hydrateBody = source.slice(source.indexOf("const hydrateProject"), source.indexOf("// Mount bootstrap"));
    expect(hydrateBody).toContain("projectTransitionRef.current!.request(");
    expect(hydrateBody).toContain("() => installProject(record, opts)");
    // [B12.3 §F / B12.5 §C] transition outcomes are truthful: only failed
    // transitions surface (pre-commit failures toast "unchanged";
    // commit-phase failures route to BLOCKING activation recovery).
    expect(hydrateBody).toContain('if (outcome.status !== "transition-failed") return;');
    expect(hydrateBody).toContain("if (outcome.recovery)");
    expect(hydrateBody).toContain("setActivationRecovery(outcome.detail)");
  });
});

// ─── §4 Serialized delete/replacement planning ───────────────────────────────

describe("B06.2 §4 — delete and replacement plans execute against the head", () => {
  it("20. rapid delete + edit from the same snapshot cannot lose the earlier edit (delete plans inside the queue)", async () => {
    const state = baseState();
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-rapid-del" }, { store: new InMemoryAtomicProjectStore() });
    await editor.openForProject(state, null);
    const [edit, deletion] = await Promise.all([
      editor.execute(state, { commandId: "schematic.set-property", label: "Edit R2", buildOperations: () => [{ operationId: "op:r2", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R2", patch: { value: "222k" } }] }),
      // The delete plan is built INSIDE the queue against the canonical head
      // (the page's B06.2 pattern) — never from the stale captured snapshot.
      editor.execute(state, {
        commandId: "schematic.delete-component",
        label: "Delete U1",
        buildOperations: (canonical) => {
          const planned = planSchematicDelete(fromCanonicalSchematic(canonical), { family: "kicad", componentId: "u1-id" }, PART_A_PINS);
          return planned.ok ? [planned.operation] : [];
        },
      }),
    ]);
    if (!edit.ok || !deletion.ok) throw new Error("rapid pair rejected");
    expect(deletion.state.components.find((c) => c.id === "R2")?.value).toBe("222k"); // earlier edit survived
    expect(deletion.state.kicadComponents).toEqual([]);
    expect(editor.events.filter((e) => e.kind === "rebased")).toEqual([]);
    expect(editor.headMark()?.headSequence).toBe(2);
  });

  it("21. rapid replacement from a stale snapshot cannot rebase — it plans against the serialized head", async () => {
    const state = baseState();
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-rapid-rep" }, { store: new InMemoryAtomicProjectStore() });
    await editor.openForProject(state, null);
    const [edit, swap] = await Promise.all([
      editor.execute(state, { commandId: "schematic.set-property", label: "Edit R1", buildOperations: () => [SET_R1("111k")] }),
      editor.execute(state, {
        commandId: "schematic.replace-component",
        label: "Swap U1",
        buildOperations: (canonical) => {
          const headState = fromCanonicalSchematic(canonical);
          const planned = planSchematicReplacement(headState, { componentId: "u1-id", target: { partId: "lib:part-b", pins: PART_B_PINS, authority: { status: "catalog-unverified" } }, currentPins: PART_A_PINS });
          return planned.ok ? [planned.operation] : [];
        },
      }),
    ]);
    if (!edit.ok || !swap.ok) throw new Error("rapid pair rejected");
    expect(swap.state.components.find((c) => c.id === "R1")?.value).toBe("111k");
    expect(swap.state.kicadComponents![0].partId).toBe("lib:part-b");
    expect(editor.events.filter((e) => e.kind === "rebased")).toEqual([]);
  });
});

// ─── §5 Storage availability and corruption ──────────────────────────────────

describe("B06.2 §5 — storage failure cannot produce false success", () => {
  it("22. without IndexedDB, default construction is UNAVAILABLE — in-memory is never silently selected", async () => {
    expect(typeof indexedDB).toBe("undefined"); // node test environment
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-unavailable" }); // no injection
    const outcome = await editor.openForProject(baseState(), null);
    expect(outcome.status).toBe("unavailable");
    expect(editor.lifecycle).toBe("unavailable");
    const refused = await editor.execute(baseState(), { commandId: "schematic.set-property", label: "Edit", buildOperations: () => [SET_R1("5k")] });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.reasonCode).toBe("session_unavailable");
    expect(refused.message).toContain("disabled");
    expect(editor.headMark()).toBeNull();
  });

  it("23. a store whose open fails disables mutation with a truthful error", async () => {
    const failing: AtomicProjectStore = {
      load: () => Promise.reject(new Error("INDEXEDDB_OPEN_FAILED")),
      initialize: () => Promise.reject(new Error("INDEXEDDB_OPEN_FAILED")),
      commit: () => Promise.reject(new Error("INDEXEDDB_OPEN_FAILED")),
      backup: () => Promise.reject(new Error("INDEXEDDB_OPEN_FAILED")),
      restore: () => Promise.reject(new Error("INDEXEDDB_OPEN_FAILED")),
    };
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-openfail" }, { store: failing });
    const outcome = await editor.openForProject(baseState(), null);
    expect(outcome.status).toBe("unavailable");
    expect(outcome.detail).toContain("INDEXEDDB_OPEN_FAILED");
    const refused = await editor.execute(baseState(), { commandId: "schematic.set-property", label: "Edit", buildOperations: () => [SET_R1("5k")] });
    expect(refused.ok).toBe(false);
  });

  it("24+25. corrupt history is quarantined (never silently replaced), and explicit in-memory injection remains supported", async () => {
    // 25: explicit injection is this whole suite; assert construction accepts it.
    const store = new InMemoryAtomicProjectStore();
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "p-quarantine" }, { store });
    await editor.openForProject(baseState(), null);
    editor.dispose();
    // Corrupt raw; reopen → conflicted; recovery quarantines BEFORE replacing.
    const envelope = await store.load("p-quarantine", "main");
    (envelope!.canonicalSnapshot as { schematic?: unknown }).schematic = { broken: true };
    store.unsafeSetRaw("p-quarantine", "main", envelope!);
    const reopened = new SchematicEditorSession({ ...SCOPE, projectId: "p-quarantine" }, { store });
    const outcome = await reopened.openForProject(baseState(), null);
    expect(outcome.status).toBe("corrupt-history");
    expect((await store.load("p-quarantine", "main"))?.canonicalSnapshot.schematic).toEqual({ broken: true }); // untouched
    const recovered = await reopened.recoverStartFresh(baseState());
    expect(recovered.status).toBe("fresh");
    expect(store.quarantined("p-quarantine", "main").length).toBeGreaterThanOrEqual(1);
    expect(store.quarantined("p-quarantine", "main").some((q) => JSON.stringify(q).includes("broken"))).toBe(true);
  });
});

// ─── §6 Evidence pinning + decision-table parity ─────────────────────────────

describe("B06.2 §6 — evidence matches the implementation", () => {
  it("recovery-fixtures.json is exactly what the decision table produces today", () => {
    const committedPath = resolve(process.cwd(), "artifacts/ai-control-plane-b06-2/recovery-fixtures.json");
    expect(existsSync(committedPath), "run: npx tsx scripts/generate-b06-schematic-artifacts.ts").toBe(true);
    expect(readFileSync(committedPath, "utf8").replaceAll("\r\n", "\n")).toBe(renderRecoveryEvidence());
    const evidence = buildRecoveryEvidence();
    const byId = new Map(evidence.scenarios.map((scenario) => [scenario.scenarioId, scenario.decision]));
    expect(byId.get("resume-exact-head")?.action).toBe("resume");
    expect(byId.get("rebase-local-newer")?.action).toBe("rebase-local-newer");
    expect(byId.get("recover-verified-older")?.action).toBe("recover-canonical");
    expect(byId.get("recover-untrusted-no-mark")?.action).toBe("recover-canonical");
    expect(byId.get("conflict-mark-ahead")?.action).toBe("conflict");
    expect(byId.get("conflict-same-seq-wrong-digest")?.action).toBe("conflict");
    expect(byId.get("conflict-unverifiable-position")?.action).toBe("conflict");
    // The evidence runs the same pure function the session uses.
    expect(decideProjectionReconciliation(evidence.scenarios[0].input)).toEqual(evidence.scenarios[0].decision);
    // The projection digest used by the session is the same UI digest domain.
    expect(schematicStateDigest(baseState()).startsWith("eng1-")).toBe(true);
  });
});
