/**
 * B10.1 — the AUTHORITY-NEUTRAL agent netlist projection
 * (`sirkit.agent-netlist-projection.v1`) and its server-side semantic
 * validation against the VERIFIED schematic.
 *
 * The browser never transports the full PcbNetlist: `projectAgentNetlist`
 * strips every catalog/assignment/authority-bearing optional field
 * (atomicAssignment, atomicPartRevisionId, pinPadMapping, footprint hints,
 * mpn/package/value) down to the logical intent readiness needs —
 * component stable id, display reference, declared pins, net identity,
 * nodes, and canonical endpoint keys. The server validates the SAME exact
 * contract: unknown keys REFUSE (authority-shaped keys refuse by name),
 * and semantic checks prove the netlist corresponds to the verified
 * schematic. Board/netlist disagreement is deliberately NOT validated
 * here — readiness must still be able to diagnose a stale board; that
 * disagreement is a readiness RESULT, not a malformed resource.
 *
 * The sealed resource stays: local-working-copy only, optional, pinned to
 * the verified schematic and canonical revision, never component
 * authority, never manufacturing release authority.
 */

import type { SchematicState } from "@/lib/schematic-types";
import { normalizeRefDes, schDisplayRef } from "@/lib/schematic-types";
import { schematicEndpointKey } from "../pcb/integrity";
import { buildNetlist, theoryPinContract, type PcbNetlist } from "../pcb/netlist-bridge";
import { engineeringDigest } from "../engineering/stable";

export const AGENT_NETLIST_SCHEMA = "sirkit.agent-netlist-projection.v1" as const;

export interface AgentNetlistPin { number: string; name?: string }
export interface AgentNetlistComponent { id: string; ref: string; pins: AgentNetlistPin[] }
export interface AgentNetlistNode { componentId: string; pinNumber: string }
export interface AgentNetlistNet { id: number; name: string; nodes: AgentNetlistNode[]; endpointKeys: string[] }

/** The versioned transport contract. */
export interface AgentNetlistProjection {
  schema: typeof AGENT_NETLIST_SCHEMA;
  components: AgentNetlistComponent[];
  nets: AgentNetlistNet[];
}

/** The sealed logical content (PcbNetlist-compatible subset — no schema tag). */
export interface AgentNetlistLogical {
  components: AgentNetlistComponent[];
  nets: AgentNetlistNet[];
}

/** Browser-side projection of the live PcbEditor netlist into the
 *  authority-neutral contract BEFORE transport. */
export function projectAgentNetlist(netlist: PcbNetlist): AgentNetlistProjection {
  return {
    schema: AGENT_NETLIST_SCHEMA,
    components: netlist.components.map((component) => ({
      id: component.id,
      ref: component.ref,
      pins: component.pins.map((pin) => ({ number: pin.number, ...(typeof pin.name === "string" ? { name: pin.name } : {}) })),
    })),
    nets: netlist.nets.map((net) => ({
      id: net.id,
      name: net.name,
      nodes: net.nodes.map((node) => ({ componentId: node.componentId, pinNumber: node.pinNumber })),
      endpointKeys: [...net.endpointKeys],
    })),
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

const MAX_COMPONENTS = 5_000;
const MAX_NETS = 20_000;
const MAX_PINS_PER_COMPONENT = 2_000;
const MAX_NODES_PER_NET = 10_000;
const MAX_STRING = 10_000;

/** Authority-shaped fields refuse BY NAME (never silently dropped). */
const AUTHORITY_SHAPED_KEYS = new Set([
  "atomicAssignment", "atomicPartRevisionId", "pinPadMapping",
  "footprintHint", "mpn", "package", "value",
  "approval", "approved", "verification", "certificate", "candidates",
  "authority", "authoritySource", "release",
]);

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], optional: readonly string[], path: string, issues: string[]): boolean {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key) || optional.includes(key)) continue;
    issues.push(AUTHORITY_SHAPED_KEYS.has(key)
      ? `${path}.${key}: authority-shaped field is refused (the agent netlist is logical intent only — never catalog, assignment, mapping, approval, or release authority)`
      : `${path}.${key}: unknown key is refused`);
    return false;
  }
  for (const key of allowed) {
    if (value[key] === undefined) { issues.push(`${path}.${key}: required key is missing`); return false; }
  }
  return true;
}

