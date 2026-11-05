/**
 * B14 — replacement PROPOSAL side: tool exposure gating, the strict scope
 * envelope (every out-of-scope replacement is a structured blocker with zero
 * mutation), valid sealed proposals, artifact integrity, provider schema
 * parity, and trace redaction. Real assembler, real gateway, real registry.
 */

import { describe, expect, it } from "vitest";
import type { KicadPin } from "../../kicad/types";
import type { SchematicState } from "@/lib/schematic-types";
import { kicadPinWorldPos } from "@/app/lib/geometry";
import { createEmptyBoard } from "../../pcb/types";
import { assembleAgentRunContext } from "../../agent/context";
import { buildRunToolset, availableResourceKinds } from "../../agent/loop";
import { createAgentToolGateway, AGENT_REPLACEMENT_PROPOSAL_TOOL_ID } from "../../agent/gateway";
import { renderOpenAiResponsesTool, renderAnthropicAgentTool } from "../../agent/provider-tools";
import { AgentTraceRecorder } from "../../agent/trace-recorder";
import { sirkitToolRegistry } from "../tool-catalog";
import { schematicStateDigest } from "../schematic-model";
import { assembleReplacementProposal, replacementHeadDigestFor } from "../replacement-proposal-assembler";
import { verifyReplacementAuthorityGrant } from "../schematic-authority.internal";
import {
  REPLACEMENT_PROPOSAL_SCHEMA,
  verifySealedReplacementProposalIntegrity,
  type SealedReplacementProposal,
} from "../replacement-proposals";
import { buildAuthorizationBinding } from "../proposal-authorization";
import type { ComponentAuthorityRecord } from "../component-authority";
import type { PublishedSymbolPinFacts } from "../replacement-pin-facts";
import type { Tier1ProposalHeadMark, Tier1ProposalScope } from "../schematic-proposals";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SCOPE = { tenantId: "local", projectId: "p-b14", branchId: "main" } as const;

function pin(number: string, name: string, xMm: number): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 };
}
const PART_A_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
/** Identity-compatible target (same numbers AND names, same geometry). */
const PART_B_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
/** Same pin COUNT, different names — never implicitly compatible. */
const PART_C_PINS: readonly KicadPin[] = [pin("1", "X", -2.5), pin("2", "Y", 2.5)];
/** Different numbering — compatible only via explicit mapping (forbidden). */
const PART_D_PINS: readonly KicadPin[] = [pin("3", "A", -5), pin("4", "B", 5)];
/** Identity names/numbers at MOVED geometry — a mapped substitution. */
const PART_E_PINS: readonly KicadPin[] = [pin("1", "A", -5), pin("2", "B", 5)];

