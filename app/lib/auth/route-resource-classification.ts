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
 *    external process, no authoritative write). [B24-A3, 2026-10-06] Not the credit half any more: the two reviewed public model-egress searches carry metered provider credit, excused only with a valid ABUSE_LIMITS entry (publicHasCreditOrWrite, OD-197).
 *
 * The committed `route-data-and-resource-classification.csv` is rendered from
 * this table (byte-pinned).
 */

import { allRoutePolicies, type RoutePolicy } from "./route-policy";
import { ABUSE_LIMITS, PRINCIPAL_ABUSE_LIMITS, principalAbuseLimitProblems, publicAbuseLimitProblems } from "./abuse-limits"; // [B24-A3] OD-197: the public windows [B24-A3b] and the per-principal windows the census holds the classification to (in place of a blank line)
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
  // [B23-B1] reads the authority head, the board head and lineage and the release ledger, and regenerates the release (no ledger write) [B23-B2 review, 2026-10-04] regressions-3: the commit composes the durable exchange record (mfg.provider-exchange.v1), which writes only past a reviewed transfer descriptor; none exists, so the row stays read; the revision adding the first descriptor moves it to read-write (b23-b-exchange-ledger case 21 fails until it does)
  "/api/pcb/provider-exchange": { durable: "read", sensitivity: "project-durable", expensive: true }, "/api/ready": { durable: "none", sensitivity: "none" }, // [B24-A1] OD-198: appended in place - readiness reads the configuration and a bounded select 1, no project or caller data, and writes nothing
};

/**
 * [B23-A2] OD-174, D23-9: what a route sends OUT of Sirkit through the egress boundary, a closed vocabulary - `none` (nothing
 * through the boundary: no observation query and no files), `observation-query` (a bounded query whose answer is an observation:
 * a distributor or aggregator search, an approved MCP server's tool call, the cross-verify prompt to the operator's SchGen
 * endpoint; never a file) or `files` (design or part files leave Sirkit: only through a human-only `externalTransfer` row,
 * OD-174). The value is per path and DERIVED: a path sends an observation query exactly when its runtime import closure reaches [superseded 2026-10-05 by the B23 closeout (B23-B1, B23-B2, OD-182): but a transfer row's value is declared `files` since B23-B1, never derived; since B23-B2 the provider exchange route's closure reaches the boundary only through provider-egress.ts, and its derived value, observation-query, is pinned beside the declared one]
 * the egress boundary `app/lib/net/outbound-fetch.ts`, unless a reviewed cache-only exemption holds (`b23-a-route-vocabulary`, the
 * way `b22-a2-process-census` case 3 derives `external_process`). No route sends files in B23-A2. [B23-A2 review] `none` does NOT
 * mean the route sends nothing: the model-provider SDKs open their own connections, so a prompt or an embedding input sent to the
 * configured LLM provider is the separate `modelEgress` column (below). A row sends nothing out of Sirkit exactly when it is
 * `none` and not `modelEgress` (Sirkit's own Supabase and Postgres store aside: the durable_access column), OD-182 (a).
 */
export const OUTBOUND_EGRESS = Object.freeze(["none", "observation-query", "files"] as const);
export type OutboundEgress = (typeof OUTBOUND_EGRESS)[number];
const OUTBOUND_EGRESS_BY_PATH: Readonly<Record<string, OutboundEgress>> = Object.freeze({
  "/api/bom": "observation-query", // live distributor pricing for a member (OD-31, OD-33)
  "/api/bom/diff": "observation-query", // live pricing of the current BOM against a snapshot
  "/api/bom/snapshot": "observation-query", // live pricing of the snapshot taken (the path's GET row carries the path's value)
  "/api/chat": "observation-query", // the external acquisition read port and the approved MCP observation port
  "/api/parts/external-search": "observation-query", // a member's bounded external candidate search
  "/api/schematic/cross-verify": "observation-query", // the cross-verify prompt to the operator-configured SchGen endpoint
});
/**
 * [B23-A2 review] The paths that can send a model input - a prompt or an embedding input - to the configured LLM provider (OpenAI
 * or Anthropic) through the provider SDK's own transport: DERIVED (b23-a-route-vocabulary case 4) from the route's handler
 * bindings referencing an SDK client (a binding-level walk: module reachability would mark nearly every route, because the DB
 * schema imports the embedding module's dimension constant). The `provider_credit` column is a cost marker, not this.
 */
const MODEL_EGRESS_PATHS: ReadonlySet<string> = new Set([
  "/api/architecture/propose", "/api/calculation/propose", "/api/chat", "/api/circuit-knowledge/propose", "/api/circuit-verification/propose",
  "/api/component-selection/propose", "/api/interfaces/propose", "/api/parts/search", "/api/pcb/ai-rules/from-brief", "/api/pcb/assign/suggest",
  "/api/pcb/edit/assist", "/api/pcb/footprints/search", "/api/pcb/repair/agent", "/api/power/propose", "/api/schematic", "/api/schematic-compiler/propose",
  "/api/schematic/build", "/api/schematic/build-multi", "/api/schematic/edit", "/api/schematic/edit-build", "/api/schematic/layout-critic",
  "/api/schematic/review", "/api/spice/ai",
]);
/** [B23-A2 review] Reviewed: the PUBLIC paths that send a model input, one reason each (`outboundEgressViolations`). Both embed the
 *  anonymous caller's search text with OpenAI; nothing else of the caller's leaves. Recorded, not changed: A2 adds no route change. [B24-A3, 2026-10-06] Changed since: both rows declare provider credit and expensive and each meets its public windows and the embedding meter (OD-197, answering OD-174's question). */
