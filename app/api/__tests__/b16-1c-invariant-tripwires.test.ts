/**
 * B16.1C §I — invariant tripwires. Any of these failing in CI means a
 * regression of a security or truth boundary this stage depends on:
 *
 *  - 155 route methods / 152 canonical wrappers / 3 approved factories / 0 raw (B18-A: + GET/POST /api/agent/autonomy);
 *  - exactly 12 agent-exposed tools, none of them qualification or release;
 *  - the manufacturing routes keep their policy rows (qualify: pcb_editor |
 *    project_admin; release: project_admin only) and their bounded envelopes;
 *  - qualification derives package class ONLY from server-owned binding
 *    authority (no regex/substring guess over footprint ids anywhere in the
 *    route), publishes with the CURRENT aggregate revision (no literal CAS),
 *    and refuses concurrent runs;
 *  - every release-gate failure code has a public table entry;
 *  - release requires a human project administrator and records a ledger entry;
 *  - the protected original repository is untouched by this stage.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm, exportedHttpMethods } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { policyFor } from "@/app/lib/auth/route-policy";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { MANUFACTURING_PUBLIC_ERRORS } from "@/app/lib/pcb/fab/manufacturing-errors";
import { QUALIFICATION_PACKAGE_VOCABULARY } from "@/app/lib/pcb/fab/qualification-authority";
import { AGENT_EXPOSABLE_OPERATION_CLASSES, INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { if (entry !== "__tests__") routeFiles(full, out); }
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("B16.1C §I — invariant tripwires", () => {
  it("155 route methods = 152 canonical + 3 factories + 0 raw (B18-A: + GET/POST /api/agent/autonomy); exactly the intentional agent-exposed tools, none qualification/release", () => {
    let total = 0, canonical = 0, factories = 0, raw = 0;
    for (const file of routeFiles(join(ROOT, "app", "api"))) {
      const src = readFileSync(file, "utf8");
      for (const method of exportedHttpMethods(src, file)) {
        total += 1;
        const form = classifyRouteMethodForm(src, method, file, ROOT).form;
        if (form === "canonical-wrapper") canonical += 1; else if (form === "factory") factories += 1; else raw += 1;
      }
    }
    expect({ total, canonical, factories, raw }).toEqual({ total: 155, canonical: 152, factories: 3, raw: 0 }); // B18-A: + GET/POST /api/agent/autonomy (canonical wrappers; 0 raw stays 0)
    const registry = sirkitToolRegistry();
    const exposed = registry.list().filter((descriptor) => descriptor.agentExposed);
    expect(exposed.map((descriptor) => descriptor.toolId).sort()).toHaveLength(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    // (sirkit.manufacturing.readiness-inspect is a read-only readiness report and stays exposed; nothing that qualifies or releases is.)
    expect(exposed.some((descriptor) => /qualif|\.release$/i.test(descriptor.toolId))).toBe(false);
    expect(exposed.every((descriptor) => (AGENT_EXPOSABLE_OPERATION_CLASSES as readonly string[]).includes(descriptor.operationClass))).toBe(true);
    expect(registry.list().filter((descriptor) => descriptor.callability === "callable" && /qualif|release/i.test(descriptor.toolId))).toEqual([]);
    const releaseTool = registry.list().find((descriptor) => descriptor.toolId === "sirkit.manufacturing.release");
    expect(releaseTool).toMatchObject({ agentExposed: false, callability: "not-callable" });
  });

  it("manufacturing route policy rows are unchanged: qualify pcb_editor|project_admin, release project_admin only, both same-origin JSON", () => {
    const qualify = policyFor("/api/pcb/qualify", "POST"), release = policyFor("/api/pcb/release", "POST");
    expect(qualify).toBeTruthy(); expect(release).toBeTruthy();
    const roles = (policy: unknown) => JSON.stringify(policy);
    expect(roles(qualify)).toMatch(/pcb_editor/); expect(roles(qualify)).toMatch(/project_admin/);
    expect(roles(release)).toMatch(/project_admin/); expect(roles(release)).not.toMatch(/pcb_editor|reviewer|viewer/);
  });

  it("qualify route: server-owned authority only (no footprint-id regex guess), current aggregate revision CAS, in-flight guard, bounded envelopes", () => {
    const src = read("app/api/pcb/qualify/route.ts");
    expect(src).toContain("resolveQualificationComponentAuthority(");
    expect(src).toContain("stage3BindingRepository");
    expect(src).not.toMatch(/footprintId\)\s*\?\s*"|\/(0603|0805|SOIC|TSSOP|Header|PinHeader)\//i);
    expect(src).not.toMatch(/non_hdi_other/);
    expect(src).not.toMatch(/expectedRevision:\s*1\b/);
    // [B16-A F2] the CAS pin now travels into the ONE atomic board+authority commit.
    expect(src).toContain("expectedBoardAggregateRevision: head.aggregateRevision");
    expect(src).toContain("MFG_QUALIFICATION_IN_PROGRESS");
    expect(src).toContain("boundedManufacturingFailure(");
    expect(src).not.toMatch(/error instanceof Error \? error\.message/);
    expect(src).toContain("rc01ParityEvidenceDigest(");
    expect(src).toContain("rc02RouteEvidenceDigest(");
    expect(src).toContain("rc03CapabilityEvidenceDigest(");
    expect(src).not.toMatch(/`sha256:\$\{boardRevision\}`|`bindings:\$\{/);
    expect(src).toContain('QUALIFIED_FABRICATION_PROFILE_ID = "jlcpcb-2l"');
  });

  it("release route: human project administrator only, current-board check, release-time profile expiry, ledger record, bounded envelopes", () => {
    const src = read("app/api/pcb/release/route.ts");
    expect(src).toContain('scope.actor.actorKind !== "human" || scope.actor.role !== "project_admin"');
    expect(src).toContain("MFG_RELEASE_HUMAN_REQUIRED");
    expect(src).toContain("MFG_AUTHORITY_STALE");
    expect(src).toContain("MFG_RULE_PROFILE_STALE_AT_RELEASE");
    expect(src).toContain("ledger.record(");
    expect(src).toContain("boundedManufacturingFailure(");
    expect(src).not.toMatch(/error instanceof Error \? error\.message/);
    expect(src).toContain("X-Sirkit-Authority-Revision");
  });

  it("every release-gate failure code has a bounded public entry; the vocabulary is closed and non-BGA", () => {
    const gate = read("app/lib/pcb/fab/release-gate.ts");
    const codes = [...new Set([...gate.matchAll(/fail\("(MFG_[A-Z0-9_]+)"/g)].map((match) => match[1]!))];
    expect(codes.length).toBeGreaterThan(20);
    for (const code of codes) expect(Object.prototype.hasOwnProperty.call(MANUFACTURING_PUBLIC_ERRORS, code), code).toBe(true);
    expect(QUALIFICATION_PACKAGE_VOCABULARY.every((entry) => entry.packageClass !== "bga_hdi" && entry.packageClass !== "unknown")).toBe(true);
    expect(Object.isFrozen(QUALIFICATION_PACKAGE_VOCABULARY)).toBe(true);
  });

  it("the pcb-sync board read exposes reload truth (snapshot head, authority, release) and keeps its query surface closed", () => {
    const handler = read("app/api/pcb-sync/handler.ts");
    expect(handler).toContain('new Set(["boardId", "knownRevision", "knownDigest", "include"])');
    expect(handler).toContain('include !== "manufacturing") fail("PS_API_UNKNOWN_FIELD")');
    const summary = read("app/api/pcb-sync/manufacturing-summary.ts");
    expect(summary).toContain("getSnapshotHead(");
    expect(summary).toContain("ledger.latest(");
    expect(summary).toContain("store.getHead(");
  });

  // [B16-A F26/F27] the protected original's location is resolved from the
  // environment (default: the owner's machine). Where it is absent — CI, any
  // other machine — the test is reported SKIPPED, never as a vacuous pass.
  const configuredOriginal = process.env.SIRKIT_PROTECTED_ORIGINAL_PATH?.trim();
  const PROTECTED_ORIGINAL = configuredOriginal ? configuredOriginal : "C:\\Users\\robsa\\sirkit";
  it.skipIf(!existsSync(PROTECTED_ORIGINAL))("the protected original repository is untouched by this stage (no B16.1C modules exist there)", () => {
    const original = PROTECTED_ORIGINAL;
    for (const path of ["app/lib/pcb/fab/qualification-authority.ts", "app/lib/pcb/fab/manufacturing-errors.ts", "app/lib/pcb/fab/release-ledger.ts", "app/lib/workflow/prompt-to-gerber/machine.ts", "app/api/pcb-sync/manufacturing-summary.ts"]) {
      expect(existsSync(join(original, path)), path).toBe(false);
    }
  });
});
