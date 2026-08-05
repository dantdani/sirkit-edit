import type { EngineeringActor } from "../engineering/types";
import { humanReviewer } from "./capability";
import { finalizeVerification, verificationId } from "./stable";
import type { RuleCategory, RuleImplementationRef, RuleRegistrySnapshot, RuleSelector, VerificationRuleDefinition, VerificationSeverity } from "./types";

interface RuleSeed {
  key: string;
  title: string;
  category: RuleCategory;
  severity: VerificationSeverity;
  selector: RuleSelector;
  implementationRef: RuleImplementationRef;
  remediation: string;
  waiverPolicy?: VerificationRuleDefinition["waiverPolicy"];
}

const FOUNDATIONAL_RULES: RuleSeed[] = [
  { key: "graph-integrity", title: "Authoritative semantic graph integrity", category: "graph_integrity", severity: "blocking", selector: { target: "graph", expectedCardinality: { minimum: 1, maximum: 1 } }, implementationRef: "builtin.graph_integrity", remediation: "Return to CD-8 and create a valid immutable semantic-graph successor.", waiverPolicy: "non_waivable" },
  { key: "variant-projection-integrity", title: "Variant projection integrity", category: "variant_population", severity: "blocking", selector: { target: "variant_projection", expectedCardinality: { minimum: 1 } }, implementationRef: "builtin.variant_projection_integrity", remediation: "Resolve every population conflict and regenerate all variant projections.", waiverPolicy: "non_waivable" },
  { key: "exact-component-binding", title: "Exact component, package, symbol, footprint, and mapping binding", category: "atomic_binding", severity: "blocking", selector: { target: "component", expectedCardinality: { minimum: 1 } }, implementationRef: "builtin.exact_component_binding", remediation: "Bind the component to exact current atomic and CAD revisions with provenance.", waiverPolicy: "non_waivable" },
  { key: "pin-disposition", title: "Exactly one terminal disposition per pin and variant", category: "graph_integrity", severity: "blocking", selector: { target: "pin", expectedCardinality: { minimum: 1 } }, implementationRef: "builtin.pin_disposition_complete", remediation: "Assign one explicit, evidenced terminal disposition in this variant.", waiverPolicy: "non_waivable" },
  { key: "endpoint-reciprocity", title: "Net endpoint reciprocity", category: "graph_integrity", severity: "blocking", selector: { target: "endpoint", expectedCardinality: { minimum: 0 } }, implementationRef: "builtin.endpoint_reciprocity", remediation: "Repair exact endpoint, net, pin, and disposition membership in CD-8.", waiverPolicy: "non_waivable" },
  { key: "connected-atomic-nc", title: "Atomic NC/DNC/NU pins remain non-conductive", category: "atomic_binding", severity: "blocking", selector: { target: "pin", predicates: [{ field: "terminalClassification", operator: "in", value: ["nc", "dnc", "nu", "mechanical"] }], expectedCardinality: { minimum: 0 } }, implementationRef: "builtin.connected_atomic_nc", remediation: "Remove the connection or correct the exact atomic classification with source evidence.", waiverPolicy: "non_waivable" },
  { key: "push-pull-contention", title: "No proven push-pull output contention", category: "pin_compatibility", severity: "blocking", selector: { target: "net", expectedCardinality: { minimum: 0 } }, implementationRef: "builtin.push_pull_contention", remediation: "Isolate the drivers or replace the topology with an electrically valid shared-bus implementation." },
  { key: "required-input-driver", title: "Required digital inputs have a defined driver or bias", category: "pin_compatibility", severity: "error", selector: { target: "pin", predicates: [{ field: "electricalType", operator: "equals", value: "input" }], expectedCardinality: { minimum: 0 } }, implementationRef: "builtin.required_input_driver", remediation: "Provide a valid driver, bias network, or approved atomic leave-floating disposition." },
  { key: "rail-source-presence", title: "Every declared rail has an evidenced compatible source", category: "power_ground_domain", severity: "blocking", selector: { target: "rail", expectedCardinality: { minimum: 0 } }, implementationRef: "builtin.rail_source_presence", remediation: "Bind the rail to a selected source role and verify source/load operating conditions." },
  { key: "distinct-tie-integrity", title: "Explicit ties preserve distinct net identity", category: "power_ground_domain", severity: "blocking", selector: { target: "tie", expectedCardinality: { minimum: 0 } }, implementationRef: "builtin.distinct_tie_integrity", remediation: "Restore distinct nets on each side of the intentional tie and its variant semantics.", waiverPolicy: "non_waivable" },
  { key: "hierarchy-binding", title: "Hierarchical port bindings are electrically valid", category: "interface_connector_test", severity: "blocking", selector: { target: "port_binding", expectedCardinality: { minimum: 0 } }, implementationRef: "builtin.hierarchy_binding_integrity", remediation: "Correct the parent/child port binding and rerun CD-8 validation.", waiverPolicy: "non_waivable" },
  { key: "roundtrip-current", title: "Approved KiCad round-trip proof remains current", category: "currency_lineage", severity: "blocking", selector: { target: "graph", expectedCardinality: { minimum: 1, maximum: 1 } }, implementationRef: "builtin.round_trip_current", remediation: "Regenerate the KiCad artifact and independently reparse and certify semantic equivalence.", waiverPolicy: "non_waivable" },
  { key: "requirement-traceability", title: "Circuit requirements have implementation and verification evidence", category: "requirement_coverage", severity: "blocking", selector: { target: "requirement", expectedCardinality: { minimum: 0 } }, implementationRef: "builtin.requirement_traceability", remediation: "Add explicit implementation references and deterministic verification evidence.", waiverPolicy: "non_waivable" },
];

