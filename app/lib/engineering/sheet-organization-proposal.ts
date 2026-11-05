/**
 * [PR-J5, 2026-10-23] Runbook section J increment 5 (J.6 items 1, 4, 6 and 8; J.3 item 4; OD-259 item 4): the agent's ORGANISE
 * proposal artifact, `sirkit.sheet-organization-proposal.v1` - a Tier 2 SEALED proposal the page shows for review and NEVER applies
 * by itself.
 *
 *  - `compileSheetOrganizationProposal` resolves the model's closed request (named groups of reference designators, optional names
 *    for the ports of unnamed crossing nets) against the run's verified schematic: every member must be a catalog part on the source
 *    sheet, named once (unknown and duplicate members are refused BY NAME); parts the model leaves unassigned stay on the source sheet
 *    (OD-259 item 4). It then runs J4's ONE organise planner, `planOrganizeIntoSheets` (app/lib/schematic/sheet-organization.ts) -
 *    a chain of equivalence-proven planMoveToSheet steps applied once more as ONE batch - so the pin-to-net partition and every
 *    component identity are proven unchanged BEFORE anything is sealed; a refused plan is `blocked` with the planner's own code and
 *    sentence and nothing is sealed. "Check these" lists the parts the planner's connectivity grouping would place elsewhere.
 *  - `sealSheetOrganizationProposal` seals the plan's FACTS (the resolved groups with stable ids, the interfaces with their ports,
 *    the unassigned parts, the equivalence digests, the operations digest and count) under a closed key set with the scope identity,
 *    the authorization binding, the base schematic digest (sheets included when present), a 10-minute expiry and an identity digest -
 *    the tier-1 seal / verify pattern (schematic-proposals.ts). The OPERATIONS themselves are not carried: the page's Approve
 *    RE-PLANS the sealed groups on the canonical base through the same planner (`replanSheetOrganization`) and applies only when the
 *    operations digest and the partition digest equal the sealed ones - one truth, one schematic.move-to-sheet transaction.
 *  - `verifySealedSheetOrganizationProposalIntegrity` / `verifySealedSheetOrganizationProposal`: schema, exact keys, digests; then
 *    the live scope, lineage, head, expiry and base digest - every check fails closed (the page's receiver and Approve run them).
 */

import type { SchematicState } from "@/lib/schematic-types";
import { ROOT_SHEET_ID } from "@/lib/schematic-types";
import { compareCodePoints } from "@/app/lib/stable-compare";
import { organizeSheetId, planOrganizeIntoSheets, proposeSheetGroups, type OrganizeGroupInput, type OrganizePartSource, type OrganizePlan } from "@/app/lib/schematic/sheet-organization";
import { PORT_NAME_PATTERN } from "@/app/lib/schematic/sheet-operations";
import { sheetOf, sheetsOf } from "@/app/lib/schematic/sheets";
import { isWellFormedAuthorizationBinding, type SchematicProposalAuthorizationBinding } from "./proposal-authorization";
import { schematicStateDigest } from "./schematic-model";
import { isWellFormedProposalScope, type Tier1ProposalScope } from "./schematic-proposals";
import { engineeringDigest } from "./stable";
import type { EngineeringOperation } from "./types";

export const SHEET_ORGANIZATION_PROPOSAL_SCHEMA = "sirkit.sheet-organization-proposal.v1" as const;
export const SHEET_ORGANIZATION_TOOL_ID = "sirkit.schematic.propose-sheet-organization" as const;
export const SHEET_ORGANIZATION_TOOL_VERSION = "1.0.0" as const;
/** Proposals expire; an expired proposal can only be regenerated, not applied. */
export const SHEET_ORGANIZATION_PROPOSAL_TTL_MS = 10 * 60 * 1000;
/** The operation-id prefix every plan of this proposal uses (seal and Approve alike: the digests must agree). */
export const SHEET_ORGANIZATION_OPERATION_PREFIX = "organize-proposal" as const;
/** The root sheet's name when the organisation creates the project's first child sheet (the J4 UI's own). */
export const SHEET_ORGANIZATION_ROOT_NAME = "Overview" as const;

