/**
 * [B22-C] The independent deck validator for CD-10's lowered netlists (discovery D22-19, in part; 9.5 item 29; runbook B22-C :926
 * "exact simulator and model libraries are pinned", :927 "netlist lowering is deterministic and independently validated").
 *
 * CD-10's own lowering audit compares the lowering manifest with itself and with the IR's cardinalities; nothing re-read the deck
 * it emits, so a deck whose element cards name the wrong nodes passed once its FNV digests were recomputed (they are public). This
 * module re-parses the emitted text on its own - it imports nothing from the lowering and shares none of its code - and checks it
 * against the IR through the manifest:
 *  - the IR pin (the manifest names this IR and its digest);
 *  - the lines: comments, `.include`, element cards, exactly one analysis line and a final `.end`; anything else (a control block,
 *    a second analysis, an unknown directive) is refused; [B22-C review] security-1: a comment line is read, not skipped - a `*#`
 *    line (ngspice runs its rest as a command, SEC-1 probe p3) and an `*ng_script` title (the deck runs as a script, p4) are refused
 *    wherever they stand, as is any line break but LF and NUL (the set SEC-1's final screen refuses); the analysis line has the one
 *    closed shape the lowering emits for its analysis;
 *  - every IR component instance has exactly one element card, named by its mapping, whose terminal nodes map (through the
 *    manifest's node mapping) to the nets the IR binds its terminals to, whose model is its bound asset's and whose parameters are
 *    the IR's; no other element card stands in the deck;
 *  - every inserted test element sits on the IR's nodes; [B22-C review] security-2: its card is exactly its kind's letter, its two
 *    nodes and the IR's value - no other token;
 *  - the node mapping: every IR net mapped once, no two nets on one name, and node `0` exactly the explicit primary reference;
 *  - every `.include` is a mapped, sandbox-relative model library, and every model library is pinned by its content digest:
 *    `artifact://sha256/<64 hex>` in the asset's storage reference, the same SHA-256 as its `sha256:<hex>` content digest and the
 *    include's digest, and - when the server holds the model text - the text's own SHA-256. Decks lowered for both CD-10 provider
 *    paths, the diagnostic ngspice provider and the analytical reference provider, pass it. [B22-C review] coverage-2: no CD-10 path
 *    calls it yet - CD-10's own lowering checks only the `artifact://sha256/` prefix - so it is a library function the authoritative
 *    path will need, not an enforced pin (recorded on the page).
 * It is built beside SEC-1's final deck screen, which is a safety screen over the Studio's executed decks and not this validator.
 * Pure: no process, no file, no network.
 */
import { createHash } from "node:crypto";
import type { NetlistLoweringManifest, SimulationModelAsset, SimulationNetlistIR } from "@/app/lib/model-simulation/types";

export const DECK_VALIDATION_CODES = Object.freeze([
  "DECK_IR_PIN_MISMATCH",
  "DECK_LINE_UNEXPECTED",
  "DECK_END_MISSING",
  "DECK_ANALYSIS_INVALID",
  "DECK_INCLUDE_UNMAPPED",
  "DECK_MODEL_NOT_CONTENT_PINNED",
  "DECK_COMPONENT_UNMAPPED",
  "DECK_MODEL_MISMATCH",
  "DECK_PARAMETER_MISMATCH",
  "DECK_NODE_UNMAPPED",
  "DECK_NODE_MAPPING_MISMATCH",
  "DECK_NODE_COLLAPSE",
  "DECK_REFERENCE_INVALID",
  "DECK_TEST_ELEMENT_MISMATCH",
] as const);
export type DeckValidationCode = (typeof DECK_VALIDATION_CODES)[number];

export interface LoweredDeckInput {
  readonly ir: SimulationNetlistIR;
  /** The lowered netlist as emitted: its text and its manifest. */
  readonly artifact: { readonly immutableContent: string; readonly manifest: NetlistLoweringManifest };
  /** The model assets the IR's instances bind, by `<id>@<revision>:<digest>`. */
  readonly assets: readonly SimulationModelAsset[];
  /** The model text the server holds, by the same revision id; when present its SHA-256 must equal the pinned digest. */
  readonly modelContents?: Readonly<Record<string, string>>;
}

