// @vitest-environment jsdom
/**
 * [PR-B] The BOM view's refresh intent and settlement (assignment checkpoint B.3).
 *
 *  1. "Refresh prices" bypasses the cache for the request its click starts, and the force intent is read by the effect and
 *     cleared only by the request that was answered (never consumed by a run that is aborted). The case renders under
 *     StrictMode so the development double-invocation of mount effects is exercised (the assertion on the two initial
 *     reads is the proof); it is a PIN, not a reproduction: the pending tree's consume-at-start flag was reviewed as a
 *     development-only defect, but StrictMode double-invokes MOUNT effects only, so a Refresh click (a dependency change)
 *     ran its effect once and the pending code also sent the forced request. Recorded in root-causes-and-fixes.md.
 *  2. A failure outside the fetch's own handling still settles the request: the error is shown and Refresh is enabled;
 *     "Loading…" never sticks.
 *
 * Failing first on the pending tree (2026-10-14): case 2 (the view stayed loading, the error never shown; the request's
 * rejection was unhandled). Case 1 passed on the pending tree (see above).
 */
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import type { BomResult, BomRow } from "@/app/lib/bom/build";
import type { ProjectSelectorScope } from "@/app/lib/project/project-selector";
import { BomView } from "../BomView";

const SCOPE: ProjectSelectorScope = { tenantId: "tenant-a", projectId: "project-a", branchId: "main" };
const STORAGE_KEY = "sirkit:bom:pricingChoice";
const state: SchematicState = { components: [], wires: [], kicadComponents: [{ id: "instance-1", partId: "part-a", x: 0, y: 0, rotation: 0, refDes: "U1", value: "Original value" }] };

function bom(name: string): BomResult {
  const row: BomRow = {
    partId: "part-a", atomicRevisionId: null, refDes: "U1", refDesList: ["U1"], qty: 1, name,
    mpn: null, manufacturer: null, package: null, value: null, datasheet: null, category: null,
    pricing: null, lifecycleStatus: "unknown", alternatesCount: 0,
    riskScore: { total: 50, grade: "caution", components: { lifecycle: 17, availability: 0, diversity: 0, pricing: 0 }, notes: [] },
  };
  return {
    ok: true, rows: [row], totalUnitsAvailable: [], estimatedProjectCost: { value: null, currency: null },
    pricingSource: "none", cached: 0, fetched: 0,
    lifecycleSummary: { active: 0, nrnd: 0, last_time_buy: 0, eol: 0, obsolete: 0, unknown: 1, totalRows: 1, riskRecommendation: "review" },
    riskSummary: { overallScore: 50, overallGrade: "caution", totalRows: 1, rowsAtRisk: 1, worstRows: [], productionReady: false, recommendation: "Supply signals unknown." },
    warnings: [], pricingMode: "none", registryVersion: "1.1.0", sources: [], generatedAt: Date.now(),
  };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => window.localStorage.setItem(STORAGE_KEY, "digikey")); // "Refresh prices" is disabled while no live source is chosen
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe("BOM refresh lifecycle", () => {
  it("Refresh prices bypasses the cache for the request that survives React's development double-invocation", async () => {
    const reads: Array<{ init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url !== "/api/bom") return json({ ok: true, snapshots: [], notifications: [] });
      reads.push({ init });
      return json(bom("Part A"));
    }));
    render(<StrictMode><BomView state={state} projectScope={SCOPE} /></StrictMode>);
    await screen.findByText("Part A", { selector: "td > div.font-medium" });
    const before = reads.length;
    expect(before).toBeGreaterThanOrEqual(2); // the double-invoked effect started two reads: proof the harness exercises the case
    fireEvent.click(screen.getByRole("button", { name: /Refresh prices/ }));
    await waitFor(() => expect(reads.length).toBeGreaterThan(before));
    await act(async () => {});
    const started = reads.slice(before);
    const surviving = started.filter((read) => !(read.init.signal as AbortSignal | undefined)?.aborted);
    expect(surviving).toHaveLength(1);
    expect(JSON.parse(String(surviving[0].init.body)).forceRefresh).toBe(true);
  });

  it("a failure outside the fetch's own handling still settles the request: the error shows and Refresh is enabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url !== "/api/bom") return json({ ok: true, snapshots: [], notifications: [] });
      return { get ok(): boolean { throw new Error("transport exploded"); }, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }));
    render(<BomView state={state} projectScope={SCOPE} />);
    await screen.findByText(/could not be built \(transport exploded\)/);
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Refresh prices" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
