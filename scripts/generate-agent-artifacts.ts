/**
 * B09/B09.3/B10 — deterministic agent artifact generator:
 * artifacts/ai-control-plane-b09/{agent-exposed-tool-manifest.csv,json,
 * tool-activation-audit.csv, provider-schema-parity.json,
 * normalized-loop-replay-fixtures.json}.
 *
 * STATIC exposure is never confused with PER-RUN availability. The manifest
 * distinguishes: statically agent-exposed; binding resolved; required
 * runtime resources (from the ACTIVATED binding declarations); browser
 * runtime availability; and the conditional reason. [B10] the browser chat
 * request now carries the versioned atomic editorContext (exact PcbEditor
 * working copy + live selection + optional live netlist), so canonical
 * reads are CONDITIONAL on a published, validated current-generation board
 * — never unconditionally "assemblable", never withheld when the board is
 * genuinely present and valid.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sirkitToolRegistry } from "../app/lib/engineering/tool-catalog";
import { ACTIVATED_READ_BINDINGS, resolveReadBinding } from "../app/lib/engineering/tool-bindings-readonly";
import { canonicalJson } from "../app/lib/engineering/stable";
import { buildAgentToolDeclarations, renderAgentProviderParity, strictCompatibility } from "../app/lib/agent/provider-tools";

const outDir = join(process.cwd(), "artifacts", "ai-control-plane-b09");
mkdirSync(outDir, { recursive: true });

const registry = sirkitToolRegistry();

const EXCLUSION_REASONS: Record<string, string> = {
  "sirkit.parts.search": "recall path performs a provider-hosted embedding call and live database access; no verified resource contract exists (B04 note upheld)",
  "sirkit.component-authority.inspect": "component-authority-records resource has no server-side source in the B09 chat run context (binding repository is project-DB scoped)",
  "sirkit.placement.propose": "real implementation (autoPlace worker/candidate flow) returns unsealed candidates, not revision-pinned sealed proposal artifacts through the proposal gateway",
  "sirkit.routing.propose": "real implementation is the external FreeRouting process — mutation-free but non-deterministic and unsealed; no revision-pinned proposal artifact path exists",
  "sirkit.pcb.repair-plan": "PCBToolService.planRepairs returns an unsealed plan bound to a live PcbHistory instance; no sealed revision-pinned artifact path exists",
  "sirkit.schematic.add-component": "internal-only structured-route surface (never discoverable to agents)",
  "sirkit.pcb.undo-redo-canonical": "undo/redo exposure is forbidden in B09 (view-session/internal-only)",
  "sirkit.manufacturing.release": "manufacturing release is categorically blocked from chat (MFG01 server gate only)",
};

type Descriptor = NonNullable<ReturnType<typeof registry.get>>;

function requiredRuntimeResources(item: Descriptor): string {
  if (item.operationClass === "read") {
    const binding = ACTIVATED_READ_BINDINGS.find((entry) => entry.toolId === item.toolId);
    return binding ? [...binding.requiredResources].join(";") : "";
  }
  if (item.operationClass === "propose" && item.agentExposed) return "validated-schematic;canonical-head-mark";
  return "";
}

/** [B10] browser runtime truth: reads are CONDITIONAL on the resources the
 *  run's editorContext actually supplies (validated board for canonical
 *  reads; sealed selection for selection inspection; proven netlist stays
 *  optional). Nothing is unconditionally "assemblable". */
function browserRuntimeAvailability(item: Descriptor): { availability: string; reason: string } {
  if (!item.agentExposed) return { availability: "not-exposed", reason: reasonFor(item) };
  if (item.operationClass === "read") {
    const required = requiredRuntimeResources(item);
    if (required.includes("selection-snapshot")) {
      return {
        availability: "conditional",
        reason: "requires the editorContext's validated board AND its sealed live selection (selection-snapshot); withheld per run when either is absent",
      };
    }
    return {
      availability: "conditional",
      reason: "requires the editorContext's published, validated current-generation PCB working copy (canonical-state); withheld per run when the browser publishes no valid board" + (item.toolId === "sirkit.manufacturing.readiness-inspect" ? "; the optional netlist resource is consumed only when provably captured with this run's schematic — otherwise schematic parity reports not-evaluated" : ""),
    };
  }
  return {
    availability: "conditional",
    reason: "available only when the run request carries a validated schematic snapshot AND a validated canonical head mark (lineage-sealed proposal contract); otherwise withheld and the run proceeds tool-less",
  };
}

