/**
 * B16.0.8 §A — the MONOTONIC migration ratchet.
 *
 * The frozen raw-route baseline (`_raw-route-baseline.json`) may only SHRINK:
 *  - every non-canonical (raw or factory) method must be IN the baseline — a
 *    NEW raw route/method fails CI immediately;
 *  - a MIGRATED method (canonical wrapper, removed from the baseline) that
 *    reverts to raw fails the same check;
 *  - the baseline size is pinned at its current maximum and the migrated count
 *    at its floor — the ratchet is monotonic;
 *  - the generator refuses baseline ADDITIONS (test-pinned empty exception list).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyRouteMethodForm, exportedHttpMethods } from "./_boundary-analysis";
import { ALLOWED_BASELINE_ADDITIONS, refusedBaselineAdditions, currentRawMethods } from "../../../../scripts/generate-b16-0-8-baseline";
import baseline from "./_raw-route-baseline.json";

const ROOT = process.cwd();
/** RATCHET PINS — update ONLY downward (baseline) / upward (migrated floor)
 *  as tranches land. B16.0.8 tranche 1: 15 migrated (138 legacy left);
 *  B16.0.9 tranche 2: +17 authenticated design-family methods (121 left);
 *  B16.0.10 tranche 3: +8 schematic AI methods (113 left);
 *  B16.0.11 tranche 4: +12 BOM methods (101 left);
 *  B16.0.12 tranche 5: +12 public catalog/footprint/export methods (89 left);
 *  B16.0.13 tranche 6: +5 protected PCB provider/process/export methods (84 left);
 *  B16.0.14 tranche 7: +2 selector-envelope / footprint-search-service methods (82 left);
 *  B16.0.15 tranche 8: +2 manufacturing qualify/release methods (80 left);
 *  B16.0.16 tranche 9: +8 CD-7 calculation methods (72 left);
 *  B16.0.17 tranche 10: +10 CD-8 schematic-compiler methods (62 left);
 *  B16.0.18 tranche 11: +10 CD-6 component-selection methods (52 left);
 *  B16.0.19 tranche 12: +9 circuit-knowledge/-verification methods (43 left);
 *  B16.0.20 tranche 13: +6 CD-10 model-simulation methods (37 left);
 *  B16.0.21 tranche 14: +8 firmware-bringup/full-flow/release-eng methods (29 left). */
const BASELINE_MAX = 3;
const MIGRATED_FLOOR = 150;

/** The B16.0.8 tranche-1 methods: MIGRATED — must stay canonical forever. */
const TRANCHE_1: ReadonlyArray<[string, string]> = [
  ["GET", "/api/requirements/capabilities"],
  ["GET", "/api/parts/categories"],
  ["GET", "/api/kicad/v1"],
  ["GET", "/api/kicad/v1/categories.json"],
  ["GET", "/api/kicad/v1/parts/[id]"],
  ["POST", "/api/constraints/explain"],
  ["POST", "/api/constraints/preview"],
  ["POST", "/api/parts/search"],
  ["POST", "/api/assignment-queue/materialize"],
  ["POST", "/api/assignment-queue/revalidate"],
  ["POST", "/api/engineering-effects"],
  ["GET", "/api/footprint-resolution"],
  ["GET", "/api/mapping-verification"],
  ["POST", "/api/requirements/compile"],
  ["POST", "/api/requirements/sources"],
];

/** The B16.0.9 tranche-2 methods (authenticated design families): MIGRATED —
 *  must stay canonical forever. */
const TRANCHE_2: ReadonlyArray<[string, string]> = [
  ["POST", "/api/architecture/alternatives"],
  ["POST", "/api/architecture/candidates"],
  ["POST", "/api/architecture/compare"],
  ["POST", "/api/architecture/problem"],
  ["POST", "/api/architecture/propose"],
  ["POST", "/api/power/alternatives"],
  ["POST", "/api/power/candidates"],
  ["POST", "/api/power/compare"],
  ["POST", "/api/power/problem"],
  ["POST", "/api/power/propose"],
  ["POST", "/api/power/reconcile"],
  ["POST", "/api/interfaces/allocate"],
  ["POST", "/api/interfaces/alternatives"],
  ["POST", "/api/interfaces/candidates"],
  ["POST", "/api/interfaces/compare"],
  ["POST", "/api/interfaces/problem"],
  ["POST", "/api/interfaces/propose"],
];

