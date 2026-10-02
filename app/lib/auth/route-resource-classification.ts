/**
 * B16.0.2 §A — the per-route DATA / RESOURCE classification behind the exact
 * policy table.
 *
 * For EVERY (path, method) in `route-policy.ts` this records what the actual
 * handler does — durable data read/write, project-data sensitivity, provider
 * credit, external process execution, expensive CPU/IO, authoritative
 * mutation, release/qualification behaviour, and whether it is genuinely
 * static/catalog/public. The CI gate (`b16-0-2-route-classification.test.ts`)
 * pins:
 *  - a BIJECTION between this classification and the policy table;
 *  - a route that touches durable PROJECT data may not be public;
 *  - a route that executes an external process may not be public;
 *  - a public row is genuinely static / catalog / stateless compute over
 *    caller-supplied data (no durable project data, no provider credit, no
 *    external process, no authoritative write).
 *
 * The committed `route-data-and-resource-classification.csv` is rendered from
 * this table (byte-pinned).
 */

import { allRoutePolicies, type RoutePolicy } from "./route-policy";

export type DurableAccess = "none" | "read" | "write" | "read-write";
export type ProjectDataSensitivity = "none" | "caller-supplied-only" | "project-durable" | "session-identity";

/** Per-path resource facts NOT already encoded in the policy row. Only paths
 *  that touch durable project data or spawn an external process (or are
 *  expensive engineering compute) need an entry; everything else defaults to
 *  the derived-from-policy values. */
interface ResourceAnnotation {
  durable?: DurableAccess;
  sensitivity?: ProjectDataSensitivity;
  externalProcess?: string;
  expensive?: boolean;
}

const ANNOTATIONS: Record<string, ResourceAnnotation> = {
  // ── durable project data ───────────────────────────────────────────────────
  "/api/bom/snapshot": { durable: "read-write", sensitivity: "project-durable" },
  "/api/agent/autonomy": { durable: "read-write", sensitivity: "project-durable" }, // [B18-A] durable-workflow aggregate agent.autonomy-settings.v1
  // [B18-B] the execution-grant aggregates (agent.execution-grant.v1 + the per-principal index): consumption burns the grant
  // bound to the caller's session identity; settlement records the browser-attested outcome on the same aggregate.
  "/api/agent/execution-grant": { durable: "read-write", sensitivity: "session-identity" },
  "/api/agent/execution-grant/settle": { durable: "read-write", sensitivity: "project-durable" },
  "/api/bom/notifications": { durable: "read-write", sensitivity: "project-durable" },
  "/api/bom/diff": { durable: "read", sensitivity: "project-durable" },
  "/api/pcb-sync": { durable: "read-write", sensitivity: "project-durable" },
  "/api/physical-bindings": { durable: "read-write", sensitivity: "project-durable" },
  // [B19-E E4] the durable-workflow aggregate atomic.publication-request.v1, and the atomic catalog tables a publication writes
  // ([B19-E E4 review] gates-1: those tables are shared by every tenant; only the configured governance tenant AND project reach them)
  "/api/components/atomic/publication": { durable: "read-write", sensitivity: "project-durable" },
  "/api/assignment-queue": { durable: "read-write", sensitivity: "project-durable" },
  "/api/pcb/release": { durable: "read-write", sensitivity: "project-durable", expensive: true }, // [B22-A2] D22-18: was "kicad-cli (server-authoritative)"; the release gate writes Gerber/Excellon natively and its closure reaches no spawner (b22-a2-process-census)
  "/api/pcb/qualify": { durable: "read-write", sensitivity: "project-durable", expensive: true, externalProcess: "freerouting (java)" }, // [B22-A2] D22-18: createAutonomousRouteExecutor runs FreeRouting except in fixture replay (fixture mode with SIRKIT_FIXTURE_ROUTER record or live starts it too)
  // ── SPICE runs (in-process durable job store, scope-bound) ──────────────────
  "/api/spice/runs": { durable: "read-write", sensitivity: "project-durable", externalProcess: "ngspice" },
  "/api/spice/runs/[id]": { durable: "read-write", sensitivity: "project-durable" },
  "/api/spice/runs/[id]/bundle": { durable: "read", sensitivity: "project-durable" },
  "/api/spice/runs/[id]/events": { durable: "read", sensitivity: "project-durable" },
  "/api/spice/runs/[id]/waveforms": { durable: "read", sensitivity: "project-durable" },
  // ── external-process compute over caller-supplied data ──────────────────────
  "/api/simulate": { externalProcess: "ngspice", sensitivity: "caller-supplied-only", expensive: true },
  "/api/spice/models/smoke-test": { externalProcess: "ngspice", sensitivity: "caller-supplied-only", expensive: true },
  "/api/spice/models/import": { durable: "none", sensitivity: "caller-supplied-only" },
  "/api/pcb/autoroute": { externalProcess: "freerouting (java)", sensitivity: "caller-supplied-only", expensive: true },
  "/api/pcb/export/gerbers": { externalProcess: "kicad-cli", sensitivity: "caller-supplied-only", expensive: true },
  "/api/pcb/export/kicad-pcb": { sensitivity: "caller-supplied-only" },
  "/api/export/kicad": { sensitivity: "caller-supplied-only" },
  // [B16.0.3 §C] chat READS durable, project-scoped component authority + pin
  // facts for the agent's replacement-facts path (same durable sources as
  // /api/replacement-authority). [B18-B] it also MINTS execution grants
  // (durable-workflow aggregates bound to the session identity) through the
  // composition-root minter, so its durable access is truthfully read-write.
  // The grant is not an engineering write: the commit stays in the browser's
  // canonical editor session, so the policy row stays authenticated-propose
  // (authoritativeWrite: false) — recorded as an owner decision in B18-B.
  "/api/chat": { durable: "read-write", sensitivity: "session-identity", externalProcess: "freerouting (java)" }, // [B22-A2] D22-18: the composition root's routing executor (sirkit.routing.propose) runs FreeRouting
  // [B16.0.3 §C] the replacement REAUTHORIZATION exchange READS durable,
  // project-scoped component authority + published pin facts
  // (resolveComponentAuthoritySource / loadRunComponentAuthority /
  // loadRunReplacementPinFacts). It writes nothing and spends no provider
  // credit. Its previous classification (durable=none, caller-supplied-only)
  // was untrue.
  "/api/replacement-authority": { durable: "read", sensitivity: "project-durable" },
  // [B19-E E2] the external candidate search spends provider credit (the policy row says so) and keeps its answers in process
  // memory only: it reads and writes no durable store, and a search query is caller-supplied data.
  "/api/parts/external-search": { durable: "none", sensitivity: "caller-supplied-only" },
  // [B19-E E5] the atomic catalog's append-only status events, read for the ids a member names: durable, but catalog data shared
  // by every tenant, never a project's own data
  "/api/components/revision-status": { durable: "read", sensitivity: "none" },
  // [B20 B2] the MCP endpoint's answers are bound to the bearer principal (its tools/list varies by the member's role).
  // [B20 B3] tools/call serves reads from the project's durable server board (resolveMcpReadDependencies: a read-only view of
  // the durable repository, the server-owned component authority, the membership runtime); it writes nothing
  "/api/mcp": { durable: "read", sensitivity: "session-identity" },
  // [B20 B2] the token route returns a credential bound to the caller's own identity and live membership; nothing is stored
  "/api/mcp/token": { durable: "none", sensitivity: "session-identity" },
};

