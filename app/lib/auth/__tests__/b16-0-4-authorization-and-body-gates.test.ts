/**
 * B16.0.4 §A/§C — the method-scoped authorization gate + universal body gate,
 * proven by negative tripwires.
 *
 * §A: `analyzeMethodBoundary` is METHOD-SCOPED and LOAD-BEARING: a sibling
 * method's guard never satisfies another; an ignored or late authorization
 * result fails; a durable/provider/body call before the boundary fails; an
 * authorization only in a dead branch fails; an imported handler factory whose
 * returned handler is unguarded fails.
 *
 * §C: `directBodyReads` finds EVERY direct request-body read (json/text/
 * arrayBuffer/blob/formData/body.getReader), including through an aliased
 * request parameter — so a newly added unbounded route fails the automatic
 * gate without editing any allowlist.
 */

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeMethodBoundary, directBodyReads, APPROVED_ROUTE_WRAPPERS } from "./_boundary-analysis";

const ROOT = process.cwd();
const FP = "app/api/synthetic/route.ts";
const ok = (src: string, m: string) => analyzeMethodBoundary(src, m, FP, ROOT).ok;
const reason = (src: string, m: string) => { const v = analyzeMethodBoundary(src, m, FP, ROOT); return v.ok ? "OK" : v.reason; };

const IMPORTS = `import { authorizeRequest } from "@/app/lib/auth/authorize";\nimport { llmRouter } from "@/app/lib/llm/router";\n`;

describe("B16.0.4 §A — method-scoped negative tripwires (each MUST fail the gate)", () => {
  it("1. guarded GET + UNGUARDED POST: the POST fails, the GET passes (sibling cannot launder)", () => {
    const src = `${IMPORTS}import { getDb } from "@/app/lib/db/client";
      export async function GET(req: Request){ const a = await authorizeRequest(req); if(!a.ok) return a.response; return Response.json({ok:true}); }
      export async function POST(req: Request){ return Response.json(await getDb().select()); }`;
    expect(ok(src, "POST")).toBe(false);
    expect(ok(src, "GET")).toBe(true);
  });

  it("2. guarded POST + UNGUARDED PATCH: the PATCH fails", () => {
    const src = `${IMPORTS}import { getDb } from "@/app/lib/db/client";
      export async function POST(req: Request){ const a = await authorizeRequest(req); if(!a.ok) return a.response; return Response.json({ok:true}); }
      export async function PATCH(req: Request){ const rows = await getDb().update(); return Response.json(rows); }`;
    expect(ok(src, "PATCH")).toBe(false);
    expect(ok(src, "POST")).toBe(true);
  });

  it("3. IGNORED authorizeRequest result: fails (no reachable refusal)", () => {
    const src = `${IMPORTS}import { getDb } from "@/app/lib/db/client";
      export async function POST(request: Request){ await authorizeRequest(request); return Response.json(await getDb().select()); }`;
    expect(ok(src, "POST")).toBe(false);
  });

  it("4. DURABLE read before authorization: fails", () => {
    const src = `${IMPORTS}import { getDb } from "@/app/lib/db/client";
      export async function POST(request: Request){ const rows = await getDb().select(); const a = await authorizeRequest(request); if(!a.ok) return a.response; return Response.json(rows); }`;
    expect(ok(src, "POST")).toBe(false);
    expect(reason(src, "POST")).toMatch(/getDb|precedes/);
  });

  it("5. PROVIDER call before authorization: fails", () => {
    const src = `${IMPORTS}export async function POST(request: Request){ const r = await llmRouter.generate({}); const a = await authorizeRequest(request); if(!a.ok) return a.response; return Response.json(r); }`;
    expect(ok(src, "POST")).toBe(false);
    expect(reason(src, "POST")).toMatch(/llmRouter/);
  });

  it("6. BODY read before authorization: fails", () => {
    const src = `${IMPORTS}export async function POST(request: Request){ const raw = await request.text(); const a = await authorizeRequest(request); if(!a.ok) return a.response; return Response.json({ok:true, raw}); }`;
    expect(ok(src, "POST")).toBe(false);
    expect(reason(src, "POST")).toMatch(/body is read/);
  });

  it("7. authorization only in a DEAD branch (if(false)): fails", () => {
    const src = `${IMPORTS}export async function POST(req: Request){ if (false) { const a = await authorizeRequest(req); if(!a.ok) return a.response; } return Response.json({ok:true}); }`;
    expect(ok(src, "POST")).toBe(false);
  });

  it("10. a PUBLIC sibling method's absence of a guard cannot satisfy a protected method (method isolation)", () => {
    const src = `${IMPORTS}export async function GET(){ return Response.json({ok:true}); }
      export async function POST(req: Request){ const a = await authorizeRequest(req); if(!a.ok) return a.response; return Response.json({ok:true}); }`;
    // the protected POST guards itself; the unguarded GET, analyzed alone, has no guard.
    expect(ok(src, "POST")).toBe(true);
    expect(ok(src, "GET")).toBe(false);
  });

  it("the audited wrapper form passes; a bare arrow with no guard fails", () => {
    const wrapped = `import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
      export const POST = authenticatedJsonRoute({ maxBytes: 1000 }, async ({ context, body }) => Response.json({ ok: true, p: context.projectId, body }));`;
    expect(ok(wrapped, "POST")).toBe(true);
    const bare = `export const POST = async (req: Request) => Response.json({ ok: true });`;
    expect(ok(bare, "POST")).toBe(false);
    expect(APPROVED_ROUTE_WRAPPERS).toContain("authenticatedJsonRoute");
  });
});