/** The B16.0.10 tranche-3 methods (schematic AI): MIGRATED — must stay
 *  canonical forever. */
const TRANCHE_3: ReadonlyArray<[string, string]> = [
  ["POST", "/api/schematic"],
  ["POST", "/api/schematic/build"],
  ["POST", "/api/schematic/build-multi"],
  ["POST", "/api/schematic/cross-verify"],
  ["POST", "/api/schematic/edit"],
  ["POST", "/api/schematic/edit-build"],
  ["POST", "/api/schematic/layout-critic"],
  ["POST", "/api/schematic/review"],
];

/** The B16.0.11 tranche-4 BOM methods: MIGRATED — must stay canonical forever. */
const TRANCHE_4: ReadonlyArray<[string, string]> = [
  ["POST", "/api/bom"],
  ["POST", "/api/bom/cart/digikey"],
  ["POST", "/api/bom/cart/lcsc"],
  ["POST", "/api/bom/cart/mouser"],
  ["POST", "/api/bom/export-csv"],
  ["POST", "/api/bom/procurement-packet"],
  ["POST", "/api/bom/diff"],
  ["GET", "/api/bom/notifications"],
  ["PATCH", "/api/bom/notifications"],
  ["DELETE", "/api/bom/notifications"],
  ["POST", "/api/bom/snapshot"],
  ["GET", "/api/bom/snapshot"],
];

/** The B16.0.12 tranche-5 public catalog/footprint/export methods: MIGRATED —
 *  must stay canonical forever. */
const TRANCHE_5: ReadonlyArray<[string, string]> = [
  ["GET", "/api/ai/runtime"],
  ["GET", "/api/components/atomic"],
  ["POST", "/api/components/atomic/search"],
  ["POST", "/api/export/kicad"],
  ["GET", "/api/kicad/v1/parts/category/[id]"],
  ["GET", "/api/parts/[id]"],
  ["GET", "/api/parts/[id]/alternates"],
  ["POST", "/api/pcb/export/kicad-pcb"],
  ["GET", "/api/pcb/footprints/[id]"],
  ["GET", "/api/pcb/footprints/resolve"],
  ["GET", "/api/pcb/footprints/search"],
  ["POST", "/api/pcb/placement/preview"],
];

/** The B16.0.13 tranche-6 protected PCB methods: MIGRATED — must stay
 *  canonical forever. */
const TRANCHE_6: ReadonlyArray<[string, string]> = [
  ["POST", "/api/pcb/ai-rules/from-brief"],
  ["POST", "/api/pcb/autoroute"],
  ["POST", "/api/pcb/edit/assist"],
  ["POST", "/api/pcb/export/gerbers"],
  ["POST", "/api/pcb/repair/agent"],
];

/** The B16.0.14 tranche-7 methods (the two routes deferred from B16.0.13):
 *  MIGRATED — must stay canonical forever. */
const TRANCHE_7: ReadonlyArray<[string, string]> = [
  ["POST", "/api/pcb/apply-authorization"],
  ["POST", "/api/pcb/assign/suggest"],
];

/** The B16.0.15 tranche-8 manufacturing methods: MIGRATED — must stay
 *  canonical forever (authenticated-release policy, exact role separation). */
const TRANCHE_8: ReadonlyArray<[string, string]> = [
  ["POST", "/api/pcb/qualify"],
  ["POST", "/api/pcb/release"],
];

/** The B16.0.16 tranche-9 CD-7 calculation methods: MIGRATED — must stay
 *  canonical forever. */
const TRANCHE_9: ReadonlyArray<[string, string]> = [
  ["POST", "/api/calculation/corners"],
  ["POST", "/api/calculation/evaluate"],
  ["POST", "/api/calculation/export"],
  ["POST", "/api/calculation/feedback"],
  ["POST", "/api/calculation/problem"],
  ["POST", "/api/calculation/propose"],
  ["POST", "/api/calculation/report"],
  ["POST", "/api/calculation/transaction"],
];

/** The B16.0.17 tranche-10 CD-8 schematic-compiler methods: MIGRATED — must
 *  stay canonical forever. */
