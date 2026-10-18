/**
 * B16.1C §I — invariant tripwires. Any of these failing in CI means a
 * regression of a security or truth boundary this stage depends on:
 *
 *  - 174 route methods / 171 canonical wrappers / 3 approved factories / 0 raw ([PR-L, 2026-10-17] was 168 / 165: + the six methods of the durable generation task (runbook L.4); [B24-A1, 2026-10-06] was 166 / 163: + GET /api/health and GET /api/ready, OD-198; [B23-B1, 2026-10-03] was 165 / 162: + POST /api/pcb/provider-exchange, OD-174; B18-A: + GET/POST /api/agent/autonomy; B18-B:
 *    + GET/POST /api/agent/execution-grant and POST /api/agent/execution-grant/settle; B19-E E2: + POST
 *    /api/parts/external-search; B19-E E4: + GET/POST /api/components/atomic/publication; B19-E E5: + POST
 *    /api/components/revision-status; B20-B2: + POST /api/mcp, POST /api/mcp/token and GET
 *    /.well-known/oauth-protected-resource/api/mcp, the census walking app/api AND app/.well-known) — [B18-E E6] the title and this line
 *    said 155 / 152 long after B18-B added its three canonical wrappers; the assertion itself was always the ratchet, and
 *    [B19-E E2 review] it now checks this line too;
 *  - exactly the intentional agent-exposed tools (agent-exposure.ts), none of them qualification or release;
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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm, exportedHttpMethods } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { policyFor } from "@/app/lib/auth/route-policy";
import { listRouteFiles } from "@/app/lib/auth/route-tree"; // [B20 B2] the census walks app/api AND app/.well-known (OD-66)
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { MANUFACTURING_PUBLIC_ERRORS } from "@/app/lib/pcb/fab/manufacturing-errors";
import { QUALIFICATION_PACKAGE_VOCABULARY } from "@/app/lib/pcb/fab/qualification-authority";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("B16.1C §I — invariant tripwires", () => {
  it("174 route methods = 171 canonical + 3 factories + 0 raw ([PR-L, 2026-10-17] + the six generation-task methods; [B24-A1, 2026-10-06] + health and readiness; [B23-B1, 2026-10-03] + the provider exchange; B18-A: + the autonomy pair; B18-B: + the execution-grant trio; B19-E E2: + the external candidate search; B19-E E4: + the atomic publication review pair; B19-E E5: + the revision status read; B20-B2: + the MCP endpoint, its token route and its protected-resource metadata); exactly the intentional agent-exposed tools, none qualification/release", () => {
    let total = 0, canonical = 0, factories = 0, raw = 0;
    for (const file of listRouteFiles(ROOT)) {
      const src = readFileSync(file, "utf8");
      for (const method of exportedHttpMethods(src, file)) {
        total += 1;
        const form = classifyRouteMethodForm(src, method, file, ROOT).form;
        if (form === "canonical-wrapper") canonical += 1; else if (form === "factory") factories += 1; else raw += 1;
      }
    }
    expect({ total, canonical, factories, raw }).toEqual({ total: 174, canonical: 171, factories: 3, raw: 0 }); // [PR-L, 2026-10-17] reviewed ratchet move (runbook L.4, increment 4): + POST/GET /api/generation-tasks, GET /api/generation-tasks/[id], GET /api/generation-tasks/[id]/events, POST /api/generation-tasks/[id]/control (authenticated wrappers) and POST /api/generation-worker (workerRoute): six new canonical wrapper methods, 0 raw stays 0; [B24-A1, 2026-10-06] reviewed ratchet move (OD-198): + GET /api/health (publicRoute) and GET /api/ready (workerRoute), two new canonical wrappers, 0 raw stays 0; [B23-B1, 2026-10-03] reviewed ratchet move (OD-174): + POST /api/pcb/provider-exchange (authenticatedJsonRoute), one new canonical wrapper, 0 raw stays 0; B18-A: + GET/POST /api/agent/autonomy; B18-B: + GET/POST /api/agent/execution-grant, POST /api/agent/execution-grant/settle; B19-E E2: + POST /api/parts/external-search; B19-E E4: + GET/POST /api/components/atomic/publication; B19-E E5: + POST /api/components/revision-status (reviewed ratchet move: one new canonical wrapper, a member's catalog status read; 0 raw stays 0); B20-B2: + POST /api/mcp (mcpBearerJsonRoute), POST /api/mcp/token (authenticatedJsonRoute), GET /.well-known/oauth-protected-resource/api/mcp (publicRoute): three new canonical wrappers, 0 raw stays 0
    // [B19-E E2 review] the header's invariant line states the counts this assertion pins (it lagged twice: B18-E E6, B19-E E2)
    const header = /^ \* {2}- (\d+) route methods \/ (\d+) canonical wrappers \/ (\d+) approved factories \/ (\d+) raw\b/m.exec(read("app/api/__tests__/b16-1c-invariant-tripwires.test.ts"));
    expect(header && { total: Number(header[1]), canonical: Number(header[2]), factories: Number(header[3]), raw: Number(header[4]) }).toEqual({ total, canonical, factories, raw });
    const registry = sirkitToolRegistry();
    const exposed = registry.list().filter((descriptor) => descriptor.agentExposed);
    expect(exposed.map((descriptor) => descriptor.toolId).sort()).toHaveLength(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    // (sirkit.manufacturing.readiness-inspect is a read-only readiness report and stays exposed; nothing that qualifies or releases is.)
    expect(exposed.some((descriptor) => /qualif|\.release$/i.test(descriptor.toolId))).toBe(false);
    expect(exposed.every((descriptor) => isAgentExposableDescriptor(descriptor))).toBe(true);
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
    // [B18-E E6] qualification is a human act too: the actor-kind refusal is explicit and stands before any durable read.
    expect(src).toContain('scope.actor.actorKind !== "human"');
    expect(src).toContain("MFG_QUALIFY_HUMAN_REQUIRED");
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
