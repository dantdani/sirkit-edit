/**
 * B06.1 — proposal/apply boundary, authority closure, label-safe
 * replacement, and durable schematic persistence.
 *
 *  §1  Provider proposal vs human apply (mandatory tests 1–10)
 *  §2  Authority closure (11–15)
 *  §3  Net-label-safe replacement (16–18)
 *  §4  Durable production session (19–22)
 *  §5  Serialized planning (23)
 *  §6  Registry + exposure truth (24–25) and the authority import boundary
 *
 * All assertions are structural — no timing gates. (The import-boundary scan
 * walks the repo and gets a raised timeout, like the B03.2 scan.)
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import type { KicadPin } from "../../kicad/types";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE } from "../action-registry";
import type { ComponentAuthorityRecord } from "../component-authority";
import { CanonicalExecutor, resolveExecutorContract } from "../executor";
import { createEditorSessionChannel } from "../interactive-channel.internal";
import { createEmptyBoard } from "../../pcb/types";
import { InMemoryAtomicProjectStore } from "../persistence";
import { buildReadResourceBundle, sealResourceEnvelope, type ReadResourceBundle } from "../resource-envelopes";
import { computeProjectRevision } from "../revision";
import { consumeReplacementAuthority, VerifiedReplacementAuthority } from "../schematic-authority.internal";
import { schematicStateDigest, toCanonicalSchematic } from "../schematic-model";
import { compileTier1Proposal, planSchematicReplacement } from "../schematic-plans";
import { sealTier1Proposal, verifySealedTier1Proposal, type SealedTier1Proposal, type Tier1ProposalScope } from "../schematic-proposals";
import { buildAuthorizationBinding } from "../proposal-authorization";
import { buildReplacementConnectivityEvidence, renderReplacementConnectivityEvidence } from "../schematic-replay-evidence";
import { SchematicEditorSession } from "../schematic-session";
import { sirkitToolRegistry } from "../tool-catalog";
import { EngineeringTransactionService } from "../transaction-service";
import type { CanonicalProjectState, EngineeringActor, EngineeringOperation } from "../types";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SCOPE = { tenantId: "tenant-b061", projectId: "project-b061", branchId: "main" } as const;
const HUMAN: EngineeringActor = { actorId: "owner", actorKind: "human", sessionId: "s1", role: "project_admin" };

function pin(number: string, name: string, xMm: number): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 };
}
const PART_A_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const PART_B_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const PART_D_PINS: readonly KicadPin[] = [pin("3", "A", -5), pin("4", "B", 5)];

/** R1, R2 (theory); U1 with wire w1 on pin 1 and label-only VOUT on pin 2. */
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

/** Explicit in-memory injection (B06.2: no production fallback) + lazy
 *  auto-open on first execute; explicit openForProject calls take priority. */
function session(projectId = "project-b061", store?: InMemoryAtomicProjectStore): SchematicEditorSession {
  const editor = new SchematicEditorSession({ ...SCOPE, projectId }, { store: store ?? new InMemoryAtomicProjectStore() });
  const originalExecute = editor.execute.bind(editor);
  let opening: Promise<unknown> | null = null;
  editor.execute = async (state, request) => {
    if (editor.lifecycle === "unopened") opening ??= editor.openForProject(state, null);
    if (opening) await opening;
    return originalExecute(state, request);
  };
  return editor;
}

// [B09.1] V2 proposals are SCOPE-sealed. Tests that never apply use a
// fixture scope; apply-path tests seal against the OPENED editor's real
// head mark and verify against the same editor at apply time.
const FIXTURE_SCOPE: Tier1ProposalScope = { ...SCOPE, headMark: { lineageId: "lin1-f1b061f1b061f1b0", headSequence: 1, canonicalStateDigest: "eng1-f1b061f1b061f1b0" } };

function scopeOf(editor: SchematicEditorSession, projectId = "project-b061"): Tier1ProposalScope {
  const mark = editor.headMark();
  if (!mark) throw new Error("editor session is not ready (no head mark)");
  return { tenantId: SCOPE.tenantId, projectId, branchId: SCOPE.branchId, headMark: mark };
}

async function readyEditor(state: SchematicState, projectId = "project-b061", store?: InMemoryAtomicProjectStore): Promise<SchematicEditorSession> {
  const editor = session(projectId, store);
  await editor.openForProject(state, null);
  return editor;
}

function sealFor(state: SchematicState, ops: Parameters<typeof compileTier1Proposal>[1]["ops"], pins: ReadonlyMap<string, readonly KicadPin[]> = new Map([["lib:part-a", PART_A_PINS]]), scope: Tier1ProposalScope = FIXTURE_SCOPE) {
  return sealTier1Proposal({
    state,
    compilation: compileTier1Proposal(state, { ops, pinsByPartId: pins }),
    provenance: { provider: "anthropic", note: "test", instruction: "test instruction" },
    now: 1_000_000,
    scope,
    // B16.0.1 §E: the sealed authorization binding (the test's human actor).
    authorization: buildAuthorizationBinding({ principalId: HUMAN.actorId, scope: { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId } }),
  });
}

