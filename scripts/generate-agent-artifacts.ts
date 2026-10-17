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
import { resolveExternalReadBinding } from "../app/lib/agent/acquisition-reads"; // [B19-E E6]
import { resolveMcpObservationBinding } from "../app/lib/agent/mcp-observation-reads"; // [B20 A4]
import { resolvePcbSyncPreflightBinding } from "../app/lib/agent/pcb-sync-preflight-reads"; // [PR-D, 2026-10-17] OD-244
import { resolveCatalogInspectionBinding } from "../app/lib/agent/catalog-inspection-reads"; // [PR-D, 2026-10-17] OD-244
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
  "sirkit.manufacturing.release": "manufacturing release is categorically blocked from chat (MFG01 server gate only)", "sirkit.computation.circuit-analysis": "an inert sealed request a human approves (B22-B, OD-139); approving one needs an authenticated route B22-B does not add, so it is registered, never exposed or callable", "sirkit.computation.layout-experiment": "an inert sealed request a human approves (B22-B, OD-139); approving one needs a route B22-B does not add, and the placement engine has no worker entry in this build",
};

type Descriptor = NonNullable<ReturnType<typeof registry.get>>;

function requiredRuntimeResources(item: Descriptor): string {
  // [B18-C] a granted execution needs the board, the PCB history basis and the run's execution-grant minter.
  if (item.operationClass === "mutate" && item.agentExposed) return "canonical-state;pcb-proposal-basis;execution-grant-minter";
  // [B20 A4] the external tool read needs the verified board and the external tool port the chat route binds
  if (resolveMcpObservationBinding(item).state === "resolved") return "canonical-state;external-tool-port";
  // [B19-E E6] a bound external read needs the verified board and the external acquisition port the chat route binds
  if (item.binding.status === "bound-external-read") return "canonical-state;external-acquisition-port"; if (item.binding.status === "bound-computation") return "computation-port"; // [B22-B] a named computation read needs only the computation port the chat route binds
  // [PR-D, 2026-10-17] OD-244: the Schematic to PCB preflight read needs only the run request's validated schematic snapshot (no board);
  // the catalog part inspection needs the catalog port the chat route binds
  if (resolvePcbSyncPreflightBinding(item).state === "resolved") return "validated-schematic";
  if (resolveCatalogInspectionBinding(item).state === "resolved") return "catalog-port";
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
  if (resolveMcpObservationBinding(item).state === "resolved") {
    return {
      availability: "conditional",
      reason: "BOUND EXTERNAL TOOL READ (B20-A4): requires the editorContext's validated board (canonical-state) AND an external tool port bound by /api/chat through app/api/chat/mcp-observation-runtime.ts (SIRKIT_MCP_ENABLED exactly 1, a human principal, outside the fixture runtime, and a roster of approved PINNED registry rows not prohibited for an agent - none today, OD-48); labels only for a row the committed registry does not permit (unknown rows included, OD-76); at most 4 server operations per run (OD-74); withheld per run otherwise",
    };
  }
  if (item.binding.status === "bound-external-read") {
    return {
      availability: "conditional",
      reason: "BOUND EXTERNAL READ (B19-E E6): requires the editorContext's validated board (canonical-state) AND an external acquisition port bound by /api/chat through app/api/chat/external-acquisition-runtime.ts (a server with its database; withheld in the fixture runtime); labels only while every source's agentDisclosure is unknown (OD-36); exact MPNs only, at most 5 live MPNs per run (OD-40); withheld per run otherwise",
    };
  } if (item.binding.status === "bound-computation") return { availability: "conditional", reason: "BOUND COMPUTATION READ (B22-B): requires a computation port bound by /api/chat through app/api/chat/computation-runtime.ts (the server opts in with SIRKIT_NAMED_COMPUTATIONS exactly 1, OD-158; off by default); one closed engine in the bounded engine host, stopped hard at the kind's budget; no board needed (a board parse refuses without the run's canonical state); evidence, never authority; withheld per run otherwise" }; // [B22-B]
  if (resolvePcbSyncPreflightBinding(item).state === "resolved") return { availability: "conditional", reason: "BOUND PREFLIGHT READ (PR-D, OD-244): requires the run request's validated schematic snapshot and its digest (validated-schematic), no board; withheld per run when the browser publishes no validated schematic" }; // [PR-D, 2026-10-17]
  if (resolveCatalogInspectionBinding(item).state === "resolved") return { availability: "conditional", reason: "BOUND CATALOG READ (PR-D, OD-244): requires a catalog port bound by /api/chat through app/api/chat/catalog-inspection-runtime.ts (a server with its catalog database, or the fixture runtime); withheld per run when the server publishes no catalog fact" }; // [PR-D, 2026-10-17]
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
  if (item.operationClass === "mutate") {
    return {
      availability: "conditional",
      reason: "GRANTED EXECUTION (B18-C): requires the editorContext's validated board AND its PCB history basis (head, lineage, active DRC preset) AND an execution-grant minter bound by /api/chat (a human session principal with a readable autonomy setting) AND a Tier 1 execute role; a call mints a one-shot server grant — the user's editor previews it for confirmation or, under execute_explicit_tier1 for the exact requested operation, commits it through the canonical editor session; withheld per run otherwise",
    };
  }
  return {
    availability: "conditional",
    reason: "available only when the run request carries a validated schematic snapshot AND a validated canonical head mark (lineage-sealed proposal contract); otherwise withheld and the run proceeds tool-less",
  };
}

