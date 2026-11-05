/**
 * [PR-F fD] MODULE CONTRACTS (the owner's Astra directive, sections 6-7; CONTINUATION E): the typed, versioned contract a model
 * submits for the modules of ONE pinned schematic, and the validator that checks it against that schematic. Schema
 * `sirkit.module-contract.v1`.
 *
 *  - a module is a stable id, a name and a responsibility; it OWNS components named by their EXACT identities on the pinned
 *    sheet - the validator binds each reference designator to the schematic's own instance (KiCad: component id, part id and
 *    published exact revision id; Theory: component id and type) and copies those into the validated set, never the model's
 *    text; an identity the model states must agree (a part or revision id that differs is refused, never substituted);
 *  - ports name NETS by the sheet's own identities: a net label (`netLabelNameKey`) or `GND` (a ground symbol or ground-kind
 *    label) - the SAME names the netlist authority publishes (app/lib/pcb/netlist-bridge.ts `buildNetlist`: net labels win,
 *    ground → GND); an unnamed net has no stable identity and cannot be a port. No second netlist: the known net set is the
 *    union of what the netlist authority names and what the sheet's labels declare (without the parts cache the authority
 *    locates Theory pins only, so a Build-sheet label net has no located node and the label itself is its declared identity);
 *  - every numeric value is a `Quantity` WITH a unit; every recommendation (a port fact, a requirement, a constraint) carries
 *    evidence { sourceIdentity, documentRevision, section, applicability, assumptions, uncertainty, kind } (directive 6) - a
 *    value without units and an evidence without a source are refused;
 *  - unknown stays unknown: a port fact or a requirement topic the model does not know is listed `unknown` (a topic that does
 *    not apply, `notApplicable`); a fact neither stated nor listed is refused as unstated, never defaulted;
 *  - footprint / pin authority is DERIVED from the sheet through the editor's own refusal list (`listUnresolvedInstances`,
 *    app/lib/pcb-sync/unresolved-instances.ts): an owned instance without a published exact revision must be acknowledged in
 *    the module's `partAuthorityGaps`; claiming a gap for a resolved instance, or hiding one, is refused;
 *  - cross-module constraints bind the shared resources (power, ground, clock, reference, connector nets) and net ownership:
 *    a net carried by the ports of two or more modules is an INTERFACE and must be stated by a constraint naming every
 *    module that carries it; a signal interface (an output meets an input) must address loading - the driver's permitted
 *    load and the receiver's impedance - or say explicitly that it is unknown; a shared reference net must name its owner.
 *    "An individually passing filter and ADC module do not automatically make a passing acquisition system" (directive 7):
 *    the validator refuses the set whose interface is unstated, however complete each module is;
 *  - the directive's initial qualified scope is at most 50 physical component instances (connectors and repeated parts
 *    count; a Theory stimulus such as a ground or a source is not physical): a sheet beyond it is refused as unsupported,
 *    never classified a success.
 *
 * What the validator does NOT do: it runs no electrical check, no simulation, no ERC - the validated set says so
 * (`electricalCheck.state === "not_run"`). It proves identities, nets, units, evidence shape, ownership and the interface
 * statements against the pinned sheet, nothing else. Pure: reads the schematic state only - no part cache, no network, no DOM.
 */
import type { SchematicState } from "@/lib/schematic-types";
import { netLabelNameKey, normalizeRefDes, refDesKey, schDisplayRef } from "@/lib/schematic-types";
import { buildNetlist, theoryPinContract } from "../pcb/netlist-bridge";
import { listUnresolvedInstances, type UnresolvedInstance, type UnresolvedInstanceMissing } from "../pcb-sync/unresolved-instances";
import { engineeringDigest } from "./stable";

export const MODULE_CONTRACT_SCHEMA = "sirkit.module-contract.v1" as const;
/** Directive section 2: the initial qualified scope, in physical component instances (KiCad instances + physical Theory parts). */
export const ASTRA_QUALIFIED_PHYSICAL_INSTANCES = 50;
export const EVIDENCE_KINDS = Object.freeze(["hard-requirement", "approved-policy", "optimization-goal"] as const);
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const PORT_DIRECTIONS = Object.freeze(["input", "output", "bidirectional", "power-in", "power-out", "reference", "ground"] as const);
export type PortDirection = (typeof PORT_DIRECTIONS)[number];
/** The facts a port states or lists unknown (logic level applies to the three signal directions only). */
export const PORT_FACTS = Object.freeze(["voltage", "current", "logicLevel", "impedance", "permittedLoading"] as const);
export type PortFact = (typeof PORT_FACTS)[number];
export const SIGNAL_DIRECTIONS: readonly PortDirection[] = Object.freeze(["input", "output", "bidirectional"]);
/** Directive 7: the requirement topics every module states, lists unknown, or marks not applicable. */
export const REQUIREMENT_TOPICS = Object.freeze(["bandwidth", "gain", "noise", "timing", "accuracy", "power", "reference", "ground", "startup", "protection"] as const);
export type RequirementTopic = (typeof REQUIREMENT_TOPICS)[number];
export const CONSTRAINT_KINDS = Object.freeze(["interface", "shared-power", "shared-ground", "shared-clock", "shared-reference", "shared-connector", "net-ownership"] as const);
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];
/** The kinds that name a net's OWNER (the module that sources or arbitrates the shared resource). */
export const OWNED_CONSTRAINT_KINDS: readonly ConstraintKind[] = Object.freeze(["shared-power", "shared-ground", "shared-clock", "shared-reference", "shared-connector", "net-ownership"]);
export const QUANTITY_BOUNDS = Object.freeze(["min", "max", "typical", "nominal"] as const);
export type QuantityBound = (typeof QUANTITY_BOUNDS)[number];
/** The ground net's name, as the netlist authority publishes it. */
export const GROUND_NET = "GND";