function sealedOrThrow(state: SchematicState, ops: Parameters<typeof compileTier1Proposal>[1]["ops"], scope: Tier1ProposalScope = FIXTURE_SCOPE): SealedTier1Proposal {
  const outcome = sealFor(state, ops, undefined, scope);
  if (outcome.kind !== "sealed") throw new Error(`expected sealed, got blocked: ${JSON.stringify(outcome.blockers)}`);
  return outcome.proposal;
}

async function applyProposal(editor: SchematicEditorSession, state: SchematicState, proposal: SealedTier1Proposal, now = 1_000_001, expectedScope?: Tier1ProposalScope) {
  const scope = expectedScope ?? scopeOf(editor);
  const verification = verifySealedTier1Proposal(proposal, { currentSchematicDigest: schematicStateDigest(state), now, expectedScope: scope });
  if (!verification.ok) return { verification, result: null } as const;
  const result = await editor.execute(state, {
    commandId: "schematic.edit-tier1-apply",
    label: "Applied AI edit proposal",
    buildOperations: () => structuredClone(proposal.operations) as EngineeringOperation[],
    expectedBaseDigest: proposal.baseSchematicDigest,
    expectedHeadMark: proposal.scope.headMark,
  });
  return { verification, result } as const;
}

/** Configurable valid-by-default B05.1 authority bundle for u1-id → lib:part-b. */
function makeBundle(state: SchematicState, overrides?: {
  scope?: { tenantId: string; projectId: string; branchId: string };
  canonicalRevision?: string;
  freshness?: "current" | "stale";
  authorityStatus?: "verified" | "unverified";
  record?: Partial<ComponentAuthorityRecord> | null;
  extraRecords?: ComponentAuthorityRecord[];
}): ReadResourceBundle {
  const scope = overrides?.scope ?? SCOPE;
  const canonicalProject = projectFor(state, scope);
  const canonicalRevision = overrides?.canonicalRevision ?? computeProjectRevision(canonicalProject).canonicalStateDigest;
  const record: ComponentAuthorityRecord = {
    authorityRecordId: "auth:u1-id",
    componentId: "u1-id",
    projectId: scope.projectId,
    authorityRevision: "rev-new",
    selectedPart: { mpn: "lib:part-b", manufacturer: "Test Semiconductor", provenance: "physical-binding" },
    lifecycle: "selected",
    approval: "approved",
    freshness: "current",
    conflict: "none",
    footprintAsset: "available",
    mappingVerification: "verified",
    // [B13] server-owned exact target identity; verified replacement derives
    // its installed asset IDs from here, never from caller input.
    exactAuthority: {
      atomicPartRevisionId: "rev-new",
      mpn: "lib:part-b",
      manufacturer: "Test Semiconductor",
      symbolAssetVersionId: "sym-new",
      footprintAssetVersionId: "fp-new",
      mappingCertificateId: "cert-new",
      selectionRecordId: "sel-new",
    },
    ...overrides?.record,
  };
  const canonicalEnvelope = sealResourceEnvelope({
    resourceId: "res:canonical", kind: "canonical-state", ...scope,
    authoritySource: "local-working-copy", authorityStatus: "verified",
    sourceVersion: "1", sourceCanonicalRevision: canonicalRevision,
    producer: "b061-test", producerVersion: "1.0.0", freshness: "current",
    content: canonicalProject,
  });
  const records = overrides?.record === null ? [] : [record, ...(overrides?.extraRecords ?? [])];
  const authorityEnvelope = sealResourceEnvelope({
    resourceId: "res:authority", kind: "component-authority-records", ...scope,
    authoritySource: "durable-server-board", authorityStatus: overrides?.authorityStatus ?? "verified",
    sourceVersion: "1", sourceCanonicalRevision: canonicalRevision,
    producer: "b061-test", producerVersion: "1.0.0", freshness: overrides?.freshness ?? "current",
    content: { records, candidates: [] },
  });
  return buildReadResourceBundle(canonicalEnvelope, [authorityEnvelope]);
}

function consumeFor(state: SchematicState, bundle: ReadResourceBundle, overrides?: { expectedCanonicalRevision?: string; targetPartId?: string; atomicPartRevisionId?: string }) {
  return consumeReplacementAuthority({
    bundle,
    scope: SCOPE,
    expectedCanonicalRevision: overrides?.expectedCanonicalRevision ?? computeProjectRevision(projectFor(state)).canonicalStateDigest,
    componentId: "u1-id",
    targetPartId: overrides?.targetPartId ?? "lib:part-b",
    target: { atomicPartRevisionId: overrides?.atomicPartRevisionId ?? "rev-new", selectionRecordId: "sel-new" },
  });
}

// ─── §1 Provider proposal vs human apply ─────────────────────────────────────