describe("B16.0.4 §A — factory delegation tripwires (imported handler factories; on-disk fixtures)", () => {
  // EVERY write primitive below is rooted at this OS-temp scratch dir — the
  // b11-5 §D test-write gate (#12) admits this file ONLY while that holds.
  let scratchRoot = "";
  beforeAll(() => {
    scratchRoot = mkdtempSync(join(tmpdir(), "b16-0-4-factory-scan-"));
    mkdirSync(join(scratchRoot, "app", "api", "syn"), { recursive: true });
    mkdirSync(join(scratchRoot, "app", "lib", "auth"), { recursive: true });
    // a REAL guard the factory can call
    writeFileSync(join(scratchRoot, "app", "lib", "auth", "authorize.ts"), `export async function authorizeRequest(_r: Request){ return { ok: true as const, kind: "authenticated" as const, context: {} }; }\n`);
    // GUARDED factory
    writeFileSync(join(scratchRoot, "app", "api", "syn", "guarded-handler.ts"), `import { authorizeRequest } from "@/app/lib/auth/authorize";\nexport function createGuardedHandler(){ return async (req: Request) => { const a = await authorizeRequest(req); if(!a.ok) return a.response as Response; return Response.json({ ok: true }); }; }\n`);
    // UNGUARDED factory
    writeFileSync(join(scratchRoot, "app", "api", "syn", "unguarded-handler.ts"), `export function createUnguardedHandler(){ return async (_req: Request) => Response.json({ ok: true }); }\n`);
    // IGNORED-refusal factory (awaits the boundary but ignores it)
    writeFileSync(join(scratchRoot, "app", "api", "syn", "ignoring-handler.ts"), `import { authorizeRequest } from "@/app/lib/auth/authorize";\nexport function createIgnoringHandler(){ return async (req: Request) => { await authorizeRequest(req); return Response.json({ ok: true }); }; }\n`);
  });
  afterAll(() => { if (scratchRoot) rmSync(scratchRoot, { recursive: true, force: true }); });

  const routeSrc = (factory: string, mod: string) => `import { ${factory} } from "./${mod}";\nexport const POST = ${factory}();\n`;
  const verdict = (factory: string, mod: string) => analyzeMethodBoundary(routeSrc(factory, mod), "POST", join(scratchRoot, "app", "api", "syn", "route.ts"), scratchRoot);

  it("8. an imported factory whose returned handler is GUARDED passes; UNGUARDED fails", () => {
    expect(verdict("createGuardedHandler", "guarded-handler").ok).toBe(true);
    expect(verdict("createUnguardedHandler", "unguarded-handler").ok).toBe(false);
  });

  it("9. an imported factory whose returned handler AWAITS the boundary but IGNORES its refusal fails", () => {
    const v = verdict("createIgnoringHandler", "ignoring-handler");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/IGNORED|factory/);
  });
});

describe("B16.0.4 §C — direct body-read detection (every API + aliased request)", () => {
  // B16.0.6: the §C gate now reports fail-closed request-FLOW violations; the
  // descriptive reason is carried in `alias`. Detection is asserted against the
  // reason text (a violation must fire), not an api-name enum.
  const reasons = (src: string): string => directBodyReads(src, FP, ROOT).map((u) => u.alias).join(" | ");
  it("detects json / text / arrayBuffer / blob / formData", () => {
    for (const api of ["json", "text", "arrayBuffer", "blob", "formData"]) {
      const src = `export async function POST(request: Request){ const b = await request.${api}(); return Response.json({ b }); }`;
      expect(reasons(src), api).toContain(`.${api}()`);
    }
  });
  it("detects request.body.getReader()", () => {
    const src = `export async function POST(request: Request){ const r = request.body!.getReader(); return Response.json({ r: !!r }); }`;
    expect(reasons(src)).toContain("body");
  });
  it("detects a read through an ALIASED request parameter", () => {
    const src = `export async function POST(request: Request){ const r = request; const b = await r.json(); return Response.json({ b }); }`;
    expect(reasons(src)).toContain(".json()");
  });
  it("does NOT flag a bounded read (readBoundedJsonObject) or a comment/string mention", () => {
    const src = `import { readBoundedJsonObject } from "@/app/lib/http/bounded-json";
      export async function POST(request: Request){ /* request.json() would be unbounded */ const s = "request.text()"; const read = await readBoundedJsonObject(request, { maxBytes: 1000 }); return Response.json({ ok: read.ok, s }); }`;
    expect(directBodyReads(src, FP, ROOT)).toEqual([]);
  });
});