/**
 * [B16.0.3 §C] the effective-resource ANNOTATION-COMPLETENESS map: a route
 * whose handler resolves/reads a known DURABLE authority source MUST carry a
 * durable-resource annotation (durable !== "none"). The gate connects the
 * actual durable-source calls/imports found in the handler to this annotation
 * so a truthful classification cannot silently drift back to "none".
 */
export const KNOWN_DURABLE_SOURCE_SYMBOLS: readonly string[] = [
  "resolveComponentAuthoritySource",
  "loadRunComponentAuthority",
  "loadRunReplacementPinFacts",
  "resolveReplacementPinFactsSource",
  // [B18-B] the execution-grant store (durable-workflow aggregates; consumed by the grant routes and the /api/chat minter)
  "resolveExecutionGrantStore",
  "createExecutionGrantMinter",
  // [B20 B3] the MCP endpoint's read dependencies (the durable board reader, component authority, membership re-check)
  "resolveMcpReadDependencies",
];

export interface RouteResourceRow {
  path: string;
  method: string;
  isPublic: boolean;
  durableAccess: DurableAccess;
  projectDataSensitivity: ProjectDataSensitivity;
  providerCredit: boolean;
  externalProcess: string;
  expensive: boolean;
  authoritativeWrite: boolean;
  releaseOrQualification: boolean;
  staticOrCatalog: boolean;
}

function rowFor(policy: RoutePolicy): RouteResourceRow {
  const annotation = ANNOTATIONS[policy.path] ?? {};
  const durableAccess: DurableAccess = annotation.durable ?? (policy.authoritativeWrite ? "write" : "none");
  const sensitivity: ProjectDataSensitivity = annotation.sensitivity ?? (policy.requiresAuth ? (durableAccess === "none" ? "caller-supplied-only" : "project-durable") : "none");
  const externalProcess = annotation.externalProcess ?? "";
  const isPublic = !policy.requiresAuth;
  const staticOrCatalog = isPublic && durableAccess === "none" && externalProcess === "" && !policy.providerCredit;
  return {
    path: policy.path,
    method: policy.method,
    isPublic,
    durableAccess,
    projectDataSensitivity: sensitivity,
    providerCredit: policy.providerCredit,
    externalProcess,
    expensive: annotation.expensive ?? false,
    authoritativeWrite: policy.authoritativeWrite,
    releaseOrQualification: policy.releaseOrQualification,
    staticOrCatalog,
  };
}

export function routeResourceClassification(): RouteResourceRow[] {
  return allRoutePolicies().map(rowFor);
}

/** The classification invariants (returned as violation lists for the gate). */
export function classificationViolations(): { publicTouchesDurableData: string[]; publicSpawnsProcess: string[]; publicHasCreditOrWrite: string[] } {
  const rows = routeResourceClassification();
  return {
    publicTouchesDurableData: rows.filter((r) => r.isPublic && r.durableAccess !== "none").map((r) => `${r.method} ${r.path}`),
    publicSpawnsProcess: rows.filter((r) => r.isPublic && r.externalProcess !== "").map((r) => `${r.method} ${r.path}`),
    publicHasCreditOrWrite: rows.filter((r) => r.isPublic && (r.providerCredit || r.authoritativeWrite || r.releaseOrQualification)).map((r) => `${r.method} ${r.path}`),
  };
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function renderRouteResourceClassificationCsv(): string {
  const header = ["path", "method", "is_public", "durable_access", "project_data_sensitivity", "provider_credit", "external_process", "expensive", "authoritative_write", "release_or_qualification", "static_or_catalog"];
  const rows = [...routeResourceClassification()]
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
    .map((r) => [
      r.path, r.method, String(r.isPublic), r.durableAccess, r.projectDataSensitivity,
      String(r.providerCredit), r.externalProcess, String(r.expensive), String(r.authoritativeWrite),
      String(r.releaseOrQualification), String(r.staticOrCatalog),
    ].map(csvCell).join(","));
  return [header.join(","), ...rows].join("\n") + "\n";
}
