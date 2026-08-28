/**
 * B16.0.6 §B/§C/§D — PERMANENT regressions for the eight additional fail-open
 * counterexamples, plus boundary-result-contract and canonical-provenance
 * fixtures. Every case asserts the corrected analyzer fails CLOSED.
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeMethodBoundary, directBodyReads } from "./_boundary-analysis";

const ROOT = process.cwd();
const FP = "app/api/synthetic/route.ts";
const ok = (src: string, m = "POST"): boolean => analyzeMethodBoundary(src, m, FP, ROOT).ok;
const reason = (src: string, m = "POST"): string => { const v = analyzeMethodBoundary(src, m, FP, ROOT); return v.ok ? "OK" : v.reason; };
const flows = (src: string): string => directBodyReads(src, FP, ROOT).map((u) => u.alias).join(" | ");
const AUTH = `import { authorizeRequest } from "@/app/lib/auth/authorize";\nimport { getDb } from "@/app/lib/db/client";\n`;

describe("B16.0.6 §B — authorization result CONTRACT (no runtime type guessed)", () => {
  it("R1 bare object negation `if (!authorized)` on a union result → REJECT", () => {
    expect(ok(`${AUTH}export async function POST(request: Request){ const authorized = await authorizeRequest(request); if (!authorized) return Response.json({ denied: true }); return Response.json(await getDb().select()); }`)).toBe(false);
  });
  it("R2 unawaited inline union boundary `if (!authorizeRequest(request))` → REJECT", () => {
    expect(ok(`${AUTH}export async function POST(request: Request){ if (!authorizeRequest(request)) return Response.json({ denied: true }); return Response.json(await getDb().select()); }`)).toBe(false);
    expect(reason(`${AUTH}export async function POST(request: Request){ if (!authorizeRequest(request)) return Response.json({ denied: true }); return Response.json(await getDb().select()); }`)).toMatch(/union|inline|await/i);
  });
  it("the union boundary requires AWAITED binding + `.ok` refusal (canonical form PASSES)", () => {
    expect(ok(`${AUTH}export async function POST(request: Request){ const a = await authorizeRequest(request); if (!a.ok) return a.response; return Response.json(await getDb().select()); }`)).toBe(true);
  });
  it("a union boundary bound WITHOUT await, then `!a.ok` → REJECT (the Promise has no .ok)", () => {
    expect(ok(`${AUTH}export async function POST(request: Request){ const a = authorizeRequest(request); if (!a.ok) return a.response; return Response.json(await getDb().select()); }`)).toBe(false);
  });
  it("a genuine BOOLEAN boundary (local, reaching node:crypto timingSafeEqual) may be refused inline `if (!f(req))`", () => {
    const src = `import { timingSafeEqual } from "node:crypto";
      function ok(request: Request){ const s = request.headers.get("authorization") ?? ""; const a = Buffer.from(s), b = Buffer.from(process.env.SECRET ?? ""); return a.length === b.length && timingSafeEqual(a, b); }
      import { readBoundedJsonObject, boundedJsonRefusalResponse } from "@/app/lib/http/bounded-json";
      export async function POST(request: Request){ if (!ok(request)) return Response.json({ e: 1 }, { status: 401 }); const read = await readBoundedJsonObject(request, { maxBytes: 100 }); if (!read.ok) return boundedJsonRefusalResponse(read); return Response.json({ ok: true }); }`;
    expect(ok(src)).toBe(true);
  });
  it("a boundary with an UNKNOWN contract (opaque helper) → REJECT (never guessed)", () => {
    const src = `import { mystery } from "./mystery";
      import { getDb } from "@/app/lib/db/client";
      export async function POST(request: Request){ const a = await mystery(request); if (!a.ok) return a.response; return Response.json(await getDb().select()); }`;
    // `mystery` is unresolvable-as-a-boundary → the method has no verifiable guard.
    expect(ok(src)).toBe(false);
  });
});

describe("B16.0.6 §C — canonical reader identity by PROVENANCE, never by name", () => {
  it("R3 forged `readBoundedEvil` prefix → REJECT (flow violation)", () => {
    expect(flows(`async function readBoundedEvil(input: Request){ return input.json(); }
      export async function POST(request: Request){ return Response.json(await readBoundedEvil(request)); }`)).toMatch(/non-canonical consumer readBoundedEvil/);
  });
  it("R4 forged LOCAL `readBoundedJsonObject` (exact name, wrong provenance) → REJECT", () => {
    expect(flows(`async function readBoundedJsonObject(input: Request){ return input.json(); }
      export async function POST(request: Request){ return Response.json(await readBoundedJsonObject(request)); }`)).toMatch(/non-canonical consumer readBoundedJsonObject/);
  });
  it("the REAL canonical `readBoundedJsonObject` (imported from bounded-json.ts) → NO violation", () => {
    expect(directBodyReads(`import { readBoundedJsonObject } from "@/app/lib/http/bounded-json";
      export async function POST(request: Request){ const r = await readBoundedJsonObject(request, { maxBytes: 100 }); return Response.json({ ok: r.ok }); }`, FP, ROOT)).toEqual([]);
  });
});

describe("B16.0.6 §D — fail-closed request/stream flow (no depth escape, no unresolved-clean)", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["R5 assignment alias", `export async function POST(request: Request){ let alias: Request; alias = request; const b = await alias.json(); return Response.json({ b }); }`, /\.json\(\)/],
    ["R6 body-stream forwarding", `async function consume(stream: ReadableStream){ return stream.getReader().read(); }
      export async function POST(request: Request){ return Response.json(await consume(request.body!)); }`, /stream passed to a non-canonical/],
    ["R7 returned request alias", `function identity(input: Request){ return input; }
      export async function POST(request: Request){ const alias = identity(request); const b = await alias.json(); return Response.json({ b }); }`, /non-canonical consumer identity/],
    ["R8 five-hop chain", `async function h5(r: Request){ return r.json(); }
      async function h4(r: Request){ return h5(r); }
      async function h3(r: Request){ return h4(r); }
      async function h2(r: Request){ return h3(r); }
      async function h1(r: Request){ return h2(r); }
      export async function POST(request: Request){ return Response.json(await h1(request)); }`, /non-canonical consumer h1/],
    ["namespace helper", `import * as helpers from "./helpers";
      export async function POST(request: Request){ return Response.json(await helpers.read(request)); }`, /unresolved\/dynamic/],
    ["array container", `export async function POST(request: Request){ const arr = [request]; const b = await arr[0].json(); return Response.json({ b }); }`, /\.json\(\)/],
    ["stream returned from helper", `function getBody(r: Request){ return r.body; }
      export async function POST(request: Request){ const s = getBody(request); const b = await s!.getReader().read(); return Response.json({ b }); }`, /non-canonical consumer getBody/],
  ];
  it.each(cases)("%s → fail-closed violation", (_label, src, re) => {
    expect(flows(src)).toMatch(re);
  });
  it("a DEEP chain that terminates only in canonical readers converges to SAFE (no false positive)", () => {
    const src = `import { readBoundedJsonObject } from "@/app/lib/http/bounded-json";
      async function h3(r: Request){ return readBoundedJsonObject(r, { maxBytes: 100 }); }
      async function h2(r: Request){ return h3(r); }
      async function h1(r: Request){ return h2(r); }
      export async function POST(request: Request){ const x = await h1(request); return Response.json({ ok: (x as { ok: boolean }).ok }); }`;
    expect(directBodyReads(src, FP, ROOT)).toEqual([]);
  });
});

describe("B16.0.6 §C — on-disk provenance fixtures (factory closure + cross-module helper)", () => {
  let scratchRoot = "";
  beforeAll(() => {
    scratchRoot = mkdtempSync(join(tmpdir(), "b16-0-6-provenance-scan-"));
    mkdirSync(join(scratchRoot, "app", "api", "syn"), { recursive: true });
    mkdirSync(join(scratchRoot, "app", "lib", "http"), { recursive: true });
    // a FORGED bounded-json module at the WRONG path (not app/lib/http/bounded-json.ts)
    writeFileSync(join(scratchRoot, "app", "api", "syn", "evil-reader.ts"), `export async function readBoundedJsonObject(input: Request){ return { ok: true, body: await input.json() }; }\n`);
  });
  afterAll(() => { if (scratchRoot) rmSync(scratchRoot, { recursive: true, force: true }); });
  it("importing `readBoundedJsonObject` from a NON-canonical module → REJECT (provenance, not name)", () => {
    const src = `import { readBoundedJsonObject } from "./evil-reader";\nexport async function POST(request: Request){ const r = await readBoundedJsonObject(request); return Response.json(r); }`;
    const v = directBodyReads(src, join(scratchRoot, "app", "api", "syn", "route.ts"), scratchRoot);
    expect(v.length).toBeGreaterThan(0);
  });
});