function boundedString(value: unknown, path: string, issues: string[], maxLength = MAX_STRING): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    issues.push(`${path}: must be a non-empty string of at most ${maxLength} chars`);
    return false;
  }
  return true;
}

/**
 * Validate the transported projection against the VERIFIED schematic.
 * Returns every violation (bounded to 5); empty ⇔ sealable. The caller has
 * already proven schematic-digest agreement (atomic capture).
 */
export function validateAgentNetlistProjection(raw: unknown, schematic: SchematicState): string[] {
  const issues: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["netlist is not an object"];
  const netlist = raw as Record<string, unknown>;
  if (!exactKeys(netlist, ["schema", "components", "nets"], [], "netlist", issues)) return issues;
  if (netlist.schema !== AGENT_NETLIST_SCHEMA) return [`netlist.schema: expected ${AGENT_NETLIST_SCHEMA}`];
  if (!Array.isArray(netlist.components)) return ["netlist.components is not an array"];
  if (!Array.isArray(netlist.nets)) return ["netlist.nets is not an array"];
  if (netlist.components.length > MAX_COMPONENTS) return [`netlist exceeds ${MAX_COMPONENTS} components`];
  if (netlist.nets.length > MAX_NETS) return [`netlist exceeds ${MAX_NETS} nets`];

  // The verified schematic's PHYSICAL component set — using THE production
  // physicality rule (theoryPinContract): ground symbols and voltage/
  // current sources are sim stimuli, never physical netlist members
  // [B10.2 R3]. Display references use the production normalization.
  const schematicRefs = new Map<string, string>();
  for (const component of schematic.components) {
    if (theoryPinContract(component.type) === null) continue; // simulation-only
    schematicRefs.set(component.id, normalizeRefDes(schDisplayRef(component)));
  }
  for (const component of schematic.kicadComponents ?? []) schematicRefs.set(component.id, normalizeRefDes(component.refDes ?? component.id));

  const componentPins = new Map<string, Set<string>>();
  for (const [index, item] of (netlist.components as unknown[]).entries()) {
    if (issues.length >= 5) return issues;
    const path = `netlist.components[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) { issues.push(`${path}: not an object`); continue; }
    const component = item as Record<string, unknown>;
    if (!exactKeys(component, ["id", "ref", "pins"], [], path, issues)) continue;
    if (!boundedString(component.id, `${path}.id`, issues, 200)) continue;
    if (componentPins.has(component.id)) { issues.push(`${path}.id: duplicate component identity "${component.id.slice(0, 60)}"`); continue; }
    if (!boundedString(component.ref, `${path}.ref`, issues, 200)) continue;
    // Semantic: the component must BELONG to the verified schematic and its
    // display reference must agree with the schematic's.
    const schematicRef = schematicRefs.get(component.id);
    if (schematicRef === undefined) { issues.push(`${path}.id: "${component.id.slice(0, 60)}" is not a component of the verified schematic`); continue; }
    if (component.ref !== schematicRef) { issues.push(`${path}.ref: "${component.ref.slice(0, 60)}" does not agree with the schematic's display reference "${schematicRef.slice(0, 60)}"`); continue; }
    if (!Array.isArray(component.pins) || component.pins.length > MAX_PINS_PER_COMPONENT) { issues.push(`${path}.pins: must be an array of at most ${MAX_PINS_PER_COMPONENT}`); continue; }
    const pins = new Set<string>();
    const declaredPins: Array<{ number: string; name?: string }> = [];
    let pinsValid = true;
    for (const [pinIndex, pinItem] of (component.pins as unknown[]).entries()) {
      const pinPath = `${path}.pins[${pinIndex}]`;
      if (typeof pinItem !== "object" || pinItem === null || Array.isArray(pinItem)) { issues.push(`${pinPath}: not an object`); pinsValid = false; break; }
      const pin = pinItem as Record<string, unknown>;
      if (!exactKeys(pin, ["number"], ["name"], pinPath, issues)) { pinsValid = false; break; }
      if (!boundedString(pin.number, `${pinPath}.number`, issues, 64)) { pinsValid = false; break; }
      if (pin.name !== undefined && !boundedString(pin.name, `${pinPath}.name`, issues, 200)) { pinsValid = false; break; }
      if (pins.has(pin.number)) { issues.push(`${pinPath}.number: duplicate pin "${pin.number.slice(0, 40)}"`); pinsValid = false; break; }
      pins.add(pin.number);
      declaredPins.push({ number: pin.number, ...(pin.name !== undefined ? { name: pin.name as string } : {}) });
    }
    if (!pinsValid) continue;
    // [B10.2] theory components must declare EXACTLY the production theory
    // pin contract (numbers AND names) — invented pins (e.g. resistor pin
    // "999") and altered pin names refuse at the validator itself.
    const theory = schematic.components.find((candidate) => candidate.id === component.id);
    if (theory) {
      const contract = theoryPinContract(theory.type);
      if (contract) {
        const expectedPins = Object.entries(contract)
          .map(([pinName, pinNumber]) => ({ number: pinNumber, name: pinName }))
          .sort((a, b) => a.number.localeCompare(b.number));
        const suppliedPins = [...declaredPins].sort((a, b) => a.number.localeCompare(b.number));
        const agrees = suppliedPins.length === expectedPins.length
          && expectedPins.every((expectedPin, pinIndex) => suppliedPins[pinIndex]!.number === expectedPin.number && suppliedPins[pinIndex]!.name === expectedPin.name);
        if (!agrees) { issues.push(`${path}.pins: do not match the production theory pin contract for type "${theory.type}" (exact pin numbers and names required)`); continue; }
      }
    }
    componentPins.set(component.id, pins);
  }
  if (issues.length > 0) return issues;

  const netIds = new Set<number>();
  const globalEndpoints = new Set<string>();
  for (const [index, item] of (netlist.nets as unknown[]).entries()) {
    if (issues.length >= 5) return issues;
    const path = `netlist.nets[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) { issues.push(`${path}: not an object`); continue; }
    const net = item as Record<string, unknown>;
    if (!exactKeys(net, ["id", "name", "nodes", "endpointKeys"], [], path, issues)) continue;
    if (typeof net.id !== "number" || !Number.isSafeInteger(net.id)) { issues.push(`${path}.id: not a safe integer`); continue; }
    if (netIds.has(net.id)) { issues.push(`${path}.id: duplicate net identity ${net.id}`); continue; }
    netIds.add(net.id);
    if (typeof net.name !== "string" || net.name.length > 500) { issues.push(`${path}.name: missing or malformed`); continue; }
    if (!Array.isArray(net.nodes) || net.nodes.length > MAX_NODES_PER_NET) { issues.push(`${path}.nodes: must be an array of at most ${MAX_NODES_PER_NET}`); continue; }
    const derivedEndpoints: string[] = [];
    let nodesValid = true;
    for (const [nodeIndex, nodeItem] of (net.nodes as unknown[]).entries()) {
      const nodePath = `${path}.nodes[${nodeIndex}]`;
      if (typeof nodeItem !== "object" || nodeItem === null || Array.isArray(nodeItem)) { issues.push(`${nodePath}: not an object`); nodesValid = false; break; }
      const node = nodeItem as Record<string, unknown>;
      if (!exactKeys(node, ["componentId", "pinNumber"], [], nodePath, issues)) { nodesValid = false; break; }
      if (!boundedString(node.componentId, `${nodePath}.componentId`, issues, 200) || !boundedString(node.pinNumber, `${nodePath}.pinNumber`, issues, 64)) { nodesValid = false; break; }
      const pins = componentPins.get(node.componentId);
      if (!pins) { issues.push(`${nodePath}: references unknown component "${node.componentId.slice(0, 60)}"`); nodesValid = false; break; }
      if (!pins.has(node.pinNumber)) { issues.push(`${nodePath}: references undeclared pin "${node.pinNumber.slice(0, 40)}" on "${node.componentId.slice(0, 60)}"`); nodesValid = false; break; }
      const endpoint = schematicEndpointKey(node.componentId, node.pinNumber);
      if (derivedEndpoints.includes(endpoint)) { issues.push(`${nodePath}: duplicate node/endpoint within the net`); nodesValid = false; break; }
      if (globalEndpoints.has(endpoint)) { issues.push(`${nodePath}: endpoint appears in multiple nets`); nodesValid = false; break; }
      derivedEndpoints.push(endpoint);
    }
    if (!nodesValid) continue;
    for (const endpoint of derivedEndpoints) globalEndpoints.add(endpoint);
    // endpointKeys must agree EXACTLY with the canonical keys derived from
    // the node component/pin identities (buildNetlist emits them sorted).
    if (!Array.isArray(net.endpointKeys) || net.endpointKeys.some((key) => typeof key !== "string" || key.length > MAX_STRING)) {
      issues.push(`${path}.endpointKeys: must be an array of bounded strings`);
      continue;
    }
    const expected = [...derivedEndpoints].sort();
    const supplied = net.endpointKeys as string[];
    if (supplied.length !== expected.length || expected.some((key, keyIndex) => supplied[keyIndex] !== key)) {
      issues.push(`${path}.endpointKeys: do not agree exactly with the net's node component/pin identities`);
    }
  }
  return issues;
}