/** The closed bounds of the request (the tool's input surface) and of the artifact. */
export const SHEET_ORGANIZATION_LIMITS = Object.freeze({
  maxGroups: 8,
  maxMembers: 512,
  maxNameChars: 80,
  maxMemberChars: 32,
  maxInterfaceNames: 64,
  maxChecks: 32,
  /** The sealed artifact's JSON length bound (the page receives it whole; the loop's result text is a summary of it). */
  maxArtifactChars: 48_000,
});

const MEMBER_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,31}$/;

export interface SheetOrganizationGroupRequest { name: string; members: readonly string[] }
export interface SheetOrganizationRequest {
  groups: readonly SheetOrganizationGroupRequest[];
  /** Names for the ports of unnamed crossing nets, keyed by the SIG<n> name the planner mints (OD-259 item 4). */
  interfaceNames?: Readonly<Record<string, string>>;
}

export interface SheetOrganizationGroup { sheetId: string; name: string; members: Array<{ componentId: string; refDes: string }> }
export interface SheetOrganizationInterface {
  /** The crossing net's name before the organisation (null when unnamed: its port takes SIG<n> or the model's name). */
  net: string | null;
  portName: string;
  /** The SIG<n> name the planner minted for an unnamed net (what `interfaceNames` keys), null for a named net. */
  defaultName: string | null;
  direction: "passive";
  childSheetId: string;
  childSheetName: string;
  parentSheetId: string;
  hierarchicalLabels: number;
}
export interface SheetOrganizationCheck { refs: string[]; group: string; alternatives: string[]; reason: string }

export interface SheetOrganizationCompilation {
  sourceSheetId: string;
  rootName: string;
  groups: SheetOrganizationGroup[];
  interfaceNames: Record<string, string>;
  interfaces: SheetOrganizationInterface[];
  unassigned: string[];
  checkThese: SheetOrganizationCheck[];
  /** Why "check these" could not be derived from connectivity (the planner's own grouping refused), else null. */
  checkNote: string | null;
  renamedNets: Array<{ netId: string; from: string; to: string | null }>;
  equivalence: { partitionDigest: string; componentCount: number; identityDigest: string };
  operations: EngineeringOperation[];
  operationsDigest: string;
}

export type SheetOrganizationBlockerCode =
  | "empty-request" | "too-many-groups" | "too-many-members" | "group-name-invalid" | "member-invalid" | "unknown-member" | "duplicate-member"
  | "theory-component-unsupported" | "member-not-on-source-sheet" | "interface-names-invalid" | "plan-refused" | "equivalence-not-proven" | "proposal-too-large";
export interface SheetOrganizationBlocker { code: SheetOrganizationBlockerCode; detail: string; refs?: string[] }

export type SheetOrganizationCompileOutcome = { ok: true; compilation: SheetOrganizationCompilation } | { ok: false; blockers: SheetOrganizationBlocker[] };

export interface SealedSheetOrganizationProposal {
  schema: typeof SHEET_ORGANIZATION_PROPOSAL_SCHEMA;
  proposalId: string;
  toolId: typeof SHEET_ORGANIZATION_TOOL_ID;
  version: string;
  /** The sealed scope identity (tenant / project / branch and the canonical head mark) - part of the identity digest. */
  scope: Tier1ProposalScope;
  /** The closed authorization binding (the verified principal, its membership revision, the required apply role). */
  authorization: SchematicProposalAuthorizationBinding;
  /** `schematicStateDigest` of the run's verified snapshot (the sheet set included when present). */
  baseSchematicDigest: string;
  sourceSheetId: string;
  rootName: string;
  groups: SheetOrganizationGroup[];
  interfaceNames: Record<string, string>;
  interfaces: SheetOrganizationInterface[];
  unassigned: string[];
  checkThese: SheetOrganizationCheck[];
  checkNote: string | null;
  renamedNets: Array<{ netId: string; from: string; to: string | null }>;
  equivalence: { partitionDigest: string; componentCount: number; identityDigest: string };
  /** The digest of the EXACT operations the re-plan must reproduce at Approve (and their count); the operations themselves are not carried. */
  operationsDigest: string;
  operationCount: number;
  provenance: { provider: string; runId: string; note: string; instruction: string };
  createdAt: number;
  expiresAt: number;
}

export type SheetOrganizationSealOutcome = { kind: "sealed"; proposal: SealedSheetOrganizationProposal } | { kind: "blocked"; blockers: SheetOrganizationBlocker[] };

