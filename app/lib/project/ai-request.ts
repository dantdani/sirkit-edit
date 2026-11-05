/**
 * [PR-C] The ONE request preparation every AI request from the page uses: the project/branch SELECTOR headers the canonical
 * route wrapper reads (`resolveTrustedRequestContext`), beside the JSON content type. A selector is never authority — the
 * server still loads the caller's live membership for exactly that scope — so this helper confers nothing; it only makes
 * the request well-formed. Build mode sent these headers since B16.0.2; the Theory client (`lib/apply-netlist.ts`) sent
 * none and was refused 400 AUTH_PROJECT_SELECTOR_REQUIRED before any provider work (reproductions R1).
 *
 * Browser-safe; imports nothing from the server auth tree.
 */
import { projectSelectorHeaders } from "./project-selector";

/** The scope an AI request is ABOUT: the active project (null before one exists) and its branch. */
export interface AiRequestScope {
  projectId: string | null;
  branchId: string;
}

/** `Content-Type: application/json` plus the selector headers (none while no project exists: the server then refuses, by design). */
export function aiRequestHeaders(scope: AiRequestScope): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...projectSelectorHeaders(scope.projectId ? { tenantId: "local", projectId: scope.projectId, branchId: scope.branchId } : null),
  };
}
