/**
 * B16.0.3 §B — the structural authorization-boundary gate + negative tripwires.
 *
 * The B16.0.2 boundary gate scanned source TEXT and carried ONE explicit
 * exception (`app/api/replacement-authority/route.ts`). B16.0.3 removes the
 * exception entirely and replaces the text scan with an AST analysis
 * (`analyzeBoundaryCalls`) that requires a REAL, REACHABLE, IMPORTED call to an
 * approved boundary helper. This suite pins the four mandated negative
 * tripwires (a handler cannot pass by MENTIONING a helper) plus the positive
 * cases (comment / string / type / unused-import / unreachable never count;
 * a genuine call does).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeBoundaryCalls, analyzeMethodBoundary, callsApprovedBoundary } from "./_boundary-analysis";

const APPROVED = [
  "authorizeRequest", "scopedTrustedJson", "scopedJson", "resolveTrustedRequestContext",
  "pcbSyncScope", "scopedPcbSyncJson", "spiceRunScope", "bomScope",
  "verifyWorkerSecret", "timingSafeEqual",
] as const;

describe("B16.0.3 §B — a real boundary CALL is required (positive)", () => {
  it("a genuine `await authorizeRequest(req)` call (imported, reachable) is detected", () => {
    const source = `
      import { authorizeRequest } from "@/app/lib/auth/authorize";
      export async function POST(req: Request): Promise<Response> {
        const authorized = await authorizeRequest(req);
        if (!authorized.ok) return authorized.response;
        return Response.json({ ok: true });
      }`;
    const result = analyzeBoundaryCalls(source, APPROVED);
    expect(result.reached).toBe(true);
    expect(result.calledHelpers).toContain("authorizeRequest");
  });

  it("a family-wrapper call (`scopedJson`, `spiceRunScope`, `bomScope`, `timingSafeEqual`) counts", () => {
    for (const [helper, importFrom] of [
      ["scopedJson", "../../_scope"],
      ["spiceRunScope", "./_scope"],
      ["bomScope", "../_scope"],
      ["timingSafeEqual", "node:crypto"],
    ] as const) {
      const source = `
        import { ${helper} } from "${importFrom}";
        export async function POST(req: Request) {
          const r = await ${helper}(req);
          return Response.json({ ok: true });
        }`;
      expect(callsApprovedBoundary(source, APPROVED), helper).toBe(true);
    }
  });

  // [B16.0.22] SUPERSEDED FORM: the route no longer calls authorizeRequest
  // inline — it adopted the canonical wrapper, whose provenance-checked
  // classification is a strictly stronger boundary proof than a helper-call
  // scan (the wrapper calls authorizeRequest FIRST internally; a same-name
  // local decoy is not recognized). The B16.0.3 R1 regression this test
  // guards (an unauthenticated durable read) stays impossible: the callback
  // cannot run before authorization completes.
  it("THE REAL replacement-authority route now carries the canonical wrapper boundary", () => {
    const file = join(process.cwd(), "app", "api", "replacement-authority", "route.ts");
    const verdict = analyzeMethodBoundary(readFileSync(file, "utf8"), "POST", file, process.cwd());
    expect(verdict.ok && verdict.via).toBe("wrapper");
    expect(verdict.ok && verdict.detail).toContain("authenticatedJsonRoute");
  });
});

describe("B16.0.3 §B — the four mandated negative tripwires (a mention never passes)", () => {
  it("1. a route with only an `authorizeRequest` COMMENT fails", () => {
    const source = `
      export async function POST(req: Request) {
        // authorizeRequest(req) would go here
        /* authorizeRequest */
        return Response.json({ ok: true });
      }`;
    expect(callsApprovedBoundary(source, APPROVED)).toBe(false);
  });

  it("2. an UNUSED `authorizeRequest` import fails", () => {
    const source = `
      import { authorizeRequest } from "@/app/lib/auth/authorize";
      export async function POST(req: Request) {
        return Response.json({ ok: true });
      }`;
    expect(callsApprovedBoundary(source, APPROVED)).toBe(false);
  });

  it("3. a policy-classified handler that directly calls a DURABLE LOADER (no boundary call) fails", () => {
    const source = `
      import { loadRunComponentAuthority } from "@/app/lib/engineering/component-authority-source";
      import { resolveComponentAuthoritySource } from "../chat/component-authority-runtime";
      export async function POST(req: Request) {
        const source = resolveComponentAuthoritySource({ tenantId: "local", projectId: "p", branchId: "main" });
        const authority = await loadRunComponentAuthority(source, { componentInstanceIds: ["x"] });
        return Response.json({ ok: true, authority });
      }`;
    expect(callsApprovedBoundary(source, APPROVED)).toBe(false);
  });

  it("4. the PREVIOUS replacement-authority handler shape (bounded read → durable resolve, no auth) fails", () => {
    const source = `
      import { loadRunComponentAuthority } from "@/app/lib/engineering/component-authority-source";
      import { resolveComponentAuthoritySource } from "../chat/component-authority-runtime";
      import { readBoundedStream } from "@/app/lib/http/bounded-stream";
      const LOCAL_TENANT_ID = "local";
      export async function POST(req: Request) {
        const bounded = await readBoundedStream(req.body, 16384, { signal: req.signal, deadlineMs: 10000 });
        if (!bounded.ok) return Response.json({ ok: false }, { status: 413 });
        const requestScope = { tenantId: LOCAL_TENANT_ID, projectId: "p", branchId: "main" };
        const source = resolveComponentAuthoritySource(requestScope);
        if (!source) return Response.json({ ok: false }, { status: 503 });
        const authority = await loadRunComponentAuthority(source, { componentInstanceIds: ["x"] });
        return Response.json({ ok: true, authority });
      }`;
    expect(callsApprovedBoundary(source, APPROVED)).toBe(false);
  });
});

describe("B16.0.3 §B — mention-only forms never count (string / type / shadowed / unreachable)", () => {
  it("a STRING literal `\"authorizeRequest\"` never counts", () => {
    const source = `
      export async function POST(req: Request) {
        const helper = "authorizeRequest";
        return Response.json({ helper });
      }`;
    expect(callsApprovedBoundary(source, APPROVED)).toBe(false);
  });

  it("a TYPE reference never counts", () => {
    const source = `
      import type { authorizeRequest } from "@/app/lib/auth/authorize";
      type Guard = typeof authorizeRequest;
      export async function POST(req: Request): Promise<Response> {
        const g: Guard = undefined as never;
        return Response.json({ ok: !!g });
      }`;
    // `import type` binds the name but there is no runtime call.
    expect(callsApprovedBoundary(source, APPROVED)).toBe(false);
  });

  it("a LOCALLY-declared same-named function (shadowing, not imported) never counts", () => {
    const source = `
      async function authorizeRequest(_req: Request) { return { ok: true }; }
      export async function POST(req: Request) {
        const a = await authorizeRequest(req);
        return Response.json(a);
      }`;
    expect(callsApprovedBoundary(source, APPROVED)).toBe(false);
  });

  it("an UNREACHABLE call — inside `if (false)`, after `return`, or the dead branch of `if (true)` — never counts", () => {
    const deadIf = `
      import { authorizeRequest } from "@/app/lib/auth/authorize";
      export async function POST(req: Request) {
        if (false) { const a = await authorizeRequest(req); void a; }
        return Response.json({ ok: true });
      }`;
    expect(callsApprovedBoundary(deadIf, APPROVED)).toBe(false);

    const afterReturn = `
      import { authorizeRequest } from "@/app/lib/auth/authorize";
      export async function POST(req: Request) {
        return Response.json({ ok: true });
        const a = await authorizeRequest(req); void a;
      }`;
    expect(callsApprovedBoundary(afterReturn, APPROVED)).toBe(false);

    const deadElse = `
      import { authorizeRequest } from "@/app/lib/auth/authorize";
      export async function POST(req: Request) {
        if (true) { return Response.json({ ok: true }); }
        else { const a = await authorizeRequest(req); void a; }
      }`;
    expect(callsApprovedBoundary(deadElse, APPROVED)).toBe(false);
  });
});