const PROPOSAL_KEYS = Object.freeze(["schema", "proposalId", "toolId", "version", "scope", "authorization", "baseSchematicDigest", "sourceSheetId", "rootName", "groups", "interfaceNames", "interfaces", "unassigned", "checkThese", "checkNote", "renamedNets", "equivalence", "operationsDigest", "operationCount", "provenance", "createdAt", "expiresAt"] as const);
const IDENTITY_SCHEMA = "sirkit.sheet-organization-proposal-id.v1";
const OPERATIONS_SCHEMA = "sirkit.sheet-organization-operations.v1";
const IDENTITY_DIGEST_SCHEMA = "sirkit.sheet-organization-component-identity.v1";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const boundedString = (value: unknown, max: number): value is string => typeof value === "string" && value.length >= 1 && value.length <= max;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The operations digest the seal and the Approve re-plan both compute: over the base digest and the exact operations. */
export function sheetOrganizationOperationsDigest(baseSchematicDigest: string, operations: readonly EngineeringOperation[]): string {
  return engineeringDigest({ schema: OPERATIONS_SCHEMA, base: baseSchematicDigest, operations });
}

/** A digest of every component identity (Theory and catalog), position-free: equal before and after any organisation. */
export function componentIdentityDigest(state: SchematicState): string {
  const rows = [
    ...state.components.map((item) => JSON.stringify([item.id, item.type, item.value, item.refDes ?? null])),
    ...(state.kicadComponents ?? []).map((item) => JSON.stringify([item.id, item.partId, item.refDes, item.value, item.atomicPartRevisionId ?? null, item.symbolAssetVersionId ?? null, item.footprintAssetVersionId ?? null, item.mappingCertificateId ?? null, item.selectionRecordId ?? null])),
  ].sort(compareCodePoints);
  return engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, rows });
}

/** The planner's closed group inputs of a request or a sealed proposal (what the seal planned and what Approve re-plans). */
export function sheetOrganizationGroupInputs(groups: ReadonlyArray<{ name: string; members: ReadonlyArray<string | { refDes: string }> }>): OrganizeGroupInput[] {
  return groups.map((group) => ({ name: group.name, refs: group.members.map((member) => (typeof member === "string" ? member : member.refDes)) }));
}

/**
 * Compile the request against the verified schematic: member resolution (by name, on the source sheet, once), the unassigned parts,
 * J4's planner as the ONE equivalence proof, the interfaces and "check these". Pure and deterministic; nothing is changed.
 */
