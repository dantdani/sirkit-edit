/**
 * B16.0 — the authentication-route coverage registry.
 *
 * Reuses the B01 `API_ROUTE_COVERAGE` enumeration (which CI already keeps
 * in exact sync with the `app/api` tree) and adds the AUTHENTICATION
 * dimension: how each route establishes identity, and its auth class. This is
 * the source of the committed `auth-route-coverage.csv` and the input to the
 * B16.0 CI gates.
 */

import { API_ROUTE_COVERAGE, type ApiRouteCoverageEntry } from "../engineering/action-registry";
import { allRoutePolicies } from "./route-policy";

/** The authentication class of a route. */
export type AuthRouteClass =
  | "public"
  | "authenticated-read"
  | "authenticated-propose"
  | "authenticated-mutation"
  | "authenticated-release"
  | "internal-worker"
  | "demo-deprecated"
  /** [B20 B2] the bearer-authenticated MCP endpoint (OD-54) */
  | "authenticated-mcp";

/** How a route establishes request identity today. */
export type IdentitySource =
  /** Migrated to `resolveTrustedRequestContext` (server-derived identity). */
  | "trusted-context"
  /** Server-derived body scope + a server-synthesized actor (chat family). */
  | "body-scope-server-actor"
  /** A constant-time worker/service secret (no human identity). */
  | "worker-secret"
  /** No identity — a public/catalog/compute route. */
  | "none"
  /** LEGACY: still reads `x-sirkit-*` identity headers — migration pending. */
  | "legacy-header-scope"
  /** [B20 B2] a Sirkit-issued MCP access token re-checked against the LIVE membership (OD-43). */
  | "mcp-bearer";

export interface AuthRouteCoverageEntry {
  path: string;
  methods: readonly string[];
  authClass: AuthRouteClass;
  identitySource: IdentitySource;
  /** True once the route derives identity through `TrustedRequestContext`. */
  migrated: boolean;
}

/**
 * [B16.0.1 §A/§I — SUPERSESSION] The B16.0 model classified identity through
 * coarse per-family PATH-PREFIX sets, including a documented
 * `legacy-header-scope` migration backlog that legitimized whole route
 * families (R6). B16.0.1 replaced that model with the EXACT method-aware
 * policy table in `route-policy.ts` — every route/method has one explicit
 * row, `authorizeRequest` enforces it at runtime, and the §I CI gates pin the
 * bijection. This module now DERIVES its per-path view from that one source
 * of truth, and the legacy backlog is EMPTY: zero production routes read a
 * caller-identity header, and the B16.0 forbidden-header gate therefore
 * pins the whole `app/api` tree at zero readers.
 */
export const LEGACY_HEADER_SCOPE_PATH_PREFIXES: readonly string[] = [];

const IDENTITY_PRECEDENCE: readonly IdentitySource[] = ["worker-secret", "trusted-context", "body-scope-server-actor", "mcp-bearer"];
const AUTH_CLASS_PRECEDENCE: readonly AuthRouteClass[] = [
  "authenticated-release", "authenticated-mutation", "authenticated-propose", "authenticated-mcp", "authenticated-read", "internal-worker", "public",
];

function policyRowsFor(path: string) {
  return allRoutePolicies().filter((row) => row.path === path);
}

function identitySourceFor(path: string): IdentitySource {
  const rows = policyRowsFor(path);
  for (const source of IDENTITY_PRECEDENCE) {
    if (rows.some((row) => row.identitySource === source)) return source;
  }
  return "none";
}

function authClassFor(entry: ApiRouteCoverageEntry, identitySource: IdentitySource): AuthRouteClass {
  const rows = policyRowsFor(entry.path);
  // The strictest class across the path's methods (e.g. GET read + POST
  // mutate reports authenticated-mutation).
  for (const authClass of AUTH_CLASS_PRECEDENCE) {
    if (rows.some((row) => row.authClass === authClass)) return authClass;
  }
  // No policy row: unreachable while the §I bijection gate holds — reported
  // truthfully as the legacy latent-gap class rather than invented.
  return identitySource === "none" && entry.class !== "read" && entry.class !== "propose" ? "demo-deprecated" : "public";
}

export function buildAuthRouteCoverage(coverage: readonly ApiRouteCoverageEntry[] = API_ROUTE_COVERAGE): AuthRouteCoverageEntry[] {
  return [...coverage]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => {
      const identitySource = identitySourceFor(entry.path);
      return {
        path: entry.path,
        methods: entry.methods,
        authClass: authClassFor(entry, identitySource),
        identitySource,
        migrated: identitySource === "trusted-context" || identitySource === "body-scope-server-actor" || identitySource === "worker-secret" || identitySource === "mcp-bearer",
      };
    });
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function renderAuthRouteCoverageCsv(coverage: readonly ApiRouteCoverageEntry[] = API_ROUTE_COVERAGE): string {
  const header = ["path", "methods", "auth_class", "identity_source", "migrated"];
  const rows = buildAuthRouteCoverage(coverage).map((entry) => [
    entry.path,
    entry.methods.join(";"),
    entry.authClass,
    entry.identitySource,
    entry.migrated ? "yes" : "no",
  ].map(csvCell).join(","));
  return [header.join(","), ...rows].join("\n") + "\n";
}
