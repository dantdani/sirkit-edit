/**
 * B16.0 §CI gates — the identity-header and browser-secret source gates.
 *
 * Built on the B14.4/B15.3 AST engine (`_import-gate-helpers`). Pins:
 *  - the migrated release-perimeter routes read NONE of the forbidden
 *    identity headers (`x-sirkit-role` / `x-sirkit-actor-kind` /
 *    `x-sirkit-actor-id`);
 *  - EVERY `app/api` file that still reads a forbidden identity header lies
 *    within the documented legacy-migration backlog (a NEW route reading one
 *    outside that backlog trips the gate);
 *  - no browser/client module imports the server auth core;
 *  - the worker boundary can never produce a human actor;
 *  - negative tripwires for each.
 */

import { describe, expect, it } from "vitest";
import {
  collectProductionFiles,
  identifierReferences,
  moduleImportOffenders,
} from "@/app/lib/project/__tests__/_import-gate-helpers";
import { LEGACY_HEADER_SCOPE_PATH_PREFIXES } from "@/app/lib/auth/route-coverage";
import { workerActor } from "@/app/lib/auth/worker-principal";

const files = collectProductionFiles();

const FORBIDDEN_IDENTITY_HEADERS = ["x-sirkit-role", "x-sirkit-actor-kind", "x-sirkit-actor-id"] as const;

/** The migrated release-perimeter files — server-derived identity, ZERO
 *  forbidden-header reads. */
const MIGRATED_PERIMETER_FILES = [
  "app/api/pcb-sync/_scope.ts",
  "app/api/physical-bindings/_scope.ts",
  "app/api/assignment-queue/_scope.ts",
  "app/api/pcb/qualify/route.ts",
  "app/api/pcb/release/route.ts",
];

/** Map a legacy path prefix to its `app/api/<prefix>/…` file-path prefix. */
const LEGACY_FILE_PREFIXES = LEGACY_HEADER_SCOPE_PATH_PREFIXES.map((p) => "app/api/" + p.replace(/^\/api\//, ""));

describe("B16.0 §CI — the migrated release perimeter reads no forbidden identity headers", () => {
  it("pcb-sync / physical-bindings / assignment-queue / qualify / release read NONE of the forbidden identity headers", { timeout: 120_000 }, () => {
    for (const header of FORBIDDEN_IDENTITY_HEADERS) {
      const readers = identifierReferences(files, header, new Set());
      for (const migrated of MIGRATED_PERIMETER_FILES) {
        expect(readers, `${migrated} must not read ${header}`).not.toContain(migrated);
      }
    }
  });

  it("EVERY app/api file that reads a forbidden identity header is within the documented legacy backlog", { timeout: 120_000 }, () => {
    for (const header of FORBIDDEN_IDENTITY_HEADERS) {
      const readers = identifierReferences(files, header, new Set()).filter((f) => f.startsWith("app/api/"));
      for (const reader of readers) {
        const inBacklog = LEGACY_FILE_PREFIXES.some((prefix) => reader === prefix || reader.startsWith(prefix + "/"));
        expect(inBacklog, `${reader} reads ${header} but is NOT in the documented legacy backlog — migrate it or add it to LEGACY_HEADER_SCOPE_PATH_PREFIXES`).toBe(true);
      }
    }
  });

  it("NEGATIVE tripwire: a NEW route outside the backlog reading x-sirkit-role trips the gate", { timeout: 120_000 }, () => {
    const injected = new Map(files);
    injected.set("app/api/evil/route.ts", 'export async function POST(request: Request) { const r = request.headers.get("x-sirkit-role"); return Response.json({ r }); }');
    const readers = identifierReferences(injected, "x-sirkit-role", new Set()).filter((f) => f.startsWith("app/api/"));
    expect(readers).toContain("app/api/evil/route.ts");
    const inBacklog = LEGACY_FILE_PREFIXES.some((prefix) => "app/api/evil/route.ts".startsWith(prefix + "/") || "app/api/evil/route.ts" === prefix);
    expect(inBacklog).toBe(false);
  });
});

describe("B16.0 §CI — the server auth core is not reachable from the browser", () => {
  const SERVER_ONLY_AUTH_MODULES = [
    "app/lib/auth/identity-provider",
    "app/lib/auth/postgres-membership",
    "app/lib/auth/worker-principal",
    "app/lib/auth/constant-time",
    "app/lib/auth/identity-runtime",
    "app/lib/auth/trusted-request-context",
  ];
  // Approved importers: the auth core itself, the migrated route scopes, and
  // the request pipeline. Client modules must never appear.
  function isClientModule(file: string): boolean {
    if (file.startsWith("app/components/")) return true;
    const source = files.get(file) ?? "";
    return /^\s*["']use client["']/m.test(source);
  }

  it("no browser/client module imports the server auth core", { timeout: 120_000 }, () => {
    for (const mod of SERVER_ONLY_AUTH_MODULES) {
      // Everything is "approved" for the module gate; we then filter offenders
      // to client modules — a client importer is the violation.
      const allFiles = new Set([...files.keys()]);
      const offenders = moduleImportOffenders(files, mod, allFiles).filter(isClientModule);
      // (approved = all → base offenders empty; recompute against empty set)
      const clientImporters = moduleImportOffenders(files, mod, new Set()).filter(isClientModule);
      expect(offenders).toEqual([]);
      expect(clientImporters, `${mod} must not be imported by a client module`).toEqual([]);
    }
  });

  it("NEGATIVE tripwire: a client component importing the trusted-context resolver trips the gate", { timeout: 120_000 }, () => {
    const injected = new Map(files);
    injected.set("app/components/EvilAuthPanel.tsx", '"use client";\nimport { resolveTrustedRequestContext } from "@/app/lib/auth/trusted-request-context";\nexport function X() { return null; }');
    const clientImporters = moduleImportOffenders(injected, "app/lib/auth/trusted-request-context", new Set()).filter((f) => f.startsWith("app/components/"));
    expect(clientImporters).toContain("app/components/EvilAuthPanel.tsx");
  });
});

describe("B16.0 §CI — the worker boundary can never produce a human", () => {
  it("the worker actor is a machine kind", () => {
    expect(workerActor().actorKind).not.toBe("human");
    expect(["automated_engine", "system_migration", "import_adapter"]).toContain(workerActor().actorKind);
  });
});