const NEWLINE = String.fromCharCode(10);
/** [B22-C review] security-1: the characters SEC-1's final screen refuses as line breaks or NUL - NUL, VT, CR, NEL, LS, PS - with FF,
 *  which SEC-1 reads as a break too; the lowering emits none of them. */
const LINE_BREAKS_BUT_LF = new Set([0x00, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029]);
/** [B22-C review] the analysis line's closed shape per analysis kind, as the lowering emits it: a scalar is a value the lowering's
 *  scalar rule admits, a source an identifier. */
const SCALAR = "[A-Za-z0-9_.+\\-Ee{}]+";
const ANALYSIS_LINE = new RegExp(`^(?:\\.op|\\.tran ${SCALAR} ${SCALAR}|\\.ac dec ${SCALAR} ${SCALAR} ${SCALAR}|\\.dc [A-Za-z0-9_]+ ${SCALAR} ${SCALAR} ${SCALAR})$`, "i");
/** [B22-C review] security-2: the element letter each test-element kind lowers to (anything else is a voltage source). */
const TEST_ELEMENT_LETTER: Readonly<Record<string, string>> = Object.freeze({ current_source: "I", capacitive_load: "C", inductive_load: "L", resistive_load: "R" });
const CONTENT_REF = /^artifact:\/\/sha256\/([0-9a-f]{64})$/;
const SANDBOX_MODEL_PATH = /^models\/[A-Za-z0-9_.-]+$/;
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const revisionOf = (asset: SimulationModelAsset): string => `${asset.modelAssetId}@${asset.revision}:${asset.deterministicDigest}`;

/** [B22-C] The 64-hex SHA-256 a model asset is pinned by, or null when its storage reference and content digest do not agree on one. */
export function pinnedContentSha256(asset: SimulationModelAsset): string | null {
  const match = CONTENT_REF.exec(asset.contentAddressedStorageRef);
  return match && asset.immutableContentDigest === `sha256:${match[1]}` ? match[1]! : null;
}

/** The identifier rule the deck follows for element, model and parameter names - written here on its own, never imported. */
function identifierOf(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "n_$1").slice(0, 96) || "unnamed";
}
/** A typed value as the deck must carry it, or null when no safe rendering exists. */
function rendered(value: string | number | boolean): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? value.toString() : null;
  if (typeof value === "boolean") return value ? "1" : "0";
  return /^[A-Za-z0-9_.+\-Ee{}]+$/.test(value) ? value : null;
}

