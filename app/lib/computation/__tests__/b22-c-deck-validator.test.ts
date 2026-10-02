/**
 * [B22-C] An independent deck validator (discovery D22-19, in part; 9.5 item 29; runbook B22-C :926 "exact simulator and model
 * libraries are pinned", :927 "netlist lowering is deterministic and independently validated"). CD-10's `auditNetlistLowering`
 * checks the lowering manifest against itself and the IR's cardinalities; nothing re-read the emitted deck, so a deck whose element
 * lines name the wrong nodes passed the audit as long as its FNV digests were recomputed - and FNV digests are public. The new
 * validator (`app/lib/computation/deck-validator.ts`) re-parses the emitted text on its own and checks every element card's nodes,
 * its model and its parameters, every inserted test element, the reference node and every `.include` against the IR through the
 * manifest; a model library must be pinned by its content digest (`artifact://sha256/<64 hex>`, the same SHA-256 as
 * `sha256:<hex>`, and the content's own SHA-256 when the server holds it) - for both CD-10 provider paths, the diagnostic ngspice
 * provider and the analytical reference provider. It is built beside SEC-1's `assertCompiledDeckSafe` (a safety screen, not this
 * validator) and imports nothing from the lowering it checks.
 *
 * Test-first: case 1 is the pre-edit counterexample (the tampered deck passes `auditNetlistLowering` on b4c7be7; the validator did
 * not exist). Pure computation: no process, no file.
 *
 * [B22-C review] Case 6 adds what the validator skipped: a `*#` command line and an `*ng_script` title (the two non-control
 * constructs ngspice-46 executes, SEC-1's probes p3 and p4), any line break but LF and NUL (security-1), a test-element card's
 * kind, value and token count (security-2) and the analysis line's closed shape; case 8 pins that no CD-10 path calls the validator
 * yet and that the page says so (coverage-2). Those ran RED on the reviewed tree.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectProductionFiles } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { auditNetlistLowering, lowerNetlistIr, type LoweredNetlistArtifact } from "@/app/lib/model-simulation/lowering";
import { analyticalReferenceProvider, diagnosticNgspiceProvider } from "@/app/lib/model-simulation/provider";
import { finalizeSimulation, simulationDigest } from "@/app/lib/model-simulation/stable";
import type { SimulationAnalysisPlan, SimulationModelAsset, SimulationNetlistIR, SimulatorProviderDefinition } from "@/app/lib/model-simulation/types";

const NEWLINE = String.fromCharCode(10);
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const MODEL_TEXT = [".subckt DIVIDER_LEG a b", "R1 a b {R}", ".ends DIVIDER_LEG", ""].join(NEWLINE);

function asset(content = MODEL_TEXT, refHex = sha256(content)): SimulationModelAsset {
  return finalizeSimulation({ modelAssetId: "model:divider-leg", revision: 1, semanticName: "DIVIDER_LEG", modelKind: "validated_internal", dialectAndProviderCompatibility: [], exactFamilyPartPackageScopes: [], sourceAndProvenanceRefs: ["evidence:b22-c"], immutableContentDigest: `sha256:${refHex}`, contentAddressedStorageRef: `artifact://sha256/${refHex}`, includeArtifactDigests: [], licenseMetadata: { licenseId: "license:b22-c", execution: "allowed", caching: "allowed", teamReview: "allowed", export: "allowed", retention: "allowed", evidenceRefs: [] }, encryptionOrOpacityState: "inspectable", terminalDefinitions: [], parameterDefinitions: [], modeledBehaviorCapabilities: [], omittedOrIdealizedBehaviors: [], operatingDomain: [], requiredExternalElements: [], validationAndOracleRefs: [], knownLimitations: [], reviewState: "approved", lifecycleState: "active", deterministicDigest: "" } as unknown as SimulationModelAsset);
}
const revisionOf = (model: SimulationModelAsset): string => `${model.modelAssetId}@${model.revision}:${model.deterministicDigest}`;
/** A divider: two model instances in series between VIN and GND through VOUT, and a 5 V test source on VIN. */
function divider(model: SimulationModelAsset): SimulationNetlistIR {
  const node = (net: string, role: "explicit_reference" | "ordinary") => finalizeSimulation({ nodeId: `ir-node:${net}`, semanticNetId: net, variantId: "variant:default", referenceRole: role, provenanceRefs: [], deterministicDigest: "" });
  const stableNodes = [node("net:GND", "explicit_reference"), node("net:VIN", "ordinary"), node("net:VOUT", "ordinary")];
  const instance = (component: string, a: string, b: string, value: string) => finalizeSimulation({ modelInstanceId: `ir-model-instance:${component}`, componentInstanceId: component, modelBindingId: `binding:${component}`, modelAssetRevisionId: revisionOf(model), terminals: [{ modelTerminalId: "terminal:a", pinInstanceId: `${component}:1`, nodeId: `ir-node:${a}` }, { modelTerminalId: "terminal:b", pinInstanceId: `${component}:2`, nodeId: `ir-node:${b}` }], parameters: [{ parameterId: "R", typedValue: value, unit: "ohm" }], deterministicDigest: "" });
  const source = finalizeSimulation({ testElementId: "test-element:vin", kind: "voltage_source" as const, positiveNodeId: "ir-node:net:VIN", negativeNodeId: "ir-node:net:GND", typedProperties: { value: 5 }, sourceDefinitionRef: "stimulus:vin", designGraphMutation: false as const, deterministicDigest: "" });
  return finalizeSimulation<SimulationNetlistIR>({ netlistIrId: "netlist-ir:b22-c", sourceGraphRevisionId: "graph:b22-c", sourceGraphDigest: "graph-digest:b22-c", variantProjectionId: "projection:b22-c", variantId: "variant:default", componentModelInstances: [instance("component:r-top", "net:VIN", "net:VOUT", "1k"), instance("component:r-bottom", "net:VOUT", "net:GND", "2k")], stableNodes, branchAndReferenceDefinitions: [], parameterDefinitions: [], hierarchyLoweringMap: [], controlledIdealTestElements: [source], excludedUnsupportedRegionIds: [], provenanceMap: [], semanticDigest: "semantic:b22-c", deterministicDigest: "" });
}
const PLAN = finalizeSimulation({ analysisPlanId: "analysis:op", analysisKind: "operating_point", operatingPointAndInitializationPolicy: "operating_point", timeOrFrequencyOrSweepDomain: {}, numericalSettings: {}, outputSavePolicy: { semanticSignalIds: ["net:VOUT"], authoritativeRawRequired: true }, expectedBehaviorAndLimitations: [], providerFeatureRequirements: [], retryPolicyRevisionId: "retry:1", deterministicDigest: "" } as unknown as SimulationAnalysisPlan);
function lowered(provider: SimulatorProviderDefinition = diagnosticNgspiceProvider(), model = asset()) {
  const ir = divider(model);
  return { ir, model, artifact: lowerNetlistIr({ ir, provider, assets: [model], analysisPlan: PLAN, primaryReferenceSemanticNetId: "net:GND" }) };
}
/** The artifact with its deck lines rewritten and every FNV digest recomputed, as any client can (they are public). */
function tampered(artifact: LoweredNetlistArtifact, rewrite: (lines: string[]) => string[], patchManifest: (manifest: LoweredNetlistArtifact["manifest"]) => void = () => {}): LoweredNetlistArtifact {
  const immutableContent = rewrite(artifact.immutableContent.split(NEWLINE)).join(NEWLINE);
  const manifest = structuredClone(artifact.manifest);
  patchManifest(manifest);
  manifest.generatedNetlistDigest = simulationDigest(immutableContent);
  manifest.deterministicDigest = simulationDigest({ ...manifest, deterministicDigest: undefined });
  return { ...artifact, immutableContent, contentDigest: manifest.generatedNetlistDigest, manifest };
}
const elementLine = (lines: string[], prefix: string): number => lines.findIndex((line) => line.startsWith(prefix));
async function validator() {
  return import("@/app/lib/computation/deck-validator");
}

