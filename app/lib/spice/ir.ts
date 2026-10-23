import { buildNetUnionFind } from "@/app/lib/connectivity"; import { assertWholeProject, sheetErrors, validateSheetHierarchy } from "@/app/lib/schematic/sheets"; // [PR-J1 integration, 2026-10-22] on this line so no line moves
import { kicadPinWorldPos, pinWorldPos, pointKey } from "@/app/lib/geometry";
import { PIN_NAMES, netLabelNameKey, normalizeRefDes, schDisplayRef, type KicadComponentInstance, type Point, type SchComponent } from "@/lib/schematic-types";
import { createId } from "./identity";
import { getActiveDesign } from "./project";
import type {
  CanonicalSimulationIr,
  IrDevice,
  IrNode,
  ModelAsset,
  ModelBinding,
  OverlayElement,
  OverlayNodeTarget,
  SavedOutput,
  SimulationPartSnapshot,
  SimulationProject,
  SimulationTest,
  SourceRef,
} from "./types";

export interface CompileIrInput {
  project: SimulationProject;
  testId: string;
  parts?: SimulationPartSnapshot[];
}

export interface CompileIrResult {
  ir: CanonicalSimulationIr;
  componentPinNodes: Record<string, string>;
  pointNodes: Record<string, string>;
}

const THEORY_PREFIX: Record<SchComponent["type"], IrDevice["deviceType"] | null> = {
  resistor: "R",
  capacitor: "C",
  inductor: "L",
  diode: "D",
  "voltage-source": "V",
  "current-source": "I",
  ground: null,
};

function sanitizeNodeName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_+.-]/g, "_");
  if (cleaned === "" || cleaned === "0" || /^gnd$/i.test(cleaned)) return cleaned === "" ? "" : "0";
  return cleaned.startsWith("$") ? `N_${cleaned.slice(1)}` : cleaned;
}

function sanitizeElementName(name: string, prefix: IrDevice["deviceType"]): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_]/g, "_") || createId(prefix.toLowerCase());
  return cleaned.toUpperCase().startsWith(prefix) ? cleaned : `${prefix}${cleaned}`;
}

function uniqueName(base: string, seen: Set<string>): string {
  let candidate = base;
  let index = 2;
  while (seen.has(candidate.toUpperCase())) candidate = `${base}_${index++}`;
  seen.add(candidate.toUpperCase());
  return candidate;
}

function enabledModelsForTest(project: SimulationProject, test: SimulationTest): Map<string, ModelAsset> {
  const substitutions = new Map<string, string>();
  for (const element of test.overlay.elements) {
    if (element.enabled && element.kind === "component-substitution") substitutions.set(element.componentId, element.modelId);
  }
  const models = new Map(project.modelAssets.map((asset) => [asset.id, asset]));
  for (const binding of project.modelBindings) {
    const replacement = substitutions.get(binding.componentId);
    if (replacement && models.has(replacement)) models.set(`binding:${binding.componentId}`, models.get(replacement)!);
  }
  return models;
}

function bindingForComponent(project: SimulationProject, test: SimulationTest, componentId: string): ModelBinding | undefined {
  const substitution = test.overlay.elements.find(
    (element): element is Extract<OverlayElement, { kind: "component-substitution" }> => element.enabled && element.kind === "component-substitution" && element.componentId === componentId,
  );
  const binding = project.modelBindings.find((candidate) => candidate.componentId === componentId);
  if (!substitution) return binding;
  return binding
    ? { ...binding, modelId: substitution.modelId }
    : {
        id: createId("binding"),
        componentId,
        modelId: substitution.modelId,
        pinMap: {},
        parameterOverrides: {},
        confidence: 1,
        assignedBy: "user",
        reviewed: true,
        createdAt: new Date().toISOString(),
      };
}

function selectTest(project: SimulationProject, testId: string): SimulationTest {
  const test = project.tests.find((candidate) => candidate.id === testId);
  if (!test) throw new Error(`Simulation test ${testId} was not found`);
  return test;
}

