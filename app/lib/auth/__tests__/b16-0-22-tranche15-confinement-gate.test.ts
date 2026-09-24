/**
 * B16.0.22 §H — confinement + authority gates for the tranche-15 migration
 * (assignment-queue, footprint-resolution, passive-policy, pcb-sync,
 * physical-bindings, replacement-authority). Reverting any migrated method to
 * a raw handler, re-introducing raw-Request primitives into a route file,
 * widening the legacy refusal contract, or dropping a preserved ceiling /
 * deadline / safe-header / forbidden-key screen fails CI here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm } from "./_boundary-analysis";
import { listRouteFiles } from "../route-tree"; // [B20 B2] app/api AND app/.well-known (OD-66); the sole-adopter paths below stay split on /app/api/
import { ASSIGNMENT_API_DEADLINE_MS, ASSIGNMENT_API_MAX_BYTES, ASSIGNMENT_FORBIDDEN_BODY_KEYS } from "../../../api/assignment-queue/_scope";
import { FOOTPRINT_RESOLUTION_API_DEADLINE_MS, FOOTPRINT_RESOLUTION_API_MAX_BYTES } from "../../../api/footprint-resolution/_scope";
import { PHYSICAL_BINDING_API_DEADLINE_MS, PHYSICAL_BINDING_API_MAX_BYTES } from "../../../api/physical-bindings/_scope";
import { PASSIVE_POLICY_API_MAX_BYTES } from "../../../api/passive-policy/_scope";

const ROOT = process.cwd();
const METHODS: ReadonlyArray<[string, string]> = [
  ["GET", "app/api/assignment-queue/route.ts"],
  ["POST", "app/api/assignment-queue/route.ts"],
  ["POST", "app/api/footprint-resolution/route.ts"],
  ["GET", "app/api/passive-policy/route.ts"],
  ["GET", "app/api/pcb-sync/route.ts"],
  ["GET", "app/api/physical-bindings/route.ts"],
  ["POST", "app/api/physical-bindings/route.ts"],
  ["POST", "app/api/replacement-authority/route.ts"],
];
const ROUTES = [...new Set(METHODS.map(([, rel]) => rel))];

/** Source with comments AND string literals removed — gates inspect CODE only. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}
function raw(rel: string): string { return readFileSync(join(ROOT, rel), "utf8"); }

describe("B16.0.22 §H — canonical adoption (provenance-checked)", () => {
  it("all eight tranche-15 methods classify canonical-wrapper", () => {
    for (const [method, rel] of METHODS) {
      const c = classifyRouteMethodForm(raw(rel), method, join(ROOT, rel), ROOT);
      expect(c.form, `${method} ${rel}`).toBe("canonical-wrapper");
    }
  });
  it("no tranche-15 route file touches raw-Request primitives or the legacy scoped helpers", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/new URL\s*\(/);
      expect(src, rel).not.toMatch(/request\s*\.\s*(json|text|body|headers|url|signal)/);
      expect(src, rel).not.toMatch(/searchParams/);
      expect(src, rel).not.toMatch(/readBoundedStream|isJsonContentType|readBoundedJson/);
      expect(src, rel).not.toMatch(/\b(assignmentApiScope|scopedAssignmentJson|scopedResolutionJson|resolutionScope|passivePolicyApiScope|scopedPassivePolicyJson|pcbSyncScope|scopedPcbSyncJson|bindingScope|scopedBindingJson)\s*\(/);
    }
  });
});

describe("B16.0.22 §H — preserved ceilings, deadlines, and screens", () => {
  it("family ceilings and deadlines are the verified historical values", () => {
    expect(ASSIGNMENT_API_MAX_BYTES).toBe(1_000_000);
    expect(ASSIGNMENT_API_DEADLINE_MS).toBe(30_000);
    expect(FOOTPRINT_RESOLUTION_API_MAX_BYTES).toBe(4_000_000);
    expect(FOOTPRINT_RESOLUTION_API_DEADLINE_MS).toBe(30_000);
    expect(PHYSICAL_BINDING_API_MAX_BYTES).toBe(2_000_000);
    expect(PHYSICAL_BINDING_API_DEADLINE_MS).toBe(30_000);
    expect(PASSIVE_POLICY_API_MAX_BYTES).toBe(64_000);
  });
  it("replacement-authority declares the exact historical 16,384-byte ceiling, 10 s read deadline, and the v1 legacy refusal contract", () => {
    const src = raw("app/api/replacement-authority/route.ts");
    expect(src).toMatch(/MAX_BODY_BYTES = 16_384/);
    expect(src).toMatch(/REQUEST_READ_DEADLINE_MS = 10_000/);
    expect(src).toMatch(/legacyReaderRefusals:\s*"replacement-authority-v1"/);
    expect(src).toMatch(/exposeAbortSignal:\s*true/);
  });
  it("the v1 legacy refusal table in the canonical module carries the exact historical envelopes (aborted settles 408)", () => {
    const src = raw("app/lib/auth/route-handlers.ts");
    for (const envelope of [
      "request body exceeds the bounded limit",
      "request body was not received within the read deadline",
      "request aborted before the body completed",
      "unreadable request body",
      "request body is not valid UTF-8",
      "request body is not valid JSON",
      "request body must be an object",
    ]) expect(src).toContain(envelope);
    expect(src).toMatch(/aborted:\s*\{\s*status:\s*408/);
    // The option is a CLOSED enum — no free-form escape. [B16.0.24] it gained a
    // second member ("auth-signin-v1"); it remains a closed string-literal
    // union, never an arbitrary string.
    expect(src).toMatch(/legacyReaderRefusals\?:\s*"replacement-authority-v1"\s*\|\s*"auth-signin-v1";/);
  });
  it("the legacy refusal contract has EXACTLY two closed-enum adopters, each with its own frozen profile [B16.0.24]", () => {
    // replacement-authority → replacement-authority-v1; sign-in → auth-signin-v1.
    // Any OTHER adopter, or a free-form profile, fails CI.
    const adopters = listRouteFiles(ROOT)
      .filter((file) => readFileSync(file, "utf8").includes("legacyReaderRefusals"))
      .map((file) => file.replace(/\\/g, "/").split("/app/api/")[1]!)
      .sort();
    expect(adopters).toEqual(["auth/signin/route.ts", "replacement-authority/route.ts"]);
    expect(raw("app/api/replacement-authority/route.ts")).toMatch(/legacyReaderRefusals:\s*"replacement-authority-v1"/);
    expect(raw("app/api/auth/signin/route.ts")).toMatch(/legacyReaderRefusals:\s*"auth-signin-v1"/);
  });
  it("assignment-queue: the commit header travels ONLY through the declared safe-header allowlist; the forbidden-authority screen precedes feature-state work", () => {
    const src = raw("app/api/assignment-queue/route.ts");
    expect(src).toMatch(/safeHeaders:\s*\["x-sirkit-assignment-commit"\]/);
    expect(src).toMatch(/meta\.headers\?\.\["x-sirkit-assignment-commit"\]/);
    const screen = src.indexOf("assignmentForbiddenAuthorityRefusal(body)");
    const state = src.indexOf("assignmentQueueFeatureState()", src.indexOf("export const POST"));
    expect(screen).toBeGreaterThan(0);
    expect(state).toBeGreaterThan(screen);
    expect([...ASSIGNMENT_FORBIDDEN_BODY_KEYS]).toEqual(["sourceBundle", "binding", "mappingRecord", "policyRecord", "board", "path", "url"]);
  });
  it("footprint-resolution threads the abort signal ONLY through the declared exposeAbortSignal input", () => {
    const src = raw("app/api/footprint-resolution/route.ts");
    expect(src).toMatch(/exposeAbortSignal:\s*true/);
    expect(code("app/api/footprint-resolution/route.ts")).not.toMatch(/request\s*\.\s*signal/);
  });
  it("the pcb-sync legacy Request adapter retains the historical duplicated-key refusal; the canonical route dispatches through the Request-free core", () => {
    expect(raw("app/api/pcb-sync/handler.ts")).toMatch(/getAll\(key\)\.length > 1/);
    const src = raw("app/api/pcb-sync/route.ts");
    expect(src).toMatch(/createPcbSyncBoardGetCore/);
    expect(src).not.toMatch(/createPcbSyncBoardGetHandler/);
  });
});
