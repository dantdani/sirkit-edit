import type { EngineeringActor } from "../engineering/types";
import { finalizeVerification, uniqueSorted, verificationId } from "./stable";
import type { CircuitFinding, FullOracleRun } from "./types";

export interface VerificationRemediationProposal {
  proposalId: string;
  graphDigest: string;
  fullRunId: string;
  findingStableIdentities: string[];
  proposedBy: EngineeringActor;
  summary: string;
  proposedActions: Array<{ actionId: string; kind: "inspect_evidence" | "request_external_review" | "propose_schematic_successor" | "rerun_full_oracle"; targetIds: string[]; rationale: string }>;
  authority: "proposal_only_no_design_or_verdict_mutation";
  status: "draft";
  deterministicDigest: string;
}

export const CIRCUIT_VERIFICATION_PROPOSAL_TOOL = {
  name: "propose_circuit_verification_remediation",
  description: "Propose evidence inspection, external review, or a new schematic successor for human review. This tool cannot mutate design truth, waive a finding, or change readiness.",
  schema: {
    type: "object", additionalProperties: false, required: ["findingStableIdentities", "summary", "proposedActions"],
    properties: {
      findingStableIdentities: { type: "array", minItems: 1, maxItems: 256, items: { type: "string", minLength: 1, maxLength: 4096 } },
      summary: { type: "string", minLength: 1, maxLength: 4000 },
      proposedActions: { type: "array", minItems: 1, maxItems: 256, items: { type: "object", additionalProperties: false, required: ["actionId", "kind", "targetIds", "rationale"], properties: { actionId: { type: "string", minLength: 1, maxLength: 4096 }, kind: { enum: ["inspect_evidence", "request_external_review", "propose_schematic_successor", "rerun_full_oracle"] }, targetIds: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 4096 } }, rationale: { type: "string", minLength: 1, maxLength: 2000 } } } },
    },
  },
} as const;

/** A string-array node of the tool schema. */
interface StringArraySchemaNode { readonly items: { readonly minLength?: number; readonly maxLength?: number }; readonly maxItems: number; readonly minItems?: number }
/** A bounded-string node of the tool schema. */
interface StringSchemaNode { readonly minLength?: number; readonly maxLength?: number }

/**
 * [B16.0.19 §F] STRICT structural validation of raw provider tool output
 * against the ONE declared CIRCUIT_VERIFICATION_PROPOSAL_TOOL schema — every
 * constraint (required fields, additionalProperties, enums, min/max items,
 * string bounds) is READ FROM the schema nodes at call time; no numeric limit
 * is independently hard-coded. Runs BEFORE
 * `normalizeVerificationRemediationProposal`. Bounded diagnostics; empty = valid.
 */
export function validateCircuitVerificationProposalToolInput(value: unknown): string[] {
  const P = CIRCUIT_VERIFICATION_PROPOSAL_TOOL.schema.properties;
  const ACTION = P.proposedActions.items.properties;
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["proposal: must be an object"];
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!(key in P)) errors.push(`proposal: unexpected key ${key.slice(0, 64)}`);
  const boundedString = (name: string, v: unknown, node: StringSchemaNode): void => {
    const minLength = node.minLength ?? 0;
    const maxLength = node.maxLength ?? Number.POSITIVE_INFINITY;
    if (typeof v !== "string" || v.length < minLength || v.length > maxLength) errors.push(`${name}: must be a string of ${minLength}..${maxLength} chars`);
  };
  const stringArray = (name: string, v: unknown, node: StringArraySchemaNode): void => {
    const minLength = node.items.minLength ?? 0;
    const maxLength = node.items.maxLength ?? Number.POSITIVE_INFINITY;
    if (!Array.isArray(v)) { errors.push(`${name}: missing or not an array`); return; }
    if (v.length > node.maxItems) errors.push(`${name}: exceeds ${node.maxItems} items`);
    if (v.length < (node.minItems ?? 0)) errors.push(`${name}: requires at least ${node.minItems} items`);
    if (v.some((item) => typeof item !== "string" || item.length < minLength || item.length > maxLength)) errors.push(`${name}: items must be strings of ${minLength}..${maxLength} chars`);
  };
  stringArray("findingStableIdentities", raw.findingStableIdentities, P.findingStableIdentities);
  boundedString("summary", raw.summary, P.summary);
  if (!Array.isArray(raw.proposedActions)) errors.push("proposedActions: missing or not an array");
  else {
    if (raw.proposedActions.length > P.proposedActions.maxItems) errors.push(`proposedActions: exceeds ${P.proposedActions.maxItems} items`);
    if (raw.proposedActions.length < (P.proposedActions.minItems ?? 0)) errors.push(`proposedActions: requires at least ${P.proposedActions.minItems} items`);
    raw.proposedActions.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) { errors.push(`proposedActions[${index}]: must be an object`); return; }
      const action = item as Record<string, unknown>;
      for (const key of Object.keys(action)) if (!(key in ACTION)) errors.push(`proposedActions[${index}]: unexpected key ${key.slice(0, 64)}`);
      boundedString(`proposedActions[${index}].actionId`, action.actionId, ACTION.actionId);
      if (!(ACTION.kind.enum as readonly string[]).includes(action.kind as string)) errors.push(`proposedActions[${index}].kind: missing or not a declared kind`);
      stringArray(`proposedActions[${index}].targetIds`, action.targetIds, ACTION.targetIds);
      boundedString(`proposedActions[${index}].rationale`, action.rationale, ACTION.rationale);
    });
  }
  return errors;
}

export function createVerificationRemediationProposal(input: { run: FullOracleRun; findings: CircuitFinding[]; actor: EngineeringActor; summary: string; actions: VerificationRemediationProposal["proposedActions"] }): VerificationRemediationProposal {
  const knownTargets = new Set(input.findings.flatMap((item) => item.semanticAnchorIds));
  if (!input.summary.trim() || !input.actions.length || input.findings.some((item) => item.currentRunId !== input.run.runId) || input.actions.some((item) => !item.actionId.trim() || !item.rationale.trim() || item.targetIds.some((id) => !knownTargets.has(id)))) throw new Error("CD9_REMEDIATION_PROPOSAL_INPUT_INVALID");
  const body = { graphDigest: input.run.graphDigest, fullRunId: input.run.runId, findingStableIdentities: uniqueSorted(input.findings.map((item) => item.stableIdentity)), proposedBy: structuredClone(input.actor), summary: input.summary.trim(), proposedActions: structuredClone(input.actions).map((item) => ({ ...item, targetIds: uniqueSorted(item.targetIds) })), authority: "proposal_only_no_design_or_verdict_mutation" as const, status: "draft" as const };
  return finalizeVerification<VerificationRemediationProposal>({ ...body, proposalId: verificationId("verification-remediation-proposal", body), deterministicDigest: "" });
}

export function normalizeVerificationRemediationProposal(input: { raw: { findingStableIdentities: string[]; summary: string; proposedActions: VerificationRemediationProposal["proposedActions"] }; run: FullOracleRun; actor: EngineeringActor }): VerificationRemediationProposal {
  const requested = uniqueSorted(input.raw.findingStableIdentities);
  const findings = requested.map((identity) => input.run.findings.find((item) => item.stableIdentity === identity)).filter((item): item is CircuitFinding => Boolean(item));
  if (findings.length !== requested.length) throw new Error("CD9_AI_PROPOSAL_FINDING_REFERENCE_INVALID");
  return createVerificationRemediationProposal({ run: input.run, findings, actor: input.actor, summary: input.raw.summary, actions: input.raw.proposedActions });
}