export const MAX_CONTRACT_MODULES = 32;
export const MAX_CONTRACT_PORTS = 64;
export const MAX_CONTRACT_REQUIREMENTS = 64;
export const MAX_CONTRACT_CONSTRAINTS = 64;
export const MAX_CONTRACT_TESTS = 32;
export const MAX_CONTRACT_LIST_ITEMS = 32;
export const MAX_CONTRACT_EVIDENCE = 16;
export const MAX_CONTRACT_QUANTITIES = 16;
export const MAX_CONTRACT_NAME_CHARS = 120;
export const MAX_CONTRACT_TEXT_CHARS = 400;

/** The closed refusal codes (`validateModuleContractSet`; all-or-nothing, every blocker listed). */
export const MODULE_CONTRACT_REFUSAL_CODES = Object.freeze([
  "set-malformed", "scope-unsupported", "module-malformed", "module-id-duplicate", "component-unknown", "component-ambiguous", "component-identity-mismatch", "component-double-ownership",
  "port-malformed", "port-net-unknown", "port-fact-unstated", "quantity-without-units", "quantity-malformed", "evidence-without-source", "evidence-malformed", "evidence-missing",
  "requirement-malformed", "requirement-without-evidence", "module-topic-unstated", "module-topic-conflict", "part-authority-mismatch", "part-authority-gap-unstated", "test-malformed",
  "constraint-malformed", "constraint-net-unknown", "constraint-module-unknown", "constraint-without-evidence", "net-owner-missing", "net-ownership-conflict",
  "interface-unstated", "interface-loading-unstated", "reference-unstated",
] as const);
export type ModuleContractRefusalCode = (typeof MODULE_CONTRACT_REFUSAL_CODES)[number];

// ─── The validated contract (what the sealed artifact carries) ──────────────────────────────────────────────────────────────

/** Every numeric value carries its unit; `bound` says what the number is (a minimum, a maximum, a typical or a nominal value). */
export interface Quantity { name: string; value: number; unit: string; bound: QuantityBound }
/** Directive 6: what is retained for each material recommendation. */
export interface ContractEvidence { sourceIdentity: string; documentRevision: string; section: string; applicability: string; assumptions: string; uncertainty: string; kind: EvidenceKind }
export interface ModuleRequirement { topic: RequirementTopic; statement: string; quantities: Quantity[]; evidence: ContractEvidence[] }
export interface ModulePort {
  id: string;
  /** The net's identity on the pinned sheet (a net label name as `netLabelNameKey` normalizes it, or GND). */
  net: string;
  direction: PortDirection;
  /** null: not stated (listed `unknown`, or not a signal direction). */
  logicLevel: string | null;
  voltage: Quantity[];
  current: Quantity[];
  impedance: Quantity[];
  permittedLoading: Quantity[];
  unknown: PortFact[];
  evidence: ContractEvidence[];
}
/** The EXACT identity of an owned component, copied from the pinned sheet (never from the model's text). */
export interface OwnedComponent {
  refDes: string;
  family: "kicad" | "theory";
  componentId: string;
  /** KiCad: the catalog part id the instance was placed from; Theory: null. */
  partId: string | null;
  /** KiCad: the published exact revision the instance carries, or null (then a part-authority gap); Theory: null. */
  revisionId: string | null;
  /** Theory: the symbol type (resistor, capacitor, ...); KiCad: null. */
  theoryType: string | null;
  value: string;
}
export interface ModuleTest { id: string; procedure: string; acceptance: string; quantities: Quantity[]; evidence: ContractEvidence[] }
export interface ModuleContract {
  id: string;
  name: string;
  responsibility: string;
  components: OwnedComponent[];
  ports: ModulePort[];
  requirements: ModuleRequirement[];
  unknown: RequirementTopic[];
  notApplicable: RequirementTopic[];
  /** The owned instances the module acknowledges as lacking footprint / pin authority (reference designators). */
  partAuthorityGaps: string[];
  placementRouting: string[];
  tests: ModuleTest[];
}
export interface InterfaceLoading { state: "stated"; driver: string; quantities: Quantity[] }
export interface InterfaceLoadingUnknown { state: "unknown"; reason: string }
export interface CrossModuleConstraint {
  id: string;
  kind: ConstraintKind;
  net: string;
  modules: string[];
  /** The owning module for a shared resource (required for the owned kinds); null for an interface. */
  owner: string | null;
  statement: string;
  quantities: Quantity[];
  /** An interface states its loading or says it is unknown; null for the other kinds. */
  loading: InterfaceLoading | InterfaceLoadingUnknown | null;
  evidence: ContractEvidence[];
}
/** Footprint / pin authority of one owned instance, DERIVED from the pinned sheet (the editor's own refusal list), per module. */
export interface PartAuthorityRow { refDes: string; moduleId: string; state: "published-exact-revision" | "unresolved"; missing: UnresolvedInstanceMissing | null; reviewPath: string | null }
export interface ModuleContractSet {
  schema: typeof MODULE_CONTRACT_SCHEMA;
  system: { name: string; statement: string; operatingConditions: Quantity[] };
  modules: ModuleContract[];
  constraints: CrossModuleConstraint[];
  /** Derived from the sheet: what must be published before PCB, per owned instance. */
  partAuthority: PartAuthorityRow[];
  coverage: {
    /** Physical instances on the sheet, as the directive counts them. */
    physicalInstances: number;
    owned: number;
    /** Physical instances no module owns (data, never a refusal: a visible gap). */
    unassigned: string[];
    /** The sheet's named nets and the ones the ports reference. */
    knownNets: string[];
    referencedNets: string[];
    /** Nets carried by two or more modules, with the constraints that state them. */
    sharedNets: Array<{ net: string; modules: string[]; constraintIds: string[] }>;
  };
  /** No electrical check ran here; the set proves identities, nets, units, evidence and interface statements only. */
  electricalCheck: { state: "not_run"; detail: string };
}