describe("B06.1 §1 — sealed proposal boundary", () => {
  it("1+2. receiving provider output and previewing the proposal mutate NOTHING", () => {
    const state = baseState();
    const before = structuredClone(state);
    const editor = session();
    const outcome = sealFor(state, [
      { op: "set-value", target: "R1", value: "4.7k" },
      { op: "delete", target: "U1" },
    ]);
    expect(outcome.kind).toBe("sealed");
    if (outcome.kind !== "sealed") throw new Error("unreachable");
    // Preview data exists (exact operations + destructive impacts)…
    expect(outcome.proposal.operations.length).toBe(2);
    expect(outcome.proposal.impacts.destructive).toBe(true);
    expect(outcome.proposal.impacts.deletes[0].removeWireIds).toEqual(["w1"]);
    // …and neither compiling, sealing, nor previewing touched the state or
    // executed anything.
    expect(state).toEqual(before);
    expect(editor.events).toEqual([]);
    expect(Object.isFrozen(outcome.proposal)).toBe(true);
    expect(Object.isFrozen(outcome.proposal.operations)).toBe(true);
  });

  it("3. explicit apply commits EXACTLY the sealed operations as one atomic transaction", async () => {
    const state = baseState();
    const editor = await readyEditor(state);
    const proposal = sealedOrThrow(state, [
      { op: "set-value", target: "R1", value: "4.7k" },
      { op: "rename", target: "U1", refDes: "U9" },
    ], scopeOf(editor));
    const { verification, result } = await applyProposal(editor, state, proposal);
    expect(verification.ok).toBe(true);
    if (!result?.ok) throw new Error("apply rejected");
    expect(result.status).toBe("executed");
    expect(result.state.components.find((c) => c.id === "R1")?.value).toBe("4.7k");
    expect(result.state.kicadComponents![0].refDes).toBe("U9");
    expect(editor.events.filter((e) => e.kind === "executed")).toHaveLength(1);
  });

  it("4. cancel changes nothing (no session interaction exists to cancel)", () => {
    const state = baseState();
    const before = structuredClone(state);
    const proposal = sealedOrThrow(state, [{ op: "set-value", target: "R1", value: "9k" }]);
    // Cancel is dropping the proposal — there is nothing to roll back.
    expect(proposal.operations.length).toBe(1);
    expect(state).toEqual(before);
  });

  it("5. altered operations or digests are rejected before any execution", async () => {
    const state = baseState();
    const proposal = sealedOrThrow(state, [{ op: "set-value", target: "R1", value: "9k" }]);
    // Tampered operation content (rebuilt object — the original is frozen).
    const tamperedOps = structuredClone(proposal) as unknown as { operations: Array<{ patch?: { value?: string } }> };
    tamperedOps.operations[0].patch = { value: "666k" };
    const alteredOps = verifySealedTier1Proposal(tamperedOps as unknown as SealedTier1Proposal, { currentSchematicDigest: schematicStateDigest(state), now: 1_000_001, expectedScope: proposal.scope });
    expect(alteredOps.ok).toBe(false);
    if (alteredOps.ok) throw new Error("unreachable");
    expect(alteredOps.code).toBe("altered");
    // Tampered operations digest (consistent ops+digest, forged identity).
    const tamperedDigest = structuredClone(proposal) as unknown as { baseSchematicDigest: string };
    tamperedDigest.baseSchematicDigest = "eng1-forged";
    const alteredBase = verifySealedTier1Proposal(tamperedDigest as unknown as SealedTier1Proposal, { currentSchematicDigest: "eng1-forged", now: 1_000_001, expectedScope: proposal.scope });
    expect(alteredBase.ok).toBe(false);
    if (alteredBase.ok) throw new Error("unreachable");
    expect(alteredBase.code).toBe("altered");
    // Expiry.
    const expired = verifySealedTier1Proposal(proposal, { currentSchematicDigest: schematicStateDigest(state), now: proposal.expiresAt + 1, expectedScope: proposal.scope });
    expect(expired.ok).toBe(false);
    if (expired.ok) throw new Error("unreachable");
    expect(expired.code).toBe("expired");
  });

  it("6. a stale proposal is rejected at verification AND at the serialized session queue", async () => {
    const state = baseState();
    const editor = await readyEditor(state);
    const proposal = sealedOrThrow(state, [{ op: "set-value", target: "R1", value: "9k" }], scopeOf(editor));
    // The schematic moves on before the apply.
    const moved = await editor.execute(state, {
      commandId: "schematic.set-property",
      label: "Edit before apply",
      buildOperations: () => [{ operationId: "op:x", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R2", patch: { value: "7k" } }],
    });
    if (!moved.ok) throw new Error("setup edit rejected");
    // Front-door verification catches it…
    const verification = verifySealedTier1Proposal(proposal, { currentSchematicDigest: schematicStateDigest(moved.state), now: 1_000_001, expectedScope: scopeOf(editor) });
    expect(verification.ok).toBe(false);
    if (verification.ok) throw new Error("unreachable");
    // [B09.1] the moved canonical head now fails the HEAD identity check
    // (stronger than the base-digest check it also fails).
    expect(verification.code).toBe("stale-head");
    // …and even a caller that skips it is stopped INSIDE the queue by the
    // pinned base digest, with nothing applied.
    const digestBefore = schematicStateDigest(moved.state);
    const smuggled = await editor.execute(moved.state, {
      commandId: "schematic.edit-tier1-apply",
      label: "Stale apply",
      buildOperations: () => structuredClone(proposal.operations) as EngineeringOperation[],
      expectedBaseDigest: proposal.baseSchematicDigest,
    });
    expect(smuggled.ok).toBe(false);
    if (smuggled.ok) throw new Error("unreachable");
    expect(smuggled.reasonCode).toBe("stale_revision");
    expect(smuggled.diagnostics).toContain("EXPECTED_BASE_DIGEST_MISMATCH");
    const after = await editor.execute(moved.state, { commandId: "schematic.set-property", label: "noop probe", buildOperations: () => [] });
    if (!after.ok) throw new Error("probe rejected");
    expect(schematicStateDigest(after.state)).toBe(digestBefore);
  });

  it("7+8+9. unknown target, missing pin data, and theory rename each block the COMPLETE proposal", () => {
    const state = baseState();
    for (const [ops, code] of [
      [[{ op: "set-value", target: "R1", value: "1" }, { op: "set-value", target: "GHOST", value: "2" }], "unknown-target"],
      [[{ op: "set-value", target: "R1", value: "1" }, { op: "delete", target: "U1" }], "pins-unavailable"],
      [[{ op: "set-value", target: "R1", value: "1" }, { op: "rename", target: "R2", refDes: "R7" }], "unsupported-theory-rename"],
    ] as const) {
      const outcome = sealTier1Proposal({
        state,
        compilation: compileTier1Proposal(state, { ops: ops as never, pinsByPartId: new Map() }),
        provenance: { provider: "anthropic", note: "", instruction: "" },
        now: 1_000_000,
        scope: FIXTURE_SCOPE,
        // B16.0.1 §E: the sealed authorization binding (the test's human actor).
        authorization: buildAuthorizationBinding({ principalId: HUMAN.actorId, scope: { tenantId: FIXTURE_SCOPE.tenantId, projectId: FIXTURE_SCOPE.projectId, branchId: FIXTURE_SCOPE.branchId } }),
      });
      expect(outcome.kind).toBe("blocked");
      if (outcome.kind !== "blocked") throw new Error("unreachable");
      expect(outcome.blockers.map((blocker) => blocker.code)).toEqual([code]);
      // The valid first op never became an applicable proposal.
    }
  });

  it("10. a rejected canonical transaction is never followed by another mutation (and the legacy rename side channel is gone)", async () => {
    const state = baseState();
    const editor = session();
    const before = schematicStateDigest(state);
    // An operation batch that fails canonical validation mid-batch…
    const rejected = await editor.execute(state, {
      commandId: "schematic.edit-tier1-apply",
      label: "Invalid batch",
      buildOperations: () => [
        { operationId: "op:ok", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "5k" } },
        { operationId: "op:bad", schemaVersion: 1, units: "px", kind: "schematic_delete_component", family: "theory", componentId: "R1", removeWireIds: ["missing-wire"], removeNetLabelIds: [] },
      ],
    });
    expect(rejected.ok).toBe(false);
    const probe = await editor.execute(state, { commandId: "schematic.set-property", label: "noop probe", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(schematicStateDigest(probe.state)).toBe(before);
    // Structural tripwire: the page has no legacy theory-rename mutation path.
    const pageSource = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");
    expect(pageSource.includes("legacyTheoryRenames")).toBe(false);
  });
});

// ─── §2 Authority closure ────────────────────────────────────────────────────

describe("B06.1 §2 — verified authority only via the bundle adapter", () => {
  it("11+12. plain caller-supplied verified-atomic status, forged identifiers, and structural clones are all rejected", () => {
    const state = baseState();
    const attempts: Array<unknown> = [
      { status: "verified-atomic", atomicPartRevisionId: "rev-x" },
      { status: "catalog-unverified", atomicPartRevisionId: "rev-x" },
      { status: "catalog-unverified", mappingCertificateId: "cert-x" },
    ];
    for (const authority of attempts) {
      const planned = planSchematicReplacement(state, {
        componentId: "u1-id",
        target: { partId: "lib:part-b", pins: PART_B_PINS, authority: authority as never },
        currentPins: PART_A_PINS,
      });
      expect(planned.ok).toBe(false);
      if (planned.ok) throw new Error("unreachable");
      expect(planned.refusal).toBe("ambiguous-authority");
    }
    // A structural clone of a REAL authority instance is not the branded class.
    const real = consumeFor(state, makeBundle(state));
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error("unreachable");
    const forged = JSON.parse(JSON.stringify({ ...real.authority })) as never;
    const viaForged = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-b", pins: PART_B_PINS, authority: forged },
      currentPins: PART_A_PINS,
    });
    expect(viaForged.ok).toBe(false);
    if (viaForged.ok) throw new Error("unreachable");
    expect(viaForged.refusal).toBe("ambiguous-authority");
  });

  it("13. valid pinned authority works ONLY through the approved adapter, and binds component + target part", () => {
    const state = baseState();
    const consumed = consumeFor(state, makeBundle(state));
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) throw new Error("unreachable");
    expect(consumed.authority).toBeInstanceOf(VerifiedReplacementAuthority);
    expect(JSON.stringify(consumed.authority)).toBe("\"[verified-replacement-authority]\"");
    const planned = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-b", pins: PART_B_PINS, authority: consumed.authority },
      currentPins: PART_A_PINS,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error("unreachable");
    expect(planned.plan.authorityStatus).toBe("verified-atomic");
    // The SAME instance cannot authorize a different target part.
    const wrongTarget = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-z", pins: PART_B_PINS, authority: consumed.authority },
      currentPins: PART_A_PINS,
    });
    expect(wrongTarget.ok).toBe(false);
  });

  it("14. stale, wrong-scope, wrong-revision, wrong-part, unverified, candidate-only, and conflicting resources are rejected", () => {
    const state = baseState();
    const cases: Array<{ result: ReturnType<typeof consumeFor>; code: string }> = [
      { result: consumeFor(state, makeBundle(state, { freshness: "stale" })), code: "stale_or_unavailable" },
      { result: consumeFor(state, makeBundle(state, { scope: { ...SCOPE, projectId: "someone-elses-project" } })), code: "wrong_scope" },
      { result: consumeFor(state, makeBundle(state), { expectedCanonicalRevision: "eng1-different-head" }), code: "wrong_revision" },
      { result: consumeFor(state, makeBundle(state), { targetPartId: "lib:part-q" }), code: "wrong_part" },
      { result: consumeFor(state, makeBundle(state, { authorityStatus: "unverified" })), code: "not_verified" },
      { result: consumeFor(state, makeBundle(state, { record: { lifecycle: "candidate", selectedPart: undefined } })), code: "not_verified" },
      { result: consumeFor(state, makeBundle(state, { record: null })), code: "missing_authority_record" },
      { result: consumeFor(state, makeBundle(state, { extraRecords: [{ authorityRecordId: "auth:dup", componentId: "u1-id", projectId: SCOPE.projectId, authorityRevision: "rev-2", lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none", footprintAsset: "available", mappingVerification: "verified" }] })), code: "not_verified" },
      { result: consumeFor(state, makeBundle(state), { atomicPartRevisionId: "rev-imposter" }), code: "asset_mismatch" },
    ];
    for (const { result, code } of cases) {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.code).toBe(code);
    }
  });

  it("15. consumed authority resource ids + digests enter the durable transaction record", async () => {
    const state = baseState();
    const bundle = makeBundle(state);
    const consumed = consumeFor(state, bundle);
    if (!consumed.ok) throw new Error("authority setup failed");
    const planned = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-b", pins: PART_B_PINS, authority: consumed.authority },
      currentPins: PART_A_PINS,
    });
    if (!planned.ok) throw new Error("plan refused");
    const service = await EngineeringTransactionService.open(projectFor(state), { buildId: "b061-test", store: new InMemoryAtomicProjectStore() });
    const executor = new CanonicalExecutor(service, ACTION_COVERAGE_REGISTRY, { interactiveChannel: createEditorSessionChannel("b061 test") });
    const result = await executor.execute({
      commandId: "schematic.replace-component",
      actor: HUMAN,
      expectedRevision: service.currentRevision(),
      idempotencyKey: "auth-1",
      reason: "Verified replacement",
      operations: [planned.operation],
      provenance: { source: "ui" },
    });
    expect(result.status).toBe("executed");
    const record = service.durableRecords()[0];
    const operation = record.transaction.operations[0];
    expect(operation.kind).toBe("schematic_replace_component");
    if (operation.kind !== "schematic_replace_component") throw new Error("unreachable");
    expect(operation.consumedAuthorityResources).toEqual([
      { resourceId: "res:canonical", contentDigest: bundle.canonicalState.contentDigest },
      { resourceId: "res:authority", contentDigest: bundle.auxiliary[0].contentDigest },
    ]);
  });
});

// ─── §3 Net-label-safe replacement ───────────────────────────────────────────

describe("B06.1 §3 — label connectivity", () => {
  it("16+17. label-only connectivity moves safely, atomically with wire endpoints, with ONE exact inverse (undo digest-identical)", async () => {
    const state = baseState();
    const planned = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-d", pins: PART_D_PINS },
      currentPins: PART_A_PINS,
      explicitPinMapping: [{ fromPin: "1", toPin: "3" }, { fromPin: "2", toPin: "4" }],
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error("unreachable");
    // Pin 2 is label-only; it may be reported preserved ONLY because the
    // label move is part of the plan and operation.
    expect(planned.plan.preservedConnections).toContain("2");
    expect(planned.plan.netLabelMoves.map((move) => move.labelId)).toEqual(["l1"]);
    expect(planned.operation.kind === "schematic_replace_component" && planned.operation.netLabelMoves).toHaveLength(1);

    const editor = session();
    const before = schematicStateDigest(state);
    const result = await editor.execute(state, { commandId: "schematic.replace-component", label: "Replace U1", buildOperations: () => [planned.operation] });
    if (!result.ok) throw new Error("replace rejected");
    const movedLabel = result.state.netLabels!.find((label) => label.id === "l1")!;
    expect(movedLabel.position).not.toEqual({ x: 320, y: 100 });
    // Exact undo restores wire endpoint AND label position digest-identically.
    await editor.reconcileHistoryStep("undo", state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");
    const probe = await editor.execute(state, { commandId: "schematic.set-property", label: "noop probe", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(schematicStateDigest(probe.state)).toBe(before);
  });

  it("17b. a drifted label position fails the operation's precondition atomically", async () => {
    const state = baseState();
    const planned = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-d", pins: PART_D_PINS },
      currentPins: PART_A_PINS,
      explicitPinMapping: [{ fromPin: "1", toPin: "3" }, { fromPin: "2", toPin: "4" }],
    });
    if (!planned.ok) throw new Error("plan refused");
    // The label moves before the operation lands (forged/stale plan).
    const drifted = structuredClone(state);
    drifted.netLabels![0].position = { x: 900, y: 900 };
    const editor = session();
    const result = await editor.execute(drifted, { commandId: "schematic.replace-component", label: "Replace U1", buildOperations: () => [planned.operation] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics.some((d) => d.includes("LABEL_POSITION_PRECONDITION_FAILED") || d.includes("OBJECT_NOT_FOUND"))).toBe(true);
  });

  it("18. dropped label connectivity refuses without acknowledgement and is explicitly surfaced when acknowledged", () => {
    const state = baseState();
    const onePin = [pin("1", "A", -2.5)];
    const refused = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-f", pins: onePin },
      currentPins: PART_A_PINS,
      explicitPinMapping: [{ fromPin: "1", toPin: "1" }],
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.refusal).toBe("unacknowledged-dropped-connections");
    expect(refused.pins).toEqual(["2"]);
    const acknowledged = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-f", pins: onePin },
      currentPins: PART_A_PINS,
      explicitPinMapping: [{ fromPin: "1", toPin: "1" }],
      acknowledgeDroppedPins: ["2"],
    });
    expect(acknowledged.ok).toBe(true);
    if (!acknowledged.ok) throw new Error("unreachable");
    expect(acknowledged.plan.preservedConnections).not.toContain("2");
    expect(acknowledged.plan.warnings.some((warning) => warning.includes("VOUT"))).toBe(true);
  });

  it("the committed B06.1 connectivity fixtures match the implementation", () => {
    const committedPath = resolve(process.cwd(), "artifacts/ai-control-plane-b06-1/replacement-connectivity-fixtures.json");
    expect(existsSync(committedPath), "run: npx tsx scripts/generate-b06-schematic-artifacts.ts").toBe(true);
    expect(readFileSync(committedPath, "utf8").replaceAll("\r\n", "\n")).toBe(renderReplacementConnectivityEvidence());
    const evidence = buildReplacementConnectivityEvidence();
    expect(evidence.fixtures.every((fixture) => fixture.inverseRoundTripExact)).toBe(true);
    expect(evidence.refusals.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── §4 Durable production session ───────────────────────────────────────────

describe("B06.1 §4 — one durable authoritative schematic head", () => {
  it("19. the canonical head survives session disposal and recreation over the same store", async () => {
    const store = new InMemoryAtomicProjectStore();
    const state = baseState();
    const first = session("p-durable", store);
    await first.openForProject(state, null);
    const edited = await first.execute(state, {
      commandId: "schematic.set-property",
      label: "Edit",
      buildOperations: () => [{ operationId: "op:a", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "42k" } }],
    });
    if (!edited.ok) throw new Error("edit rejected");
    const mark = edited.headMark!;
    expect(mark.headSequence).toBe(1);
    first.dispose();

    const second = session("p-durable", store);
    const outcome = await second.openForProject(edited.state, mark);
    expect(outcome.status).toBe("resumed");
    expect(second.headMark()?.headSequence).toBe(1);
    expect(second.headMark()?.canonicalStateDigest).toBe(mark.canonicalStateDigest);
    expect(second.lineageId).toBe(mark.lineageId);
  });

  it("20. persistence failure leaves visible and canonical state unchanged; the retry succeeds idempotently", async () => {
    let fail = false;
    const store = new InMemoryAtomicProjectStore((phase) => { if (fail && phase === "before_commit") throw new Error("DISK_FULL"); });
    const state = baseState();
    const editor = session("p-fail", store);
    await editor.openForProject(state, null);
    const markBefore = editor.headMark()!;
    fail = true;
    const request = {
      commandId: "schematic.set-property",
      label: "Edit",
      idempotencyKey: "retry-1",
      buildOperations: () => [{ operationId: "op:a", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "42k" } }] as EngineeringOperation[],
    };
    const failed = await editor.execute(state, request);
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error("unreachable");
    expect(failed.reasonCode).toBe("persistence_failed");
    expect(editor.headMark()).toEqual(markBefore);
    const probe = await editor.execute(state, { commandId: "schematic.set-property", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(schematicStateDigest(probe.state)).toBe(schematicStateDigest(state));
    fail = false;
    const retried = await editor.execute(state, request);
    expect(retried.ok && retried.status === "executed").toBe(true);
  });

  it("21. a STALE SavedProject projection cannot overwrite the newer canonical head; newer legacy edits rebase instead", async () => {
    const store = new InMemoryAtomicProjectStore();
    const stale = baseState();
    const first = session("p-stale", store);
    await first.openForProject(stale, null);
    const edited = await first.execute(stale, {
      commandId: "schematic.set-property",
      label: "Edit",
      buildOperations: () => [{ operationId: "op:a", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "42k" } }],
    });
    if (!edited.ok) throw new Error("edit rejected");
    first.dispose();

    // Reload where the projection is the PRE-EDIT state with NO mark (its
    // autosave never saw the canonical commit): canonical wins.
    const second = session("p-stale", store);
    const outcome = await second.openForProject(stale, null);
    expect(outcome.status).toBe("recovered-canonical");
    if (outcome.status !== "recovered-canonical") throw new Error("unreachable");
    expect(outcome.state.components.find((c) => c.id === "R1")?.value).toBe("42k");
    // B06.2: the session is not ready (and exposes no head mark) until the
    // UI proves adoption of the recovered state.
    expect(second.lifecycle).toBe("hydrating");
    expect(second.headMark()).toBeNull();
    expect(second.confirmAdoption(outcome.state)).toBe(true);
    expect(second.headMark()?.headSequence).toBe(1);
    second.dispose();

    // Reload where the projection KNOWS the head (mark matches) but carries
    // additional legacy edits: the projection wins and the lineage rebases.
    const legacyEdited = structuredClone(edited.state);
    legacyEdited.components.push({ id: "R99", type: "resistor", x: 700, y: 700, rotation: 0, value: "9k" });
    const third = session("p-stale", store);
    const rebased = await third.openForProject(legacyEdited, edited.headMark!);
    expect(rebased.status).toBe("rebased-local-newer");
    expect(third.headMark()?.headSequence).toBe(0); // fresh lineage genesis
  });

  it("21b. B06.2: corrupt durable history fails closed — preserved, mutations disabled, explicit recovery quarantines before a fresh lineage", async () => {
    const store = new InMemoryAtomicProjectStore();
    const state = baseState();
    const first = session("p-corrupt", store);
    await first.openForProject(state, null);
    first.dispose();
    // Corrupt the stored envelope raw (bypassing integrity maintenance).
    const envelope = await store.load("p-corrupt", "main");
    (envelope!.canonicalSnapshot as { schematic?: unknown }).schematic = { hacked: true };
    store.unsafeSetRaw("p-corrupt", "main", envelope!);

    const other = session("p-corrupt", store);
    const outcome = await other.openForProject(state, null);
    expect(outcome.status).toBe("corrupt-history");
    expect(other.lifecycle).toBe("conflicted");
    // The corrupt envelope was NOT overwritten (raw value intact)…
    const untouched = await store.load("p-corrupt", "main");
    expect(untouched?.canonicalSnapshot.schematic).toEqual({ hacked: true });
    // …and mutations are structurally rejected with a truthful outcome.
    const refused = await other.execute(state, { commandId: "schematic.set-property", label: "Edit", buildOperations: () => [{ operationId: "op:a", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "5k" } }] });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.reasonCode).toBe("session_conflicted");
    // Explicit recovery: quarantine the raw corrupt value, then start fresh.
    const recovered = await other.recoverStartFresh(state);
    expect(recovered.status).toBe("fresh");
    expect(other.lifecycle).toBe("ready");
    expect(store.quarantined("p-corrupt", "main").length).toBeGreaterThanOrEqual(1);
    const edited = await other.execute(state, { commandId: "schematic.set-property", label: "Edit", buildOperations: () => [{ operationId: "op:a", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "5k" } }] });
    expect(edited.ok).toBe(true);
  });

  it("22. project switching isolates persistence and lineage over one shared store", async () => {
    const store = new InMemoryAtomicProjectStore();
    const stateOne = baseState();
    const stateTwo = baseState();
    const one = session("p-one", store);
    const two = session("p-two", store);
    await one.openForProject(stateOne, null);
    await two.openForProject(stateTwo, null);
    expect(one.lineageId).not.toBe(two.lineageId);
    const editedOne = await one.execute(stateOne, { commandId: "schematic.set-property", label: "Edit", buildOperations: () => [{ operationId: "op:a", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "111k" } }] });
    if (!editedOne.ok) throw new Error("edit rejected");
    // Project two's head is untouched.
    expect(two.headMark()?.headSequence).toBe(0);
    const reopenedTwo = session("p-two", store);
    const outcome = await reopenedTwo.openForProject(stateTwo, two.headMark());
    expect(outcome.status).toBe("resumed");
    expect(reopenedTwo.headMark()?.headSequence).toBe(0);
  });
});