export function compileCanonicalIr(input: CompileIrInput): CompileIrResult {
  const { project } = input;
  const test = selectTest(project, input.testId);
  const design = project.designRevisions.find((candidate) => candidate.id === test.baseDesignRevisionId) ?? getActiveDesign(project);
  const schematic = design.schematic; assertWholeProject(schematic, "spice-ir"); if (schematic.sheets !== undefined || sheetErrors(validateSheetHierarchy(schematic)).length > 0) throw new Error("SIM_MULTI_SHEET_PENDING: compiling a simulation of a project organised into sheets is not available yet; nothing was compiled"); // [PR-J, 2026-10-22] J2: never a cross-sheet coordinate union; [PR-J1 integration, 2026-10-22] PC-3 / J1-CONS-7: never one sheet's view, never sheet references without their tree
  const parts = new Map((input.parts ?? []).map((part) => [part.id, part]));
  const kicad = schematic.kicadComponents ?? [];
  const labels = schematic.netLabels ?? [];
  const warnings: string[] = [];

  const kicadPinPoints: Array<{ component: KicadComponentInstance; pinName: string; point: Point }> = [];
  for (const component of kicad) {
    const part = parts.get(component.partId);
    if (!part) {
      warnings.push(`${component.refDes}: catalog pin metadata is unavailable; model connectivity cannot be compiled.`);
      continue;
    }
    for (const pin of part.pins) {
      kicadPinPoints.push({ component, pinName: pin.number || pin.name, point: kicadPinWorldPos(component, pin) });
    }
  }

  const uf = buildNetUnionFind(
    schematic.components,
    schematic.wires,
    kicadPinPoints.map((entry) => entry.point),
    labels,
  );

  const groundSites: string[] = schematic.components
    .filter((component) => component.type === "ground")
    .map((component) => pointKey(pinWorldPos(component, "pin")));
  for (const label of labels) {
    const name = netLabelNameKey(label.name);
    if (label.kind === "ground" || name === "GND" || name === "0") groundSites.push(pointKey(label.position));
  }
  let groundRoot: string | null = null;
  for (const site of groundSites) {
    if (groundRoot === null) groundRoot = uf.find(site);
    else uf.union(groundRoot, site);
  }
  if (groundRoot !== null) groundRoot = uf.find(groundRoot);

  const allSites = new Set<string>();
  for (const component of schematic.components) {
    for (const pin of PIN_NAMES[component.type] ?? []) allSites.add(pointKey(pinWorldPos(component, pin)));
  }
  for (const entry of kicadPinPoints) allSites.add(pointKey(entry.point));
  for (const wire of schematic.wires) for (const vertex of wire.vertices) allSites.add(pointKey(vertex));
  for (const label of labels) allSites.add(pointKey(label.position));

  const roots = new Set([...allSites].map((site) => uf.find(site)));
  const aliasesByRoot = new Map<string, Set<string>>();
  for (const label of labels) {
    const root = uf.find(pointKey(label.position));
    let aliases = aliasesByRoot.get(root);
    if (!aliases) {
      aliases = new Set();
      aliasesByRoot.set(root, aliases);
    }
    aliases.add(label.name.trim());
  }

  const usedNodeNames = new Set<string>();
  const nodeNameByRoot = new Map<string, string>();
  if (groundRoot !== null) {
    nodeNameByRoot.set(groundRoot, "0");
    usedNodeNames.add("0");
  }
  let anonymousIndex = 1;
  for (const root of [...roots].sort()) {
    if (root === groundRoot) continue;
    const aliases = [...(aliasesByRoot.get(root) ?? [])].map(sanitizeNodeName).filter(Boolean).sort();
    const preferred = aliases.find((alias) => alias !== "0") ?? `N${String(anonymousIndex++).padStart(3, "0")}`;
    let unique = preferred;
    let suffix = 2;
    while (usedNodeNames.has(unique.toUpperCase())) unique = `${preferred}_${suffix++}`;
    usedNodeNames.add(unique.toUpperCase());
    nodeNameByRoot.set(root, unique);
  }

  const pointNodes: Record<string, string> = {};
  for (const site of allSites) pointNodes[site] = nodeNameByRoot.get(uf.find(site)) ?? "N_UNRESOLVED";

  const nodes: IrNode[] = [...roots]
    .sort((a, b) => (nodeNameByRoot.get(a) ?? a).localeCompare(nodeNameByRoot.get(b) ?? b))
    .map((root) => ({
      id: `node_${nodeNameByRoot.get(root) ?? stableRootId(root)}`,
      name: nodeNameByRoot.get(root) ?? "N_UNRESOLVED",
      aliases: [...(aliasesByRoot.get(root) ?? [])].sort(),
      ground: root === groundRoot,
      sourceRefs: [
        ...labels
          .filter((label) => uf.find(pointKey(label.position)) === root)
          .map((label): SourceRef => ({ kind: "schematic-net", id: label.id, label: label.name })),
      ],
    }));
  const nodeIdByName = new Map(nodes.map((node) => [node.name.toUpperCase(), node.id]));
  for (const node of nodes) for (const alias of node.aliases) nodeIdByName.set(alias.toUpperCase(), node.id);

  const componentPinNodes: Record<string, string> = {};
  function nodeIdAt(point: Point): string {
    const name = pointNodes[pointKey(point)];
    const id = nodeIdByName.get(name?.toUpperCase());
    if (!id) throw new Error(`Could not resolve simulation node at ${pointKey(point)}`);
    return id;
  }

  const devices: IrDevice[] = [];
  const seenDeviceNames = new Set<string>();
  for (const component of [...schematic.components].sort((a, b) => a.id.localeCompare(b.id))) {
    const prefix = THEORY_PREFIX[component.type];
    if (!prefix) continue;
    const pins = (PIN_NAMES[component.type] ?? []).map((pin) => {
      const nodeId = nodeIdAt(pinWorldPos(component, pin));
      componentPinNodes[`${component.id}.${pin}`] = nodeId;
      return { name: pin, nodeId };
    });
    // B07.1 — identity vs presentation: the device `id`, bindings,
    // componentPinNodes, and SourceRef.id stay on the IMMUTABLE stable id;
    // the device name and SourceRef.label follow the normalized DISPLAY
    // reference, so a rename changes presentation only and every saved
    // stable-id target still resolves.
    const displayRef = normalizeRefDes(schDisplayRef(component));
    const name = uniqueName(sanitizeElementName(displayRef, prefix), seenDeviceNames);
    devices.push({
      id: component.id,
      name,
      deviceType: prefix,
      pins,
      value: component.value,
      modelId: component.type === "diode" ? "builtin_1n4148_generic" : undefined,
      modelName: component.type === "diode" ? "SIRKIT_D1N4148" : undefined,
      parameters: {},
      source: { kind: "schematic-component", id: component.id, label: displayRef },
    });
  }

  const models = enabledModelsForTest(project, test);
  for (const component of [...kicad].sort((a, b) => a.refDes.localeCompare(b.refDes))) {
    const part = parts.get(component.partId);
    const binding = bindingForComponent(project, test, component.id);
    const model = binding ? models.get(binding.modelId) ?? project.modelAssets.find((asset) => asset.id === binding.modelId) : undefined;
    const resolvedPins = part?.pins.map((pin) => {
      const point = kicadPinWorldPos(component, pin);
      const nodeId = nodeIdAt(point);
      componentPinNodes[`${component.id}.${pin.number}`] = nodeId;
      componentPinNodes[`${component.id}.${pin.name}`] = nodeId;
      return { pin, nodeId, mapped: binding?.pinMap[pin.number] ?? binding?.pinMap[pin.name] };
    }) ?? [];

    const ordered = model?.externalPins.length
      ? model.externalPins
          .sort((a, b) => a.position - b.position)
          .map((external) => resolvedPins.find((candidate) => candidate.mapped === external.name || candidate.mapped === String(external.position)))
          .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      : resolvedPins;
    devices.push({
      id: component.id,
      name: uniqueName(sanitizeElementName(component.refDes, model?.modelType === "model" ? inferModelPrefix(model) : "X"), seenDeviceNames),
      deviceType: model?.modelType === "model" ? inferModelPrefix(model) : "X",
      pins: ordered.map(({ pin, nodeId, mapped }) => ({ name: pin.number || pin.name, modelPin: mapped, nodeId })),
      value: component.value,
      modelId: model?.id,
      modelName: model?.subcircuitName ?? model?.name,
      parameters: binding?.parameterOverrides ?? {},
      source: { kind: "schematic-component", id: component.id, label: component.refDes },
    });
  }

  const outputs: SavedOutput[] = structuredClone(test.outputs.filter((output) => output.enabled));
  const customDirectives: CanonicalSimulationIr["customDirectives"] = [];
  let overlayCounter = 1;
  function resolveTarget(target: OverlayNodeTarget): string {
    if (target.kind === "component-pin") {
      const id = componentPinNodes[`${target.componentId}.${target.pin}`];
      if (!id) throw new Error(`Overlay target ${target.componentId}.${target.pin} does not resolve to a schematic pin`);
      return id;
    }
    const existing = nodeIdByName.get(target.net.trim().toUpperCase());
    if (existing) return existing;
    const name = sanitizeNodeName(target.net) || `OVERLAY_${overlayCounter++}`;
    const node: IrNode = {
      id: `node_${name}`,
      name,
      aliases: [target.net],
      ground: name === "0",
      sourceRefs: [{ kind: "overlay", id: test.overlay.id, label: target.net }],
    };
    nodes.push(node);
    nodeIdByName.set(name.toUpperCase(), node.id);
    return node.id;
  }

  for (const element of test.overlay.elements.filter((candidate) => candidate.enabled)) {
    const source: SourceRef = { kind: "overlay", id: element.id, label: element.name };
    if (element.kind === "probe") {
      const nodeId = resolveTarget(element.target);
      const node = nodes.find((candidate) => candidate.id === nodeId)!;
      const expression = element.quantity === "voltage" ? `v(${node.name})` : element.quantity === "current" ? `i(${element.name})` : `p(${element.name})`;
      outputs.push({ id: element.id, label: element.name, expression, enabled: true });
      continue;
    }
    if (element.kind === "initial-condition") {
      const node = nodes.find((candidate) => candidate.id === resolveTarget(element.target))!;
      customDirectives.push({ text: `.ic v(${node.name})=${element.value}`, source });
      continue;
    }
    if (element.kind === "series-parasitic") {
      warnings.push(`${element.name}: series parasitic overlays are preserved but require a net-splitting compiler pass before execution.`);
      continue;
    }
    if (element.kind === "component-substitution") continue;

    if (element.kind === "fault") {
      if (element.fault === "open") {
        warnings.push(`${element.name}: open-circuit fault disables conduction without modifying the production schematic.`);
        continue;
      }
      const target = resolveTarget(element.target);
      const ground = nodes.find((node) => node.ground)?.id;
      if (!ground) throw new Error(`${element.name}: a short fault requires a ground reference`);
      devices.push({
        id: element.id,
        name: uniqueName(sanitizeElementName(element.name, "R"), seenDeviceNames),
        deviceType: "R",
        pins: [{ name: "+", nodeId: target }, { name: "-", nodeId: ground }],
        value: element.resistance ?? "1m",
        parameters: {},
        source,
      });
      continue;
    }

    const positive = resolveTarget(element.positive);
    const negative = resolveTarget(element.negative);
    const prefix: IrDevice["deviceType"] =
      element.kind === "voltage-source" ? "V"
        : element.kind === "current-source" ? "I"
          : element.kind === "resistive-load" ? "R"
            : element.kind === "capacitive-load" ? "C"
              : "L";
    devices.push({
      id: element.id,
      name: uniqueName(sanitizeElementName(element.name, prefix), seenDeviceNames),
      deviceType: prefix,
      pins: [{ name: "+", nodeId: positive }, { name: "-", nodeId: negative }],
      value: element.kind === "voltage-source" || element.kind === "current-source"
        ? element.waveform || element.value
        : element.value,
      parameters: {},
      source,
    });
  }

  for (const analysis of test.analyses) {
    for (const text of analysis.advancedDirectives ?? []) {
      customDirectives.push({ text, source: { kind: "custom-directive", id: analysis.id, label: analysis.name } });
    }
  }

  const usedModelIds = new Set(devices.map((device) => device.modelId).filter((id): id is string => Boolean(id)));
  const ir: CanonicalSimulationIr = {
    schemaVersion: 1,
    title: `${project.name} — ${test.name}`,
    designRevisionId: design.id,
    testRevision: { id: test.id, revision: test.revision, createdAt: test.updatedAt, createdBy: "user" },
    nodes,
    devices,
    variables: structuredClone(test.variables.filter((variable) => variable.enabled)),
    environment: structuredClone(test.environment),
    analyses: structuredClone(test.analyses.filter((analysis) => analysis.enabled)),
    outputs,
    models: project.modelAssets.filter((model) => usedModelIds.has(model.id)).map((model) => structuredClone(model)),
    customDirectives,
    warnings,
  };
  return { ir, componentPinNodes, pointNodes };
}

function inferModelPrefix(model: ModelAsset): IrDevice["deviceType"] {
  const content = model.originalContent.toLowerCase();
  if (/\.model\s+\S+\s+d\b/.test(content)) return "D";
  if (/\.model\s+\S+\s+(?:npn|pnp)\b/.test(content)) return "Q";
  if (/\.model\s+\S+\s+(?:nmos|pmos|vdmos)\b/.test(content)) return "M";
  return "X";
}

function stableRootId(root: string): string {
  let hash = 2166136261;
  for (let i = 0; i < root.length; i++) hash = Math.imul(hash ^ root.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