export function compileSheetOrganizationProposal(input: { state: SchematicState; request: SheetOrganizationRequest; getPart: OrganizePartSource; sourceSheetId?: string }): SheetOrganizationCompileOutcome {
  const blockers: SheetOrganizationBlocker[] = [];
  const block = (code: SheetOrganizationBlockerCode, detail: string, refs?: string[]): SheetOrganizationCompileOutcome => ({ ok: false, blockers: [...blockers, { code, detail, ...(refs ? { refs } : {}) }] });
  const { state, request } = input;
  const sourceSheetId = input.sourceSheetId ?? ROOT_SHEET_ID;
  const limits = SHEET_ORGANIZATION_LIMITS;
  if (!Array.isArray(request.groups) || request.groups.length === 0) return block("empty-request", "No group was named: groups is 1-8 { name, members } entries. Nothing was changed.");
  if (request.groups.length > limits.maxGroups) return block("too-many-groups", `${request.groups.length} groups were named; at most ${limits.maxGroups} sheets are organised at once (OD-255 item 10). Nothing was changed.`);
  const total = request.groups.reduce((sum, group) => sum + (Array.isArray(group.members) ? group.members.length : 0), 0);
  if (total > limits.maxMembers) return block("too-many-members", `${total} members were named; at most ${limits.maxMembers} parts are organised at once. Nothing was changed.`);

  const onSheet = (state.kicadComponents ?? []).filter((item) => sheetOf(item) === sourceSheetId);
  const byUpper = new Map<string, typeof onSheet>();
  for (const instance of onSheet) { const key = instance.refDes.trim().toUpperCase(); byUpper.set(key, [...(byUpper.get(key) ?? []), instance]); }
  const elsewhere = new Map((state.kicadComponents ?? []).filter((item) => sheetOf(item) !== sourceSheetId).map((item) => [item.refDes.trim().toUpperCase(), item] as const));
  const theory = new Map(state.components.map((item) => [(item.refDes ?? item.id).trim().toUpperCase(), item] as const));
  const seen = new Map<string, string>();
  const groups: SheetOrganizationGroup[] = [];
  for (const [index, group] of request.groups.entries()) {
    const name = typeof group.name === "string" ? group.name.replace(/\s+/g, " ").trim() : "";
    if (name.length === 0 || name.length > limits.maxNameChars || name.includes("/")) return block("group-name-invalid", `Group ${index + 1} needs a name of 1-${limits.maxNameChars} characters without "/" (it separates the sheet path). Nothing was changed.`);
    if (!Array.isArray(group.members) || group.members.length === 0) return block("member-invalid", `Group "${name}" names no member: members is a list of reference designators. Nothing was changed.`);
    const members: SheetOrganizationGroup["members"] = [];
    for (const raw of group.members) {
      if (typeof raw !== "string" || !MEMBER_PATTERN.test(raw.trim())) return block("member-invalid", `Group "${name}" names an invalid member (${typeof raw === "string" ? `"${raw.slice(0, 32)}"` : typeof raw}): a member is a reference designator such as R7. Nothing was changed.`);
      const key = raw.trim().toUpperCase();
      const owner = seen.get(key);
      if (owner !== undefined) return block("duplicate-member", `${key} is named in two groups ("${owner}" and "${name}"); every part belongs to exactly one sheet. Nothing was changed.`, [key]);
      const hits = byUpper.get(key) ?? [];
      if (hits.length === 0) {
        if (theory.has(key)) return block("theory-component-unsupported", `${key} is an ideal (Theory) component; the organise planner groups catalog parts only. Nothing was changed.`, [key]);
        const other = elsewhere.get(key);
        if (other) return block("member-not-on-source-sheet", `${key} is already on sheet ${sheetOf(other)}, not on the source sheet ${sourceSheetId}; the organisation groups the source sheet's parts. Nothing was changed.`, [key]);
        return block("unknown-member", `${key} (group "${name}") is not a catalog part of this schematic. Nothing was changed.`, [key]);
      }
      if (hits.length > 1) return block("duplicate-member", `${key} names ${hits.length} parts of the source sheet; the reference designators must be unique before organising. Nothing was changed.`, [key]);
      seen.set(key, name);
      members.push({ componentId: hits[0]!.id, refDes: hits[0]!.refDes });
    }
    groups.push({ sheetId: organizeSheetId(members.map((member) => member.refDes)), name, members });
  }
  const interfaceNames: Record<string, string> = {};
  if (request.interfaceNames !== undefined) {
    if (!isRecord(request.interfaceNames)) return block("interface-names-invalid", "interfaceNames maps the SIG<n> port of an unnamed crossing net to a name. Nothing was changed.");
    const entries = Object.entries(request.interfaceNames);
    if (entries.length > limits.maxInterfaceNames) return block("interface-names-invalid", `interfaceNames holds ${entries.length} entries; at most ${limits.maxInterfaceNames}. Nothing was changed.`);
    for (const [key, value] of entries.sort(([a], [b]) => compareCodePoints(a, b))) {
      if (!/^SIG\d{1,4}$/.test(key) || typeof value !== "string") return block("interface-names-invalid", `interfaceNames keys are the SIG<n> ports the proposal reported, values their new names ("${key.slice(0, 40)}" is not one). Nothing was changed.`);
      if (!PORT_NAME_PATTERN.test(value.trim())) return block("interface-names-invalid", `The interface name for ${key} must be 1-64 letters, digits, "_", "+", "-" or "." (got "${value.slice(0, 40)}"). Nothing was changed.`);
      interfaceNames[key] = value.trim();
    }
  }
  const assigned = new Set(groups.flatMap((group) => group.members.map((member) => member.componentId)));
  const unassigned = onSheet.filter((item) => !assigned.has(item.id)).map((item) => item.refDes).sort(compareCodePoints);

  const plan: OrganizePlan = planOrganizeIntoSheets(state, sheetOrganizationGroupInputs(groups), input.getPart, { sourceSheetId, rootName: SHEET_ORGANIZATION_ROOT_NAME, operationIdPrefix: SHEET_ORGANIZATION_OPERATION_PREFIX, ...(Object.keys(interfaceNames).length > 0 ? { portNames: interfaceNames } : {}) });
  if (!plan.ok) return block("plan-refused", `${plan.code}: ${plan.message}`, plan.step?.refs);
  const identityBefore = componentIdentityDigest(state);
  const identityAfter = componentIdentityDigest(plan.after);
  if (identityBefore !== identityAfter || (plan.after.kicadComponents ?? []).length !== (state.kicadComponents ?? []).length) return block("equivalence-not-proven", "The organisation would change a component identity; it is not equivalent. Nothing was changed.");

  const interfaces: SheetOrganizationInterface[] = [];
  const seenPorts = new Set<string>();
  for (const step of plan.preview.steps) {
    for (const crossing of step.crossings) {
      const key = `${crossing.port.sheetId}:${crossing.port.id}`;
      if (seenPorts.has(key)) continue;
      seenPorts.add(key);
      interfaces.push({ net: crossing.netName, portName: crossing.port.name, defaultName: crossing.renamedFrom ?? (crossing.netName === null ? crossing.port.name : null), direction: "passive", childSheetId: crossing.port.sheetId, childSheetName: step.group.name, parentSheetId: crossing.sheetPin.sheetId, hierarchicalLabels: crossing.hierarchicalLabels.length });
    }
  }
  const checks = checkThese(state, groups, input.getPart, sourceSheetId);
  const compilation: SheetOrganizationCompilation = {
    sourceSheetId,
    rootName: SHEET_ORGANIZATION_ROOT_NAME,
    groups,
    interfaceNames,
    interfaces,
    unassigned,
    checkThese: checks.checks,
    checkNote: checks.note,
    renamedNets: plan.preview.steps.flatMap((step) => step.renamedNets.map((item) => ({ ...item }))),
    equivalence: { partitionDigest: plan.preview.partitionDigest, componentCount: (state.kicadComponents ?? []).length + state.components.length, identityDigest: identityBefore },
    operations: plan.operations,
    operationsDigest: sheetOrganizationOperationsDigest(schematicStateDigest(state), plan.operations),
  };
  return { ok: true, compilation };
}

