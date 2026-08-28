/**
 * B16.0.1 §E/§F — REPLACEMENT sealed authorization binding and apply-time
 * membership reauthorization.
 *
 * STOP-CONDITION regression for the replacement (B14) family: "membership
 * revocation cannot stop an already-sealed proposal from applying." These
 * tests prove that it now CAN — through the PRODUCTION approval controller
 * (`approveAndApplyReplacement`), a revoked, logged-out, replaced, or
 * downgraded author, or a membership whose revision moved since sealing,
 * refuses the apply with ZERO mutation, ZERO journal entries, and ZERO
 * capability minted, while an unchanged still-authorized author commits
 * exactly once (real endpoint reauthorization over the platform fetch
 * boundary). A LEGACY V1 artifact refuses with the precise
 * `legacy-authorization-missing` code, and recovery/adoption can never adopt
 * a receipt under another principal or membership revision.
 *
 * Real composition (production controller + service + real
 * SchematicEditorSession + coordinator + interlock + durable journal + the
 * REAL /api/replacement-authority handler); no provider, no credits.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { KicadPin } from "../../kicad/types";
import type { SchematicState } from "@/lib/schematic-types";
import { kicadPinWorldPos } from "@/app/lib/geometry";
import { SchematicEditorSession } from "../schematic-session";
import { InMemoryAtomicProjectStore } from "../persistence";
import { SchematicGestureCoordinator } from "../schematic-gesture-coordinator";
import { SchematicHistory } from "../../project/schematic-history";
import { adoptCanonicalResult } from "../../project/canonical-adoption";
import { ProjectCommitInterlock } from "../project-commit-interlock";
import { ApprovedMutationRegistry, ApprovedMutationAuditLedger } from "../approved-agent-mutations";
import {
  ApprovedMutationJournal,
  InMemoryApprovedMutationJournalStore,
  APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA,
} from "../approved-mutation-journal";
import { schematicStateDigest } from "../schematic-model";
import { engineeringDigest } from "../stable";
import { assembleReplacementProposal } from "../replacement-proposal-assembler";
import {
  REPLACEMENT_PROPOSAL_SCHEMA,
  REPLACEMENT_PROPOSAL_SCHEMA_V1,
  verifySealedReplacementProposalIntegrity,
  type SealedReplacementProposal,
} from "../replacement-proposals";
import { buildAuthorizationBinding, SCHEMATIC_PROPOSAL_AUTHORIZATION_SCHEMA } from "../proposal-authorization";
import { REPLACEMENT_RECEIPT_SCHEMA } from "../approved-replacement-mutations";
import { approveAndApplyReplacement } from "../../project/replacement-approval-controller.internal";
import type { MembershipReauthorization, MembershipReauthorizer } from "../../project/membership-reauthorization";
import { loadRunComponentAuthority } from "../component-authority-source";
import { pcbBoardInstanceId, PCB_BOARD_ASSEMBLY_VARIANT_ID, PCB_BOARD_HIERARCHY_PATH } from "../../pcb/board-identity";
import type { PublishedSymbolPinFacts } from "../replacement-pin-facts";
import { POST as REAUTH_POST } from "@/app/api/replacement-authority/route";
import {
  resetComponentAuthoritySourceFactory,
  resolveComponentAuthoritySource,
  setComponentAuthoritySourceFactory,
} from "@/app/api/chat/component-authority-runtime";
import { resetReplacementPinFactsSourceFactory, setReplacementPinFactsSourceFactory } from "@/app/api/chat/replacement-facts-runtime";
import {
  FIXTURE_AUTHORITY_VARIANT,
  FIXTURE_EXACT,
  matchingAtomicConfirmer,
  validApprovedAggregate,
} from "./_authority-fixtures";

// ─── Fixtures (aligned with b14-1-production-integration) ────────────────────

const PROJECT = "p-b1601r";
const SCOPE = { tenantId: "local", projectId: PROJECT, branchId: "main" } as const;
const COMPONENT = "u1-id";
const PRINCIPAL = "user-alice";
const REVISION = "membership:rev-7";

const AUTHORIZED_LIVE: MembershipReauthorization = {
  ok: true, principalId: PRINCIPAL, role: "pcb_editor", membershipRevision: REVISION,
  scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId },
};

function reauthorizerReturning(live: MembershipReauthorization): MembershipReauthorizer {
  return async () => live;
}

function pin(number: string, name: string, xMm: number): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 };
}
const PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const U1 = { id: COMPONENT, partId: "lib:part-a", x: 300, y: 100, rotation: 0 as const, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" };

function baseState(): SchematicState {
  const pin1 = kicadPinWorldPos(U1, PINS[0]!);
  return { components: [], kicadComponents: [{ ...U1 }], wires: [{ id: "w1", vertices: [{ x: pin1.x - 60, y: pin1.y }, pin1] }], netLabels: [] };
}

function pinFactsFor(rev: string, symbol: string, certificateId: string): PublishedSymbolPinFacts {
  const ids = PINS.map((entry) => `pin-${entry.number}`);
  return {
    atomicPartRevisionId: rev, symbolAssetVersionId: symbol, pins: [...PINS],
    certificate: { id: certificateId, symbolVersionId: symbol, footprintVersionId: FIXTURE_EXACT.footprintAssetVersionId, symbolPinIds: ids, missingTerminalIds: [], missingSymbolPinIds: [], missingPadNumbers: [], ambiguous: [], state: "approved" },
    symbolPinIds: ids,
  };
}
const CURRENT_FACTS = pinFactsFor("rev-current", "sym-current", "cert-current");
const TARGET_FACTS = pinFactsFor(FIXTURE_EXACT.atomicPartRevisionId, FIXTURE_EXACT.symbolAssetVersionId, FIXTURE_EXACT.mappingCertificateId);

async function installSeams(): Promise<void> {
  const aggregate = await validApprovedAggregate(COMPONENT, {
    scopeOverrides: {
      ...SCOPE,
      boardInstanceId: pcbBoardInstanceId(PROJECT),
      hierarchyPath: [...PCB_BOARD_HIERARCHY_PATH],
      assemblyVariantIds: [FIXTURE_AUTHORITY_VARIANT],
    },
  });
  setComponentAuthoritySourceFactory(() => ({
    bindings: { async loadForComponent() { return [aggregate]; } },
    atomic: matchingAtomicConfirmer(),
  }));
  setReplacementPinFactsSourceFactory(() => ({
    loadPinFacts: async (revision) => (revision === "rev-current" ? CURRENT_FACTS : revision === FIXTURE_EXACT.atomicPartRevisionId ? TARGET_FACTS : null),
  }));
}

/** Route the PLATFORM fetch boundary into the real endpoint handler (the
 *  production replacement-authority channel's transport, unmodified). */
