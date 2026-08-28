/**
 * B16.0.7 §A/§F — PERMANENT regressions for R1–R11. Even though ordinary routes
 * are migrating to canonical wrappers (so handwritten guards should disappear),
 * the analyzer/flow gate must keep these fail-closed as defense in depth.
 */
import { describe, expect, it } from "vitest";
import { analyzeMethodBoundary, directBodyReads } from "./_boundary-analysis";

const ROOT = process.cwd();
const FP = "app/api/synthetic/route.ts";
const ok = (src: string): boolean => analyzeMethodBoundary(src, "POST", FP, ROOT).ok;
const flows = (src: string): string => directBodyReads(src, FP, ROOT).map((u) => u.alias).join(" | ");
const AUTH = `import { authorizeRequest } from "@/app/lib/auth/authorize";\nimport { getDb } from "@/app/lib/db/client";\n`;

describe("B16.0.7 §A — authorization dominance (work between/inside refusal)", () => {
  it("R1 durable work BETWEEN authorization and its refusal → REJECT", () => {
    expect(ok(`${AUTH}export async function POST(request: Request){ const authorized = await authorizeRequest(request); const secret = await getDb().select(); if (!authorized.ok) return authorized.response; return Response.json(secret); }`)).toBe(false);
  });
  it("R2 durable work INSIDE the refusal branch → REJECT", () => {
    expect(ok(`${AUTH}export async function POST(request: Request){ const authorized = await authorizeRequest(request); if (!authorized.ok) { const secret = await getDb().select(); return Response.json(secret); } return Response.json({ ok: true }); }`)).toBe(false);
  });
  it("R3 body read inside the refusal branch → flagged", () => {
    expect(flows(`${AUTH}export async function POST(request: Request){ const authorized = await authorizeRequest(request); if (!authorized.ok) { const body = await request.json(); return Response.json(body); } return Response.json({ ok: true }); }`)).toMatch(/\.json\(\)/);
  });
  it("R4 unawaited async boolean binding → REJECT", () => {
    const src = `import { timingSafeEqual } from "node:crypto";
      async function asyncBool(request: Request){ const s = request.headers.get("x") ?? ""; return timingSafeEqual(Buffer.from(s), Buffer.from(s)); }
      import { getDb } from "@/app/lib/db/client";
      export async function POST(request: Request){ const allowed = asyncBool(request); if (!allowed) return Response.json({ e: 1 }); return Response.json(await getDb().select()); }`;
    expect(ok(src)).toBe(false);
  });
  it("the canonical dominant form still PASSES (nothing between/inside; awaited .ok refusal)", () => {
    expect(ok(`${AUTH}export async function POST(request: Request){ const a = await authorizeRequest(request); if (!a.ok) return a.response; const rows = await getDb().select(); return Response.json(rows); }`)).toBe(true);
  });
});

describe("B16.0.7 §E — Request/body aggregate escapes all fail closed", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["R5 consume({ request })", `function consume(box: { request: Request }){ return box.request.json(); }
      export async function POST(request: Request){ return Response.json(await consume({ request })); }`, /disallowed position/],
    ["R6 const box = { request }; consume(box)", `function consume(box: { request: Request }){ return box.request.json(); }
      export async function POST(request: Request){ const box = { request }; return Response.json(await consume(box)); }`, /disallowed position/],
    ["R7 new Response(request.body).text()", `export async function POST(request: Request){ const t = await new Response(request.body).text(); return Response.json({ t }); }`, /stream passed to a non-canonical/],
    ["R8 for await (const chunk of request.body)", `export async function POST(request: Request){ const chunks = []; for await (const chunk of request.body as any) chunks.push(chunk); return Response.json({ n: chunks.length }); }`, /iterated/],
    ["R9 return { request }", `function wrap(request: Request){ return { request }; }
      export async function POST(request: Request){ const w = wrap(request); return Response.json(await w.request.json()); }`, /non-canonical consumer wrap|disallowed position/],
    ["R10 store.request = request", `const store: { request?: Request } = {};
      export async function POST(request: Request){ store.request = request; return Response.json(await store.request!.json()); }`, /stored to a property/],
    ["R11 box.request = request; box.request.json()", `export async function POST(request: Request){ const box: { request?: Request } = {}; box.request = request; return Response.json(await box.request!.json()); }`, /stored to a property|disallowed position/],
    ["array push then read", `export async function POST(request: Request){ const a: Request[] = []; a.push(request); return Response.json(await a[0].json()); }`, /unresolved|disallowed/],
    ["callback closure", `export async function POST(request: Request){ const f = () => request.json(); return Response.json(await f()); }`, /\.json\(\)/],
  ];
  it.each(cases)("%s → fail-closed violation", (_label, src, re) => {
    expect(flows(src)).toMatch(re);
  });
  it("a clean route (metadata + canonical reader only) has ZERO violations", () => {
    const src = `import { authorizeRequest } from "@/app/lib/auth/authorize";
      import { readBoundedJsonObject, boundedJsonRefusalResponse } from "@/app/lib/http/bounded-json";
      export async function POST(request: Request){ const a = await authorizeRequest(request); if (!a.ok) return a.response; const url = new URL(request.url); const read = await readBoundedJsonObject(request, { maxBytes: 1000 }); if (!read.ok) return boundedJsonRefusalResponse(read); return Response.json({ ok: true, p: url.pathname }); }`;
    expect(directBodyReads(src, FP, ROOT)).toEqual([]);
  });
});
