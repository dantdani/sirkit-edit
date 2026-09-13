/**
 * B16.0.1 §A — the EXACT, method-aware route authorization policy.
 *
 * One explicit policy entry per (path, method). There are NO broad prefix
 * exceptions and NO `legacy-header-scope`: every authenticated route derives
 * identity from `TrustedRequestContext`. A route/method with no entry has no
 * policy (`policyFor` → null), which fails closed at runtime and trips the CI
 * gate — so a newly-added route (even under an existing family) must be
 * classified before it can serve.
 */

import type { EngineeringCapability, ProjectRole } from "../engineering/types";

export type AuthRouteClass =
  | "public"
  | "authenticated-read"
  | "authenticated-propose"
  | "authenticated-mutation"
  | "authenticated-release"
  | "internal-worker";

export type IdentitySource =
  | "trusted-context"
  | "body-scope-server-actor"
  | "worker-secret"
  | "none";

export interface RoutePolicy {
  path: string;
  method: string;
  authClass: AuthRouteClass;
  identitySource: IdentitySource;
  requiresAuth: boolean;
  /** Empty ⇒ any authenticated member; otherwise the exact permitted roles. */
  permittedRoles: readonly ProjectRole[];
  requiredCapability?: EngineeringCapability;
  providerCredit: boolean;
  requiresCsrf: boolean;
  authoritativeWrite: boolean;
  releaseOrQualification: boolean;
  evidence: string;
}

// ── Role sets ────────────────────────────────────────────────────────────────
const ALL_MEMBERS: readonly ProjectRole[] = ["viewer", "commenter", "pcb_editor", "automation", "reviewer", "project_admin", "migration_admin"];
const EDITORS: readonly ProjectRole[] = ["pcb_editor", "reviewer", "project_admin", "automation"];
const WRITE_EDITORS: readonly ProjectRole[] = ["pcb_editor", "project_admin", "automation"];
const REVIEW_EDITORS: readonly ProjectRole[] = ["pcb_editor", "reviewer", "project_admin"];
const ADMIN_ONLY: readonly ProjectRole[] = ["project_admin"];
const QUALIFY_ROLES: readonly ProjectRole[] = ["pcb_editor", "project_admin"];
/** [B18-B] the roles that may tender, cancel or settle a Tier 1 execution grant (= TIER1_EXECUTE_ROLES; a grant is issued only to them). */
const TIER1_EXECUTE: readonly ProjectRole[] = ["pcb_editor", "project_admin"];