function reasonFor(item: Descriptor): string {
  if (item.agentExposed) {
    if (item.operationClass === "read") return "STATICALLY EXPOSED: activated B05/B05.1 read binding; per-run availability requires every declared runtime resource (see browser_runtime_availability)";
    return "STATICALLY EXPOSED: sealed tier-1 proposal binding (proposal-artifact only; apply stays the human-only destructive command); per-run availability requires validated schematic + canonical head mark";
  }
  if (EXCLUSION_REASONS[item.toolId]) return `EXCLUDED: ${EXCLUSION_REASONS[item.toolId]}`;
  if (["mutate", "destructive", "release", "view-session"].includes(item.operationClass)) return "EXCLUDED: mutation-capable operation class is forbidden for agents in B09";
  if (item.callability !== "callable") return "EXCLUDED: no proven callable implementation binding";
  return "EXCLUDED: not activated in B09 (default-deny)";
}

const csvCell = (value: string | number | boolean): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const rows = registry.list().map((item) => {
  const runtime = browserRuntimeAvailability(item);
  return {
    toolId: item.toolId,
    version: item.version,
    operationClass: item.operationClass,
    bindingStatus: item.binding.status,
    bindingModule: item.binding.module ?? "",
    bindingSymbol: item.binding.symbol ?? "",
    discovery: item.discovery,
    staticallyExposed: item.agentExposed,
    bindingResolved: item.operationClass === "read" ? resolveReadBinding(item).state === "resolved" : item.binding.status === "bound-proposal",
    requiredRuntimeResources: requiredRuntimeResources(item),
    browserRuntimeAvailability: runtime.availability,
    requiredProjectState: [...item.requiredProjectState].join(";"),
    requiredAuthority: [...item.requiredAuthority].join(";"),
    approvalTier: item.approvalTier,
    strictCompatible: strictCompatibility(item).ok,
    reason: item.agentExposed ? runtime.reason : reasonFor(item),
  };
});

const header = ["tool_id", "version", "operation_class", "binding_status", "binding_module", "binding_symbol", "discovery", "statically_exposed", "binding_resolved", "required_runtime_resources", "browser_runtime_availability", "required_project_state", "required_authority", "approval_tier", "strict_compatible", "reason"];
const csv = [header, ...rows.map((row) => [row.toolId, row.version, row.operationClass, row.bindingStatus, row.bindingModule, row.bindingSymbol, row.discovery, row.staticallyExposed, row.bindingResolved, row.requiredRuntimeResources, row.browserRuntimeAvailability, row.requiredProjectState, row.requiredAuthority, row.approvalTier, row.strictCompatible, row.reason])]
  .map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
writeFileSync(join(outDir, "agent-exposed-tool-manifest.csv"), csv);
writeFileSync(join(outDir, "tool-activation-audit.csv"), csv);
writeFileSync(join(outDir, "agent-exposed-tool-manifest.json"), canonicalJson({
  schema: "sirkit.agent-exposed-tool-manifest.v3",
  note: "v3 (B10): static exposure and per-run availability stay separate; browser_runtime_availability records the ACTUAL runtime contract with the B10 editor-context bridge (canonical reads conditional on the published validated working-copy board; selection inspection additionally on the sealed live selection; proposal on validated schematic + head mark; otherwise zero-tool conversational runs).",
  registryDigest: registry.digest(),
  tools: rows,
}) + "\n");

const exposed = registry.list().filter((item) => item.agentExposed);
const declarations = buildAgentToolDeclarations(exposed).declarations;
writeFileSync(join(outDir, "provider-schema-parity.json"), canonicalJson(renderAgentProviderParity(declarations)) + "\n");

writeFileSync(join(outDir, "normalized-loop-replay-fixtures.json"), canonicalJson({
  schema: "sirkit.agent-loop-replay-fixtures.v1",
  note: "Deterministic scripted-adapter fixtures live in app/lib/agent/__tests__ (b09-loop-safety, b09-provider-contracts, b09-proposals); this file pins the exposed declaration set they run against.",
  registryDigest: registry.digest(),
  exposedDeclarations: declarations.map((declaration) => ({ providerName: declaration.providerName, toolId: declaration.toolId, version: declaration.version, inputSchema: declaration.inputSchema })),
}) + "\n");

console.log(`Wrote B09 agent artifacts for ${exposed.length} statically exposed tools (${registry.list().length} registered) to ${outDir}`);