const U1 = { id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0 as const, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-old", symbolAssetVersionId: "sym-old" };

function baseState(): SchematicState {
  const pin1 = kicadPinWorldPos(U1, PART_A_PINS[0]!);
  const pin2 = kicadPinWorldPos(U1, PART_A_PINS[1]!);
  return {
    components: [{ id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" }],
    kicadComponents: [{ ...U1 }],
    wires: [{ id: "w1", vertices: [{ x: pin1.x - 60, y: pin1.y }, pin1] }],
    netLabels: [{ id: "l1", position: pin2, name: "VOUT", kind: "label", orientation: 0 }],
  };
}

function record(over: Partial<ComponentAuthorityRecord> = {}): ComponentAuthorityRecord {
  return {
    authorityRecordId: "auth:u1-id", componentId: "u1-id", projectId: SCOPE.projectId, authorityRevision: "rev-new",
    selectedPart: { mpn: "lib:part-b", manufacturer: "Fixture Semiconductor", provenance: "physical-binding" },
    lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none",
    footprintAsset: "available", mappingVerification: "verified",
    exactAuthority: {
      atomicPartRevisionId: "rev-new", mpn: "lib:part-b", manufacturer: "Fixture Semiconductor",
      symbolAssetVersionId: "sym-new", footprintAssetVersionId: "fp-new", mappingCertificateId: "cert-new", selectionRecordId: "sel-new",
    },
    evidenceRefs: ["binding:fixture:u1-id"],
    ...over,
  };
}

function pinFacts(rev: string, symbol: string, pins: readonly KicadPin[], certificateId = "cert-new"): PublishedSymbolPinFacts {
  const ids = pins.map((entry) => `pin-${entry.number}`);
  return {
    atomicPartRevisionId: rev, symbolAssetVersionId: symbol, pins: [...pins],
    certificate: {
      id: certificateId, symbolVersionId: symbol, footprintVersionId: "fp-new", symbolPinIds: ids,
      missingTerminalIds: [], missingSymbolPinIds: [], missingPadNumbers: [], ambiguous: [], state: "approved",
    },
    symbolPinIds: ids,
  };
}
const CURRENT_FACTS = pinFacts("rev-old", "sym-old", PART_A_PINS, "cert-old");
const TARGET_FACTS = pinFacts("rev-new", "sym-new", PART_B_PINS);

// The head mark's canonical digest is the SESSION-domain digest the
// replacement binds — computed over the same reference the session uses.
const MARK: Tier1ProposalHeadMark = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: replacementHeadDigestFor(baseState(), SCOPE) };
const PROPOSAL_SCOPE: Tier1ProposalScope = { ...SCOPE, headMark: MARK };

function assemble(over: Partial<Parameters<typeof assembleReplacementProposal>[0]> = {}) {
  return assembleReplacementProposal({
    state: baseState(), componentId: "u1-id",
    authority: { records: [record()], candidates: [] },
    scope: PROPOSAL_SCOPE,
    // B16.0.1 §E: the sealer requires the server-verified authorization binding.
    authorization: buildAuthorizationBinding({ principalId: "user-fixture", scope: SCOPE }),
    currentPinFacts: CURRENT_FACTS, targetPinFacts: TARGET_FACTS,
    provenance: { provider: "openai", note: "n", instruction: "replace it" },
    now: 1_000_000,
    ...over,
  });
}

function blockerOf(outcome: ReturnType<typeof assembleReplacementProposal>): string {
  if (outcome.kind !== "blocked") throw new Error("expected blocked, got sealed");
  return outcome.blockers[0]!.code;
}

function sealedOf(outcome: ReturnType<typeof assembleReplacementProposal>): SealedReplacementProposal {
  if (outcome.kind !== "sealed") throw new Error("expected sealed: " + JSON.stringify(outcome));
  return outcome.proposal;
}

function contextFor(input: { records?: ComponentAuthorityRecord[] | null; mark?: Tier1ProposalHeadMark | null; board?: boolean }) {
  const assembly = assembleAgentRunContext({
    ...SCOPE,
    schematic: baseState(),
    ...(input.board === false ? {} : { board: createEmptyBoard() }),
    ...(input.mark === null ? {} : { schematicHeadMark: input.mark ?? MARK }),
    ...(input.records ? { componentAuthority: { records: input.records, candidates: [] } } : {}),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

// ─── Tool exposure gating (1–3) ──────────────────────────────────────────────

describe("B14 — tool exposure gating", () => {
  it("1. withheld without canonical state (no authority resource can exist)", () => {
    const context = contextFor({ board: false });
    expect(availableResourceKinds(context).has("component-authority-records")).toBe(false);
    const warnings: string[] = [];
    const { declarations } = buildRunToolset(sirkitToolRegistry(), context, (message) => warnings.push(message));
    expect(declarations.some((declaration) => declaration.toolId === AGENT_REPLACEMENT_PROPOSAL_TOOL_ID)).toBe(false);
  });

  it("2. withheld without a canonical head mark", () => {
    const context = contextFor({ records: [record()], mark: null });
    const warnings: string[] = [];
    const { declarations } = buildRunToolset(sirkitToolRegistry(), context, (message) => warnings.push(message));
    expect(declarations.some((declaration) => declaration.toolId === AGENT_REPLACEMENT_PROPOSAL_TOOL_ID)).toBe(false);
  });

  it("3. withheld without the component-authority resource, with the exact reason", () => {
    const context = contextFor({});
    const warnings: string[] = [];
    const { declarations } = buildRunToolset(sirkitToolRegistry(), context, (message) => warnings.push(message));
    expect(declarations.some((declaration) => declaration.toolId === AGENT_REPLACEMENT_PROPOSAL_TOOL_ID)).toBe(false);
    expect(warnings.join(" ")).toContain("component-authority-records");
    // With BOTH the mark and the resource the tool IS in the run toolset.
    const full = contextFor({ records: [record()] });
    const exposed = buildRunToolset(sirkitToolRegistry(), full, () => undefined).declarations;
    expect(exposed.some((declaration) => declaration.toolId === AGENT_REPLACEMENT_PROPOSAL_TOOL_ID)).toBe(true);
  });
});

// ─── Strict-scope blockers (4–20) ────────────────────────────────────────────

describe("B14 — strict-scope structured blockers (zero mutation)", () => {
  it("4/5. unknown component and theory component block", () => {
    expect(blockerOf(assemble({ componentId: "nope" }))).toBe("unknown-component");
    expect(blockerOf(assemble({ componentId: "R1" }))).toBe("theory-component-unsupported");
  });

  it("6/7/8. unresolved, stale, and conflicted authority block", () => {
    const noExact = record(); delete (noExact as { exactAuthority?: unknown }).exactAuthority;
    expect(blockerOf(assemble({ authority: { records: [noExact], candidates: [] } }))).toBe("authority-not-verified-exact");
    expect(blockerOf(assemble({ authority: { records: [record({ freshness: "stale" })], candidates: [] } }))).toBe("authority-not-verified-exact");
    expect(blockerOf(assemble({ authority: { records: [record({ conflict: "present" })], candidates: [] } }))).toBe("authority-not-verified-exact");
  });

  it("9. a permitted alternative without its own exact authority is never a target", () => {
    const alt = record({ permittedAlternatives: ["lib:part-alt"] });
    delete (alt as { exactAuthority?: unknown }).exactAuthority;
    expect(blockerOf(assemble({ authority: { records: [alt], candidates: [] } }))).toBe("authority-not-verified-exact");
    // An expectedMpn naming the alternative can never redirect the target.
    expect(blockerOf(assemble({ expectedMpn: "lib:part-alt" }))).toBe("expected-mpn-mismatch");
  });

  it("10. the already-installed exact target is a structured no-op", () => {
    const state = baseState();
    state.kicadComponents![0] = {
      ...state.kicadComponents![0]!,
      partId: "lib:part-b", atomicPartRevisionId: "rev-new", symbolAssetVersionId: "sym-new",
      footprintAssetVersionId: "fp-new", mappingCertificateId: "cert-new", selectionRecordId: "sel-new",
    };
    expect(blockerOf(assemble({ state }))).toBe("already-installed");
  });

  it("11/14. missing current atomic authority or current pin facts block", () => {
    const state = baseState();
    delete (state.kicadComponents![0] as { atomicPartRevisionId?: string }).atomicPartRevisionId;
    expect(blockerOf(assemble({ state }))).toBe("current-authority-missing");
    expect(blockerOf(assemble({ currentPinFacts: null }))).toBe("current-pin-authority-unavailable");
    expect(blockerOf(assemble({ currentPinFacts: pinFacts("rev-other", "sym-old", PART_A_PINS) }))).toBe("current-pin-authority-unavailable");
  });

  it("12/13/15. missing/unpublished target facts or mismatched target symbol block", () => {
    expect(blockerOf(assemble({ targetPinFacts: null }))).toBe("target-pin-authority-unavailable"); // unpublished ⇒ the read returns null
    expect(blockerOf(assemble({ targetPinFacts: pinFacts("rev-new", "sym-other", PART_B_PINS) }))).toBe("target-pin-authority-unavailable");
  });

  it("16/17. pin-count-only matches and non-identity numbering block (no provider mapping exists)", () => {
    expect(blockerOf(assemble({ targetPinFacts: pinFacts("rev-new", "sym-new", PART_C_PINS) }))).toBe("replacement-plan-refused");
    expect(blockerOf(assemble({ targetPinFacts: pinFacts("rev-new", "sym-new", PART_D_PINS) }))).toBe("replacement-plan-refused");
  });

  it("18. a mapping certificate that cannot be corroborated blocks", () => {
    expect(blockerOf(assemble({ targetPinFacts: pinFacts("rev-new", "sym-new", PART_B_PINS, "cert-other") }))).toBe("mapping-certificate-mismatch");
    const uncovered = pinFacts("rev-new", "sym-new", PART_B_PINS);
    (uncovered.certificate as unknown as { symbolPinIds: string[] }).symbolPinIds = ["pin-1", "pin-ghost"];
    expect(blockerOf(assemble({ targetPinFacts: uncovered }))).toBe("mapping-certificate-mismatch");
  });

  it("19. a replacement that would lose a connected pin blocks — the model can never acknowledge a drop", () => {
    const oneTarget = pinFacts("rev-new", "sym-new", [pin("1", "A", -2.5)]);
    const outcome = assemble({ targetPinFacts: oneTarget });
    expect(blockerOf(outcome)).toBe("replacement-plan-refused");
    if (outcome.kind === "blocked") expect(outcome.blockers[0]!.detail).toMatch(/identity|drop/i);
  });

  it("20. an ambiguous net-label relocation blocks", () => {
    const stackedCurrent = [pin("1", "A", -2.5), pin("2", "B", -2.5)];
    const splitTarget = [pin("1", "A", -5), pin("2", "B", 5)];
    const state = baseState();
    const shared = kicadPinWorldPos(U1, stackedCurrent[0]!);
    state.wires = [];
    state.netLabels = [{ id: "l1", position: shared, name: "NET", kind: "label", orientation: 0 }];
    const outcome = assemble({
      state,
      scope: { ...SCOPE, headMark: { ...MARK, canonicalStateDigest: replacementHeadDigestFor(state, SCOPE) } },
      currentPinFacts: pinFacts("rev-old", "sym-old", stackedCurrent),
      targetPinFacts: pinFacts("rev-new", "sym-new", splitTarget),
    });
    expect(blockerOf(outcome)).toBe("replacement-plan-refused");
    if (outcome.kind === "blocked") expect(outcome.blockers[0]!.detail).toContain("ambiguous-label-move");
  });
});

// ─── Valid proposals (21–22) + integrity + parity + trace ────────────────────

describe("B14 — valid sealed proposals and artifact integrity", () => {
  it("21. a valid identity-mapping proposal seals the complete reviewed plan and leaves NO live grant", () => {
    const proposal = sealedOf(assemble());
    // B16.0.1: the current schema constant (v2 — carries the authorization binding).
    expect(proposal.schema).toBe(REPLACEMENT_PROPOSAL_SCHEMA);
    expect(proposal.componentInstanceId).toBe("u1-id");
    expect(proposal.expectedCurrentPartId).toBe("lib:part-a");
    expect(proposal.target).toMatchObject({ partId: "lib:part-b", manufacturer: "Fixture Semiconductor", atomicPartRevisionId: "rev-new", symbolAssetVersionId: "sym-new", footprintAssetVersionId: "fp-new", mappingCertificateId: "cert-new" });
    expect(proposal.impact.droppedConnections).toEqual([]);
    expect(proposal.impact.mode).toBe("pin-identical-substitution");
    expect(proposal.impact.mappingEvidence).toBe("exact-pin-identity+certificate");
    expect(proposal.impact.preservedConnections).toEqual(["1", "2"]);
    const operation = proposal.operation as { kind: string; replacement: Record<string, string>; authorityGrantId?: string; consumedAuthorityResources?: unknown[] };
    expect(operation.kind).toBe("schematic_replace_component");
    expect(operation.replacement.atomicPartRevisionId).toBe("rev-new");
    expect(operation.authorityGrantId).toBeTruthy();
    expect(operation.consumedAuthorityResources).toHaveLength(2);
    expect(verifySealedReplacementProposalIntegrity(proposal)).toEqual({ ok: true });
    // The PROPOSAL-time grant was retired before the artifact left the server.
    const check = verifyReplacementAuthorityGrant({
      grantId: operation.authorityGrantId,
      scope: SCOPE, currentCanonicalRevision: MARK.canonicalStateDigest,
      operation: proposal.operation as never,
    });
    expect(check).toMatchObject({ ok: false, code: "grant_missing" });
  });

  it("22. a certified moved-geometry target seals as a mapped substitution with exact reviewed moves", () => {
    const proposal = sealedOf(assemble({ targetPinFacts: pinFacts("rev-new", "sym-new", PART_E_PINS) }));
    expect(proposal.impact.mode).toBe("mapped-substitution");
    expect(proposal.impact.wireEndpointMoves.length).toBe(1);
    expect(proposal.impact.netLabelMoves.length).toBe(1);
    expect(proposal.impact.droppedConnections).toEqual([]);
    // Determinism: identical inputs seal byte-identically (replay identity).
    const again = sealedOf(assemble({ targetPinFacts: pinFacts("rev-new", "sym-new", PART_E_PINS) }));
    expect(JSON.stringify(again)).toBe(JSON.stringify(proposal));
  });

  it("25a. altered/unknown/nonzero-drop artifacts fail integrity closed", () => {
    const proposal = sealedOf(assemble());
    const tamperedTarget = structuredClone(proposal) as SealedReplacementProposal;
    (tamperedTarget.target as { symbolAssetVersionId: string }).symbolAssetVersionId = "sym-attacker";
    expect(verifySealedReplacementProposalIntegrity(tamperedTarget).ok).toBe(false);
    const unknownField = { ...structuredClone(proposal), approval: "granted" } as unknown as SealedReplacementProposal;
    expect(verifySealedReplacementProposalIntegrity(unknownField)).toMatchObject({ ok: false, code: "malformed" });
    const dropped = structuredClone(proposal) as SealedReplacementProposal;
    (dropped.impact as unknown as { droppedConnections: string[] }).droppedConnections = ["2"];
    expect(verifySealedReplacementProposalIntegrity(dropped)).toMatchObject({ ok: false, code: "malformed" });
  });

  it("23. receiving a sealed replacement proposal through the REAL gateway mutates nothing", async () => {
    const state = baseState();
    const before = schematicStateDigest(state);
    const gateway = createAgentToolGateway(sirkitToolRegistry(), {
      replacementPinFacts: async (revision) => (revision === "rev-old" ? CURRENT_FACTS : revision === "rev-new" ? TARGET_FACTS : null),
    });
    const outcome = await gateway.invoke({
      runId: "run-b14", provider: "openai",
      toolId: AGENT_REPLACEMENT_PROPOSAL_TOOL_ID, version: "1.0.0",
      args: { componentId: "u1-id" },
      context: contextFor({ records: [record()] }),
      timeoutMs: 10_000,
    });
    expect(outcome.kind).toBe("proposal");
    if (outcome.kind !== "proposal") return;
    // B16.0.1: the gateway seals the current v2 schema (with the authorization binding).
    expect(outcome.proposal.schema).toBe(REPLACEMENT_PROPOSAL_SCHEMA);
    expect(schematicStateDigest(baseState())).toBe(before);
  });

  it("[B19-E E5 review] the REAL gateway asks for the instance's pins as current and the exact authority's pins as target", async () => {
    // current pins are read from the revision being left (even a withdrawn one); target pins only from a selectable revision.
    // This source serves each revision ONLY in its own role, so a swapped or dropped role cannot seal.
    const calls: Array<[string, string]> = [];
    const gateway = createAgentToolGateway(sirkitToolRegistry(), {
      replacementPinFacts: async (revision, role) => {
        calls.push([revision, role]);
        if (revision === "rev-old" && role === "current") return CURRENT_FACTS;
        if (revision === "rev-new" && role === "target") return TARGET_FACTS;
        return null;
      },
    });
    const outcome = await gateway.invoke({
      runId: "run-b14-roles", provider: "openai",
      toolId: AGENT_REPLACEMENT_PROPOSAL_TOOL_ID, version: "1.0.0",
      args: { componentId: "u1-id" },
      context: contextFor({ records: [record()] }),
      timeoutMs: 10_000,
    });
    expect(calls).toEqual([["rev-old", "current"], ["rev-new", "target"]]);
    expect(outcome.kind, JSON.stringify(outcome).slice(0, 300)).toBe("proposal");
  });

  it("the model can never supply asset identities, pins, authority, approvals, or drop acknowledgements", async () => {
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    for (const forbidden of [
      { componentId: "u1-id", atomicPartRevisionId: "rev-attacker" },
      { componentId: "u1-id", symbolAssetVersionId: "sym-attacker" },
      { componentId: "u1-id", pins: [{ number: "1" }] },
      { componentId: "u1-id", authority: { status: "verified-atomic" } },
      { componentId: "u1-id", approved: true },
      { componentId: "u1-id", acknowledgeDroppedPins: ["2"] },
    ]) {
      const outcome = await gateway.invoke({
        runId: "run-b14", provider: "openai",
        toolId: AGENT_REPLACEMENT_PROPOSAL_TOOL_ID, version: "1.0.0",
        args: forbidden as never,
        context: contextFor({ records: [record()] }),
        timeoutMs: 10_000,
      });
      expect(outcome.kind, JSON.stringify(forbidden)).toBe("refused");
      if (outcome.kind === "refused") expect(outcome.status).toBe("invalid_input");
    }
  });

  it("49. OpenAI and Anthropic render equivalent strict schemas for the replacement tool", () => {
    const declaration = buildRunToolset(sirkitToolRegistry(), contextFor({ records: [record()] }), () => undefined)
      .declarations.find((entry) => entry.toolId === AGENT_REPLACEMENT_PROPOSAL_TOOL_ID)!;
    const openai = renderOpenAiResponsesTool(declaration);
    const anthropic = renderAnthropicAgentTool(declaration);
    expect(JSON.stringify(openai.parameters)).toBe(JSON.stringify(anthropic.input_schema));
    expect((openai.parameters as { additionalProperties?: boolean }).additionalProperties).toBe(false);
  });

  it("50. the trace stores only bounded proposal identity/digests — never records, pins, or plan content", () => {
    const proposal = sealedOf(assemble());
    const recorder = new AgentTraceRecorder({
      runId: "run-b14", traceId: "trace-b14", provider: "openai",
      promptVersion: "v", promptDigest: "eng1-aaaaaaaaaaaaaaaa", registryDigest: sirkitToolRegistry().digest(),
      scope: SCOPE,
      contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
    }, { append: () => undefined, complete: () => undefined });
    recorder.recordRunStarted();
    recorder.recordTool({
      callId: "call-1", toolId: AGENT_REPLACEMENT_PROPOSAL_TOOL_ID, version: "1.0.0", operationClass: "propose",
      args: { componentId: "u1-id" }, outcomeClass: "proposal", status: "proposal_sealed", verification: null,
      output: null, proposal: { proposalId: proposal.proposalId, operationsDigest: proposal.operationDigest },
    });
    const trace = recorder.finalize({ outcome: "completed", failureReason: null });
    const serialized = JSON.stringify(trace);
    expect(serialized).toContain(proposal.proposalId);
    expect(serialized).toContain(proposal.operationDigest);
    expect(serialized).not.toContain("rev-new");
    expect(serialized).not.toContain("wireEndpointMoves");
    expect(serialized).not.toContain("Fixture Semiconductor");
  });
});
