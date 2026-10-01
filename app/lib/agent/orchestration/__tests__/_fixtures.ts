/**
 * [B21 A] Shared VALID orchestration documents for the A suites (not a test file). Every fixture is built fresh per call so
 * a case may mutate its copy freely; the digests are computed with the production `engineeringDigest`, never pasted.
 */
import { DEFAULT_AGENT_BUDGET } from "@/app/lib/agent/contracts";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { PROPOSED_ACTION_KINDS, SPECIALIST_REQUEST_SCHEMA, SPECIALIST_RESULT_SCHEMA, type ProposedActionKind } from "../contracts";

export const DIGEST_A = engineeringDigest({ fixture: "a" });
export const DIGEST_B = engineeringDigest({ fixture: "b" });

export const SCOPE = Object.freeze({
  tenantId: "local",
  projectId: "p21",
  branchId: "main",
  canonicalRevisionDigest: DIGEST_A,
  schematicHeadMark: { lineageId: "lineage-1", headSequence: 3, canonicalStateDigest: DIGEST_B },
  pcbBasis: { historyHeadSequence: 7, historyHeadLabel: null, lineageId: "lineage-1", activeDrcPresetId: "preset-default" },
});

export const BUDGET = Object.freeze({ ...DEFAULT_AGENT_BUDGET, maxInputTokens: 200_000, maxOutputTokens: 4_096 });

export const TIER1_KIND: ProposedActionKind = PROPOSED_ACTION_KINDS[0];

export function validRequest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SPECIALIST_REQUEST_SCHEMA,
    taskId: "task-1",
    role: "verification-critic",
    objective: "Verify the connectivity of the timer replacement against the current board",
    scope: structuredClone(SCOPE),
    contextRefs: [{ id: "resource-1", digest: DIGEST_A }],
    allowedToolIds: ["sirkit.validation.connectivity-verify", "sirkit.validation.drc-run"],
    budget: { ...BUDGET },
    requiredOutputs: ["summary", "validationRequests"],
    deadlineAt: "2026-09-24T12:05:00.000Z",
    ...over,
  };
}

/** An opaque sealed-artifact-shaped payload: its top level is what A checks; its interior (a `readiness.state` key, as the
 *  bounded compiler's impact certificate really carries) is bound by the digest only. */
export function payloadOf(kind: ProposedActionKind, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: kind,
    proposalId: "prop-1",
    scope: { tenantId: "local", projectId: "p21", branchId: "main" },
    operations: [{ op: "set-property", target: "R1", value: "10k" }],
    readiness: { state: "unavailable", reason: "the compiler never certifies readiness" },
    ...over,
  };
}

export function action(kind: ProposedActionKind, over: Record<string, unknown> = {}): Record<string, unknown> {
  const payload = payloadOf(kind);
  return { kind, payload, artifactDigest: engineeringDigest(payload), ...over };
}

export function validResult(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SPECIALIST_RESULT_SCHEMA,
    role: "schematic",
    summary: "One Tier 1 property edit on R1; connectivity unchanged; readiness not certified.",
    proposedActions: [action(TIER1_KIND)],
    assumptions: [{ id: "assumption-1", statement: "R1 is the timing resistor named by the user", evidenceIds: ["evidence-1"] }],
    evidence: [{ kind: "readiness-report", id: "evidence-1", digest: DIGEST_A, sourceClass: "deterministic_verifier", extractionMethod: "deterministic_inference", reviewed: false }],
    requiredTools: [{ toolId: "sirkit.validation.drc-run", version: "1.0.0", reason: "confirm no new DRC violation after the edit" }],
    risks: [{ id: "risk-1", severity: "medium", statement: "the replacement changes the timing constant", mitigation: null }],
    unresolvedQuestions: [{ id: "question-1", question: "Is the 10k value the intended lower-power target?", blocking: false }],
    validationRequests: [{ bindingToolId: "sirkit.validation.connectivity-verify", baseRevision: DIGEST_A }],
    confidence: "medium",
    ...over,
  };
}