export interface ModuleContractBlocker { code: ModuleContractRefusalCode; detail: string; moduleId?: string }
export type ModuleContractValidation = { ok: true; set: ModuleContractSet } | { ok: false; blockers: ModuleContractBlocker[] };

export const ELECTRICAL_CHECK_NOT_RUN = "no electrical check, simulation or ERC ran over this contract set: identities, nets, units, evidence shape, ownership and the interface statements were checked against the pinned schematic, nothing else; cross-module loading, references, return paths, power sequencing and whole-circuit behaviour are rechecked after composition by the existing deterministic checks, never by this note";

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const closed = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => record(value) && Object.keys(value).every((key) => keys.includes(key));
const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "").trim();
  if (trimmed.length === 0) return null;
  const points = Array.from(trimmed);
  return points.length <= max ? trimmed : `${points.slice(0, max - 1).join("")}…`;
};
const stringList = (value: unknown, max: number, each: number): string[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const out: string[] = [];
  for (const entry of value) { const words = text(entry, each); if (words === null) return null; out.push(words); }
  return out;
};
const topicList = (value: unknown): RequirementTopic[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > REQUIREMENT_TOPICS.length) return null;
  const out: RequirementTopic[] = [];
  for (const entry of value) { if (!(REQUIREMENT_TOPICS as readonly string[]).includes(entry as string)) return null; out.push(entry as RequirementTopic); }
  return out;
};

/** The identities of the pinned sheet by reference key; an ambiguous reference (two instances) is recorded, never guessed. */
export function schematicComponentIdentities(state: SchematicState): { byRef: Map<string, OwnedComponent>; ambiguous: Set<string> } {
  const byRef = new Map<string, OwnedComponent>();
  const ambiguous = new Set<string>();
  const add = (component: OwnedComponent): void => {
    const key = refDesKey(component.refDes);
    if (byRef.has(key)) { ambiguous.add(key); return; }
    byRef.set(key, component);
  };
  for (const instance of state.kicadComponents ?? []) {
    add({ refDes: normalizeRefDes(instance.refDes), family: "kicad", componentId: instance.id, partId: instance.partId, revisionId: instance.atomicPartRevisionId ?? null, theoryType: null, value: instance.value ?? "" });
  }
  for (const component of state.components) {
    if (theoryPinContract(component.type) === null) continue; // a stimulus (ground, source) is not a physical part and cannot be owned
    add({ refDes: normalizeRefDes(schDisplayRef(component)), family: "theory", componentId: component.id, partId: null, revisionId: null, theoryType: component.type, value: component.value ?? "" });
  }
  for (const key of ambiguous) byRef.delete(key);
  return { byRef, ambiguous };
}

/** Directive section 2's count: KiCad instances plus physical Theory parts (a stimulus is not physical). */
export function physicalInstanceCount(state: SchematicState): number {
  return (state.kicadComponents ?? []).length + state.components.filter((component) => theoryPinContract(component.type) !== null).length;
}

/**
 * The sheet's NAMED nets: what the netlist authority names (labels win; ground → GND; an unnamed net is `N$n`, no stable
 * identity, excluded) united with the sheet's declared labels and GND when a ground symbol or ground-kind label exists.
 */
export function knownNetNames(state: SchematicState): Set<string> {
  const names = new Set<string>();
  for (const net of buildNetlist(state).nets) if (!/^N\$\d+$/.test(net.name)) names.add(netLabelNameKey(net.name));
  for (const label of state.netLabels ?? []) {
    if (label.kind === "ground") names.add(GROUND_NET);
    const key = netLabelNameKey(label.name);
    if (key.length > 0) names.add(key);
  }
  if (state.components.some((component) => component.type === "ground")) names.add(GROUND_NET);
  return names;
}

export function moduleContractSetDigest(set: ModuleContractSet): string {
  return engineeringDigest({ schema: "sirkit.module-contract-set-digest.v1", set });
}

// ─── The validator ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const SET_KEYS = Object.freeze(["system", "modules", "constraints"] as const);
const SYSTEM_KEYS = Object.freeze(["name", "statement", "operatingConditions"] as const);
const MODULE_KEYS = Object.freeze(["id", "name", "responsibility", "components", "ports", "requirements", "unknown", "notApplicable", "partAuthorityGaps", "placementRouting", "tests"] as const);
const COMPONENT_KEYS = Object.freeze(["refDes", "partId", "revisionId"] as const);
const PORT_KEYS = Object.freeze(["id", "net", "direction", "logicLevel", "voltage", "current", "impedance", "permittedLoading", "unknown", "evidence"] as const);
const REQUIREMENT_KEYS = Object.freeze(["topic", "statement", "quantities", "evidence"] as const);
const TEST_KEYS = Object.freeze(["id", "procedure", "acceptance", "quantities", "evidence"] as const);
const CONSTRAINT_KEYS = Object.freeze(["id", "kind", "net", "modules", "owner", "statement", "quantities", "loading", "evidence"] as const);
const LOADING_KEYS = Object.freeze(["driver", "quantities", "unknown"] as const);
const QUANTITY_KEYS = Object.freeze(["name", "value", "unit", "bound"] as const);
const EVIDENCE_KEYS = Object.freeze(["sourceIdentity", "documentRevision", "section", "applicability", "assumptions", "uncertainty", "kind"] as const);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