/** "Check these": the parts the planner's own connectivity grouping (UNHINTED: hints would break every tie the model's way) places in
 *  another group than the model did, each with the planner's reason, bounded (OD-258 item 4: a usable proposal, not a refusal). */
function checkThese(state: SchematicState, groups: readonly SheetOrganizationGroup[], getPart: OrganizePartSource, sourceSheetId: string): { checks: SheetOrganizationCheck[]; note: string | null } {
  const own = proposeSheetGroups(state, getPart, { sourceSheetId });
  if (!own.ok) return { checks: [], note: `The connectivity grouping could not be derived for comparison (${own.code}): ${own.message}` };
  const modelGroupOf = new Map(groups.flatMap((group) => group.members.map((member) => [member.refDes, group.name] as const)));
  const plannerGroupOf = new Map(own.groups.flatMap((group) => group.refs.map((ref) => [ref, group] as const)));
  const checks: SheetOrganizationCheck[] = [];
  for (const [ref, modelGroup] of [...modelGroupOf.entries()].sort(([a], [b]) => compareCodePoints(a, b))) {
    const planned = plannerGroupOf.get(ref);
    if (!planned) continue;
    // the planner's group named after the hint that holds its primary hub; the model's group holding most of the planner's parts is its counterpart
    const counterpart = [...new Set(planned.refs.map((other) => modelGroupOf.get(other)).filter((name): name is string => name !== undefined))]
      .map((name) => ({ name, shared: planned.refs.filter((other) => modelGroupOf.get(other) === name).length }))
      .sort((a, b) => (b.shared - a.shared) || compareCodePoints(a.name, b.name))[0];
    if (!counterpart || counterpart.name === modelGroup) continue;
    checks.push({ refs: [ref], group: modelGroup, alternatives: [counterpart.name], reason: `${ref} is placed in "${modelGroup}", but by connectivity it belongs with ${planned.hubs.length > 0 ? planned.hubs.join(", ") : planned.refs.filter((other) => other !== ref).slice(0, 3).join(", ")} (mostly in "${counterpart.name}"): ${planned.reason}` });
    if (checks.length >= SHEET_ORGANIZATION_LIMITS.maxChecks) break;
  }
  return { checks, note: null };
}

