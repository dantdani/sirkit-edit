/**
 * [PR-G, 2026-10-17] The SAFE receiver for the agent's `module_contracts_ready` event (the module contract proposal,
 * `sirkit.module.propose-contracts`, app/lib/agent/module-contract-proposals.ts; OD-249): a structurally verified
 * `sirkit.module-contract-proposal.v1` artifact (schema, exact key set, the constant `contract-structure-checked`, an electrical
 * check that is `not_run`, both sealed digests intact) or nothing. A fabricated, altered or malformed event yields null and offers
 * nothing. Receiving a contract set mutates NOTHING and applies nothing - there is no apply path for a contract set: the page renders
 * it as a collapsible ENGINEERING NOTE card in the run log (modules, owned components, ports, cross-module constraints, unresolved
 * part-authority gaps, the validator's result as data) and the human accepts it by continuing or asks for a revision. The project has
 * no separate engineering-notes store (none exists in app/lib/project or app/lib/engineering), so the card IS the note: it is saved with
 * the project's chat history exactly as every run-log card is.
 *
 * `moduleContractCurrency` is the intake's currency check against the LIVE editor (the generation proposal's recipe, shared through
 * sheet-artifact-currency.ts); `moduleContractNoteLines` is a pure projection of the sealed set into the card's rows. Pure and node-free.
 */
import { MODULE_CONTRACT_PROPOSAL_SCHEMA, verifySealedModuleContractProposalIntegrity, type SealedModuleContractProposal } from "../agent/module-contract-proposals";
import type { ModulePort, Quantity } from "../engineering/module-contract";
import { auditRunId, sheetArtifactCurrency, type SheetArtifactCurrency, type SheetArtifactLiveEditor } from "./sheet-artifact-currency";

/** The run-log card's message id prefix (the page renders the card collapsible when its id carries it). */
export const MODULE_CONTRACT_NOTE_ID_PREFIX = "module-contracts:";
/** Where the note lives: said on the card, so nobody looks for a store that does not exist. */
export const MODULE_CONTRACT_NOTE_HOME = "This card is the engineering note: it is kept with the project's chat history (no separate notes store exists). Nothing is applied — no sheet or board changes; accept it by continuing, or ask the assistant for a revision.";

export interface ReceivedModuleContracts {
  proposal: SealedModuleContractProposal;
  /** audit metadata only (never authority): the run that sealed it */
  runId: string | null;
}

/** Narrow an agent `module_contracts_ready` event payload without granting anything. */
export function receiveModuleContractsEvent(
  event: { type?: unknown; runId?: unknown; proposal?: unknown; [key: string]: unknown } | null | undefined,
): ReceivedModuleContracts | null {
  if (!event || typeof event !== "object") return null;
  if (event.type !== "module_contracts_ready") return null;
  const proposal = event.proposal;
  if (typeof proposal !== "object" || proposal === null || Array.isArray(proposal)) return null;
  if ((proposal as { schema?: unknown }).schema !== MODULE_CONTRACT_PROPOSAL_SCHEMA) return null;
  if (!verifySealedModuleContractProposalIntegrity(proposal).ok) return null;
  return { proposal: proposal as SealedModuleContractProposal, runId: auditRunId(event.runId) };
}

/** The intake's currency check against the live editor (scope, expiry, head, base - in that order); every refusal is the page's sentence. */
export function moduleContractCurrency(proposal: SealedModuleContractProposal, live: SheetArtifactLiveEditor): SheetArtifactCurrency {
  return sheetArtifactCurrency(proposal, live, "module contract set");
}

const quantity = (item: Quantity): string => `${item.name} ${item.value} ${item.unit} (${item.bound})`;
const portWords = (port: ModulePort): string => {
  const facts = [...port.voltage, ...port.current, ...port.impedance, ...port.permittedLoading].map(quantity);
  return `${port.id} → net ${port.net}, ${port.direction}${port.logicLevel ? `, ${port.logicLevel}` : ""}${facts.length > 0 ? `; ${facts.join("; ")}` : ""}${port.unknown.length > 0 ? `; unknown: ${port.unknown.join(", ")}` : ""}${port.evidence.length > 0 ? `; evidence: ${port.evidence.map((item) => `${item.sourceIdentity} ${item.documentRevision} §${item.section}`).join(" | ")}` : ""}`;
};