describe("[B22-C] an independent deck validator (D22-19, in part)", () => {
  it("1. a deck whose element card names the wrong nodes passes CD-10's own audit once its public digests are recomputed (the counterexample), and the independent validator refuses it", async () => {
    const { ir, model, artifact } = lowered();
    expect(auditNetlistLowering(ir, artifact)).toEqual([]);
    const swapped = tampered(artifact, (lines) => {
      const at = elementLine(lines, "X1_");
      const tokens = lines[at]!.split(" ");
      [tokens[1], tokens[2]] = [tokens[2]!, tokens[1]!];
      return lines.map((line, index) => (index === at ? tokens.join(" ") : line));
    });
    expect(auditNetlistLowering(ir, swapped)).toEqual([]); // the self-referential audit sees nothing
    const { validateLoweredDeck } = await validator();
    expect(validateLoweredDeck({ ir, artifact, assets: [model], modelContents: { [revisionOf(model)]: MODEL_TEXT } })).toEqual([]);
    expect(validateLoweredDeck({ ir, artifact: swapped, assets: [model] })).toContain("DECK_NODE_MAPPING_MISMATCH");
  });

  it("2. both CD-10 provider paths (the diagnostic ngspice provider and the analytical reference provider) lower to a deck the validator accepts, with the model library pinned by its content digest", async () => {
    const { validateLoweredDeck, pinnedContentSha256, DECK_VALIDATION_CODES } = await validator();
    expect([...DECK_VALIDATION_CODES]).toEqual(["DECK_IR_PIN_MISMATCH", "DECK_LINE_UNEXPECTED", "DECK_END_MISSING", "DECK_ANALYSIS_INVALID", "DECK_INCLUDE_UNMAPPED", "DECK_MODEL_NOT_CONTENT_PINNED", "DECK_COMPONENT_UNMAPPED", "DECK_MODEL_MISMATCH", "DECK_PARAMETER_MISMATCH", "DECK_NODE_UNMAPPED", "DECK_NODE_MAPPING_MISMATCH", "DECK_NODE_COLLAPSE", "DECK_REFERENCE_INVALID", "DECK_TEST_ELEMENT_MISMATCH"]);
    for (const provider of [diagnosticNgspiceProvider(), analyticalReferenceProvider()]) {
      const { ir, model, artifact } = lowered(provider);
      expect(pinnedContentSha256(model), provider.providerId).toBe(sha256(MODEL_TEXT));
      expect(validateLoweredDeck({ ir, artifact, assets: [model], modelContents: { [revisionOf(model)]: MODEL_TEXT } }), provider.providerId).toEqual([]);
      expect(artifact.immutableContent.split(NEWLINE).filter((line) => line.startsWith(".include")), provider.providerId).toHaveLength(1);
    }
  });

  it("3. include mappings: an extra or a missing include, an include whose digest is not its asset's, an asset not pinned by a 64-hex content digest, and content whose SHA-256 differs are each refused", async () => {
    const { validateLoweredDeck } = await validator();
    const { ir, model, artifact } = lowered();
    const run = (candidate: LoweredNetlistArtifact, assets = [model], modelContents?: Record<string, string>) => validateLoweredDeck({ ir, artifact: candidate, assets, modelContents });
    const include = (lines: string[]) => elementLine(lines, ".include");
    expect(run(tampered(artifact, (lines) => [...lines.slice(0, include(lines) + 1), '.include "models/9-extra.lib"', ...lines.slice(include(lines) + 1)]))).toContain("DECK_INCLUDE_UNMAPPED");
    expect(run(tampered(artifact, (lines) => lines.filter((_, index) => index !== include(lines))))).toContain("DECK_INCLUDE_UNMAPPED");
    expect(run(tampered(artifact, (lines) => lines, (manifest) => { manifest.modelIncludeAndDigestMappings[0]!.contentDigest = `sha256:${"0".repeat(64)}`; }))).toContain("DECK_MODEL_NOT_CONTENT_PINNED");
    const unpinned = asset(MODEL_TEXT, "model-test");
    const unpinnedLowering = lowered(diagnosticNgspiceProvider(), unpinned);
    expect(validateLoweredDeck({ ir: unpinnedLowering.ir, artifact: unpinnedLowering.artifact, assets: [unpinned] })).toContain("DECK_MODEL_NOT_CONTENT_PINNED");
    expect(run(artifact, [model], { [revisionOf(model)]: `${MODEL_TEXT}* edited${NEWLINE}` })).toContain("DECK_MODEL_NOT_CONTENT_PINNED");
    expect(run(artifact, [])).toContain("DECK_MODEL_NOT_CONTENT_PINNED");
  });

  it("4. component mappings: an element card the IR does not hold, a missing one, a wrong model and a changed parameter are each refused", async () => {
    const { validateLoweredDeck } = await validator();
    const { ir, model, artifact } = lowered();
    const run = (candidate: LoweredNetlistArtifact) => validateLoweredDeck({ ir, artifact: candidate, assets: [model] });
    const edit = (prefix: string, change: (tokens: string[]) => string[]) => tampered(artifact, (lines) => lines.map((line) => (line.startsWith(prefix) ? change(line.split(" ")).join(" ") : line)));
    expect(run(tampered(artifact, (lines) => { const at = elementLine(lines, "X1_"); return [...lines.slice(0, at), lines[at]!.replace(/^X1_\S+/, "X9_extra"), ...lines.slice(at)]; }))).toContain("DECK_COMPONENT_UNMAPPED");
    expect(run(tampered(artifact, (lines) => lines.filter((line) => !line.startsWith("X2_"))))).toContain("DECK_COMPONENT_UNMAPPED");
    expect(run(edit("X1_", (tokens) => tokens.map((token, index) => (index === 3 ? "OTHER_MODEL" : token))))).toContain("DECK_MODEL_MISMATCH");
    expect(run(edit("X1_", (tokens) => tokens.map((token) => (token.startsWith("R=") ? "R=9k" : token))))).toContain("DECK_PARAMETER_MISMATCH");
  });

  it("5. node mappings: a node the manifest does not map, a collapse of two nets onto one name and a reference node that is not the explicit primary reference are each refused", async () => {
    const { validateLoweredDeck } = await validator();
    const { ir, model, artifact } = lowered();
    const run = (candidate: LoweredNetlistArtifact) => validateLoweredDeck({ ir, artifact: candidate, assets: [model] });
    expect(run(tampered(artifact, (lines) => lines.map((line) => (line.startsWith("X1_") ? line.split(" ").map((token, index) => (index === 1 ? "n_99_ghost" : token)).join(" ") : line))))).toContain("DECK_NODE_UNMAPPED");
    const vout = artifact.manifest.semanticNetToSimulatorNodeMappings.find((mapping) => mapping.semanticNetId === "net:VOUT")!.providerNodeName;
    expect(run(tampered(artifact, (lines) => lines, (manifest) => { manifest.semanticNetToSimulatorNodeMappings.find((mapping) => mapping.semanticNetId === "net:VIN")!.providerNodeName = vout; }))).toContain("DECK_NODE_COLLAPSE");
    const zeroed = tampered(artifact, (lines) => lines.map((line) => line.split(" ").map((token) => (token === vout ? "0" : token)).join(" ")), (manifest) => { manifest.semanticNetToSimulatorNodeMappings.find((mapping) => mapping.semanticNetId === "net:VOUT")!.providerNodeName = "0"; });
    expect(run(zeroed)).toContain("DECK_REFERENCE_INVALID");
  });

  it("6. nothing else may stand in the deck: a control block, a second analysis, a missing .end and a test element on other nodes are refused; the IR pin is checked", async () => {
    const { validateLoweredDeck } = await validator();
    const { ir, model, artifact } = lowered();
    const run = (candidate: LoweredNetlistArtifact, irOf = ir) => validateLoweredDeck({ ir: irOf, artifact: candidate, assets: [model] });
    const before = (marker: string, extra: string[]) => tampered(artifact, (lines) => { const at = elementLine(lines, marker); return [...lines.slice(0, at), ...extra, ...lines.slice(at)]; });
    expect(run(before(".end", [".control", "run", ".endc"]))).toContain("DECK_LINE_UNEXPECTED");
    expect(run(before(".end", [".op"]))).toContain("DECK_ANALYSIS_INVALID");
    expect(run(tampered(artifact, (lines) => lines.filter((line) => line !== ".end")))).toContain("DECK_END_MISSING");
    expect(run(tampered(artifact, (lines) => lines.map((line) => (line.startsWith("VT1 ") ? line.split(" ").map((token, index) => (index === 1 ? "0" : index === 2 ? token === "0" ? "n_1_net_VIN" : token : token)).join(" ") : line))))).toContain("DECK_TEST_ELEMENT_MISMATCH");
    expect(run(artifact, finalizeSimulation({ ...ir, semanticDigest: "semantic:other", deterministicDigest: "" }))).toContain("DECK_IR_PIN_MISMATCH");
    // [B22-C review] every row below must be refused with its code; the misses are reported together
    const card = (change: (tokens: string[]) => string[], patch?: (manifest: LoweredNetlistArtifact["manifest"]) => void) => tampered(artifact, (lines) => lines.map((line) => (line.startsWith("VT1 ") ? change(line.split(" ")).join(" ") : line)), patch);
    const rows: Array<[string, LoweredNetlistArtifact, string]> = [
      // security-1: a comment line is read, not skipped - a `*#` line runs its rest as a command (SEC-1 probe p3) and an
      // `*ng_script` title runs the deck as a script (p4); the lowering emits neither, so each is refused wherever it stands
      ["a *# command line", before(".end", ["*# shell whoami"]), "DECK_LINE_UNEXPECTED"],
      ["an indented *# command line", before(".end", ["  *#echo hello"]), "DECK_LINE_UNEXPECTED"],
      ["an *ng_script title", tampered(artifact, (lines) => ["*ng_script", ...lines.slice(1)]), "DECK_LINE_UNEXPECTED"],
      ["an * NG_SCRIPT title", tampered(artifact, (lines) => [" * NG_SCRIPT b22-c", ...lines.slice(1)]), "DECK_LINE_UNEXPECTED"],
      // security-1: the deck breaks lines only with LF and carries no NUL (SEC-1's final screen refuses the same set)
      ...[0x00, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029].map((code): [string, LoweredNetlistArtifact, string] => [`U+${code.toString(16).padStart(4, "0")} inside a card`, tampered(artifact, (lines) => lines.map((line) => (line.startsWith("VT1 ") ? `${line}${String.fromCharCode(code)}*# shell whoami` : line))), "DECK_LINE_UNEXPECTED"]),
      // security-2: a test-element card is its kind, its two nodes and its value - nothing more, nothing else
      ["a changed test value", card((tokens) => tokens.map((token, index) => (index === 3 ? "500" : token))), "DECK_TEST_ELEMENT_MISMATCH"],
      ["extra test tokens", card((tokens) => [...tokens, "PULSE(0", "5", "1u)"]), "DECK_TEST_ELEMENT_MISMATCH"],
      ["a missing test value", card((tokens) => tokens.slice(0, 3)), "DECK_TEST_ELEMENT_MISMATCH"],
      ["another element kind", card((tokens) => ["RT1", ...tokens.slice(1)], (manifest) => { manifest.insertedTestElementMappings[0]!.providerElementName = "RT1"; }), "DECK_TEST_ELEMENT_MISMATCH"],
      // the analysis line has one closed shape per analysis the lowering emits; an extra token is not an analysis
      ["an analysis option", tampered(artifact, (lines) => lines.map((line) => (line === ".op" ? ".op uic" : line))), "DECK_ANALYSIS_INVALID"],
      ["a substituted analysis value", tampered(artifact, (lines) => lines.map((line) => (line === ".op" ? ".tran 1u `whoami`" : line))), "DECK_ANALYSIS_INVALID"],
    ];
    expect(rows.filter(([, candidate, code]) => !(run(candidate) as string[]).includes(code)).map(([label]) => label)).toEqual([]);
    // the untampered deck still holds
    expect(run(artifact)).toEqual([]);
  });

  it("7. the validator is independent: it imports nothing from the lowering it checks and is not SEC-1's safety screen", () => {
    const source = readFileSync(join(process.cwd(), "app/lib/computation/deck-validator.ts"), "utf8");
    const imports = [...source.matchAll(/^import [^;]* from "([^"]+)";/gm)].map((match) => match[1]);
    expect(imports.some((path) => /lowering|spice\/netlist/.test(path!))).toBe(false);
    expect(source).not.toMatch(/assertCompiledDeckSafe|lowerNetlistIr|auditNetlistLowering/);
  });

  it("8. [B22-C review] coverage-2: no CD-10 path calls the validator yet - it is a library function the authoritative path will need - and the page says so instead of recording the pin as enforced", { timeout: 120_000 }, () => {
    const callers = [...collectProductionFiles(process.cwd())].filter(([path, source]) => path !== "app/lib/computation/deck-validator.ts" && /\b(?:validateLoweredDeck|pinnedContentSha256)\b/.test(source)).map(([path]) => path);
    expect(callers).toEqual([]); // when a CD-10 path wires it, this pin moves with the page
    const page = readFileSync(join(process.cwd(), "artifacts/ai-control-plane-b22/simulation-authority.md"), "utf8");
    expect(page).toContain("no CD-10 path calls `validateLoweredDeck`");
    expect(page).not.toContain("(`deck-validator.ts`, both CD-10 provider paths)");
    // CD-10's own lowering still accepts a storage reference that is not 64 hex (case 3's `unpinned` asset lowers): the page records it
    expect(page).toMatch(/`lowering\.ts:14`[^.]*prefix/);
  });
});