/** Seal a compiled organisation against the exact state and scope it was compiled from (the tier-1 pattern; fails closed). */
export function sealSheetOrganizationProposal(input: {
  state: SchematicState;
  compilation: SheetOrganizationCompilation;
  scope: Tier1ProposalScope;
  authorization: SchematicProposalAuthorizationBinding;
  version: string;
  provenance: { provider: string; runId: string; note: string; instruction: string };
  now: number;
}): SheetOrganizationSealOutcome {
  if (!isWellFormedProposalScope(input.scope)) return { kind: "blocked", blockers: [{ code: "plan-refused", detail: "No authoritative project scope / canonical head mark is available - the proposal cannot be sealed. Nothing was changed." }] };
  if (!isWellFormedAuthorizationBinding(input.authorization) || input.authorization.tenantId !== input.scope.tenantId || input.authorization.projectId !== input.scope.projectId || input.authorization.branchId !== input.scope.branchId) {
    return { kind: "blocked", blockers: [{ code: "plan-refused", detail: "No verified authorization binding matching the project scope is available - the proposal cannot be sealed. Nothing was changed." }] };
  }
  const c = input.compilation;
  const baseSchematicDigest = schematicStateDigest(input.state);
  if (sheetOrganizationOperationsDigest(baseSchematicDigest, c.operations) !== c.operationsDigest) return { kind: "blocked", blockers: [{ code: "equivalence-not-proven", detail: "The compiled operations do not belong to this schematic snapshot. Nothing was changed." }] };
  const body = {
    schema: SHEET_ORGANIZATION_PROPOSAL_SCHEMA,
    toolId: SHEET_ORGANIZATION_TOOL_ID,
    version: input.version,
    scope: structuredClone(input.scope),
    authorization: structuredClone(input.authorization),
    baseSchematicDigest,
    sourceSheetId: c.sourceSheetId,
    rootName: c.rootName,
    groups: structuredClone(c.groups),
    interfaceNames: { ...c.interfaceNames },
    interfaces: structuredClone(c.interfaces),
    unassigned: [...c.unassigned],
    checkThese: structuredClone(c.checkThese),
    checkNote: c.checkNote,
    renamedNets: structuredClone(c.renamedNets),
    equivalence: { ...c.equivalence },
    operationsDigest: c.operationsDigest,
    operationCount: c.operations.length,
    provenance: { provider: input.provenance.provider, runId: input.provenance.runId, note: input.provenance.note, instruction: input.provenance.instruction },
    createdAt: input.now,
    expiresAt: input.now + SHEET_ORGANIZATION_PROPOSAL_TTL_MS,
  };
  const proposal: SealedSheetOrganizationProposal = { ...body, proposalId: `shorg-${engineeringDigest({ schema: IDENTITY_SCHEMA, body }).slice(5)}` };
  if (JSON.stringify(proposal).length > SHEET_ORGANIZATION_LIMITS.maxArtifactChars) return { kind: "blocked", blockers: [{ code: "proposal-too-large", detail: `The organisation proposal would exceed ${SHEET_ORGANIZATION_LIMITS.maxArtifactChars} characters; organise fewer parts at once. Nothing was changed.` }] };
  return { kind: "sealed", proposal: deepFreeze(proposal) };
}

export type SheetOrganizationVerification =
  | { ok: true }
  | { ok: false; code: "malformed" | "wrong-version" | "altered" | "stale-base" | "foreign-scope" | "stale-head" | "expired"; detail: string };