/** The note card: a one-line summary first (shown while collapsed), then every module, constraint and gap as its own row. */
export function moduleContractNoteLines(proposal: SealedModuleContractProposal): { title: string; summary: string; details: string[] } {
  const set = proposal.contractSet;
  const gaps = set.partAuthority.filter((row) => row.state === "unresolved");
  const summary = `${set.system.name}: ${set.modules.length} module${set.modules.length === 1 ? "" : "s"} owning ${set.coverage.owned} of ${set.coverage.physicalInstances} physical instance${set.coverage.physicalInstances === 1 ? "" : "s"}${set.coverage.unassigned.length > 0 ? ` (${set.coverage.unassigned.length} unassigned: ${set.coverage.unassigned.join(", ")})` : ""}, ${set.constraints.length} cross-module constraint${set.constraints.length === 1 ? "" : "s"}, ${gaps.length} part-authority gap${gaps.length === 1 ? "" : "s"}. Validated for structure only (${proposal.verification}); electrical check: ${set.electricalCheck.state.replace("_", " ")}.`;
  const details: string[] = [
    `System: ${set.system.statement}${set.system.operatingConditions.length > 0 ? ` Operating conditions: ${set.system.operatingConditions.map(quantity).join("; ")}.` : ""}`,
    ...set.modules.flatMap((module) => [
      `Module ${module.id} — ${module.name}: ${module.responsibility} Owns ${module.components.length === 0 ? "no component" : module.components.map((component) => `${component.refDes}${component.value ? ` (${component.value})` : ""}${component.revisionId ? "" : component.family === "kicad" ? " — no published exact revision" : " — Theory symbol"}`).join(", ")}.${module.partAuthorityGaps.length > 0 ? ` Part-authority gaps acknowledged: ${module.partAuthorityGaps.join(", ")}.` : ""}${module.unknown.length > 0 ? ` Unknown: ${module.unknown.join(", ")}.` : ""}${module.placementRouting.length > 0 ? ` Placement / routing: ${module.placementRouting.join("; ")}.` : ""}`,
      ...module.ports.map((port) => `  Port ${module.id}.${portWords(port)}`),
      ...module.requirements.map((requirement) => `  Requirement ${module.id}/${requirement.topic}: ${requirement.statement}${requirement.quantities.length > 0 ? ` ${requirement.quantities.map(quantity).join("; ")}.` : ""}${requirement.evidence.length > 0 ? ` Evidence: ${requirement.evidence.map((item) => `${item.sourceIdentity} ${item.documentRevision} §${item.section} (${item.kind})`).join(" | ")}.` : ""}`),
      ...module.tests.map((test) => `  Test ${module.id}/${test.id}: ${test.procedure} Accept: ${test.acceptance}`),
    ]),
    ...set.constraints.map((constraint) => `Constraint ${constraint.id} (${constraint.kind}) on net ${constraint.net} between ${constraint.modules.join(", ")}${constraint.owner ? `, owned by ${constraint.owner}` : ""}: ${constraint.statement}${constraint.loading ? constraint.loading.state === "stated" ? ` Loading (driver ${constraint.loading.driver}): ${constraint.loading.quantities.map(quantity).join("; ")}.` : ` Loading unknown: ${constraint.loading.reason}.` : ""}`),
    ...(set.coverage.sharedNets.length > 0 ? [`Shared nets: ${set.coverage.sharedNets.map((shared) => `${shared.net} (${shared.modules.join(", ")}; constraints ${shared.constraintIds.join(", ") || "none stated"})`).join("; ")}`] : []),
    gaps.length > 0
      ? `Unresolved part authority (what must be published before PCB): ${gaps.map((row) => `${row.refDes} in ${row.moduleId} — ${row.missing ?? "unresolved"}${row.reviewPath ? ` (${row.reviewPath})` : ""}`).join("; ")}`
      : "Part authority: every owned instance carries a published exact revision.",
    `Validator result (data, not a verdict): ${proposal.verification} — identities, nets, units, evidence shape, ownership and the stated interfaces were checked against the pinned sheet. Electrical check ${set.electricalCheck.state.replace("_", " ")}: ${set.electricalCheck.detail}`,
    `Never: ${proposal.reviewTask.neverClaims}`,
    `Sealed by the assistant (${proposal.provenance.provider}) over the sheet it was validated against. ${MODULE_CONTRACT_NOTE_HOME}`,
  ];
  return { title: `Engineering note — module contracts for ${set.system.name} (${set.modules.length} module${set.modules.length === 1 ? "" : "s"})`, summary, details };
}