// ─── [B10.2] Server-derivation PROOF ─────────────────────────────────────────

export type AgentNetlistProof =
  | { ok: true; content: AgentNetlistLogical }
  | { ok: false; reason: string };

function projectionDigest(components: unknown, nets: unknown): string {
  return engineeringDigest({ schema: AGENT_NETLIST_SCHEMA, netlist: { components, nets } });
}

/**
 * [B10.2] a browser-supplied projection — even one that passes every
 * structural/semantic check — is NOT proof that it was derived from the
 * verified schematic. Proof is server-side RE-DERIVATION through THE
 * shared production netlist authority (`buildNetlist`):
 *
 *  - Theory-only schematics: the expected physical netlist is recomputed
 *    server-side and the supplied projection must agree EXACTLY (complete
 *    physical component set, no simulation-only entities, exact stable
 *    ids/display refs, exact theory pin numbers AND names, exact nets/
 *    nodes/names/canonical endpoint keys — no omissions, additions,
 *    topology rewrites, or invented pins). The SEALED content is the
 *    SERVER-OWNED recomputed result, never the browser bytes.
 *  - KiCad/catalog-bearing schematics: the verified schematic carries no
 *    trusted server-owned pin/catalog data, so the projection CANNOT be
 *    proven — fail closed (withhold; readiness reports parity not
 *    evaluated; never an authoritative pass). No component-authority
 *    producer is created and nothing is guessed.
 *
 * Board/netlist disagreement is deliberately NOT part of the proof: after
 * the netlist itself is proven, a stale board stays a READINESS diagnosis.
 */
