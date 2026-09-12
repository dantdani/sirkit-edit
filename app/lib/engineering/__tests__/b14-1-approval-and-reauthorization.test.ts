/**
 * B14.1 §A/§B — the one-shot interactive approval capability and the
 * authentic reauthorization channel: every forgery/replay/scope/expiry
 * refusal, the exact-stale-copy closure (refused BEFORE journal.prepare and
 * before canonical execution), and the permanent import-boundary walkers.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
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
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "../approved-mutation-journal";
import { schematicStateDigest } from "../schematic-model";
import { applyApprovedReplacementProposal, type FreshReplacementFacts } from "../approved-replacement-mutations";
import { assembleReplacementProposal } from "../replacement-proposal-assembler";
import { issueReplacementApprovalIntent, consumeReplacementApprovalIntent, REPLACEMENT_APPROVAL_INTENT_TTL_MS } from "../replacement-approval.internal";
import { __createTestReplacementReauthorizationChannel, consumeReplacementReauthorization, createReplacementReauthorization } from "../../project/replacement-reauthorization";
import type { SealedReplacementProposal } from "../replacement-proposals";
import { buildAuthorizationBinding } from "../proposal-authorization";
import type { ComponentAuthorityRecord } from "../component-authority";
import type { PublishedSymbolPinFacts } from "../replacement-pin-facts";
import { sirkitToolRegistry } from "../tool-catalog";
import { isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

// ─── Fixtures (b14 family) ───────────────────────────────────────────────────

const PROJECT = "p-b141";
const SCOPE = { tenantId: "local", projectId: PROJECT, branchId: "main" } as const;

function pin(number: string, name: string, xMm: number): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 };
}
const PART_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const U1 = { id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0 as const, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-old", symbolAssetVersionId: "sym-old" };
function baseState(): SchematicState {
  const pin1 = kicadPinWorldPos(U1, PART_PINS[0]!);
  return { components: [], kicadComponents: [{ ...U1 }], wires: [{ id: "w1", vertices: [{ x: pin1.x - 60, y: pin1.y }, pin1] }], netLabels: [] };
}
function record(): ComponentAuthorityRecord {
  return {
    authorityRecordId: "auth:u1-id", componentId: "u1-id", projectId: PROJECT, authorityRevision: "rev-new",
    selectedPart: { mpn: "lib:part-b", manufacturer: "Fixture Semiconductor", provenance: "physical-binding" },
    lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none",
    footprintAsset: "available", mappingVerification: "verified",
    exactAuthority: { atomicPartRevisionId: "rev-new", mpn: "lib:part-b", manufacturer: "Fixture Semiconductor", symbolAssetVersionId: "sym-new", footprintAssetVersionId: "fp-new", mappingCertificateId: "cert-new", selectionRecordId: "sel-new" },
    evidenceRefs: ["binding:fixture:u1-id"],
  };
}
function pinFacts(rev: string, symbol: string, certificateId = "cert-new"): PublishedSymbolPinFacts {
  const ids = PART_PINS.map((entry) => `pin-${entry.number}`);
  return {
    atomicPartRevisionId: rev, symbolAssetVersionId: symbol, pins: [...PART_PINS],
    certificate: { id: certificateId, symbolVersionId: symbol, footprintVersionId: "fp-new", symbolPinIds: ids, missingTerminalIds: [], missingSymbolPinIds: [], missingPadNumbers: [], ambiguous: [], state: "approved" },
    symbolPinIds: ids,
  };
}
function freshFacts(): FreshReplacementFacts {
  return { records: [record()], candidates: [], currentPinFacts: pinFacts("rev-old", "sym-old", "cert-old"), targetPinFacts: pinFacts("rev-new", "sym-new") };
}
function channelFor(provider: () => FreshReplacementFacts | null) {
  return __createTestReplacementReauthorizationChannel(async (requestBody) => {
    const facts = provider();
    if (!facts) return { ok: false, text: "" };
    const parsed = JSON.parse(requestBody) as { nonce: string; componentInstanceId: string; scope: { projectId: string } };
    // [B14.2 §C] echo the exact correlation binding the endpoint would.
    const binding = { nonce: parsed.nonce, componentInstanceId: parsed.componentInstanceId, scope: { tenantId: "local", projectId: parsed.scope.projectId, branchId: "main" } };
    return { ok: true, text: JSON.stringify({ ok: true, ...facts, binding }) };
  });
}

const NOW = 5_000_000;

async function harness() {
  const state = baseState();
  const editor = new SchematicEditorSession({ tenantId: "local", projectId: PROJECT, branchId: "main" }, { store: new InMemoryAtomicProjectStore() });
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
  const mark = editor.headMark()!;
  const sealed = assembleReplacementProposal({
    state, componentId: "u1-id",
    authority: { records: [record()], candidates: [] },
    scope: { ...SCOPE, headMark: mark },
    // B16.0.1 §E: the sealer requires the server-verified authorization binding.
    authorization: buildAuthorizationBinding({ principalId: "user-fixture", scope: SCOPE }),
    currentPinFacts: pinFacts("rev-old", "sym-old", "cert-old"),
    targetPinFacts: pinFacts("rev-new", "sym-new"),
    provenance: { provider: "openai", note: "n", instruction: "i" },
    now: NOW,
  });
  if (sealed.kind !== "sealed") throw new Error("seal failed");
  const journalStore = new InMemoryApprovedMutationJournalStore();
  let tick = NOW + 1_000;
  const clock = (): number => { tick += 1_000; return tick; };
  const registry = new ApprovedMutationRegistry();
  const base = (proposal: SealedReplacementProposal) => ({
    proposal, session: editor, gateway: coordinator, interlock: new ProjectCommitInterlock(),
    journal: new ApprovedMutationJournal(journalStore, SCOPE),
    stillCurrent: () => true, currentProjectId: PROJECT, currentBranchId: "main",
    now: clock, registry, audit: new ApprovedMutationAuditLedger(),
    reauthorization: channelFor(freshFacts),
  });
  const intentFor = (proposal: SealedReplacementProposal, over: Partial<Parameters<typeof issueReplacementApprovalIntent>[0]> = {}) =>
    // B16.0.1 §E: the intent binds the sealed authorization identity, as the
    // production controller derives it from the reviewed proposal.
    issueReplacementApprovalIntent({
      proposalId: proposal.proposalId, scope: SCOPE, headMark: proposal.scope.headMark,
      authorization: { principalId: proposal.authorization.principalId, membershipRevision: proposal.authorization.membershipRevision },
      now: clock(), ...over,
    });
  return {
    editor, state, proposal: sealed.proposal, journalStore, clock, base, intentFor,
    executedCount: () => editor.events.filter((event) => event.kind === "executed").length,
    visibleDigest: () => schematicStateDigest(visible),
    journalEntries: async () => {
      const raw = await journalStore.load(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId) as { entries?: unknown[] } | null;
      return raw?.entries?.length ?? 0;
    },
  };
}

// ─── §A — the one-shot approval capability ───────────────────────────────────

describe("B14.1 §A — one-shot interactive approval intent", () => {
  it("no approval / plain forged / serialized / boolean-shaped tenders refuse BEFORE any journal or canonical work", async () => {
    const h = await harness();
    const forgeries: Array<[string, unknown]> = [
      ["missing", undefined],
      ["boolean", true],
      ["string", "human:interactive"],
      ["structural", { intentId: "rai-x", proposalId: h.proposal.proposalId, scope: SCOPE, headMark: h.proposal.scope.headMark, issuedAt: NOW, expiresAt: NOW + 999_999 }],
      ["serialized", JSON.parse(JSON.stringify(h.intentFor(h.proposal)))],
    ];
    for (const [label, approval] of forgeries) {
      const outcome = await applyApprovedReplacementProposal({ ...h.base(h.proposal), approval });
      expect(outcome.ok, label).toBe(false);
      if (!outcome.ok) expect(outcome.code, label).toBe("approval-required");
    }
    expect(h.executedCount()).toBe(0);
    expect(await h.journalEntries()).toBe(0);
  });

  it("wrong-proposal, wrong-scope, stale-head, and expired intents grant nothing", async () => {
    const h = await harness();
    const cases: Array<[string, unknown, (() => number) | undefined]> = [
      ["wrong-proposal", h.intentFor(h.proposal, { proposalId: "rprop-ffffffffffffffff" }), undefined],
      ["wrong-scope", h.intentFor(h.proposal, { scope: { ...SCOPE, projectId: "someone-else" } }), undefined],
      ["stale-head", h.intentFor(h.proposal, { headMark: { ...h.proposal.scope.headMark, headSequence: h.proposal.scope.headMark.headSequence + 1 } }), undefined],
      ["expired", h.intentFor(h.proposal, { now: NOW - REPLACEMENT_APPROVAL_INTENT_TTL_MS - 10_000 }), undefined],
    ];
    for (const [label, approval] of cases) {
      const outcome = await applyApprovedReplacementProposal({ ...h.base(h.proposal), approval });
      expect(outcome.ok, label).toBe(false);
      if (!outcome.ok) expect(outcome.code, label).toBe("approval-required");
    }
    expect(h.executedCount()).toBe(0);
  });

  it("an intent is ONE-SHOT: replay after success AND replay after a refusal both grant nothing", async () => {
    const h = await harness();
    const intent = h.intentFor(h.proposal);
    const first = await applyApprovedReplacementProposal({ ...h.base(h.proposal), approval: intent });
    expect(first.ok && first.status === "committed").toBe(true);
    const replay = await applyApprovedReplacementProposal({ ...h.base(h.proposal), approval: intent });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe("approval-required");
    expect(h.executedCount()).toBe(1);

    // A refused tender ALSO burns the intent (any tender consumes).
    const h2 = await harness();
    const burned = h2.intentFor(h2.proposal);
    const refused = await applyApprovedReplacementProposal({ ...h2.base(h2.proposal), approval: burned, reauthorization: channelFor(() => null) });
    expect(refused.ok).toBe(false);
    const retender = await applyApprovedReplacementProposal({ ...h2.base(h2.proposal), approval: burned });
    expect(retender.ok).toBe(false);
    if (!retender.ok) expect(retender.code).toBe("approval-required");
    expect(h2.executedCount()).toBe(0);
  });

  it("consumption failures are precisely classified", () => {
    // B16.0.1 §E: intents carry the sealed authorization identity.
    const AUTHZ = { principalId: "user-fixture", membershipRevision: "membership:unverified" };
    const issue = () => issueReplacementApprovalIntent({ proposalId: "rprop-aaaaaaaaaaaaaaaa", scope: SCOPE, headMark: { lineageId: "lin1-aaaaaaaaaaaaaaaa", headSequence: 1, canonicalStateDigest: "eng1-bbbbbbbbbbbbbbbb" }, authorization: AUTHZ, now: NOW });
    const intent = issue();
    const expected = { proposalId: "rprop-aaaaaaaaaaaaaaaa", scope: SCOPE, headMark: intent.headMark, authorization: AUTHZ, now: NOW + 1 };
    expect(consumeReplacementApprovalIntent(intent, expected)).toEqual({ ok: true });
    // burned on the first tender:
    expect(consumeReplacementApprovalIntent(intent, expected)).toEqual({ ok: false, code: "approval-replayed" });
    expect(consumeReplacementApprovalIntent(JSON.parse(JSON.stringify(intent)), expected)).toEqual({ ok: false, code: "approval-forged" });
    expect(JSON.stringify(intent)).toBe('"[replacement-approval-intent]"');
    // B16.0.1 §E: an intent minted under one authorization identity never
    // tenders an apply expecting another — precise wrong-authorization codes.
    expect(consumeReplacementApprovalIntent(issue(), { ...expected, authorization: { ...AUTHZ, principalId: "user-mallory" } }))
      .toEqual({ ok: false, code: "approval-wrong-authorization" });
    expect(consumeReplacementApprovalIntent(issue(), { ...expected, authorization: { ...AUTHZ, membershipRevision: "membership:rev-9" } }))
      .toEqual({ ok: false, code: "approval-wrong-authorization" });
  });
});

// ─── §B — authentic reauthorization ──────────────────────────────────────────

describe("B14.1 §B — authentic fresh reauthorization", () => {
  it("a structural adapter carrying an EXACT stale byte copy refuses BEFORE journal.prepare and before canonical execution", async () => {
    const h = await harness();
    const exactStaleCopy = JSON.parse(JSON.stringify(freshFacts())) as FreshReplacementFacts;
    const structural = {
      fetchFreshFacts: async () => exactStaleCopy,
      consume: async () => ({ facts: exactStaleCopy, provenance: { nonce: "n", requestedAt: NOW, expiresAt: NOW + 99_999 } }),
    };
    const outcome = await applyApprovedReplacementProposal({ ...h.base(h.proposal), approval: h.intentFor(h.proposal), reauthorization: structural });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("authority-unavailable");
    expect(h.executedCount()).toBe(0);          // no canonical execution
    expect(await h.journalEntries()).toBe(0);   // refused BEFORE journal.prepare
  });

  it("JSON round-trips and structural clones of a real channel authenticate nothing; channels are ONE-SHOT", async () => {
    const real = channelFor(freshFacts);
    expect(JSON.stringify(real)).toBe('"[replacement-reauthorization-channel]"');
    const cloned = { ...real };
    const request = { proposalId: "rprop-aaaaaaaaaaaaaaaa", componentInstanceId: "u1-id", currentAtomicPartRevisionId: "rev-old", scope: SCOPE, headMark: { lineageId: "lin1-aaaaaaaaaaaaaaaa", headSequence: 1, canonicalStateDigest: "eng1-bbbbbbbbbbbbbbbb" }, now: NOW };
    expect(await consumeReplacementReauthorization(cloned, request)).toBeNull();
    expect(await consumeReplacementReauthorization(JSON.parse(JSON.stringify(real)), request)).toBeNull();
    const first = await consumeReplacementReauthorization(real, request);
    expect(first).not.toBeNull();
    expect(first!.provenance.nonce.length).toBeGreaterThan(0);
    // ONE-SHOT: the same channel never serves a second consumption.
    expect(await consumeReplacementReauthorization(real, request)).toBeNull();
  });

  it("the PRODUCTION factory takes no injection parameters (no public fake-fetcher seam)", () => {
    expect(createReplacementReauthorization.length).toBe(0);
  });
});

// ─── Import boundaries (permanent walkers) ───────────────────────────────────

describe("B14.1 — capability import boundaries", () => {
  function walkProduction(onFile: (relPath: string, source: string) => void): void {
    const root = process.cwd();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (["node_modules", "__tests__", ".next", ".git", "vendor", "artifacts", "data", "public"].includes(entry)) continue;
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        onFile(relative(root, full).replaceAll("\\", "/"), readFileSync(full, "utf8"));
      }
    };
    walk(join(root, "app"));
    walk(join(root, "scripts"));
    walk(join(root, "lib"));
  }

  it("only the approval controller and the approved-replacement service reach the approval-intent module; the barrel exports nothing from it", () => {
    const approved = new Set([
      "app/lib/engineering/replacement-approval.internal.ts",
      "app/lib/engineering/approved-replacement-mutations.ts",
      "app/lib/project/replacement-approval-controller.internal.ts",
    ]);
    const offenders: string[] = [];
    walkProduction((relPath, source) => {
      if (source.includes("replacement-approval.internal") && !approved.has(relPath)) offenders.push(relPath);
    });
    expect(offenders).toEqual([]);
    const barrel = readFileSync(join(process.cwd(), "app/lib/engineering/index.ts"), "utf8");
    expect(barrel).not.toContain("replacement-approval");
  });

  it("no production file references the test-only reauthorization channel factory", () => {
    const offenders: string[] = [];
    walkProduction((relPath, source) => {
      if (relPath === "app/lib/project/replacement-reauthorization.ts") return; // the gated definition
      if (source.includes("__createTestReplacementReauthorizationChannel")) offenders.push(relPath);
    });
    expect(offenders).toEqual([]);
  });

  it("the provider registry still exposes ONLY read/propose tools — apply is never provider-callable", () => {
    for (const descriptor of sirkitToolRegistry().list()) {
      if (descriptor.agentExposed) expect(isAgentExposableDescriptor(descriptor), descriptor.toolId).toBe(true);
    }
  });
});