const TRANCHE_10: ReadonlyArray<[string, string]> = [
  ["POST", "/api/schematic-compiler/compare"],
  ["POST", "/api/schematic-compiler/diff"],
  ["POST", "/api/schematic-compiler/export"],
  ["POST", "/api/schematic-compiler/graph/validate"],
  ["POST", "/api/schematic-compiler/kicad/inspect"],
  ["POST", "/api/schematic-compiler/layout"],
  ["POST", "/api/schematic-compiler/problem"],
  ["POST", "/api/schematic-compiler/propose"],
  ["POST", "/api/schematic-compiler/transaction"],
  ["POST", "/api/schematic-compiler/variants"],
];

/** The B16.0.18 tranche-11 CD-6 component-selection methods: MIGRATED — must
 *  stay canonical forever. */
const TRANCHE_11: ReadonlyArray<[string, string]> = [
  ["POST", "/api/component-selection/alternative"],
  ["POST", "/api/component-selection/catalog"],
  ["POST", "/api/component-selection/evaluate"],
  ["POST", "/api/component-selection/export"],
  ["POST", "/api/component-selection/feedback"],
  ["POST", "/api/component-selection/problem"],
  ["POST", "/api/component-selection/propose"],
  ["POST", "/api/component-selection/solve"],
  ["POST", "/api/component-selection/sourcing"],
  ["POST", "/api/component-selection/transaction"],
];

/** The B16.0.19 tranche-12 circuit-knowledge + circuit-verification methods:
 *  MIGRATED — must stay canonical forever. */
const TRANCHE_12: ReadonlyArray<[string, string]> = [
  ["POST", "/api/circuit-knowledge/applicability"],
  ["POST", "/api/circuit-knowledge/compile"],
  ["POST", "/api/circuit-knowledge/compose"],
  ["POST", "/api/circuit-knowledge/problem"],
  ["POST", "/api/circuit-knowledge/propose"],
  ["POST", "/api/circuit-verification/problem"],
  ["POST", "/api/circuit-verification/propose"],
  ["POST", "/api/circuit-verification/readiness"],
  ["POST", "/api/circuit-verification/run"],
];

/** The B16.0.20 tranche-13 CD-10 model-simulation methods: MIGRATED — must
 *  stay canonical forever. */
const TRANCHE_13: ReadonlyArray<[string, string]> = [
  ["POST", "/api/model-simulation/denominator"],
  ["POST", "/api/model-simulation/execute"],
  ["POST", "/api/model-simulation/measure"],
  ["POST", "/api/model-simulation/problem"],
  ["POST", "/api/model-simulation/propose"],
  ["POST", "/api/model-simulation/readiness"],
];

/** The B16.0.21 tranche-14 firmware-bringup + full-flow + release-engineering
 *  methods: MIGRATED — must stay canonical forever. */
const TRANCHE_14: ReadonlyArray<[string, string]> = [
  ["POST", "/api/firmware-bringup/problem"],
  ["POST", "/api/firmware-bringup/propose"],
  ["POST", "/api/firmware-bringup/resources"],
  ["POST", "/api/full-flow/propose"],
  ["POST", "/api/full-flow/run"],
  ["POST", "/api/full-flow/transition"],
  ["POST", "/api/release-engineering/problem"],
  ["POST", "/api/release-engineering/propose"],
];

const TRANCHE_15: ReadonlyArray<[string, string]> = [
  ["GET", "/api/assignment-queue"],
  ["POST", "/api/assignment-queue"],
  ["POST", "/api/footprint-resolution"],
  ["GET", "/api/passive-policy"],
  ["GET", "/api/pcb-sync"],
  ["GET", "/api/physical-bindings"],
  ["POST", "/api/physical-bindings"],
  ["POST", "/api/replacement-authority"],
];

const TRANCHE_16: ReadonlyArray<[string, string]> = [
  ["POST", "/api/spice/ai"],
  ["POST", "/api/spice/compile"],
  ["POST", "/api/spice/models/import"],
  ["POST", "/api/spice/models/smoke-test"],
  ["POST", "/api/spice/reports"],
  ["POST", "/api/spice/run-plans/estimate"],
  ["GET", "/api/spice/runs"],
  ["POST", "/api/spice/runs"],
  ["GET", "/api/spice/runs/[id]"],
  ["DELETE", "/api/spice/runs/[id]"],
  ["GET", "/api/spice/runs/[id]/bundle"],
  ["GET", "/api/spice/runs/[id]/events"],
  ["GET", "/api/spice/runs/[id]/waveforms"],
];