function reasonFor(item: Descriptor): string {
  if (item.agentExposed) {
    if (resolveMcpObservationBinding(item).state === "resolved") return "STATICALLY EXPOSED: bound external tool read (B20-A4) over the chat route's injected MCP port; per-run availability requires the port and canonical state (see browser_runtime_availability)";
    if (item.binding.status === "bound-external-read") return "STATICALLY EXPOSED: bound external read (B19-E E6) over the chat route's injected acquisition port; per-run availability requires the port and canonical state (see browser_runtime_availability)"; if (item.binding.status === "bound-computation") return "STATICALLY EXPOSED: bound computation read (B22-B) over the chat route's injected computation port; per-run availability requires the port (see browser_runtime_availability)";
    if (item.operationClass === "read") return "STATICALLY EXPOSED: activated B05/B05.1 read binding; per-run availability requires every declared runtime resource (see browser_runtime_availability)";
    if (item.operationClass === "mutate") return "STATICALLY EXPOSED: reviewed Tier 1 granted execution (B18-C) — a call mints a server-bound one-shot grant; the user's canonical editor session is the only committer";
    return "STATICALLY EXPOSED: sealed tier-1 proposal binding (proposal-artifact only; apply stays the human-only destructive command); per-run availability requires validated schematic + canonical head mark";
  }
  if (EXCLUSION_REASONS[item.toolId]) return `EXCLUDED: ${EXCLUSION_REASONS[item.toolId]}`;
  if (item.operationClass === "mutate") return "EXCLUDED: a canonical mutation is exposed only as a reviewed Tier 1 granted execution (B18-C); this one is not in the reviewed list";
  if (["destructive", "release", "view-session"].includes(item.operationClass)) return "EXCLUDED: mutation-capable operation class is forbidden for agents in B09";
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
    bindingResolved: resolveMcpObservationBinding(item).state === "resolved" ? true : resolvePcbSyncPreflightBinding(item).state === "resolved" || resolveCatalogInspectionBinding(item).state === "resolved" ? true : item.binding.status === "bound-computation" ? resolveComputationBinding(item).state === "resolved" : item.binding.status === "bound-external-read" ? resolveExternalReadBinding(item).state === "resolved" : item.operationClass === "read" ? resolveReadBinding(item).state === "resolved" : item.operationClass === "mutate" ? item.agentExposed && item.binding.status === "bound-mutation-editor-session" : item.binding.status === "bound-proposal",
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

// [B22-B] the computation read binding, on its own line at the END (imports are hoisted): no line of this generator moves
import { resolveComputationBinding } from "../app/lib/agent/computation-reads";
