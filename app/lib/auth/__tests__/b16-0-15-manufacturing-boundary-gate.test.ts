/**
 * B16.0.15 §F/§I — permanent structural gates for the manufacturing-route
 * migration: canonical provenance, internal-only release, and negative
 * tripwires that FAIL CI if either route regresses to a raw / unsafe form.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm } from "./_boundary-analysis";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
/** Source with comments stripped — gates inspect CODE, not prose. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const QUALIFY = "app/api/pcb/qualify/route.ts";
const RELEASE = "app/api/pcb/release/route.ts";

describe("B16.0.15 §I — both manufacturing routes are canonical-wrapper adopted", () => {
  it("qualify + release classify as canonical-wrapper (authenticatedJsonRoute) by exact provenance", () => {
    for (const rel of [QUALIFY, RELEASE]) {
      const c = classifyRouteMethodForm(readFileSync(join(ROOT, rel), "utf8"), "POST", join(ROOT, rel), ROOT);
      expect(c.form, rel).toBe("canonical-wrapper");
    }
  });
});

describe("B16.0.15 §I — negative tripwires (CI fails if either route regresses)", () => {
  it("neither route reverts to a raw `export async function POST(request: Request)`", () => {
    for (const rel of [QUALIFY, RELEASE]) {
      expect(code(rel), rel).not.toMatch(/export\s+async\s+function\s+POST/);
    }
  });
  it("neither route calls scopedPcbSyncJson / pcbSyncScope / direct authorizeRequest", () => {
    for (const rel of [QUALIFY, RELEASE]) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/scopedPcbSyncJson\s*\(/);
      expect(src, rel).not.toMatch(/\bpcbSyncScope\s*\(/);
      expect(src, rel).not.toMatch(/\bauthorizeRequest\s*\(/);
    }
  });
  it("neither route does direct bounded-body reading or raw Request/Headers/URL access in the callback", () => {
    for (const rel of [QUALIFY, RELEASE]) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/readBoundedJson(Object|Body)\s*\(/);
      expect(src, rel).not.toMatch(/scopedTrustedJson\s*\(/);
      expect(src, rel).not.toMatch(/request\.(headers|url|json|text|body|signal)\b/);
      expect(src, rel).not.toMatch(/\bnew URL\s*\(/);
      expect(src, rel).not.toMatch(/\.headers\.get\s*\(/);
    }
  });
  it("both callbacks are bound to the canonical `authenticatedJsonRoute` from the sanctioned module", () => {
    for (const rel of [QUALIFY, RELEASE]) {
      const src = code(rel);
      expect(src, rel).toMatch(/authenticatedJsonRoute\s*\(/);
      expect(src, rel).toMatch(/from\s+"@\/app\/lib\/auth\/route-handlers"/);
    }
  });
  it("the trusted scope is built ONLY from the context projection + validated body.boardId", () => {
    for (const rel of [QUALIFY, RELEASE]) {
      expect(code(rel), rel).toMatch(/pcbSyncScopeFromContext\s*\(\s*context\s*\)/);
    }
    // qualify constructs the repository scope from context + boardId, never body scope
    expect(code(QUALIFY)).toMatch(/repositoryScope\s*=\s*\{\s*tenantId:\s*scope\.tenantId/);
  });
});

describe("B16.0.15 §F — manufacturing release remains internal-only & non-agent-callable", () => {
  const registry = sirkitToolRegistry();
  it("sirkit.manufacturing.release: discovery internal-only, callability not-callable, agentExposed false", () => {
    const release = registry.list().find((d) => d.toolId === "sirkit.manufacturing.release");
    expect(release).toBeTruthy();
    expect(release).toMatchObject({ discovery: "internal-only", callability: "not-callable", agentExposed: false });
  });
  it("total agent-exposed tool count remains EXACTLY 12", () => {
    expect(registry.list().filter((d) => d.agentExposed).length).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
  });
  it("no agent-exposed tool routes to /api/pcb/qualify or /api/pcb/release", () => {
    const exposed = registry.list().filter((d) => d.agentExposed);
    const serialized = JSON.stringify(exposed);
    expect(serialized).not.toMatch(/pcb\/qualify|pcb\/release|manufacturing\.release/);
  });
  it("no provider-visible exposed descriptor advertises a callable manufacturing release", () => {
    for (const d of registry.list().filter((t) => t.agentExposed)) {
      expect(JSON.stringify(d)).not.toMatch(/manufacturing[_. ]?release/i);
    }
  });
});