const TRANCHE_17: ReadonlyArray<[string, string]> = [
  ["GET", "/api/auth/callback"],
  ["POST", "/api/auth/signin"],
  ["POST", "/api/auth/signout"],
  ["POST", "/api/chat"],
  ["POST", "/api/simulate"],
];

/** [B16.0.24 §J] the EXACT approved DI-factory method/route pairs — the only
 *  non-canonical forms permitted to remain. Any new factory fails CI. */
const APPROVED_FACTORIES: ReadonlyArray<[string, string]> = [
  ["POST", "/api/mapping-verification"],
  ["POST", "/api/passive-policy"],
  ["POST", "/api/pcb-sync"],
];

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}
interface Inventory { wrappers: Array<[string, string]>; legacy: Array<[string, string]>; factories: Array<[string, string]>; rawHandlers: Array<[string, string]> }
function inventory(): Inventory {
  const wrappers: Array<[string, string]> = [];
  const legacy: Array<[string, string]> = [];
  const factories: Array<[string, string]> = [];
  const rawHandlers: Array<[string, string]> = [];
  for (const file of routeFiles(join(ROOT, "app", "api"))) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    const route = "/" + rel.replace(/^app\//, "").replace(/\/route\.ts$/, "");
    const src = readFileSync(file, "utf8");
    for (const method of exportedHttpMethods(src, file)) {
      const c = classifyRouteMethodForm(src, method, file, ROOT);
      if (c.form === "canonical-wrapper") wrappers.push([method, route]);
      else {
        legacy.push([method, route]);
        if (c.form === "factory") factories.push([method, route]);
        else rawHandlers.push([method, route]);
      }
    }
  }
  return { wrappers, legacy, factories, rawHandlers };
}
const inv = inventory();
const baselineKeys = new Set((baseline as Array<{ method: string; route: string }>).map((e) => `${e.route}#${e.method}`));

describe("B16.0.8 §A — the raw baseline may only shrink", () => {
  it("every legacy (non-wrapper) method is IN the frozen baseline — a NEW raw route/method fails here", () => {
    const offenders = inv.legacy.filter(([m, r]) => !baselineKeys.has(`${r}#${m}`)).map(([m, r]) => `${m} ${r}`);
    expect(offenders).toEqual([]);
  });
  it("baseline size is pinned (≤ BASELINE_MAX) and the migrated count holds its floor", () => {
    expect((baseline as unknown[]).length).toBeLessThanOrEqual(BASELINE_MAX);
    expect(inv.wrappers.length).toBeGreaterThanOrEqual(MIGRATED_FLOOR);
    expect(inv.wrappers.length + inv.legacy.length).toBeGreaterThan(100);
  });
  it("every tranche-1 AND tranche-2 method is canonical AND out of the baseline — a REVERT to raw fails here", () => {
    for (const [method, route] of [...TRANCHE_1, ...TRANCHE_2, ...TRANCHE_3, ...TRANCHE_4, ...TRANCHE_5, ...TRANCHE_6, ...TRANCHE_7, ...TRANCHE_8, ...TRANCHE_9, ...TRANCHE_10, ...TRANCHE_11, ...TRANCHE_12, ...TRANCHE_13, ...TRANCHE_14, ...TRANCHE_15, ...TRANCHE_16, ...TRANCHE_17]) {
      expect(inv.wrappers.some(([m, r]) => m === method && r === route), `${method} ${route} must remain canonical`).toBe(true);
      expect(baselineKeys.has(`${route}#${method}`), `${method} ${route} must not re-enter the baseline`).toBe(false);
    }
  });
});