export const PUBLIC_MODEL_EGRESS: Readonly<Record<string, string>> = Object.freeze({
  "/api/parts/search": "the public catalogue search embeds the caller's query text with OpenAI (embedQuery) for its semantic ranking",
  "/api/pcb/footprints/search": "the public footprint search embeds the caller's q text with OpenAI (embedQuery) for its semantic ranking",
});

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
  /** [B23-A2] OD-174: what the route sends out of Sirkit through the egress boundary (none, observation-query or files). */
  outboundEgress: OutboundEgress;
  /** [B23-A2 review] OD-182 (a): whether the route can send a model input to the configured LLM provider (its SDK's own transport). */
  modelEgress: boolean;
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
    expensive: annotation.expensive ?? PUBLIC_EXPENSIVE_PATHS.has(policy.path), // [B24-A3] OD-197: the two public searches and the preview (the set is appended at the end)
    authoritativeWrite: policy.authoritativeWrite,
    releaseOrQualification: policy.releaseOrQualification,
    staticOrCatalog,
    outboundEgress: policy.externalTransfer === true ? "files" : Object.hasOwn(OUTBOUND_EGRESS_BY_PATH, policy.path) ? OUTBOUND_EGRESS_BY_PATH[policy.path]! : "none", // [B23-A2] [B23-B1] files: declared by the transfer row itself, never derived (OD-182 (a))
    modelEgress: MODEL_EGRESS_PATHS.has(policy.path), // [B23-A2 review]
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
    publicHasCreditOrWrite: rows.filter((r) => r.isPublic && ((r.providerCredit && !reviewedMeteredPublicCredit(r)) || r.authoritativeWrite || r.releaseOrQualification)).map((r) => `${r.method} ${r.path}`), // [B24-A3] OD-197: narrowed in place - credit is excused only on a reviewed PUBLIC_MODEL_EGRESS path with a valid limit
  };
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function renderRouteResourceClassificationCsv(): string {
  const header = ["path", "method", "is_public", "durable_access", "project_data_sensitivity", "provider_credit", "external_process", "expensive", "authoritative_write", "release_or_qualification", "static_or_catalog", "outbound_egress", "model_egress"]; // [B23-A2] appended columns, so external_process stays at index 6 (b22-a2-process-census case 3)
  const rows = [...routeResourceClassification()]
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
    .map((r) => [
      r.path, r.method, String(r.isPublic), r.durableAccess, r.projectDataSensitivity,
      String(r.providerCredit), r.externalProcess, String(r.expensive), String(r.authoritativeWrite),
      String(r.releaseOrQualification), String(r.staticOrCatalog), r.outboundEgress, String(r.modelEgress),
    ].map(csvCell).join(","));
  return [header.join(","), ...rows].join("\n") + "\n";
}

/** [B23-A2] OD-174's classification gates, one line per violation (`<METHOD> <path>: <reason>`): the value is in the closed vocabulary;
 *  `files` only on an `externalTransfer` row and an `externalTransfer` row only with `files`; a public row sends no observation query
 *  and no files. [B23-A2 review] `modelEgress` is a boolean, and a public row that sends a model input is a `PUBLIC_MODEL_EGRESS` path. */
export function outboundEgressViolations(rows: readonly RouteResourceRow[] = routeResourceClassification(), policies: readonly RoutePolicy[] = allRoutePolicies()): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const policy = policies.find((candidate) => candidate.path === row.path && candidate.method === row.method);
    const key = `${row.method} ${row.path}`;
    if (!(OUTBOUND_EGRESS as readonly string[]).includes(row.outboundEgress) || typeof row.modelEgress !== "boolean") { out.push(`${key}: unknown_value`); continue; }
    if (row.outboundEgress === "files" && policy?.externalTransfer !== true) out.push(`${key}: files_without_transfer`);
    if (policy?.externalTransfer === true && row.outboundEgress !== "files") out.push(`${key}: transfer_without_files`);
    if (row.isPublic && row.outboundEgress !== "none") out.push(`${key}: public_sends`);
    if (row.isPublic && row.modelEgress && !Object.hasOwn(PUBLIC_MODEL_EGRESS, row.path)) out.push(`${key}: public_model_egress`); // [B23-A2 review]
  }
  return out;
}

// ── [B24-A3] the abuse-limit census (D24-8, OD-197, OD-174's question) ────────────────────────────────────────────────────────────────
// Appended on purpose: no line the B16-B24 pages cite in this file moves.