function makeRule(seed: RuleSeed, reviewer?: EngineeringActor, reviewedAt?: string): VerificationRuleDefinition {
  const ruleId = `cd9.rule.${seed.key}`;
  return finalizeVerification<VerificationRuleDefinition>({
    ruleId,
    revision: 1,
    semanticVersion: "1.0.0",
    title: seed.title,
    category: seed.category,
    severity: seed.severity,
    selector: structuredClone(seed.selector),
    implementationRef: seed.implementationRef,
    requiredInputs: ["cd8.semantic_graph", "cd8.variant_projection", "cd8.provenance"],
    evidenceRefs: [`spec:cd9:${seed.key}`, `implementation:${seed.implementationRef}`],
    remediationTemplate: seed.remediation,
    waiverPolicy: seed.waiverPolicy ?? "independent_approval",
    lifecycleState: humanReviewer(reviewer) ? "approved" : "draft",
    ...(reviewer ? { reviewer: structuredClone(reviewer) } : {}),
    ...(reviewedAt ? { reviewedAt } : {}),
    deterministicDigest: "",
  });
}

export function createFoundationalRuleRegistry(input: { reviewer?: EngineeringActor; reviewedAt?: string } = {}): RuleRegistrySnapshot {
  const approved = humanReviewer(input.reviewer) && Number.isFinite(Date.parse(input.reviewedAt ?? ""));
  const rules = FOUNDATIONAL_RULES.map((seed) => makeRule(seed, approved ? input.reviewer : undefined, approved ? input.reviewedAt : undefined));
  const base = {
    revision: 1,
    profileId: "low-voltage-embedded-circuit-verification-v1" as const,
    rules,
    requiredCategoryIds: [...new Set(rules.map((item) => item.category))].sort() as RuleCategory[],
    lifecycleState: approved ? "approved" as const : "draft" as const,
    ...(approved ? { approvedBy: structuredClone(input.reviewer!), approvedAt: input.reviewedAt } : {}),
  };
  return finalizeVerification<RuleRegistrySnapshot>({ ...base, registryId: verificationId("rule-registry", base), deterministicDigest: "" });
}

export function validateRuleRegistry(registry: RuleRegistrySnapshot): string[] {
  const errors: string[] = [];
  if (!registry || !registry.registryId || registry.revision < 1 || registry.profileId !== "low-voltage-embedded-circuit-verification-v1") errors.push("CD9_RULE_REGISTRY_IDENTITY_INVALID");
  const ids = registry?.rules?.map((item) => item.ruleId) ?? [];
  if (new Set(ids).size !== ids.length) errors.push("CD9_RULE_ID_DUPLICATE");
  for (const rule of registry?.rules ?? []) {
    if (!rule.evidenceRefs.length || !rule.requiredInputs.length || !rule.remediationTemplate.trim()) errors.push(`CD9_RULE_EVIDENCE_INCOMPLETE:${rule.ruleId}`);
    if (rule.deterministicDigest !== finalizeVerification(rule).deterministicDigest) errors.push(`CD9_RULE_DIGEST_MISMATCH:${rule.ruleId}`);
    if (rule.lifecycleState === "approved" && !humanReviewer(rule.reviewer)) errors.push(`CD9_RULE_APPROVAL_INVALID:${rule.ruleId}`);
    const limit = rule.selector.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50_000)) errors.push(`CD9_RULE_SELECTOR_LIMIT_INVALID:${rule.ruleId}`);
  }
  if (registry.lifecycleState === "approved" && (!humanReviewer(registry.approvedBy) || registry.rules.some((item) => item.lifecycleState !== "approved"))) errors.push("CD9_REGISTRY_APPROVAL_INVALID");
  if (registry.deterministicDigest !== finalizeVerification(registry).deterministicDigest) errors.push("CD9_REGISTRY_DIGEST_MISMATCH");
  return [...new Set(errors)].sort();
}