// ── Policy constructors (defaults per class) ─────────────────────────────────
function pub(path: string, methods: readonly string[], evidence: string): RoutePolicy[] {
  return methods.map((method) => ({ path, method, authClass: "public", identitySource: "none", requiresAuth: false, permittedRoles: [], providerCredit: false, requiresCsrf: false, authoritativeWrite: false, releaseOrQualification: false, evidence }));
}
function read(path: string, methods: readonly string[], evidence: string, roles: readonly ProjectRole[] = ALL_MEMBERS): RoutePolicy[] {
  return methods.map((method) => ({ path, method, authClass: "authenticated-read", identitySource: "trusted-context", requiresAuth: true, permittedRoles: roles, providerCredit: false, requiresCsrf: method !== "GET" && method !== "HEAD", authoritativeWrite: false, releaseOrQualification: false, evidence }));
}
function propose(path: string, methods: readonly string[], evidence: string, opts: { providerCredit?: boolean; roles?: readonly ProjectRole[]; identitySource?: IdentitySource } = {}): RoutePolicy[] {
  return methods.map((method) => ({ path, method, authClass: "authenticated-propose", identitySource: opts.identitySource ?? "trusted-context", requiresAuth: true, permittedRoles: opts.roles ?? EDITORS, providerCredit: opts.providerCredit ?? false, requiresCsrf: method !== "GET" && method !== "HEAD", authoritativeWrite: false, releaseOrQualification: false, evidence }));
}
function mutate(path: string, methods: readonly string[], evidence: string, opts: { roles?: readonly ProjectRole[]; capability?: EngineeringCapability; identitySource?: IdentitySource } = {}): RoutePolicy[] {
  return methods.map((method) => ({ path, method, authClass: "authenticated-mutation", identitySource: opts.identitySource ?? "trusted-context", requiresAuth: true, permittedRoles: opts.roles ?? WRITE_EDITORS, ...(opts.capability ? { requiredCapability: opts.capability } : {}), providerCredit: false, requiresCsrf: method !== "GET" && method !== "HEAD", authoritativeWrite: true, releaseOrQualification: false, evidence }));
}
function release(path: string, methods: readonly string[], evidence: string, roles: readonly ProjectRole[]): RoutePolicy[] {
  return methods.map((method) => ({ path, method, authClass: "authenticated-release", identitySource: "trusted-context", requiresAuth: true, permittedRoles: roles, providerCredit: false, requiresCsrf: true, authoritativeWrite: true, releaseOrQualification: true, evidence }));
}
function worker(path: string, methods: readonly string[], evidence: string): RoutePolicy[] {
  return methods.map((method) => ({ path, method, authClass: "internal-worker", identitySource: "worker-secret", requiresAuth: true, permittedRoles: [], providerCredit: false, requiresCsrf: false, authoritativeWrite: true, releaseOrQualification: false, evidence }));
}
function bodyScope(path: string, methods: readonly string[], authClass: AuthRouteClass, evidence: string, opts: { providerCredit?: boolean; write?: boolean } = {}): RoutePolicy[] {
  return methods.map((method) => ({ path, method, authClass, identitySource: "body-scope-server-actor", requiresAuth: true, permittedRoles: EDITORS, providerCredit: opts.providerCredit ?? false, requiresCsrf: method !== "GET" && method !== "HEAD", authoritativeWrite: opts.write ?? false, releaseOrQualification: false, evidence }));
}

const CDS = "app/api CD-stage route (B16.0.1 migrated to trusted context)";
const AI = "app/api provider-credit route (B16.0.1: requires trusted auth + membership)";