function stubPlatformFetch(): void {
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    if (!href.includes("/api/replacement-authority")) throw new Error(`unexpected fetch: ${href}`);
    const { signal: _signal, ...rest } = (init ?? {}) as RequestInit & { signal?: unknown };
    return REAUTH_POST(new Request(new URL(href, "http://localhost").toString(), rest as RequestInit));
  });
}

interface Composition {
  editor: SchematicEditorSession;
  coordinator: SchematicGestureCoordinator;
  visibleDigest(): string;
  executedCount(): number;
  journalStore: InMemoryApprovedMutationJournalStore;
  registry: ApprovedMutationRegistry;
  proposal: SealedReplacementProposal;
}

/** The full production composition: seams + fetch boundary + editor session +
 *  a proposal sealed from the SAME durable authority the endpoint serves at
 *  apply time (so the deterministic recompile byte-matches). */
async function composition(): Promise<Composition> {
  await installSeams();
  stubPlatformFetch();
  const state = baseState();
  const editor = new SchematicEditorSession({ ...SCOPE }, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(state, null);
  let visible = structuredClone(state);
  const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "open" });
  const coordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, next) => {
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {}, history: () => history,
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative),
        historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {},
      }, label, next);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => {},
  });
  // Seal from the SAME server-owned authority projection the reauthorization
  // endpoint derives (endpoint-identical loader call), so apply-time fresh
  // facts byte-match the reviewed artifact.
  const source = resolveComponentAuthoritySource({ ...SCOPE });
  const authority = await loadRunComponentAuthority(source, {
    scope: { ...SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT) },
    canonicalRevision: "replacement-reauthorization",
    componentInstanceIds: [COMPONENT],
    hierarchyPath: PCB_BOARD_HIERARCHY_PATH,
    assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID,
  });
  if (!authority) throw new Error("fixture authority must load");
  const sealed = assembleReplacementProposal({
    state, componentId: COMPONENT,
    authority: { records: [...authority.records], candidates: [...authority.candidates] },
    scope: { ...SCOPE, headMark: editor.headMark()! },
    // §E: the verified author this proposal is authorized for.
    authorization: buildAuthorizationBinding({ principalId: PRINCIPAL, membershipRevision: REVISION, scope: SCOPE }),
    currentPinFacts: CURRENT_FACTS, targetPinFacts: TARGET_FACTS,
    provenance: { provider: "anthropic", note: "n", instruction: "replace it" },
    now: Date.now(),
  });
  if (sealed.kind !== "sealed") throw new Error("fixture must seal: " + JSON.stringify(sealed));
  return {
    editor, coordinator,
    visibleDigest: () => schematicStateDigest(visible),
    executedCount: () => editor.events.filter((event) => event.kind === "executed").length,
    journalStore: new InMemoryApprovedMutationJournalStore(),
    registry: new ApprovedMutationRegistry(),
    proposal: sealed.proposal,
  };
}

