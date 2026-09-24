/**
 * B01 action-surface scanners.
 *
 * Node-only helpers (fs access) shared by the coverage CI test and the matrix
 * generator. They read the repository AS IT IS — an API route or UI control
 * exists only if its source file says so. Never import this from client code.
 */

import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { listRouteFiles, routePathOf } from "../auth/route-tree";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface ScannedApiRoute {
  /** Repo-relative POSIX path of the route file, e.g. "app/api/chat/route.ts". */
  file: string;
  /** URL path, e.g. "/api/chat" (dynamic segments kept as "[id]"). */
  path: string;
  methods: HttpMethod[];
}

/** Extract the HTTP methods a Next.js route module actually exports. */
export function extractRouteMethods(source: string): HttpMethod[] {
  const found = new Set<HttpMethod>();
  for (const method of HTTP_METHODS) {
    const patterns = [
      new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`),
      new RegExp(`export\\s+const\\s+${method}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`),
    ];
    if (patterns.some((pattern) => pattern.test(source))) found.add(method);
  }
  return [...found].sort();
}

/** Enumerate every route file (app/api and app/.well-known, through the one route-tree helper: [B20 B2] OD-66) and its
 *  exported methods from the filesystem. */
export function scanApiRoutes(cwd: string): ScannedApiRoute[] {
  return listRouteFiles(cwd)
    .map((file) => {
      const rel = relative(cwd, file).split(sep).join("/");
      return { file: rel, path: routePathOf(cwd, file), methods: extractRouteMethods(readFileSync(file, "utf8")) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * UI files whose actionable controls the B01 tripwire watches. Adding an
 * actionable control (a labelled/titled button) to these surfaces without
 * updating the action registry and the committed fingerprint fails CI.
 */
export const UI_CONTROL_SURFACES = [
  "app/page.tsx",
  "app/components/pcb/PcbEditor.tsx",
  "app/components/pcb/PcbToolbar.tsx",
  "app/components/pcb/SyncButton.tsx",
  "app/components/pcb/FabDialog.tsx",
  "app/components/pcb/DrcPanel.tsx",
  "app/components/pcb/BoardRepairPanel.tsx",
  "app/components/pcb/AssignmentQueuePanel.tsx",
  "app/components/pcb/RoutingRulesPanel.tsx",
  "app/components/pcb/AssistBox.tsx",
  "app/components/pcb/CommandPalette.tsx",
  "app/components/pcb/SyncPlacementDialog.tsx",
  "app/components/pcb/GrantedExecutionDialog.tsx", // [B18-D I5] the confirmation card joins the watched surfaces (OD-17 D5)
  "app/components/chat/ExecutionEntryActions.tsx", // [B18-D I8] the chat entry's Undo
  "app/components/chat/AutonomyModeControl.tsx", // [B18-D I11] the agent autonomy control
  "app/components/editor/BuildLibraryPanel.tsx",
  "app/components/bom/BomView.tsx",
] as const;

/**
 * Extract the stable, human-authored control labels (button aria-label and
 * title string literals) from one UI surface. Labels are the repository's own
 * convention for actionable controls, which makes them a low-noise fingerprint
 * for "a new control appeared".
 */
export function extractUiControlLabels(source: string): string[] {
  const labels = new Set<string>();
  for (const match of source.matchAll(/(?:aria-label|title)=(?:"([^"]+)"|\{`([^`]+)`\}|\{"([^"]+)"\})/g)) {
    const label = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    // Template-literal labels with interpolation are dynamic states of one
    // control, not distinct controls — collapse them.
    if (label.length > 0) labels.add(label.replace(/\$\{[^}]*\}/g, "*"));
  }
  return [...labels].sort();
}

export interface UiControlFingerprint {
  schemaVersion: 1;
  surfaces: Record<string, string[]>;
}

export function scanUiControlFingerprint(cwd: string): UiControlFingerprint {
  const surfaces: Record<string, string[]> = {};
  for (const file of UI_CONTROL_SURFACES) {
    surfaces[file] = extractUiControlLabels(readFileSync(join(cwd, file), "utf8"));
  }
  return { schemaVersion: 1, surfaces };
}