export function proveAgentNetlist(raw: unknown, schematic: SchematicState): AgentNetlistProof {
  const issues = validateAgentNetlistProjection(raw, schematic);
  if (issues.length > 0) {
    return { ok: false, reason: `${issues[0]!.slice(0, 200)}${issues.length > 1 ? ` (+${issues.length - 1} more issue(s))` : ""}` };
  }
  if ((schematic.kicadComponents ?? []).length > 0) {
    return { ok: false, reason: "trusted server-side component pin authority is unavailable for KiCad/catalog components, so the netlist cannot be proven against the verified schematic; schematic parity will be reported as not evaluated" };
  }
  let derived: PcbNetlist;
  try {
    derived = buildNetlist(schematic);
  } catch {
    return { ok: false, reason: "server-side netlist derivation from the verified schematic failed; the netlist cannot be proven" };
  }
  const expected = projectAgentNetlist(derived);
  const supplied = raw as AgentNetlistProjection;
  if (projectionDigest(supplied.components, supplied.nets) !== projectionDigest(expected.components, expected.nets)) {
    return { ok: false, reason: "the supplied projection does not agree exactly with the server-derived netlist for the verified schematic (omission, addition, invented pin, or topology rewrite)" };
  }
  // The sealed resource content is the SERVER-OWNED derivation.
  return { ok: true, content: { components: expected.components, nets: expected.nets } };
}