/** INTEGRITY-ONLY verification: schema, the exact key set, well-formed scope and binding, the sealed identity (no currency checks). */
export function verifySealedSheetOrganizationProposalIntegrity(candidate: unknown): SheetOrganizationVerification {
  if (!isRecord(candidate)) return { ok: false, code: "malformed", detail: "The organisation proposal is not an object." };
  if (candidate.schema !== SHEET_ORGANIZATION_PROPOSAL_SCHEMA) return { ok: false, code: "wrong-version", detail: `The artifact is not a ${SHEET_ORGANIZATION_PROPOSAL_SCHEMA} proposal.` };
  if (Object.keys(candidate).sort().join(",") !== [...PROPOSAL_KEYS].sort().join(",")) return { ok: false, code: "malformed", detail: "The organisation proposal does not carry exactly the sealed key set." };
  if (candidate.toolId !== SHEET_ORGANIZATION_TOOL_ID || !boundedString(candidate.version, 20)) return { ok: false, code: "malformed", detail: "The organisation proposal names another tool." };
  if (!isWellFormedProposalScope(candidate.scope)) return { ok: false, code: "malformed", detail: "The organisation proposal's scope or head mark is malformed." };
  const scope = candidate.scope;
  if (!isWellFormedAuthorizationBinding(candidate.authorization) || candidate.authorization.tenantId !== scope.tenantId || candidate.authorization.projectId !== scope.projectId || candidate.authorization.branchId !== scope.branchId) return { ok: false, code: "malformed", detail: "The organisation proposal's authorization binding is missing, malformed, or disagrees with its scope." };
  if (!boundedString(candidate.baseSchematicDigest, 64) || !boundedString(candidate.sourceSheetId, 200) || !boundedString(candidate.rootName, 120)) return { ok: false, code: "malformed", detail: "The organisation proposal's base or source sheet is malformed." };
  const groups = candidate.groups;
  if (!Array.isArray(groups) || groups.length === 0 || groups.length > SHEET_ORGANIZATION_LIMITS.maxGroups) return { ok: false, code: "malformed", detail: "The organisation proposal's groups are malformed." };
  for (const group of groups) {
    if (!isRecord(group) || !boundedString(group.sheetId, 200) || !boundedString(group.name, SHEET_ORGANIZATION_LIMITS.maxNameChars) || !Array.isArray(group.members) || group.members.length === 0) return { ok: false, code: "malformed", detail: "A group of the organisation proposal is malformed." };
    for (const member of group.members) if (!isRecord(member) || !boundedString(member.componentId, 200) || !boundedString(member.refDes, SHEET_ORGANIZATION_LIMITS.maxMemberChars) || Object.keys(member).length !== 2) return { ok: false, code: "malformed", detail: "A member of the organisation proposal is malformed." };
  }
  if (!isRecord(candidate.interfaceNames) || !Array.isArray(candidate.interfaces) || !Array.isArray(candidate.unassigned) || !Array.isArray(candidate.checkThese) || !Array.isArray(candidate.renamedNets)) return { ok: false, code: "malformed", detail: "The organisation proposal's interfaces or lists are malformed." };
  if (candidate.checkNote !== null && typeof candidate.checkNote !== "string") return { ok: false, code: "malformed", detail: "The organisation proposal's check note is malformed." };
  const equivalence = candidate.equivalence;
  if (!isRecord(equivalence) || !boundedString(equivalence.partitionDigest, 128) || typeof equivalence.componentCount !== "number" || !boundedString(equivalence.identityDigest, 64)) return { ok: false, code: "malformed", detail: "The organisation proposal's equivalence is malformed." };
  if (!boundedString(candidate.operationsDigest, 64) || typeof candidate.operationCount !== "number" || !Number.isInteger(candidate.operationCount) || candidate.operationCount < 1) return { ok: false, code: "malformed", detail: "The organisation proposal's operations digest is malformed." };
  const provenance = candidate.provenance;
  if (!isRecord(provenance) || !boundedString(provenance.provider, 40) || !boundedString(provenance.runId, 200) || typeof provenance.note !== "string" || typeof provenance.instruction !== "string") return { ok: false, code: "malformed", detail: "The organisation proposal's provenance is malformed." };
  if (typeof candidate.createdAt !== "number" || !Number.isFinite(candidate.createdAt) || candidate.expiresAt !== candidate.createdAt + SHEET_ORGANIZATION_PROPOSAL_TTL_MS) return { ok: false, code: "malformed", detail: "The organisation proposal's times are malformed." };
  const { proposalId, ...body } = candidate;
  if (`shorg-${engineeringDigest({ schema: IDENTITY_SCHEMA, body }).slice(5)}` !== proposalId) return { ok: false, code: "altered", detail: "The organisation proposal does not match its sealed identity (scope, head, groups, digests and binding included)." };
  return { ok: true };
}