// ─── §5 Serialized planning ──────────────────────────────────────────────────

describe("B06.1 §5 — serialized planning", () => {
  it("23. two rapid commands from the same React snapshot serialize against successive heads — the first edit is never erased", async () => {
    const state = baseState();
    const editor = session("p-rapid");
    // Both commands capture the SAME pre-edit snapshot (the React reality).
    const [first, second] = await Promise.all([
      editor.execute(state, {
        commandId: "schematic.set-property",
        label: "Edit R1",
        buildOperations: () => [{ operationId: "op:r1", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "111k" } }],
      }),
      editor.execute(state, {
        commandId: "schematic.set-property",
        label: "Edit R2",
        buildOperations: () => [{ operationId: "op:r2", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R2", patch: { value: "222k" } }],
      }),
    ]);
    if (!first.ok || !second.ok) throw new Error("rapid commands rejected");
    // The SECOND result contains BOTH edits — no rebase erased the first.
    expect(second.state.components.find((c) => c.id === "R1")?.value).toBe("111k");
    expect(second.state.components.find((c) => c.id === "R2")?.value).toBe("222k");
    expect(editor.headMark()?.headSequence).toBe(2);
    expect(editor.events.filter((e) => e.kind === "rebased")).toEqual([]);
    expect(editor.events.filter((e) => e.kind === "executed")).toHaveLength(2);
  });
});

// ─── §6 Registry, exposure, and import boundary ──────────────────────────────

describe("B06.1 §6 — registry truth and boundaries", () => {
  it("24. proposal and apply have separate, accurate registry records", () => {
    const propose = ACTION_COVERAGE_REGISTRY.find((record) => record.id === "schematic.edit-tier1-propose");
    const apply = ACTION_COVERAGE_REGISTRY.find((record) => record.id === "schematic.edit-tier1-apply");
    expect(propose?.kind).toBe("propose");
    expect(propose?.approvalTier).toBe("none");
    expect(propose?.mutationAuthority.startsWith("NONE")).toBe(true);
    expect(apply?.kind).toBe("destructive");
    expect(apply?.toolExposure).toBe("none");
    expect(apply?.sources.some((source) => source.includes("app/api/"))).toBe(false);
    const route = API_ROUTE_COVERAGE.find((entry) => entry.path === "/api/schematic/edit");
    expect(route?.recordId).toBe("schematic.edit-tier1-propose");
    expect(route?.class).toBe("propose");
    // Kernel: propose is NOT executable; apply is.
    expect(resolveExecutorContract("schematic.edit-tier1-propose")?.executable ?? false).toBe(false);
    expect(resolveExecutorContract("schematic.edit-tier1-apply")?.executable).toBe(true);
  });

  it("25. the APPLY command never appears in the tool catalog; the propose command owns ONLY the sealed proposal tool", () => {
    // [B09] the sealed tier-1 PROPOSAL boundary is now a registered agent
    // tool (proposal-artifact side effects only). Applying remains a
    // human-only destructive command with no descriptor anywhere.
    const proposeOwners = sirkitToolRegistry().list().filter((descriptor) => descriptor.owningCommandId === "schematic.edit-tier1-propose");
    expect(proposeOwners.map((descriptor) => descriptor.toolId)).toEqual(["sirkit.schematic.propose-tier1-edit"]);
    expect(proposeOwners[0]!.operationClass).toBe("propose");
    expect(proposeOwners[0]!.sideEffects).toBe("proposal-artifact");
    for (const descriptor of sirkitToolRegistry().list()) {
      expect(descriptor.owningCommandId).not.toBe("schematic.edit-tier1-apply");
    }
  });

  it("no production file outside the approved set imports the authority-construction module, and the barrel does not export it", { timeout: 120_000 }, async () => {
    const approved = new Set([
      "app/lib/engineering/schematic-plans.ts",
      "app/lib/engineering/schematic-replay-evidence.ts",
      // B06.2: the canonical executor VERIFIES runtime grants by registry +
      // class identity (it never creates them) — the enforcement point.
      "app/lib/engineering/executor.ts",
      // B14: the replacement-proposal assembler is the ONE server-side
      // composition root that consumes authority for proposals and apply-time
      // recompilation; every grant it mints is either retired before the
      // sealed artifact leaves the assembler or handed to the approved
      // replacement service, which retires it on every terminal path.
      "app/lib/engineering/replacement-proposal-assembler.ts",
    ]);
    const root = process.cwd();
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "__tests__" || entry === ".next" || entry === ".git" || entry === "vendor" || entry === "artifacts" || entry === "data" || entry === "public") continue;
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const rel = relative(root, full).replaceAll("\\", "/");
        if (rel === "app/lib/engineering/schematic-authority.internal.ts") continue;
        const source = readFileSync(full, "utf8");
        if (source.includes("schematic-authority.internal") && !approved.has(rel)) offenders.push(rel);
      }
    };
    walk(join(root, "app"));
    walk(join(root, "scripts"));
    walk(join(root, "lib"));
    expect(offenders, `unapproved authority-module imports: ${offenders.join(", ")}`).toEqual([]);
    const barrel = await import("../index");
    expect("VerifiedReplacementAuthority" in barrel).toBe(false);
    expect("consumeReplacementAuthority" in barrel).toBe(false);
  });

  it("B06.2: production resolves ONLY the durable browser store — no silent in-memory fallback exists", () => {
    const source = readFileSync(resolve(process.cwd(), "app/lib/engineering/schematic-session.ts"), "utf8");
    expect(source.includes("BrowserIndexedDbProjectStore(\"sirkit-schematic-canonical-v1\")")).toBe(true);
    // Without IndexedDB, production resolution yields NULL (→ `unavailable`),
    // never an in-memory store.
    expect(/typeof indexedDB === "undefined"\s*\?\s*null/.test(source)).toBe(true);
    expect(/\?\s*new InMemoryAtomicProjectStore\(\)/.test(source)).toBe(false);
  });
});