/** The public rows that are expensive: the two searches (an OpenAI embedding per free-text query) and the placement preview (synchronous
 *  engine work; B20 F1 measured 124.9 s before the route's bound). Read in place by `rowFor`. */
const PUBLIC_EXPENSIVE_PATHS: ReadonlySet<string> = new Set(["/api/parts/search", "/api/pcb/footprints/search", "/api/pcb/placement/preview"]);

/** The closed set of `abuseLimitViolations` reasons ([B24-A3b] + `credit_unlimited` and `expensive_unlimited`, the authenticated rows). */
export const ABUSE_LIMIT_REASONS = Object.freeze(["public_credit_unlimited", "public_expensive_unlimited", "public_model_egress_unlimited", "public_credit_unreviewed", "limit_invalid", "orphan_limit", "credit_unlimited", "expensive_unlimited", "public_signin_unlimited"] as const); // [B24-A3 review, 2026-10-08] coverage-signin-gate-gap: + public_signin_unlimited, sign-in without its window
/** Sign-in is in the registry's scope though it spends no credit and is not expensive: a password check per request (OD-197). */
const SIGNIN_ABUSE_KEY = "POST /api/auth/signin";

/** A public row's provider credit is excused only when the row is a reviewed `PUBLIC_MODEL_EGRESS` path with a valid limit entry. */
export function reviewedMeteredPublicCredit(row: Pick<RouteResourceRow, "path" | "method" | "isPublic" | "providerCredit">, limits: Readonly<Record<string, unknown>> = ABUSE_LIMITS): boolean {
  const key = `${row.method} ${row.path}`;
  return row.isPublic && row.providerCredit && Object.hasOwn(PUBLIC_MODEL_EGRESS, row.path) && Object.hasOwn(limits, key) && publicAbuseLimitProblems(limits[key]).length === 0;
}

/** OD-197's gate, one `<METHOD> <path>: <reason>` line per violation: every public row that is provider credit, expensive or model
 *  egress has a valid limit entry (else `public_credit_unlimited`, `public_expensive_unlimited`, `public_model_egress_unlimited`, one
 *  per fact; an entry that is malformed is `limit_invalid`); a public credit row with an entry is still refused unless it is a reviewed
 *  `PUBLIC_MODEL_EGRESS` path (`public_credit_unreviewed`); and every entry names such a row or sign-in (`orphan_limit`).
 *  [B24-A3b] OD-197's full scope: every AUTHENTICATED row that is provider credit or expensive has a valid per-principal entry (else
 *  `credit_unlimited`, `expensive_unlimited`, one per fact; a malformed one `limit_invalid`), and every per-principal entry names such a
 *  row (`orphan_limit`). The two registries never stand in for each other. */
export function abuseLimitViolations(rows: readonly RouteResourceRow[] = routeResourceClassification(), policies: readonly RoutePolicy[] = allRoutePolicies(), limits: Readonly<Record<string, unknown>> = ABUSE_LIMITS, principalLimits: Readonly<Record<string, unknown>> = PRINCIPAL_ABUSE_LIMITS): string[] {
  const out: string[] = [];
  const scoped = new Set<string>();
  const principalScoped = new Set<string>();
  for (const row of rows) {
    const key = `${row.method} ${row.path}`;
    const policy = policies.find((candidate) => candidate.path === row.path && candidate.method === row.method);
    const isPublic = row.isPublic || policy?.requiresAuth === false;
    const credit = row.providerCredit || policy?.providerCredit === true;
    if (!isPublic) {
      if (!credit && !row.expensive) continue;
      principalScoped.add(key);
      if (!Object.hasOwn(principalLimits, key)) {
        if (credit) out.push(`${key}: credit_unlimited`);
        if (row.expensive) out.push(`${key}: expensive_unlimited`);
      } else if (principalAbuseLimitProblems(principalLimits[key]).length > 0) out.push(`${key}: limit_invalid`);
      continue;
    }
    if (!credit && !row.expensive && !row.modelEgress && key !== SIGNIN_ABUSE_KEY) continue;
    scoped.add(key);
    if (!Object.hasOwn(limits, key)) {
      if (credit) out.push(`${key}: public_credit_unlimited`);
      if (row.expensive) out.push(`${key}: public_expensive_unlimited`);
      if (row.modelEgress) out.push(`${key}: public_model_egress_unlimited`); if (key === SIGNIN_ABUSE_KEY) out.push(`${key}: public_signin_unlimited`); // [B24-A3 review, 2026-10-08] sign-in is in scope though neither credit nor expensive: its missing window is refused too
      continue;
    }
    if (publicAbuseLimitProblems(limits[key]).length > 0) {
      out.push(`${key}: limit_invalid`);
      continue;
    }
    if (credit && !Object.hasOwn(PUBLIC_MODEL_EGRESS, row.path)) out.push(`${key}: public_credit_unreviewed`);
  }
  for (const key of Object.keys(limits)) if (!scoped.has(key)) out.push(`${key}: orphan_limit`);
  for (const key of Object.keys(principalLimits)) if (!principalScoped.has(key)) out.push(`${key}: orphan_limit`);
  return out;
}