describe("B16.0.24 §J — the final ratchet: EXACTLY zero raw handlers, EXACTLY three factories", () => {
  const key = ([m, r]: [string, string]) => `${m} ${r}`;
  it("ZERO raw handlers remain — every app/api route method is canonical-wrapper or an approved factory", () => {
    // A loose ceiling is not enough at closure: the raw-function/raw-arrow set
    // must be EMPTY. Reverting any migrated route to a raw handler fails here.
    expect(inv.rawHandlers.map(key)).toEqual([]);
  });
  it("the factory set equals EXACTLY the three approved DI factories — a NEW factory fails CI", () => {
    expect(inv.factories.map(key).sort()).toEqual(APPROVED_FACTORIES.map(key).sort());
  });
  it("the frozen baseline is EXACTLY the three approved factory rows (no raw method survives)", () => {
    expect([...baselineKeys].map((k) => { const [route, method] = k.split("#"); return `${method} ${route}`; }).sort())
      .toEqual(APPROVED_FACTORIES.map(key).sort());
    expect((baseline as unknown[]).length).toBe(3);
  });
  it("canonical wrapper count holds the closure floor (150) and non-canonical is exactly the 3 factories", () => {
    expect(inv.wrappers.length).toBeGreaterThanOrEqual(MIGRATED_FLOOR);
    expect(inv.legacy.length).toBe(3);
  });
});

describe("B16.0.8 §A — generator refusal + exception pin (tripwires)", () => {
  it("the migration exception list is EMPTY (test-pinned)", () => {
    expect(ALLOWED_BASELINE_ADDITIONS).toEqual([]);
  });
  it("TRIPWIRE: a baseline EXPANSION (new raw method) is refused by the generator", () => {
    const refused = refusedBaselineAdditions(baselineKeys, [{ method: "POST", route: "/api/evil/new-raw", sha1: "0".repeat(40) }], []);
    expect(refused.length).toBe(1);
    expect(refused[0]!.route).toBe("/api/evil/new-raw");
  });
  it("TRIPWIRE: a synthetic NEW raw exported POST is classified non-adopted (CI would fail)", () => {
    const c = classifyRouteMethodForm(`export async function POST(request: Request){ return Response.json({ ok: true }); }`, "POST", "app/api/evil/route.ts", ROOT);
    expect(c.form).toBe("raw-function");
    expect(baselineKeys.has("/api/evil#POST")).toBe(false); // → rule 1 fails it
  });
  it("TRIPWIRE: a fake wrapper module and an aliased wrapper are NOT canonical", () => {
    expect(classifyRouteMethodForm(`import { publicRoute } from "./evil";\nexport const GET = publicRoute(undefined, () => Response.json({}));`, "GET", "app/api/x/route.ts", ROOT).form).not.toBe("canonical-wrapper");
    expect(classifyRouteMethodForm(`import { evil as publicRoute } from "@/app/lib/auth/route-handlers";\nexport const GET = publicRoute(undefined, () => Response.json({}));`, "GET", "app/api/x/route.ts", ROOT).form).not.toBe("canonical-wrapper");
  });
  it("the generator's pure scan agrees with the checked-in baseline (no drift: same keys AND the same per-route source sha1)", () => {
    const current = currentRawMethods(ROOT);
    const currentKeys = current.map((e) => `${e.route}#${e.method}`).sort();
    const checked = [...baselineKeys].sort();
    expect(currentKeys).toEqual(checked);
    // [B16-A F28] comparing keys alone let a baseline-tracked raw route change
    // silently (B16.1C edited POST /api/pcb-sync while the baseline kept the
    // b7bb6d6 sha1). Every entry's sha1 must equal the route source on disk, so
    // an edit to a tracked raw route fails CI until the baseline is regenerated
    // by the sanctioned generator (which still refuses additions).
    const currentSha1 = new Map(current.map((e) => [`${e.route}#${e.method}`, e.sha1]));
    const drifted = (baseline as Array<{ method: string; route: string; sha1: string }>)
      .filter((e) => currentSha1.get(`${e.route}#${e.method}`) !== e.sha1)
      .map((e) => `${e.method} ${e.route}: baseline sha1 ${e.sha1} ≠ source sha1 ${currentSha1.get(`${e.route}#${e.method}`) ?? "(absent)"}`);
    expect(drifted, `baseline-tracked raw route source changed since _raw-route-baseline.json was generated — regenerate it with \`pnpm exec tsx scripts/generate-b16-0-8-baseline.ts\` from the repository root and commit the result:\n${drifted.join("\n")}`).toEqual([]);
  });
});