/** [B22-C] Re-parse a lowered deck and check it against its IR; the sorted closed codes it breaks, empty when it holds. */
export function validateLoweredDeck(input: LoweredDeckInput): DeckValidationCode[] {
  const codes = new Set<DeckValidationCode>();
  const { ir, artifact, assets } = input;
  const manifest = artifact.manifest;
  if (manifest.netlistIrId !== ir.netlistIrId || manifest.netlistIrDigest !== ir.deterministicDigest) codes.add("DECK_IR_PIN_MISMATCH");

  // the node mapping, against the IR's nets
  const netOfName = new Map<string, string>();
  const nameOfNet = new Map<string, string>();
  for (const mapping of manifest.semanticNetToSimulatorNodeMappings) {
    if (nameOfNet.has(mapping.semanticNetId)) codes.add("DECK_NODE_COLLAPSE");
    if (netOfName.has(mapping.providerNodeName)) codes.add(mapping.providerNodeName === "0" ? "DECK_REFERENCE_INVALID" : "DECK_NODE_COLLAPSE");
    netOfName.set(mapping.providerNodeName, mapping.semanticNetId);
    nameOfNet.set(mapping.semanticNetId, mapping.providerNodeName);
  }
  const nodes = new Map(ir.stableNodes.map((node) => [node.semanticNetId, node]));
  const netOfNode = new Map(ir.stableNodes.map((node) => [node.nodeId, node.semanticNetId]));
  if (ir.stableNodes.some((node) => !nameOfNet.has(node.semanticNetId)) || manifest.semanticNetToSimulatorNodeMappings.some((mapping) => !nodes.has(mapping.semanticNetId))) codes.add("DECK_NODE_UNMAPPED");
  const zero = manifest.semanticNetToSimulatorNodeMappings.filter((mapping) => mapping.providerNodeName === "0");
  const primary = manifest.groundAndReferenceMappings.filter((mapping) => mapping.policy === "primary_zero");
  if (zero.length !== 1 || nodes.get(zero[0]!.semanticNetId)?.referenceRole !== "explicit_reference" || primary.length !== 1 || primary[0]!.semanticNetId !== zero[0]!.semanticNetId) codes.add("DECK_REFERENCE_INVALID");
  const expectNode = (token: string | undefined, nodeId: string | undefined, onMismatch: DeckValidationCode): void => {
    if (token === undefined || nodeId === undefined) codes.add(onMismatch);
    else if (!netOfName.has(token)) codes.add("DECK_NODE_UNMAPPED");
    else if (netOfName.get(token) !== netOfNode.get(nodeId)) codes.add(onMismatch);
  };

  // the lines, re-parsed; [B22-C review] security-1: the deck breaks lines only with LF and carries no NUL
  for (let index = 0; index < artifact.immutableContent.length; index += 1) {
    if (LINE_BREAKS_BUT_LF.has(artifact.immutableContent.charCodeAt(index))) {
      codes.add("DECK_LINE_UNEXPECTED");
      break;
    }
  }
  const includes: string[] = [];
  const cards = new Map<string, string[][]>();
  let analyses = 0;
  let ended = false;
  for (const line of artifact.immutableContent.split(NEWLINE)) {
    const trimmed = line.trim();
    if (ended) {
      if (trimmed !== "") codes.add("DECK_LINE_UNEXPECTED");
      continue;
    }
    if (trimmed === "") continue;
    if (trimmed.startsWith("*")) {
      // [B22-C review] security-1: a `*#` line runs its rest as a command (SEC-1 probe p3) and an `*ng_script` title runs the deck
      // as a script (p4); the lowering's two comment lines are neither, so both are refused on any line
      if (/^\*\s*#/.test(trimmed) || /^\*\s*ng_script/i.test(trimmed)) codes.add("DECK_LINE_UNEXPECTED");
      continue;
    }
    if (/^\.end$/i.test(trimmed)) {
      ended = true;
      continue;
    }
    const include = /^\.include\s+"([^"]*)"$/i.exec(trimmed);
    if (include) {
      includes.push(include[1]!);
      continue;
    }
    if (/^\.(?:op|tran|ac|dc)(?:\s|$)/i.test(trimmed)) {
      analyses += 1;
      if (!ANALYSIS_LINE.test(trimmed)) codes.add("DECK_ANALYSIS_INVALID"); // [B22-C review] no option, no other token
      continue;
    }
    if (/^[A-Za-z]/.test(trimmed)) {
      const tokens = trimmed.split(/\s+/);
      const name = tokens[0]!.toUpperCase();
      cards.set(name, [...(cards.get(name) ?? []), tokens]);
      continue;
    }
    codes.add("DECK_LINE_UNEXPECTED");
  }
  if (!ended) codes.add("DECK_END_MISSING");
  if (analyses !== 1) codes.add("DECK_ANALYSIS_INVALID");

  // the model libraries: mapped includes, pinned by content digest
  const mappingByPath = new Map(manifest.modelIncludeAndDigestMappings.map((mapping) => [mapping.sandboxRelativePath, mapping]));
  const seen = new Set<string>();
  for (const path of includes) {
    if (!mappingByPath.has(path) || seen.has(path)) codes.add("DECK_INCLUDE_UNMAPPED");
    seen.add(path);
  }
  const boundRevisions = new Set(ir.componentModelInstances.map((instance) => instance.modelAssetRevisionId));
  for (const revision of boundRevisions) if (manifest.modelIncludeAndDigestMappings.filter((mapping) => mapping.modelAssetRevisionId === revision).length !== 1) codes.add("DECK_INCLUDE_UNMAPPED");
  for (const mapping of manifest.modelIncludeAndDigestMappings) {
    if (!seen.has(mapping.sandboxRelativePath) || !SANDBOX_MODEL_PATH.test(mapping.sandboxRelativePath) || !boundRevisions.has(mapping.modelAssetRevisionId)) codes.add("DECK_INCLUDE_UNMAPPED");
    const asset = assets.find((candidate) => revisionOf(candidate) === mapping.modelAssetRevisionId);
    const pinned = asset ? pinnedContentSha256(asset) : null;
    if (!asset || pinned === null || mapping.contentDigest !== asset.immutableContentDigest) codes.add("DECK_MODEL_NOT_CONTENT_PINNED");
    const content = input.modelContents?.[mapping.modelAssetRevisionId];
    if (content !== undefined && pinned !== null && sha256(content) !== pinned) codes.add("DECK_MODEL_NOT_CONTENT_PINNED");
  }

  // the element cards: each IR instance once, on its nets, with its model and parameters; nothing else
  const componentNames = new Map(manifest.componentInstanceMappings.map((mapping) => [mapping.componentInstanceId, mapping.providerElementName.toUpperCase()]));
  const testNames = new Map(manifest.insertedTestElementMappings.map((mapping) => [mapping.testElementId, mapping.providerElementName.toUpperCase()]));
  const known = new Set([...componentNames.values(), ...testNames.values()]);
  for (const name of cards.keys()) if (!known.has(name)) codes.add("DECK_COMPONENT_UNMAPPED");
  if (componentNames.size !== ir.componentModelInstances.length || manifest.componentInstanceMappings.length !== ir.componentModelInstances.length) codes.add("DECK_COMPONENT_UNMAPPED");
  for (const instance of ir.componentModelInstances) {
    const name = componentNames.get(instance.componentInstanceId);
    const found = name ? cards.get(name) ?? [] : [];
    if (found.length !== 1) {
      codes.add("DECK_COMPONENT_UNMAPPED");
      continue;
    }
    const tokens = found[0]!;
    instance.terminals.forEach((terminal, index) => expectNode(tokens[1 + index], terminal.nodeId, "DECK_NODE_MAPPING_MISMATCH"));
    const asset = assets.find((candidate) => revisionOf(candidate) === instance.modelAssetRevisionId);
    const model = tokens[1 + instance.terminals.length];
    if (!asset || model === undefined || model.toUpperCase() !== identifierOf(asset.semanticName).toUpperCase()) codes.add("DECK_MODEL_MISMATCH");
    const parameters = tokens.slice(2 + instance.terminals.length);
    const expected = instance.parameters.map((parameter) => {
      const value = rendered(parameter.typedValue);
      return value === null ? null : `${identifierOf(parameter.parameterId)}=${value}`;
    });
    if (parameters.length !== expected.length || parameters.some((token, index) => expected[index] === null || token !== expected[index])) codes.add("DECK_PARAMETER_MISMATCH");
  }
  if (testNames.size !== ir.controlledIdealTestElements.length) codes.add("DECK_TEST_ELEMENT_MISMATCH");
  for (const element of ir.controlledIdealTestElements) {
    const name = testNames.get(element.testElementId);
    const found = name ? cards.get(name) ?? [] : [];
    if (found.length !== 1) {
      codes.add("DECK_TEST_ELEMENT_MISMATCH");
      continue;
    }
    const tokens = found[0]!;
    expectNode(tokens[1], element.positiveNodeId, "DECK_TEST_ELEMENT_MISMATCH");
    expectNode(tokens[2], element.negativeNodeId, "DECK_TEST_ELEMENT_MISMATCH");
    // [B22-C review] security-2: exactly its kind's letter, two nodes and the IR's value - a changed value, an extra token (a
    // waveform, an option) or another element kind is not the stimulus the IR describes
    const value = rendered(Object.values(element.typedProperties)[0] ?? 0);
    if (tokens.length !== 4 || value === null || tokens[3] !== value || name!.charAt(0) !== (TEST_ELEMENT_LETTER[element.kind] ?? "V")) codes.add("DECK_TEST_ELEMENT_MISMATCH");
  }
  return DECK_VALIDATION_CODES.filter((code) => codes.has(code));
}
