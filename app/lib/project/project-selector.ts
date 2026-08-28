/**
 * [B16.0.2 §B] the browser-side project SELECTOR helpers.
 *
 * A selector names the project/branch a request is ABOUT. It is never
 * authority: the server resolves identity from the session cookie and loads
 * the caller's live membership for exactly this scope
 * (`resolveTrustedRequestContext`). Clients send ONLY selectors and data —
 * never an actor id, role, project key, or ownership claim.
 *
 * Two transports exist because two browser surfaces exist:
 *  - `projectSelectorHeaders` — the `x-sirkit-tenant-id/-project-id/-branch-id`
 *    selector headers for `fetch`;
 *  - `projectSelectorQuery` — the same selector as query parameters for
 *    surfaces that cannot set headers (EventSource, anchor downloads). Only
 *    opaque ids travel in a URL; design data never does.
 *
 * This module is browser-safe and imports nothing from the server auth tree.
 */

export interface ProjectSelectorScope {
  tenantId: string;
  projectId: string;
  branchId: string;
}

export function projectSelectorHeaders(scope: ProjectSelectorScope | null | undefined): Record<string, string> {
  if (!scope) return {};
  return {
    "x-sirkit-tenant-id": scope.tenantId,
    "x-sirkit-project-id": scope.projectId,
    "x-sirkit-branch-id": scope.branchId,
  };
}

export function projectSelectorQuery(scope: ProjectSelectorScope | null | undefined): string {
  if (!scope) return "";
  return new URLSearchParams({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId }).toString();
}

/** Append the selector query to a URL that may already carry a query string. */
export function withProjectSelectorQuery(url: string, scope: ProjectSelectorScope | null | undefined): string {
  const query = projectSelectorQuery(scope);
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}