/** Apply-time verification against the CURRENT schematic digest and the current ready session's scope / head (the tier-1 rules). */
export function verifySealedSheetOrganizationProposal(candidate: unknown, input: { currentSchematicDigest: string; now: number; expectedScope: Tier1ProposalScope }): SheetOrganizationVerification {
  const integrity = verifySealedSheetOrganizationProposalIntegrity(candidate);
  if (!integrity.ok) return integrity;
  const proposal = candidate as SealedSheetOrganizationProposal;
  if (!isWellFormedProposalScope(input.expectedScope)) return { ok: false, code: "foreign-scope", detail: "No authoritative current scope/head identity is available to verify against." };
  const sealed = proposal.scope;
  const expected = input.expectedScope;
  if (sealed.tenantId !== expected.tenantId || sealed.projectId !== expected.projectId || sealed.branchId !== expected.branchId) return { ok: false, code: "foreign-scope", detail: "The organisation proposal was sealed for a different tenant/project/branch. Nothing was changed." };
  if (sealed.headMark.lineageId !== expected.headMark.lineageId) return { ok: false, code: "foreign-scope", detail: "The organisation proposal was sealed against a different schematic lineage. Nothing was changed." };
  if (sealed.headMark.headSequence !== expected.headMark.headSequence || sealed.headMark.canonicalStateDigest !== expected.headMark.canonicalStateDigest) return { ok: false, code: "stale-head", detail: "The canonical schematic head moved after this organisation was proposed (even an identical-looking schematic is a different head). Ask for it again from the current schematic." };
  if (input.now > proposal.expiresAt) return { ok: false, code: "expired", detail: "The organisation proposal has expired; ask for it again from the current schematic." };
  if (input.currentSchematicDigest !== proposal.baseSchematicDigest) return { ok: false, code: "stale-base", detail: "The schematic changed after this organisation was proposed; ask for it again from the current schematic." };
  return { ok: true };
}

export type SheetOrganizationReplan =
  | { ok: true; operations: EngineeringOperation[]; inverseOperations: EngineeringOperation[]; after: SchematicState }
  | { ok: false; code: "stale-base" | "plan-refused" | "operations-differ" | "partition-differs"; detail: string };

/**
 * The page's Approve: re-plan the sealed groups on the CURRENT base through the same planner and hand back the operations only when
 * their digest and the resulting partition digest equal the sealed ones (one truth: the seal's plan IS the applied plan). Pure.
 */
export function replanSheetOrganization(proposal: SealedSheetOrganizationProposal, state: SchematicState, getPart: OrganizePartSource): SheetOrganizationReplan {
  const baseDigest = schematicStateDigest(state);
  if (baseDigest !== proposal.baseSchematicDigest) return { ok: false, code: "stale-base", detail: "The schematic is not the one the organisation was proposed for. Nothing was changed." };
  const plan = planOrganizeIntoSheets(state, sheetOrganizationGroupInputs(proposal.groups), getPart, { sourceSheetId: proposal.sourceSheetId, rootName: proposal.rootName, operationIdPrefix: SHEET_ORGANIZATION_OPERATION_PREFIX, ...(Object.keys(proposal.interfaceNames).length > 0 ? { portNames: proposal.interfaceNames } : {}) });
  if (!plan.ok) return { ok: false, code: "plan-refused", detail: `${plan.code}: ${plan.message}` };
  if (sheetOrganizationOperationsDigest(baseDigest, plan.operations) !== proposal.operationsDigest || plan.operations.length !== proposal.operationCount) return { ok: false, code: "operations-differ", detail: "The re-planned organisation differs from the sealed proposal; ask for it again from the current schematic. Nothing was changed." };
  if (plan.preview.partitionDigest !== proposal.equivalence.partitionDigest) return { ok: false, code: "partition-differs", detail: "The re-planned organisation would connect pins differently from the sealed proposal. Nothing was changed." };
  return { ok: true, operations: plan.operations, inverseOperations: plan.inverseOperations, after: plan.after };
}

/** The sheets a sealed proposal would create, by name (display). */
export function sheetOrganizationSheetNames(proposal: Pick<SealedSheetOrganizationProposal, "groups">): string[] {
  return proposal.groups.map((group) => group.name);
}

/** Whether `state` already holds a sheet the proposal would create (the organisation was applied or a sibling took the name). */
export function sheetOrganizationAlreadyApplied(proposal: Pick<SealedSheetOrganizationProposal, "groups">, state: SchematicState): boolean {
  const ids = new Set(sheetsOf(state).map((sheet) => sheet.id));
  return proposal.groups.some((group) => ids.has(group.sheetId));
}
