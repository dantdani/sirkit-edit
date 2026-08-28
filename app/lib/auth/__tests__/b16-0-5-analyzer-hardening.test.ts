/**
 * B16.0.5 §A/§B — PERMANENT regressions for every independently reproduced
 * analyzer bypass. Each asserts the CORRECTED analyzer fails closed:
 *  - wrong-polarity / unrelated-binding / partial-branch authorization → REJECT;
 *  - wrapper laundering (`./evil`, aliased-from-evil, same-named local,
 *    re-export) → REJECT (only the canonical `route-handlers.ts` export passes);
 *  - taint-blind body reads (helper forwarding, destructuring, property
 *    extraction, nested alias, call/apply, element access, clone) → DETECTED.
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeMethodBoundary, directBodyReads } from "./_boundary-analysis";

const ROOT = process.cwd();
const FP = "app/api/synthetic/route.ts";
const ok = (src: string, m = "POST"): boolean => analyzeMethodBoundary(src, m, FP, ROOT).ok;
const AUTH = `import { authorizeRequest } from "@/app/lib/auth/authorize";\nimport { getDb } from "@/app/lib/db/client";\n`;

describe("B16.0.5 §A — authorization polarity & binding must be load-bearing", () => {
  it("C1 wrong polarity `if (a.ok) return ok` (unauthorized falls through) → REJECT", () => {
    expect(ok(`${AUTH}export async function POST(request: Request){ const a = await authorizeRequest(request); if (a.ok) return Response.json({ok:true}); const rows = await getDb().select(); return Response.json(rows); }`)).toBe(false);
  });
  it("C1b refusing an UNRELATED binding `if (!other.ok && a)` → REJECT", () => {
    expect(ok(`${AUTH}export async function POST(request: Request){ const a = await authorizeRequest(request); const other = { ok: false }; if (!other.ok && a) return Response.json({ok:false},{status:400}); const rows = await getDb().select(); return Response.json(rows); }`)).toBe(false);
  });
  it("C1c authorization only inside a conditional branch, then unguarded durable read → REJECT", () => {
    expect(ok(`${AUTH}export async function POST(request: Request){ if (request.headers.get("x")===null){ const a = await authorizeRequest(request); if(!a.ok) return a.response; } const rows = await getDb().select(); return Response.json(rows); }`)).toBe(false);
  });
  it("the CANONICAL negative guard `if (!a.ok) return a.response` still PASSES", () => {
    expect(ok(`${AUTH}export async function POST(request: Request){ const a = await authorizeRequest(request); if(!a.ok) return a.response; const rows = await getDb().select(); return Response.json(rows); }`)).toBe(true);
  });
  it("the `.ok === false` / bare-boolean negation forms PASS", () => {
    expect(ok(`${AUTH}export async function POST(request: Request){ const a = await authorizeRequest(request); if(a.ok === false) return a.response; const rows = await getDb().select(); return Response.json(rows); }`)).toBe(true);
  });
});

describe("B16.0.5 §A — wrapper laundering: only the canonical route-handlers export passes", () => {
  it("C2 `authenticatedJsonRoute` from `./evil` → REJECT", () => {
    expect(ok(`import { authenticatedJsonRoute } from "./evil";\nexport const POST = authenticatedJsonRoute({ maxBytes: 1000 }, async () => Response.json({ ok: true }));`)).toBe(false);
  });
  it("C2b `import { evil as authenticatedJsonRoute }` from the canonical module → REJECT", () => {
    expect(ok(`import { evil as authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";\nexport const POST = authenticatedJsonRoute({ maxBytes: 1000 }, async () => Response.json({ ok: true }));`)).toBe(false);
  });
  it("a same-named LOCAL wrapper (not imported) → REJECT", () => {
    expect(ok(`const authenticatedJsonRoute = (_o: unknown, h: () => Response) => h;\nexport const POST = authenticatedJsonRoute({ maxBytes: 1000 }, () => Response.json({ ok: true }));`)).toBe(false);
  });
  it("the REAL canonical import PASSES", () => {
    expect(ok(`import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";\nexport const POST = authenticatedJsonRoute({ maxBytes: 1000 }, async ({ context, body }: { context: unknown; body: unknown }) => Response.json({ ok: true, context, body }));`)).toBe(true);
  });
});

describe("B16.0.5 §A — re-export laundering fixture (canonical path but re-exported symbol)", () => {
  // EVERY write primitive below is rooted at this OS-temp scratch dir — the
  // b11-5 §D test-write gate (#12) admits this file ONLY while that holds.
  let scratchRoot = "";
  beforeAll(() => {
    // Reproduce a barrel that RE-EXPORTS an approved name from elsewhere: the
    // resolver requires the canonical module to DECLARE the function, so a bare
    // re-export must not pass. We model the inverse: a non-canonical module that
    // re-exports the real wrapper — importing from THERE must still reject.
    scratchRoot = mkdtempSync(join(tmpdir(), "b16-0-5-reexport-scan-"));
    mkdirSync(join(scratchRoot, "app", "api", "syn"), { recursive: true });
    mkdirSync(join(scratchRoot, "app", "lib", "auth"), { recursive: true });
    writeFileSync(join(scratchRoot, "app", "lib", "auth", "route-handlers.ts"), `export function authenticatedJsonRoute(_o: unknown, h: (i: unknown) => Response){ return (_r: Request) => h({}); }\n`);
    // a laundering barrel at a DIFFERENT path re-exporting the name
    writeFileSync(join(scratchRoot, "app", "api", "syn", "barrel.ts"), `export { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";\n`);
  });
  afterAll(() => { if (scratchRoot) rmSync(scratchRoot, { recursive: true, force: true }); });
  it("importing an approved wrapper from a NON-canonical barrel path → REJECT", () => {
    const src = `import { authenticatedJsonRoute } from "./barrel";\nexport const POST = authenticatedJsonRoute({ maxBytes: 1000 }, () => Response.json({ ok: true }));`;
    const v = analyzeMethodBoundary(src, "POST", join(scratchRoot, "app", "api", "syn", "route.ts"), scratchRoot);
    expect(v.ok).toBe(false);
  });
});

describe("B16.0.5 §B — taint-blind body-read bypasses are all DETECTED", () => {
  const apis = (src: string): string[] => directBodyReads(src, FP, ROOT).map((u) => u.api);
  const cases: Array<[string, string]> = [
    ["C3a helper forwarding", `async function parse(r: Request){ return r.json(); }\nexport async function POST(request: Request){ const b = await parse(request); return Response.json({ b }); }`],
    ["C3b destructured method", `export async function POST(request: Request){ const { json } = request; const b = await json.call(request); return Response.json({ b }); }`],
    ["C3c property extraction", `export async function POST(request: Request){ const j = request.json; const b = await j.call(request); return Response.json({ b }); }`],
    ["C3d nested alias", `export async function POST(request: Request){ const wrap = { r: request }; const b = await wrap.r.json(); return Response.json({ b }); }`],
    ["C3e call on method", `export async function POST(request: Request){ const b = await request.json.call(request); return Response.json({ b }); }`],
    ["C3f element access", `export async function POST(request: Request){ const b = await request["json"](); return Response.json({ b }); }`],
    ["C3g clone laundering", `export async function POST(request: Request){ const b = await request.clone().json(); return Response.json({ b }); }`],
    ["C3h direct member", `export async function POST(incoming: Request){ const b = await incoming.text(); return Response.json({ b }); }`],
    ["body.getReader via non-null", `export async function POST(request: Request){ const r = request.body!.getReader(); return Response.json({ r: !!r }); }`],
  ];
  it.each(cases)("%s → detected", (_label, src) => {
    expect(apis(src).length).toBeGreaterThan(0);
  });
  it("a bounded read (readBoundedJsonObject) is NOT flagged", () => {
    const src = `import { readBoundedJsonObject } from "@/app/lib/http/bounded-json";\nexport async function POST(request: Request){ const read = await readBoundedJsonObject(request, { maxBytes: 1000 }); return Response.json({ ok: read.ok }); }`;
    expect(apis(src)).toEqual([]);
  });
});