/**
 * Validate a submitted contract set against the pinned schematic. All-or-nothing: any blocker refuses the whole set, listing
 * every blocker found (bounded). On success the validated set carries the EXACT identities from the sheet, the derived part
 * authority rows and the coverage. Pure; no I/O.
 */
export function validateModuleContractSet(input: unknown, schematic: SchematicState): ModuleContractValidation {
  const blockers: ModuleContractBlocker[] = [];
  const block = (code: ModuleContractRefusalCode, detail: string, moduleId?: string): void => {
    if (blockers.length < 64) blockers.push({ code, detail: text(detail, 300) ?? code, ...(moduleId ? { moduleId } : {}) });
  };
  if (!closed(input, SET_KEYS) || !Array.isArray(input.modules) || !Array.isArray(input.constraints) || !record(input.system)) {
    block("set-malformed", `The contract set must be an object with exactly system, modules and constraints (schema ${MODULE_CONTRACT_SCHEMA}).`);
    return { ok: false, blockers };
  }
  const physical = physicalInstanceCount(schematic);
  if (physical > ASTRA_QUALIFIED_PHYSICAL_INSTANCES) block("scope-unsupported", `The pinned schematic holds ${physical} physical component instances; the initial qualified scope is at most ${ASTRA_QUALIFIED_PHYSICAL_INSTANCES} (connectors and repeated parts count). Classify the board unsupported or experimental; a module contract set is not sealed for it.`);
  const identities = schematicComponentIdentities(schematic);
  const nets = knownNetNames(schematic);
  const unresolved = new Map<string, UnresolvedInstance>();
  for (const item of listUnresolvedInstances(schematic)) if (!unresolved.has(refDesKey(item.refDes))) unresolved.set(refDesKey(item.refDes), item);

  // shared sub-validators
  const quantities = (value: unknown, where: string, moduleId?: string): Quantity[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_CONTRACT_QUANTITIES) { block("quantity-malformed", `${where}: quantities must be a list of at most ${MAX_CONTRACT_QUANTITIES} values.`, moduleId); return []; }
    const out: Quantity[] = [];
    value.forEach((entry, index) => {
      if (!closed(entry, QUANTITY_KEYS)) { block("quantity-malformed", `${where}: quantity ${index + 1} is not an object with name, value, unit and bound.`, moduleId); return; }
      const name = text(entry.name, MAX_CONTRACT_NAME_CHARS);
      const unit = text(entry.unit, 32);
      const bound = entry.bound === undefined ? "nominal" : entry.bound;
      if (name === null || typeof entry.value !== "number" || !Number.isFinite(entry.value)) { block("quantity-malformed", `${where}: quantity ${index + 1} needs a name and a finite numeric value.`, moduleId); return; }
      if (unit === null) { block("quantity-without-units", `${where}: "${name}" = ${entry.value} carries no unit; every numeric value carries its unit (V, A, ohm, Hz, dB, s, ...).`, moduleId); return; }
      if (!(QUANTITY_BOUNDS as readonly string[]).includes(bound as string)) { block("quantity-malformed", `${where}: "${name}" has a bound outside ${QUANTITY_BOUNDS.join(", ")}.`, moduleId); return; }
      out.push({ name, value: entry.value, unit, bound: bound as QuantityBound });
    });
    return out;
  };
  const evidence = (value: unknown, where: string, moduleId?: string): ContractEvidence[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_CONTRACT_EVIDENCE) { block("evidence-malformed", `${where}: evidence must be a list of at most ${MAX_CONTRACT_EVIDENCE} entries.`, moduleId); return []; }
    const out: ContractEvidence[] = [];
    value.forEach((entry, index) => {
      if (!closed(entry, EVIDENCE_KEYS)) { block("evidence-malformed", `${where}: evidence ${index + 1} is not an object with sourceIdentity, documentRevision, section, applicability, assumptions, uncertainty and kind.`, moduleId); return; }
      const sourceIdentity = text(entry.sourceIdentity, MAX_CONTRACT_TEXT_CHARS);
      if (sourceIdentity === null) { block("evidence-without-source", `${where}: evidence ${index + 1} names no source; every recommendation carries the identity of the document that states it (an exact-part datasheet, a manufacturer note, a reference design or a primary paper).`, moduleId); return; }
      const fields = { documentRevision: text(entry.documentRevision, MAX_CONTRACT_NAME_CHARS), section: text(entry.section, MAX_CONTRACT_NAME_CHARS), applicability: text(entry.applicability, MAX_CONTRACT_TEXT_CHARS), assumptions: text(entry.assumptions, MAX_CONTRACT_TEXT_CHARS), uncertainty: text(entry.uncertainty, MAX_CONTRACT_TEXT_CHARS) };
      const missing = Object.entries(fields).filter(([, field]) => field === null).map(([key]) => key);
      if (missing.length > 0 || !(EVIDENCE_KINDS as readonly string[]).includes(entry.kind as string)) { block("evidence-malformed", `${where}: evidence "${sourceIdentity}" lacks ${missing.length > 0 ? missing.join(", ") : `a kind in ${EVIDENCE_KINDS.join(", ")}`} (state "not stated by the source" rather than omit).`, moduleId); return; }
      out.push({ sourceIdentity, documentRevision: fields.documentRevision!, section: fields.section!, applicability: fields.applicability!, assumptions: fields.assumptions!, uncertainty: fields.uncertainty!, kind: entry.kind as EvidenceKind });
    });
    return out;
  };

  // 1. the system
  const systemIn = input.system;
  const systemName = closed(systemIn, SYSTEM_KEYS) ? text(systemIn.name, MAX_CONTRACT_NAME_CHARS) : null;
  const systemStatement = closed(systemIn, SYSTEM_KEYS) ? text(systemIn.statement, MAX_CONTRACT_TEXT_CHARS) : null;
  if (systemName === null || systemStatement === null) block("set-malformed", "system must carry a name and a statement of the system requirements and operating conditions (optional operatingConditions quantities).");
  const operatingConditions = closed(systemIn, SYSTEM_KEYS) ? quantities(systemIn.operatingConditions, "system.operatingConditions") : [];

  // 2. the modules
  if (input.modules.length === 0 || input.modules.length > MAX_CONTRACT_MODULES) block("set-malformed", `modules must list 1 to ${MAX_CONTRACT_MODULES} modules.`);
  const modules: ModuleContract[] = [];
  const moduleIds = new Set<string>();
  const ownerOf = new Map<string, string>(); // refDes key → module id
  const portNets = new Map<string, Map<string, Set<PortDirection>>>(); // net → module id → directions
  for (const [index, moduleIn] of input.modules.entries()) {
    const label = `modules[${index}]`;
    if (!closed(moduleIn, MODULE_KEYS)) { block("module-malformed", `${label}: not an object with the module keys (${MODULE_KEYS.join(", ")}).`); continue; }
    const id = text(moduleIn.id, 64);
    if (id === null || !ID_PATTERN.test(id)) { block("module-malformed", `${label}: id must be 1 to 64 letters, digits, dot, underscore, colon or hyphen.`); continue; }
    if (moduleIds.has(id)) { block("module-id-duplicate", `module id "${id}" is declared twice.`, id); continue; }
    moduleIds.add(id);
    const name = text(moduleIn.name, MAX_CONTRACT_NAME_CHARS);
    const responsibility = text(moduleIn.responsibility, MAX_CONTRACT_TEXT_CHARS);
    if (name === null || responsibility === null) block("module-malformed", `module "${id}": name and responsibility are required.`, id);
    // 2a. owned components: exact identities from the sheet
    const components: OwnedComponent[] = [];
    if (!Array.isArray(moduleIn.components) || moduleIn.components.length > ASTRA_QUALIFIED_PHYSICAL_INSTANCES) block("module-malformed", `module "${id}": components must list at most ${ASTRA_QUALIFIED_PHYSICAL_INSTANCES} owned components by reference designator.`, id);
    else for (const entry of moduleIn.components) {
      if (!closed(entry, COMPONENT_KEYS)) { block("module-malformed", `module "${id}": a component entry is not an object with refDes (and optional partId, revisionId).`, id); continue; }
      const refDes = text(entry.refDes, 32);
      if (refDes === null) { block("component-unknown", `module "${id}": a component entry names no reference designator.`, id); continue; }
      const key = refDesKey(refDes);
      if (identities.ambiguous.has(key)) { block("component-ambiguous", `module "${id}": ${refDes} names two instances on the pinned sheet; the sheet must be disambiguated before it can be owned.`, id); continue; }
      const identity = identities.byRef.get(key);
      if (!identity) { block("component-unknown", `module "${id}": ${refDes} is not a physical component of the pinned schematic (identities are read from the sheet, never invented).`, id); continue; }
      if (entry.partId !== undefined && text(entry.partId, 256) !== identity.partId) { block("component-identity-mismatch", `module "${id}": ${identity.refDes} was placed from part ${identity.partId ?? "(none: a Theory symbol)"}, not ${String(entry.partId).slice(0, 80)}; a different part is never substituted.`, id); continue; }
      if (entry.revisionId !== undefined && text(entry.revisionId, 256) !== identity.revisionId) { block("component-identity-mismatch", `module "${id}": ${identity.refDes} carries ${identity.revisionId ? `published exact revision ${identity.revisionId}` : "no published exact revision"}, not ${String(entry.revisionId).slice(0, 80)}.`, id); continue; }
      const owner = ownerOf.get(key);
      if (owner !== undefined) { block("component-double-ownership", `${identity.refDes} is owned by module "${owner}" and by module "${id}"; one component has exactly one owner.`, id); continue; }
      ownerOf.set(key, id);
      components.push({ ...identity });
    }
    // 2b. ports: nets by the sheet's names; every fact stated or listed unknown; evidence when anything is stated
    const ports: ModulePort[] = [];
    const portIds = new Set<string>();
    if (!Array.isArray(moduleIn.ports) || moduleIn.ports.length > MAX_CONTRACT_PORTS) block("port-malformed", `module "${id}": ports must list at most ${MAX_CONTRACT_PORTS} ports.`, id);
    else for (const [portIndex, portIn] of moduleIn.ports.entries()) {
      const where = `module "${id}" port ${portIndex + 1}`;
      if (!closed(portIn, PORT_KEYS)) { block("port-malformed", `${where}: not an object with the port keys (${PORT_KEYS.join(", ")}).`, id); continue; }
      const portId = text(portIn.id, 64);
      const netName = text(portIn.net, 64);
      if (portId === null || !ID_PATTERN.test(portId) || portIds.has(portId)) { block("port-malformed", `${where}: id must be unique within the module (1 to 64 letters, digits, dot, underscore, colon or hyphen).`, id); continue; }
      portIds.add(portId);
      if (!(PORT_DIRECTIONS as readonly string[]).includes(portIn.direction as string)) { block("port-malformed", `${where} ("${portId}"): direction must be one of ${PORT_DIRECTIONS.join(", ")}.`, id); continue; }
      const direction = portIn.direction as PortDirection;
      const net = netName === null ? null : netLabelNameKey(netName);
      if (net === null || !nets.has(net)) { block("port-net-unknown", `${where} ("${portId}"): net "${netName ?? ""}" is not a named net of the pinned schematic (a net label or GND); ${nets.size > 0 ? `the sheet names ${[...nets].sort().slice(0, 12).join(", ")}${nets.size > 12 ? ", …" : ""}` : "the sheet names no net"}.`, id); continue; }
      const unknownFacts = portIn.unknown === undefined ? [] : Array.isArray(portIn.unknown) && portIn.unknown.every((fact) => (PORT_FACTS as readonly string[]).includes(fact as string)) ? [...new Set(portIn.unknown as PortFact[])] : null;
      if (unknownFacts === null) { block("port-malformed", `${where} ("${portId}"): unknown must list facts among ${PORT_FACTS.join(", ")}.`, id); continue; }
      const logicLevel = portIn.logicLevel === undefined ? null : text(portIn.logicLevel, MAX_CONTRACT_NAME_CHARS);
      if (portIn.logicLevel !== undefined && logicLevel === null) { block("port-malformed", `${where} ("${portId}"): logicLevel must be non-empty text when given.`, id); continue; }
      const port: ModulePort = {
        id: portId, net, direction, logicLevel,
        voltage: quantities(portIn.voltage, `${where} voltage`, id), current: quantities(portIn.current, `${where} current`, id),
        impedance: quantities(portIn.impedance, `${where} impedance`, id), permittedLoading: quantities(portIn.permittedLoading, `${where} permittedLoading`, id),
        unknown: unknownFacts, evidence: evidence(portIn.evidence, `${where} ("${portId}")`, id),
      };
      const stated = (fact: PortFact): boolean => (fact === "logicLevel" ? port.logicLevel !== null : port[fact].length > 0);
      const applicable = PORT_FACTS.filter((fact) => fact !== "logicLevel" || SIGNAL_DIRECTIONS.includes(direction));
      const unstated = applicable.filter((fact) => !stated(fact) && !port.unknown.includes(fact));
      if (unstated.length > 0) block("port-fact-unstated", `${where} ("${portId}", net ${net}): ${unstated.join(", ")} neither stated nor listed unknown; unknown stays unknown, but it is said.`, id);
      if (applicable.some(stated) && port.evidence.length === 0) block("evidence-missing", `${where} ("${portId}", net ${net}): states a limit or an impedance without evidence; a port fact is a datasheet fact and carries its source.`, id);
      ports.push(port);
      const byModule = portNets.get(net) ?? new Map<string, Set<PortDirection>>();
      const directions = byModule.get(id) ?? new Set<PortDirection>();
      directions.add(direction);
      byModule.set(id, directions);
      portNets.set(net, byModule);
    }
    // 2c. requirements: every topic stated, unknown or not applicable; every statement with evidence
    const requirements: ModuleRequirement[] = [];
    const statedTopics = new Set<RequirementTopic>();
    if (!Array.isArray(moduleIn.requirements) || moduleIn.requirements.length > MAX_CONTRACT_REQUIREMENTS) block("requirement-malformed", `module "${id}": requirements must list at most ${MAX_CONTRACT_REQUIREMENTS} entries.`, id);
    else for (const [reqIndex, reqIn] of moduleIn.requirements.entries()) {
      const where = `module "${id}" requirement ${reqIndex + 1}`;
      if (!closed(reqIn, REQUIREMENT_KEYS) || !(REQUIREMENT_TOPICS as readonly string[]).includes(reqIn.topic as string)) { block("requirement-malformed", `${where}: not an object with topic (one of ${REQUIREMENT_TOPICS.join(", ")}), statement, quantities and evidence.`, id); continue; }
      const statement = text(reqIn.statement, MAX_CONTRACT_TEXT_CHARS);
      if (statement === null) { block("requirement-malformed", `${where} (${String(reqIn.topic)}): statement is required.`, id); continue; }
      const topic = reqIn.topic as RequirementTopic;
      const proof = evidence(reqIn.evidence, `${where} (${topic})`, id);
      if (reqIn.evidence === undefined || (Array.isArray(reqIn.evidence) && reqIn.evidence.length === 0)) block("requirement-without-evidence", `${where} (${topic}): "${statement.slice(0, 80)}" carries no evidence; a requirement is a recommendation and names its source, or the topic is listed unknown.`, id);
      statedTopics.add(topic);
      requirements.push({ topic, statement, quantities: quantities(reqIn.quantities, `${where} (${topic})`, id), evidence: proof });
    }
    const unknownTopics = topicList(moduleIn.unknown);
    const notApplicable = topicList(moduleIn.notApplicable);
    if (unknownTopics === null || notApplicable === null) block("requirement-malformed", `module "${id}": unknown and notApplicable must list topics among ${REQUIREMENT_TOPICS.join(", ")}.`, id);
    else {
      for (const topic of REQUIREMENT_TOPICS) {
        const places = [statedTopics.has(topic) ? "stated" : null, unknownTopics.includes(topic) ? "unknown" : null, notApplicable.includes(topic) ? "notApplicable" : null].filter((place) => place !== null);
        if (places.length === 0) block("module-topic-unstated", `module "${id}": topic ${topic} is neither stated, listed unknown nor marked not applicable.`, id);
        else if (places.length > 1) block("module-topic-conflict", `module "${id}": topic ${topic} is ${places.join(" and ")} at once; keep one.`, id);
      }
    }
    // 2d. part authority: derived from the sheet; the module acknowledges every gap and claims none that is not there
    const gaps = stringList(moduleIn.partAuthorityGaps, ASTRA_QUALIFIED_PHYSICAL_INSTANCES, 32);
    if (gaps === null) block("part-authority-mismatch", `module "${id}": partAuthorityGaps must list reference designators.`, id);
    else {
      const gapKeys = new Set(gaps.map(refDesKey));
      for (const gap of gaps) {
        const owned = components.find((component) => refDesKey(component.refDes) === refDesKey(gap));
        if (!owned) block("part-authority-mismatch", `module "${id}": ${gap} is listed as a part-authority gap but the module does not own it.`, id);
        else if (!unresolved.has(refDesKey(gap))) block("part-authority-mismatch", `module "${id}": ${owned.refDes} carries a published exact revision and its symbol asset; it is not a part-authority gap.`, id);
      }
      for (const component of components) {
        const item = unresolved.get(refDesKey(component.refDes));
        if (item && !gapKeys.has(refDesKey(component.refDes))) block("part-authority-gap-unstated", `module "${id}": ${component.refDes} lacks ${item.missing === "theory_symbol_only" ? "a physical package (a Theory symbol)" : item.missing === "symbol_asset" ? "its installed symbol asset" : "a published exact revision"} and is not acknowledged in partAuthorityGaps; what must be published before PCB is stated, never implied (${item.reviewPath}).`, id);
      }
    }
    const placementRouting = stringList(moduleIn.placementRouting, MAX_CONTRACT_LIST_ITEMS, MAX_CONTRACT_TEXT_CHARS);
    if (placementRouting === null) block("module-malformed", `module "${id}": placementRouting must list at most ${MAX_CONTRACT_LIST_ITEMS} obligations in plain words.`, id);
    // 2e. tests and acceptance criteria
    const tests: ModuleTest[] = [];
    const testIds = new Set<string>();
    if (moduleIn.tests !== undefined && (!Array.isArray(moduleIn.tests) || moduleIn.tests.length > MAX_CONTRACT_TESTS)) block("test-malformed", `module "${id}": tests must list at most ${MAX_CONTRACT_TESTS} entries.`, id);
    else for (const [testIndex, testIn] of ((moduleIn.tests as unknown[] | undefined) ?? []).entries()) {
      const where = `module "${id}" test ${testIndex + 1}`;
      if (!closed(testIn, TEST_KEYS)) { block("test-malformed", `${where}: not an object with id, procedure, acceptance, quantities and evidence.`, id); continue; }
      const testId = text(testIn.id, 64);
      const procedure = text(testIn.procedure, MAX_CONTRACT_TEXT_CHARS);
      const acceptance = text(testIn.acceptance, MAX_CONTRACT_TEXT_CHARS);
      if (testId === null || !ID_PATTERN.test(testId) || testIds.has(testId) || procedure === null || acceptance === null) { block("test-malformed", `${where}: a unique id, a procedure and an acceptance criterion are required.`, id); continue; }
      testIds.add(testId);
      tests.push({ id: testId, procedure, acceptance, quantities: quantities(testIn.quantities, `${where} ("${testId}")`, id), evidence: evidence(testIn.evidence, `${where} ("${testId}")`, id) });
    }
    modules.push({ id, name: name ?? "", responsibility: responsibility ?? "", components, ports, requirements, unknown: unknownTopics ?? [], notApplicable: notApplicable ?? [], partAuthorityGaps: gaps ?? [], placementRouting: placementRouting ?? [], tests });
  }

  // 3. the cross-module constraints
  const constraints: CrossModuleConstraint[] = [];
  const constraintIds = new Set<string>();
  const netOwner = new Map<string, { owner: string; constraintId: string }>();
  if (input.constraints.length > MAX_CONTRACT_CONSTRAINTS) block("constraint-malformed", `constraints must list at most ${MAX_CONTRACT_CONSTRAINTS} entries.`);
  else for (const [index, constraintIn] of input.constraints.entries()) {
    const where = `constraints[${index}]`;
    if (!closed(constraintIn, CONSTRAINT_KEYS)) { block("constraint-malformed", `${where}: not an object with the constraint keys (${CONSTRAINT_KEYS.join(", ")}).`); continue; }
    const id = text(constraintIn.id, 64);
    if (id === null || !ID_PATTERN.test(id) || constraintIds.has(id)) { block("constraint-malformed", `${where}: id must be unique (1 to 64 letters, digits, dot, underscore, colon or hyphen).`); continue; }
    constraintIds.add(id);
    if (!(CONSTRAINT_KINDS as readonly string[]).includes(constraintIn.kind as string)) { block("constraint-malformed", `constraint "${id}": kind must be one of ${CONSTRAINT_KINDS.join(", ")}.`); continue; }
    const kind = constraintIn.kind as ConstraintKind;
    const netName = text(constraintIn.net, 64);
    const net = netName === null ? null : netLabelNameKey(netName);
    if (net === null || !nets.has(net)) { block("constraint-net-unknown", `constraint "${id}": net "${netName ?? ""}" is not a named net of the pinned schematic.`); continue; }
    const moduleRefs = stringList(constraintIn.modules, MAX_CONTRACT_MODULES, 64);
    if (moduleRefs === null || moduleRefs.length === 0) { block("constraint-module-unknown", `constraint "${id}": modules must name at least one module id.`); continue; }
    const unknownModules = moduleRefs.filter((ref) => !moduleIds.has(ref));
    if (unknownModules.length > 0) { block("constraint-module-unknown", `constraint "${id}": ${unknownModules.join(", ")} ${unknownModules.length === 1 ? "is not a module" : "are not modules"} of this set.`); continue; }
    const owner = constraintIn.owner === undefined ? null : text(constraintIn.owner, 64);
    if (constraintIn.owner !== undefined && (owner === null || !moduleIds.has(owner))) { block("constraint-module-unknown", `constraint "${id}": owner "${String(constraintIn.owner).slice(0, 64)}" is not a module of this set.`); continue; }
    if (OWNED_CONSTRAINT_KINDS.includes(kind) && owner === null) block("net-owner-missing", `constraint "${id}" (${kind}, net ${net}): a shared resource names the module that owns the net.`);
    if (owner !== null) {
      const existing = netOwner.get(net);
      if (existing && existing.owner !== owner) block("net-ownership-conflict", `net ${net} is owned by "${existing.owner}" (constraint "${existing.constraintId}") and by "${owner}" (constraint "${id}"); one net has one owner.`);
      else netOwner.set(net, { owner, constraintId: id });
    }
    const statement = text(constraintIn.statement, MAX_CONTRACT_TEXT_CHARS);
    if (statement === null) block("constraint-malformed", `constraint "${id}": statement is required.`);
    const proof = evidence(constraintIn.evidence, `constraint "${id}"`);
    if (constraintIn.evidence === undefined || (Array.isArray(constraintIn.evidence) && constraintIn.evidence.length === 0)) block("constraint-without-evidence", `constraint "${id}" (${kind}, net ${net}): carries no evidence; a cross-module constraint is a recommendation and names its source.`);
    let loading: CrossModuleConstraint["loading"] = null;
    if (kind === "interface") {
      const loadingIn = constraintIn.loading;
      if (!closed(loadingIn, LOADING_KEYS)) block("interface-loading-unstated", `constraint "${id}" (interface, net ${net}): loading must be stated (driver and quantities) or declared unknown with a reason; an interface whose loading is unsaid is not a contract.`);
      else if (loadingIn.unknown !== undefined) {
        const reason = text(loadingIn.unknown, MAX_CONTRACT_TEXT_CHARS);
        if (reason === null || loadingIn.driver !== undefined || loadingIn.quantities !== undefined) block("interface-loading-unstated", `constraint "${id}" (interface, net ${net}): loading.unknown must be the reason alone, with no driver or quantities beside it.`);
        else loading = { state: "unknown", reason };
      } else {
        const driver = text(loadingIn.driver, 64);
        const loadQuantities = quantities(loadingIn.quantities, `constraint "${id}" loading`);
        if (driver === null || !moduleRefs.includes(driver) || loadQuantities.length === 0) block("interface-loading-unstated", `constraint "${id}" (interface, net ${net}): loading names the driving module (one of ${moduleRefs.join(", ")}) and at least one quantity with its unit (the driver's permitted load, the receiver's impedance).`);
        else loading = { state: "stated", driver, quantities: loadQuantities };
      }
    } else if (constraintIn.loading !== undefined) block("constraint-malformed", `constraint "${id}" (${kind}): loading belongs to an interface constraint only.`);
    constraints.push({ id, kind, net, modules: [...new Set(moduleRefs)].sort(), owner, statement: statement ?? "", quantities: quantities(constraintIn.quantities, `constraint "${id}"`), loading, evidence: proof });
  }

  // 4. the cross-module check: every shared net is stated by a constraint over every module that carries it (directive 7)
  const sharedNets: ModuleContractSet["coverage"]["sharedNets"] = [];
  for (const [net, byModule] of [...portNets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (byModule.size < 2) continue;
    const carrying = [...byModule.keys()].sort();
    const covering = constraints.filter((constraint) => constraint.net === net && carrying.every((moduleId) => constraint.modules.includes(moduleId)));
    sharedNets.push({ net, modules: carrying, constraintIds: covering.map((constraint) => constraint.id) });
    if (covering.length === 0) { block("interface-unstated", `net ${net} is carried by modules ${carrying.join(", ")} but no cross-module constraint states that interface over all of them; two individually complete modules do not make a system until their interface is stated (loading, reference, ownership).`); continue; }
    const directions = new Set([...byModule.values()].flatMap((set) => [...set]));
    const signal = (directions.has("output") || directions.has("bidirectional")) && (directions.has("input") || directions.has("bidirectional"));
    if (signal && !covering.some((constraint) => constraint.kind === "interface")) block("interface-loading-unstated", `net ${net} joins a driver and a receiver across modules ${carrying.join(", ")} without an interface constraint stating the loading (the driver's permitted load, the receiver's impedance) or declaring it unknown.`);
    if (directions.has("reference") && !covering.some((constraint) => constraint.kind === "shared-reference" && constraint.owner !== null)) block("reference-unstated", `net ${net} is a reference shared by modules ${carrying.join(", ")} without a shared-reference constraint naming its owner.`);
  }

  if (blockers.length > 0) return { ok: false, blockers };
  const ownedKeys = new Set(ownerOf.keys());
  const unassigned = [...identities.byRef.values()].filter((component) => !ownedKeys.has(refDesKey(component.refDes))).map((component) => component.refDes).sort();
  const partAuthority: PartAuthorityRow[] = modules.flatMap((module) => module.components.map((component): PartAuthorityRow => {
    const item = unresolved.get(refDesKey(component.refDes));
    return { refDes: component.refDes, moduleId: module.id, state: item ? "unresolved" : "published-exact-revision", missing: item?.missing ?? null, reviewPath: item?.reviewPath ?? null };
  }));
  const referencedNets = [...new Set(modules.flatMap((module) => module.ports.map((port) => port.net)))].sort();
  return {
    ok: true,
    set: {
      schema: MODULE_CONTRACT_SCHEMA,
      system: { name: systemName ?? "", statement: systemStatement ?? "", operatingConditions },
      modules,
      constraints,
      partAuthority,
      coverage: { physicalInstances: physical, owned: ownedKeys.size, unassigned, knownNets: [...nets].sort(), referencedNets, sharedNets },
      electricalCheck: { state: "not_run", detail: ELECTRICAL_CHECK_NOT_RUN },
    },
  };
}