function applyDeps(c: Composition, reauthorize: MembershipReauthorizer, proposal?: SealedReplacementProposal) {
  return {
    proposal: proposal ?? c.proposal,
    session: c.editor, gateway: c.coordinator, interlock: new ProjectCommitInterlock(),
    journal: new ApprovedMutationJournal(c.journalStore, SCOPE),
    stillCurrent: () => true, currentProjectId: PROJECT, currentBranchId: "main",
    originRunId: "run-b1601", registry: c.registry, audit: new ApprovedMutationAuditLedger(),
    reauthorize,
  };
}

async function journalEntryCount(store: InMemoryApprovedMutationJournalStore): Promise<number> {
  const raw = await store.load(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId) as { entries?: unknown[] } | null;
  return raw?.entries?.length ?? 0;
}

function resealEntry(entry: Record<string, unknown>): void {
  const body = { ...entry };
  delete body.integrity;
  entry.integrity = engineeringDigest({ schema: APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA, body });
}

function resealReceipt(receipt: Record<string, unknown>): void {
  const body = { ...receipt };
  delete body.receiptId;
  receipt.receiptId = `arr-${engineeringDigest({ schema: "sirkit.approved-replacement-receipt-id.v2", body }).slice(5)}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetComponentAuthoritySourceFactory();
  resetReplacementPinFactsSourceFactory();
});

// ─── §E: the sealed authorization binding ───────────────────────────────────

describe("B16.0.1 §E — the replacement sealed authorization binding", () => {
  it("binds the verified principal, membership revision, scope, and apply role, and verifies", async () => {
    const c = await composition();
    expect(c.proposal.schema).toBe(REPLACEMENT_PROPOSAL_SCHEMA);
    expect(c.proposal.authorization).toEqual({
      authorizationSchema: SCHEMATIC_PROPOSAL_AUTHORIZATION_SCHEMA,
      principalId: PRINCIPAL, membershipRevision: REVISION,
      tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId,
      requiredApplyRole: "pcb_editor",
    });
    expect(verifySealedReplacementProposalIntegrity(c.proposal)).toEqual({ ok: true });
  });

  it("a tampered binding (principal swapped) fails the sealed identity digest", async () => {
    const c = await composition();
    const tampered = { ...structuredClone(c.proposal), authorization: { ...c.proposal.authorization, principalId: "user-mallory" } } as SealedReplacementProposal;
    const verdict = verifySealedReplacementProposalIntegrity(tampered);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("altered");
  });

  it("a LEGACY V1 artifact refuses with the precise code `legacy-authorization-missing` — never applied, never backfilled, reauthorization never consulted", async () => {
    const c = await composition();
    const { authorization: _dropped, ...withoutBinding } = structuredClone(c.proposal) as unknown as Record<string, unknown> & { authorization: unknown };
    const legacyV1 = { ...withoutBinding, schema: REPLACEMENT_PROPOSAL_SCHEMA_V1 } as unknown as SealedReplacementProposal;
    expect(verifySealedReplacementProposalIntegrity(legacyV1)).toMatchObject({ ok: false, code: "legacy-authorization-missing" });
    // The PRODUCTION controller refuses it too — before reauthorization, with
    // ZERO mutation and ZERO journal entries.
    let reauthCalls = 0;
    const outcome = await approveAndApplyReplacement(applyDeps(c, async () => { reauthCalls += 1; return AUTHORIZED_LIVE; }, legacyV1));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("verification-failed");
      expect(outcome.message).toContain("legacy-authorization-missing");
    }
    expect(reauthCalls).toBe(0);
    expect(c.executedCount()).toBe(0);
    expect(await journalEntryCount(c.journalStore)).toBe(0);
  });
});

// ─── §F: apply-time membership reauthorization through the controller ───────

describe("B16.0.1 §F — the replacement apply refuses a revoked/downgraded/replaced author", () => {
  const FOREIGN_SCOPE = { tenantId: SCOPE.tenantId, projectId: "proj-other", branchId: SCOPE.branchId };
  const denials: Array<[string, MembershipReauthorization, string]> = [
    ["revoked (no membership → 403)", { ok: false, code: "http-403", detail: "removed" }, "reauthorization-membership-unavailable"],
    ["logged out (401)", { ok: false, code: "http-401", detail: "unauthenticated" }, "reauthorization-membership-unavailable"],
    ["downgraded to viewer", { ...AUTHORIZED_LIVE, role: "viewer" }, "reauthorization-role-insufficient"],
    ["replaced by another principal", { ...AUTHORIZED_LIVE, principalId: "user-mallory" }, "reauthorization-principal-changed"],
    ["membership revision moved", { ...AUTHORIZED_LIVE, membershipRevision: "membership:rev-8" }, "reauthorization-membership-changed"],
    ["foreign project scope", { ...AUTHORIZED_LIVE, scope: FOREIGN_SCOPE }, "reauthorization-scope-changed"],
  ];

  for (const [label, live, expectedCode] of denials) {
    it(`refuses (${label}) with ZERO mutation and ZERO journal entries`, async () => {
      const c = await composition();
      const digestBefore = c.visibleDigest();
      const outcome = await approveAndApplyReplacement(applyDeps(c, reauthorizerReturning(live)));
      expect(outcome.ok, JSON.stringify(outcome)).toBe(false);
      if (outcome.ok) throw new Error("must refuse");
      expect(outcome.status).toBe("refused");
      expect(outcome.code).toBe(expectedCode);
      expect(outcome.message.endsWith("Nothing was changed.")).toBe(true);
      // ZERO mutation: no canonical transaction, no visible change; ZERO
      // journal entries (no document was ever written — not even prepared).
      expect(c.executedCount()).toBe(0);
      expect(c.visibleDigest()).toBe(digestBefore);
      expect(await journalEntryCount(c.journalStore)).toBe(0);
    });
  }

  it("a reauthorizer that THROWS fails closed (reauthorization-unavailable, zero mutation, zero journal entries)", async () => {
    const c = await composition();
    const outcome = await approveAndApplyReplacement(applyDeps(c, async () => { throw new Error("network down"); }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("must refuse");
    expect(outcome.code).toBe("reauthorization-unavailable");
    expect(outcome.message.endsWith("Nothing was changed.")).toBe(true);
    expect(c.executedCount()).toBe(0);
    expect(await journalEntryCount(c.journalStore)).toBe(0);
  });

  it("the still-authorized author COMMITS exactly once; the receipt carries the authorization identity; a same-membership replay never commits twice", async () => {
    const c = await composition();
    const beforeDigest = c.visibleDigest();
    const outcome = await approveAndApplyReplacement(applyDeps(c, reauthorizerReturning(AUTHORIZED_LIVE)));
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok || outcome.status !== "committed") throw new Error("must commit");
    expect(c.executedCount()).toBe(1);
    expect(c.visibleDigest()).not.toBe(beforeDigest);
    // §E tail — the V2 receipt binds the sealed authorization identity.
    expect(outcome.receipt.schema).toBe(REPLACEMENT_RECEIPT_SCHEMA);
    expect(outcome.receipt.schema).toBe("sirkit.approved-replacement-receipt.v2");
    expect(outcome.receipt.authorization).toEqual({ principalId: PRINCIPAL, membershipRevision: REVISION });
    expect(outcome.receipt.approvalActor).toBe("human:interactive");
    // Exactly once: a replay (fresh registry — "reload") is the idempotent
    // one-shot replay: the byte-identical original receipt, no second commit.
    const replay = await approveAndApplyReplacement({ ...applyDeps(c, reauthorizerReturning(AUTHORIZED_LIVE)), registry: new ApprovedMutationRegistry() });
    expect(replay.ok, JSON.stringify(replay)).toBe(true);
    if (!replay.ok) return;
    expect(replay.status).toBe("already-applied");
    if (replay.status !== "already-applied") return;
    expect(JSON.stringify(replay.receipt)).toBe(JSON.stringify(outcome.receipt));
    expect(replay.receipt.authorization).toEqual({ principalId: PRINCIPAL, membershipRevision: REVISION });
    expect(c.executedCount()).toBe(1);
  });

  it("even the ALREADY-APPLIED receipt lookup requires live reauthorization — a revoked author cannot read back the receipt", async () => {
    const c = await composition();
    const committed = await approveAndApplyReplacement(applyDeps(c, reauthorizerReturning(AUTHORIZED_LIVE)));
    expect(committed.ok).toBe(true);
    const revoked = await approveAndApplyReplacement({ ...applyDeps(c, reauthorizerReturning({ ok: false, code: "http-403", detail: "removed" })), registry: new ApprovedMutationRegistry() });
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) {
      expect(revoked.code).toBe("reauthorization-membership-unavailable");
      expect(JSON.stringify(revoked)).not.toContain("arr-");
    }
    expect(c.executedCount()).toBe(1);
  });
});

// ─── §E tail: recovery/adoption can never adopt a foreign authorization ─────

describe("B16.0.1 §E — replacement recovery cannot adopt a receipt under another principal/membership revision", () => {
  const forgeries: Array<[string, (authorization: Record<string, unknown>) => void]> = [
    ["different principal", (authorization) => { authorization.principalId = "user-mallory"; }],
    ["different membership revision", (authorization) => { authorization.membershipRevision = "membership:rev-999"; }],
  ];

  for (const [label, forge] of forgeries) {
    it(`a persisted receipt + entry re-recorded under a ${label} refuses recovery-required without exposing receipt data`, async () => {
      const c = await composition();
      const committed = await approveAndApplyReplacement(applyDeps(c, reauthorizerReturning(AUTHORIZED_LIVE)));
      if (!committed.ok || committed.status !== "committed") throw new Error("setup commit failed");
      // Forge the durable journal COHERENTLY (receipt AND entry share the
      // foreign authorization; all public checksums recomputed) — the
      // strongest forgery available to durable-state tampering.
      const raw = await c.journalStore.load(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId) as { entries: Array<Record<string, unknown>> };
      const entry = raw.entries[0]!;
      const receipt = structuredClone(entry.receipt) as Record<string, unknown>;
      forge(receipt.authorization as Record<string, unknown>);
      forge(entry.authorization as Record<string, unknown>);
      resealReceipt(receipt);
      entry.receipt = receipt;
      resealEntry(entry);
      c.journalStore.unsafeSetRaw(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId, raw);
      // A fresh composition surface (new registry — "reload") over the SAME
      // durable journal + canonical evidence: adoption refuses fail-closed.
      const replay = await approveAndApplyReplacement({ ...applyDeps(c, reauthorizerReturning(AUTHORIZED_LIVE)), registry: new ApprovedMutationRegistry() });
      expect(replay.ok, label).toBe(false);
      if (!replay.ok) {
        expect(replay.code).toBe("recovery-required");
        expect(JSON.stringify(replay)).not.toContain("arr-");
      }
      expect(c.executedCount()).toBe(1); // never re-executed
    });
  }
});