const ALL: RoutePolicy[] = [
  // ── Release perimeter (trusted-context) ────────────────────────────────────
  ...read("/api/pcb-sync", ["GET"], "app/api/pcb-sync"),
  ...mutate("/api/pcb-sync", ["POST"], "app/api/pcb-sync", { roles: WRITE_EDITORS }),
  ...release("/api/pcb/release", ["POST"], "app/api/pcb/release", ADMIN_ONLY),
  ...release("/api/pcb/qualify", ["POST"], "app/api/pcb/qualify", QUALIFY_ROLES),
  ...read("/api/physical-bindings", ["GET"], "app/api/physical-bindings"),
  ...mutate("/api/physical-bindings", ["POST"], "app/api/physical-bindings", { roles: REVIEW_EDITORS }),
  ...read("/api/assignment-queue", ["GET"], "app/api/assignment-queue"),
  ...mutate("/api/assignment-queue", ["POST"], "app/api/assignment-queue", { roles: REVIEW_EDITORS }),
  ...worker("/api/assignment-queue/materialize", ["POST"], "app/api/assignment-queue/materialize"),
  ...worker("/api/assignment-queue/revalidate", ["POST"], "app/api/assignment-queue/revalidate"),
  ...worker("/api/engineering-effects", ["POST"], "app/api/engineering-effects"),

  // ── Body-scope + server actor ──────────────────────────────────────────────
  ...bodyScope("/api/chat", ["POST"], "authenticated-propose", "app/api/chat", { providerCredit: true }),
  ...read("/api/replacement-authority", ["POST"], "app/api/replacement-authority", EDITORS),
  // [B16.0.1 §F] read-only apply-time reauthorization: any active member may
  // ask "who am I / what is my live membership" for a project; the approval
  // controller decides apply-sufficiency. No mutation, same-origin CSRF.
  ...read("/api/pcb/apply-authorization", ["POST"], "app/api/pcb/apply-authorization"),
  // [B16.0.1 §H] the auth boundary itself. Sign-in CANNOT require prior
  // authentication (the credential verification IS the authentication —
  // performed by Supabase inside the route); sign-out must work even for an
  // expired session. Both are session-cookie state changes with same-origin
  // CSRF enforced IN-ROUTE (requireSameOrigin before the body is read); they
  // touch no project data, spend no provider credit, and write no project
  // state. The PKCE callback is a top-level GET navigation (no CSRF applies).
  {
    path: "/api/auth/signin", method: "POST", authClass: "public", identitySource: "none",
    requiresAuth: false, permittedRoles: [], providerCredit: false, requiresCsrf: true,
    authoritativeWrite: false, releaseOrQualification: false,
    evidence: "app/api/auth/signin (credential verification is the authentication; in-route CSRF)",
  },
  {
    path: "/api/auth/signout", method: "POST", authClass: "public", identitySource: "none",
    requiresAuth: false, permittedRoles: [], providerCredit: false, requiresCsrf: true,
    authoritativeWrite: false, releaseOrQualification: false,
    evidence: "app/api/auth/signout (clears the caller's own session cookies; in-route CSRF)",
  },
  ...pub("/api/auth/callback", ["GET"], "app/api/auth/callback (PKCE code exchange; safe same-origin redirect)"),

  // ── CD-stage propose families (migrated) ───────────────────────────────────
  ...propose("/api/architecture/alternatives", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/architecture/candidates", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/architecture/compare", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/architecture/problem", ["POST"], CDS),
  ...propose("/api/architecture/propose", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/interfaces/allocate", ["POST"], CDS),
  ...propose("/api/interfaces/alternatives", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/interfaces/candidates", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/interfaces/compare", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/interfaces/problem", ["POST"], CDS),
  ...propose("/api/interfaces/propose", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/power/alternatives", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/power/candidates", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/power/compare", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/power/problem", ["POST"], CDS),
  ...propose("/api/power/propose", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/power/reconcile", ["POST"], CDS),
  ...propose("/api/requirements/compile", ["POST"], CDS),
  ...mutate("/api/requirements/sources", ["POST"], CDS, { roles: REVIEW_EDITORS }),
  ...pub("/api/requirements/capabilities", ["GET"], "static capability catalog (embedded constant profile; no project data)"),
  ...propose("/api/calculation/corners", ["POST"], CDS),
  ...propose("/api/calculation/evaluate", ["POST"], CDS),
  ...propose("/api/calculation/feedback", ["POST"], CDS),
  ...propose("/api/calculation/problem", ["POST"], CDS),
  ...propose("/api/calculation/propose", ["POST"], CDS, { providerCredit: true }),
  ...read("/api/calculation/export", ["POST"], CDS),
  ...read("/api/calculation/report", ["POST"], CDS),
  ...mutate("/api/calculation/transaction", ["POST"], CDS, { roles: REVIEW_EDITORS }),
  ...propose("/api/component-selection/alternative", ["POST"], CDS),
  ...propose("/api/component-selection/evaluate", ["POST"], CDS),
  ...propose("/api/component-selection/feedback", ["POST"], CDS),
  ...propose("/api/component-selection/problem", ["POST"], CDS),
  ...propose("/api/component-selection/propose", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/component-selection/solve", ["POST"], CDS),
  ...propose("/api/component-selection/sourcing", ["POST"], CDS),
  ...read("/api/component-selection/catalog", ["POST"], CDS),
  ...read("/api/component-selection/export", ["POST"], CDS),
  ...mutate("/api/component-selection/transaction", ["POST"], CDS, { roles: REVIEW_EDITORS }),
  ...propose("/api/circuit-knowledge/applicability", ["POST"], CDS),
  ...propose("/api/circuit-knowledge/compile", ["POST"], CDS),
  ...propose("/api/circuit-knowledge/compose", ["POST"], CDS),
  ...propose("/api/circuit-knowledge/problem", ["POST"], CDS),
  ...propose("/api/circuit-knowledge/propose", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/circuit-verification/problem", ["POST"], CDS),
  ...propose("/api/circuit-verification/propose", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/circuit-verification/readiness", ["POST"], CDS),
  ...propose("/api/circuit-verification/run", ["POST"], CDS),
  ...propose("/api/schematic-compiler/compare", ["POST"], CDS),
  ...propose("/api/schematic-compiler/diff", ["POST"], CDS),
  ...propose("/api/schematic-compiler/graph/validate", ["POST"], CDS),
  ...propose("/api/schematic-compiler/layout", ["POST"], CDS),
  ...propose("/api/schematic-compiler/problem", ["POST"], CDS),
  ...propose("/api/schematic-compiler/propose", ["POST"], CDS, { providerCredit: true }),
  ...propose("/api/schematic-compiler/variants", ["POST"], CDS),
  ...read("/api/schematic-compiler/export", ["POST"], CDS),
  ...read("/api/schematic-compiler/kicad/inspect", ["POST"], CDS),
  ...mutate("/api/schematic-compiler/transaction", ["POST"], CDS, { roles: REVIEW_EDITORS }),
  ...propose("/api/model-simulation/denominator", ["POST"], CDS),
  ...propose("/api/model-simulation/execute", ["POST"], CDS),
  ...propose("/api/model-simulation/measure", ["POST"], CDS),
  ...propose("/api/model-simulation/problem", ["POST"], CDS),
  ...propose("/api/model-simulation/propose", ["POST"], CDS),
  ...propose("/api/model-simulation/readiness", ["POST"], CDS),
  ...propose("/api/firmware-bringup/problem", ["POST"], CDS),
  ...propose("/api/firmware-bringup/propose", ["POST"], CDS),
  ...propose("/api/firmware-bringup/resources", ["POST"], CDS),
  ...propose("/api/release-engineering/problem", ["POST"], CDS),
  ...propose("/api/release-engineering/propose", ["POST"], CDS),
  ...propose("/api/full-flow/propose", ["POST"], CDS),
  ...propose("/api/full-flow/run", ["POST"], CDS),
  ...mutate("/api/full-flow/transition", ["POST"], CDS, { roles: REVIEW_EDITORS }),
  ...read("/api/footprint-resolution", ["GET"], CDS),
  ...mutate("/api/footprint-resolution", ["POST"], CDS, { roles: REVIEW_EDITORS }),
  ...read("/api/mapping-verification", ["GET"], CDS),
  ...mutate("/api/mapping-verification", ["POST"], CDS, { roles: REVIEW_EDITORS }),
  ...read("/api/passive-policy", ["GET"], CDS),
  ...mutate("/api/passive-policy", ["POST"], CDS, { roles: REVIEW_EDITORS }),

  // ── Provider-credit AI routes (were "public"/none → now authenticated) ─────
  ...propose("/api/pcb/ai-rules/from-brief", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),
  ...propose("/api/pcb/assign/suggest", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),
  ...propose("/api/pcb/edit/assist", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),
  ...propose("/api/pcb/repair/agent", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),
  ...propose("/api/schematic", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),
  ...propose("/api/schematic/build", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),
  ...propose("/api/schematic/build-multi", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),
  ...propose("/api/schematic/edit", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),
  ...propose("/api/schematic/edit-build", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),
  ...propose("/api/schematic/review", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),
  ...propose("/api/schematic/layout-critic", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),
  ...propose("/api/schematic/cross-verify", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),
  ...propose("/api/spice/ai", ["POST"], AI, { providerCredit: true, identitySource: "body-scope-server-actor" }),

  // ── Public reads / stateless compute (no project data, no credit, no write) ─
  ...pub("/api/ai/runtime", ["GET"], "static runtime config"),
  // [B19-B I2] live distributor pricing spends metered quota: an authenticated project read, declared as spending credit.
  ...read("/api/bom", ["POST"], "BOM workbench with LIVE distributor pricing (metered vendor quota; trusted project scope)").map((policy) => ({ ...policy, providerCredit: true })),
  ...pub("/api/bom/export-csv", ["POST"], "stateless export"),
  ...pub("/api/bom/procurement-packet", ["POST"], "stateless export"),
  ...pub("/api/bom/cart/digikey", ["POST"], "stateless cart payload (no funds)"),
  ...pub("/api/bom/cart/lcsc", ["POST"], "stateless cart payload (no funds)"),
  ...pub("/api/bom/cart/mouser", ["POST"], "stateless cart payload (no funds)"),
  ...pub("/api/components/atomic", ["GET"], "catalog read"),
  ...pub("/api/components/atomic/search", ["POST"], "catalog read"),
  ...pub("/api/parts/search", ["POST"], "catalog read"),
  ...pub("/api/parts/categories", ["GET"], "catalog read"),
  ...pub("/api/parts/[id]", ["GET"], "catalog read"),
  ...pub("/api/parts/[id]/alternates", ["GET"], "catalog read"),
  ...pub("/api/kicad/v1", ["GET"], "public KiCad HTTP library"),
  ...pub("/api/kicad/v1/categories.json", ["GET"], "public KiCad HTTP library"),
  ...pub("/api/kicad/v1/parts/[id]", ["GET"], "public KiCad HTTP library"),
  ...pub("/api/kicad/v1/parts/category/[id]", ["GET"], "public KiCad HTTP library"),
  ...pub("/api/pcb/footprints/[id]", ["GET"], "footprint catalog read"),
  ...pub("/api/pcb/footprints/resolve", ["GET"], "footprint catalog read"),
  ...pub("/api/pcb/footprints/search", ["GET"], "footprint catalog read"),
  ...pub("/api/pcb/placement/preview", ["POST"], "stateless compute"),
  ...pub("/api/pcb/export/kicad-pcb", ["POST"], "stateless export"),
  ...pub("/api/constraints/explain", ["POST"], "stateless compute"),
  ...pub("/api/constraints/preview", ["POST"], "stateless compute"),
  ...pub("/api/export/kicad", ["POST"], "stateless export"),
  ...pub("/api/spice/compile", ["POST"], "stateless compute"),
  ...pub("/api/spice/reports", ["POST"], "stateless compute"),
  ...pub("/api/spice/run-plans/estimate", ["POST"], "stateless compute"),

  // ── [B16.0.2 §A/§B] durable project data + process-spawning engineering
  //    compute — AUTHENTICATED, exact project scope, trusted-context identity.
  //    BOM snapshots/notifications/diff touch durable PROJECT data (server-
  //    derived tenant/project/branch ownership — never a caller projectKey or
  //    raw id); SPICE runs and EVERY child resource (bundle/events/waveforms)
  //    are bound to the trusted scope inside the job store; ngspice /
  //    freerouting / kicad-cli routes spawn external processes on caller-
  //    supplied data and therefore require active membership + an engineering
  //    role (no bounded public-use case exists for process execution).
  // ── [B18-A] agent autonomy setting: every member reads; ONLY a project administrator changes it (CSRF, audited CAS) ──
  ...read("/api/agent/autonomy", ["GET"], "agent autonomy setting + audit trail (trusted project scope; every member)"),
  ...mutate("/api/agent/autonomy", ["POST"], "agent autonomy setting change (project administrator; compare-and-set on the revision; one audit event per change)", { roles: ADMIN_ONLY }),
  ...read("/api/agent/execution-grant", ["GET"], "own execution grant read (public projection with lazy expiry; Tier 1 execute roles; a foreign or unknown id is 404 — never an existence oracle)", TIER1_EXECUTE),
  ...mutate("/api/agent/execution-grant", ["POST"], "execution grant consumption or cancellation (one-shot compare-and-set burn bound to the SAME principal, session and membership revision the grant was minted for; forged handles refused with zero writes)", { roles: TIER1_EXECUTE }),
  ...mutate("/api/agent/execution-grant/settle", ["POST"], "execution grant settlement (browser-attested outcome bound to the consumed attempt and commitment; the awaiting chat run reads the settled record only)", { roles: TIER1_EXECUTE }),
  ...read("/api/bom/snapshot", ["GET"], "durable BOM snapshot list (trusted project scope)"),
  ...mutate("/api/bom/snapshot", ["POST"], "durable BOM snapshot create (trusted project scope)", { roles: WRITE_EDITORS }),
  ...read("/api/bom/notifications", ["GET"], "durable BOM notifications list (trusted project scope)"),
  ...mutate("/api/bom/notifications", ["PATCH", "DELETE"], "durable BOM notifications mutate (trusted project scope)", { roles: WRITE_EDITORS }),
  ...read("/api/bom/diff", ["POST"], "durable BOM snapshot diff (trusted project scope; design state in a bounded JSON body, never a URL)"),
  ...read("/api/spice/runs", ["GET"], "SPICE run list (trusted project scope)"),
  ...mutate("/api/spice/runs", ["POST"], "SPICE run start — ngspice process execution (trusted project scope)", { roles: WRITE_EDITORS }),
  ...read("/api/spice/runs/[id]", ["GET"], "SPICE run read (trusted project scope)"),
  ...mutate("/api/spice/runs/[id]", ["DELETE"], "SPICE run cancel (trusted project scope)", { roles: WRITE_EDITORS }),
  ...read("/api/spice/runs/[id]/bundle", ["GET"], "SPICE run reproducibility bundle (trusted project scope)"),
  ...read("/api/spice/runs/[id]/events", ["GET"], "SPICE run SSE events (authorized before any listener)"),
  ...read("/api/spice/runs/[id]/waveforms", ["GET"], "SPICE run waveforms (trusted project scope)"),
  ...mutate("/api/spice/models/import", ["POST"], "local SPICE model import", { roles: WRITE_EDITORS }),
  ...read("/api/spice/models/smoke-test", ["POST"], "ngspice process execution on caller-supplied model", EDITORS),
  ...read("/api/simulate", ["POST"], "ngspice process execution on caller-supplied schematic", EDITORS),
  ...read("/api/pcb/autoroute", ["POST"], "freerouting (java) process execution on caller-supplied board", EDITORS),
  ...read("/api/pcb/export/gerbers", ["POST"], "kicad-cli process execution — client-working-copy ENGINEERING export only (not verified release); attribution server-derived", REVIEW_EDITORS),
];

// ── Lookup ────────────────────────────────────────────────────────────────────
const POLICY_INDEX = new Map<string, RoutePolicy>();
for (const policy of ALL) POLICY_INDEX.set(`${policy.method} ${policy.path}`, policy);

/** Match a concrete request path (e.g. `/api/parts/123`) to a policy path
 *  with dynamic `[segment]` wildcards, then the exact method. */
export function policyFor(pathname: string, method: string): RoutePolicy | null {
  const upper = method.toUpperCase();
  const direct = POLICY_INDEX.get(`${upper} ${pathname}`);
  if (direct) return direct;
  const reqSegments = pathname.split("/");
  for (const policy of ALL) {
    if (policy.method !== upper) continue;
    const polSegments = policy.path.split("/");
    if (polSegments.length !== reqSegments.length) continue;
    let matched = true;
    for (let i = 0; i < polSegments.length; i += 1) {
      const p = polSegments[i]!;
      if (p.startsWith("[") && p.endsWith("]")) continue; // dynamic segment
      if (p !== reqSegments[i]) { matched = false; break; }
    }
    if (matched) return policy;
  }
  return null;
}

/** All policies (for the CI gate + the coverage renderer). */
export function allRoutePolicies(): readonly RoutePolicy[] { return ALL; }

// ── Coverage CSV ──────────────────────────────────────────────────────────────
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function renderExactRoutePolicyCsv(): string {
  const header = ["path", "method", "auth_class", "identity_source", "requires_auth", "permitted_roles", "required_capability", "provider_credit", "requires_csrf", "authoritative_write", "release_or_qualification", "evidence"];
  const rows = [...ALL]
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
    .map((p) => [
      p.path, p.method, p.authClass, p.identitySource, String(p.requiresAuth),
      p.permittedRoles.join(";"), p.requiredCapability ?? "", String(p.providerCredit),
      String(p.requiresCsrf), String(p.authoritativeWrite), String(p.releaseOrQualification), p.evidence,
    ].map(csvCell).join(","));
  return [header.join(","), ...rows].join("\n") + "\n";
}
