/**
 * B16.0.7 §D — STRUCTURAL wrapper-adoption gate.
 *
 * The target architecture: every protected / body-consuming exported HTTP method
 * is `export const M = <canonicalWrapper>(...)` resolved to
 * app/lib/auth/route-handlers.ts. This gate proves the STRUCTURE (an exact
 * canonical wrapper), not arbitrary control flow.
 *
 * MIGRATION STATE (B16.0.7, honest): the route migration is NOT complete — 0 of
 * the ~153 methods currently use a canonical wrapper. This suite therefore does
 * NOT yet assert full adoption (that would fail the build before the migration
 * lands). It instead:
 *   - proves the classifier's NEGATIVE tripwire (a raw exported handler is
 *     detected as non-adopted) — so CI will fail any route that regresses to a
 *     handwritten handler once adoption is enforced;
 *   - proves the canonical wrapper form is recognized ONLY by exact provenance;
 *   - records the current adoption baseline as a tracked, shrinking number.
 *
 * When the migration completes, flip `EXPECT_FULL_ADOPTION` to true (or delete
 * the baseline) to turn this into the hard gate the stop condition requires.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyRouteMethodForm, exportedHttpMethods } from "./_boundary-analysis";
import { policyFor } from "../route-policy";

const ROOT = process.cwd();
const FP = "app/api/synthetic/route.ts";

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("B16.0.7 §D — canonical wrapper form is recognized by exact provenance", () => {
  it("the canonical wrapper form is `canonical-wrapper`", () => {
    const src = `import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";\nexport const POST = authenticatedJsonRoute({ maxBytes: 1000 }, async () => Response.json({ ok: true }));`;
    expect(classifyRouteMethodForm(src, "POST", FP, ROOT).form).toBe("canonical-wrapper");
  });
  it("NEGATIVE TRIPWIRE: a raw `export async function POST(request)` is NON-adopted (`raw-function`)", () => {
    const src = `export async function POST(request: Request){ return Response.json({ ok: true }); }`;
    expect(classifyRouteMethodForm(src, "POST", FP, ROOT).form).toBe("raw-function");
  });
  it("a wrapper imported from a NON-canonical module is NOT `canonical-wrapper`", () => {
    const src = `import { authenticatedJsonRoute } from "./evil";\nexport const POST = authenticatedJsonRoute({ maxBytes: 1000 }, async () => Response.json({ ok: true }));`;
    expect(classifyRouteMethodForm(src, "POST", FP, ROOT).form).not.toBe("canonical-wrapper");
  });
  it("an aliased-from-other-module wrapper is NOT `canonical-wrapper`", () => {
    const src = `import { evil as authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";\nexport const POST = authenticatedJsonRoute({ maxBytes: 1000 }, async () => Response.json({ ok: true }));`;
    expect(classifyRouteMethodForm(src, "POST", FP, ROOT).form).not.toBe("canonical-wrapper");
  });
});

describe("B16.0.7 §D — adoption inventory (baseline; migration in progress)", () => {
  const EXPECT_FULL_ADOPTION = false; // flip to true when the migration lands
  it("records the current wrapper-adoption baseline over all app/api methods", () => {
    let total = 0, wrappers = 0, factories = 0, raw = 0;
    for (const file of routeFiles(join(ROOT, "app", "api"))) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      const path = "/" + rel.replace(/^app\//, "").replace(/\/route\.ts$/, "");
      const src = readFileSync(file, "utf8");
      for (const method of exportedHttpMethods(src, file)) {
        total += 1;
        const c = classifyRouteMethodForm(src, method, file, ROOT);
        if (c.form === "canonical-wrapper") wrappers += 1;
        else if (c.form === "factory") factories += 1;
        else raw += 1;
        if (EXPECT_FULL_ADOPTION) {
          const policy = policyFor(path.replace(/\[[^\]]+\]/g, "x"), method) ?? policyFor(path, method);
          if (policy?.requiresAuth || method === "POST" || method === "PUT" || method === "PATCH") {
            expect(c.form, `${method} ${path}`).toBe("canonical-wrapper");
          }
        }
      }
    }
    process.stdout.write(`B16.0.8 wrapper adoption: ${wrappers}/${total} canonical wrappers, ${factories} factories, ${raw} raw handlers (migration target: raw→0)\n`);
    expect(total).toBeGreaterThan(100);
    // [B16.0.8] the first tranche (15 methods) is adopted; the monotonic
    // ratchet in b16-0-8-migration-ratchet.test.ts enforces raw ⊆ baseline and
    // shrink-only. This asserts the tranche floor.
    if (!EXPECT_FULL_ADOPTION) expect(wrappers).toBeGreaterThanOrEqual(32); // tranche 1 (15) + tranche 2 (17)
  });
});
