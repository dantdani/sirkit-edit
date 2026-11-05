// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import type { BomResult, BomRow } from "@/app/lib/bom/build";
import type { ProjectSelectorScope } from "@/app/lib/project/project-selector";
import { BomView } from "../BomView";

const SCOPE: ProjectSelectorScope = { tenantId: "tenant-a", projectId: "project-a", branchId: "main" };
const STORAGE_KEY = "sirkit:bom:pricingChoice";

function schematic(partId: string, value = "Original value"): SchematicState {
  return {
    components: [], wires: [],
    kicadComponents: [{ id: "instance-1", partId, x: 0, y: 0, rotation: 0, refDes: "U1", value }],
  };
}

function bom(partId: string, name: string): BomResult {
  const row: BomRow = {
    partId, atomicRevisionId: null, refDes: "U1", refDesList: ["U1"], qty: 1, name,
    mpn: null, manufacturer: null, package: null, value: null, datasheet: null, category: null,
    pricing: null, lifecycleStatus: "unknown", alternatesCount: 2,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

interface PendingRead {
  url: string;
  init: RequestInit;
  response: ReturnType<typeof deferred<Response>>;
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

/** Deliberately ignores aborts: a retired transport that still resolves must not update the active view. */
function pendingReads(deferDurable = false) {
  const reads: PendingRead[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (!deferDurable && url === "/api/bom/snapshot") return json({ ok: true, snapshots: [] });
    if (!deferDurable && url === "/api/bom/notifications") return json({ ok: true, notifications: [] });
    const response = deferred<Response>();
    reads.push({ url, init, response });
    return response.promise;
  });
  vi.stubGlobal("fetch", fetchMock);
  return reads;
}

async function respond(read: PendingRead, value: unknown, status = 200) {
  await act(async () => {
    read.response.resolve(json(value, status));
    await read.response.promise;
  });
}

const bomReads = (reads: PendingRead[]) => reads.filter((read) => read.url === "/api/bom");
const projectOf = (read: PendingRead) => new Headers(read.init.headers).get("x-sirkit-project-id");
const rowName = { selector: "td > div.font-medium" };
const snapshot = (label: string) => ({ id: label, label, takenAt: "2026-10-11T12:00:00Z", rowCount: 1, totalCostCents: null, currency: null, designRiskScore: 50 });
const notification = (summary: string) => ({ id: summary, type: "availability", severity: "info", partId: null, summary, createdAt: "2026-10-11T12:00:00Z", readAt: null });

beforeEach(() => window.localStorage.setItem(STORAGE_KEY, "none"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe("BOM read retirement", () => {
  it.each([
    { ...SCOPE, projectId: "project-b" },
    { ...SCOPE, tenantId: "tenant-b" },
    { ...SCOPE, branchId: "review" },
  ])("keeps only the active scope's BOM, history and notifications after switching to %j", async (nextScope) => {
    const reads = pendingReads(true);
    const state = schematic("source-a");
    const view = render(<BomView state={state} projectScope={SCOPE} />);
    await waitFor(() => expect(reads).toHaveLength(3));
    const retired = [...reads];

    view.rerender(<BomView state={state} projectScope={nextScope} />);
    await waitFor(() => expect(reads).toHaveLength(6));
    const active = reads.slice(3);
    for (const read of retired) expect(read.init.signal?.aborted).toBe(true);
    for (const read of active) {
      const headers = new Headers(read.init.headers);
      expect(headers.get("x-sirkit-tenant-id")).toBe(nextScope.tenantId);
      expect(headers.get("x-sirkit-project-id")).toBe(nextScope.projectId);
      expect(headers.get("x-sirkit-branch-id")).toBe(nextScope.branchId);
      await respond(read, read.url === "/api/bom" ? bom("source-a", "Active scope component")
        : read.url === "/api/bom/snapshot" ? { ok: true, snapshots: [snapshot("Active scope snapshot")] }
          : { ok: true, notifications: [notification("Active scope notification")] });
    }
    await screen.findByText("Active scope component", rowName);

    for (const read of retired) await respond(read, read.url === "/api/bom" ? bom("source-a", "Retired scope component")
      : read.url === "/api/bom/snapshot" ? { ok: true, snapshots: [snapshot("Retired scope snapshot")] }
        : { ok: true, notifications: [notification("Retired scope notification")] });
    expect(screen.queryAllByText("Retired scope component")).toHaveLength(0);
    expect(screen.getByText("Active scope component", rowName)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "History (1)" }));
    const history = await screen.findByRole("dialog", { name: "Snapshot history" });
    expect(within(history).getByText("Active scope snapshot")).toBeTruthy();
    expect(within(history).queryByText("Retired scope snapshot")).toBeNull();
    fireEvent.click(within(history).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByTitle("Supply-chain notifications"));
    const notifications = await screen.findByRole("dialog", { name: "Notifications" });
    expect(within(notifications).getByText("Active scope notification")).toBeTruthy();
    expect(within(notifications).queryByText("Retired scope notification")).toBeNull();
  });

  it("a late answer for changed component content cannot replace the newest BOM", async () => {
    const reads = pendingReads();
    const view = render(<BomView state={schematic("source-a")} projectScope={SCOPE} />);
    await waitFor(() => expect(bomReads(reads)).toHaveLength(1));
    view.rerender(<BomView state={schematic("source-a", "Updated value")} projectScope={{ ...SCOPE }} />);
    await waitFor(() => expect(bomReads(reads)).toHaveLength(2));
    const [retired, active] = bomReads(reads);
    expect(retired.init.signal?.aborted).toBe(true);
    expect(projectOf(active)).toBe(SCOPE.projectId);
    expect(JSON.parse(String(active.init.body)).state.kicadComponents[0].value).toBe("Updated value");
    await respond(active, bom("source-a", "Newest component value"));
    await screen.findByText("Newest component value", rowName);
    await respond(retired, bom("source-a", "Old component value"));
    expect(screen.queryAllByText("Old component value")).toHaveLength(0);
    expect(screen.getByText("Newest component value", rowName)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(false);
  });

  it("a retired pricing-source error cannot erase a newer source's successful result", async () => {
    const reads = pendingReads();
    render(<BomView state={schematic("source-a")} projectScope={SCOPE} />);
    await waitFor(() => expect(bomReads(reads)).toHaveLength(1));
    await respond(bomReads(reads)[0], bom("source-a", "Initial source result"));
    await screen.findByText("Initial source result", rowName);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "digikey" } });
    await waitFor(() => expect(bomReads(reads)).toHaveLength(2));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "octopart" } });
    await waitFor(() => expect(bomReads(reads)).toHaveLength(3));
    const [, retired, active] = bomReads(reads);
    expect(retired.init.signal?.aborted).toBe(true);
    expect(JSON.parse(String(active.init.body)).pricingChoice).toBe("octopart");
    await respond(active, bom("source-a", "Current source result"));
    await screen.findByText("Current source result", rowName);
    await respond(retired, { ok: false, error: "Retired source failure" }, 503);
    expect(screen.getByText("Current source result", rowName)).toBeTruthy();
    expect(screen.queryAllByText(/Retired source failure/)).toHaveLength(0);
    expect(screen.queryByTestId("bom-offline")).toBeNull();
  });

  it("replacing the drawer's source component retires its pending alternates and prevents an obsolete swap", async () => {
    const reads = pendingReads();
    const onSwapPart = vi.fn();
    const view = render(<BomView state={schematic("source-a")} projectScope={SCOPE} onSwapPart={onSwapPart} />);
    await waitFor(() => expect(bomReads(reads)).toHaveLength(1));
    await respond(bomReads(reads)[0], bom("source-a", "Original source component"));
    fireEvent.click(await screen.findByTitle("View alternate parts"));
    await screen.findByRole("dialog", { name: /^Alternates for U1/ });
    await waitFor(() => expect(reads.filter((read) => read.url.startsWith("/api/parts/"))).toHaveLength(1));
    const retiredAlternates = reads.find((read) => read.url.startsWith("/api/parts/"))!;

    view.rerender(<BomView state={schematic("source-b")} projectScope={SCOPE} onSwapPart={onSwapPart} />);
    await waitFor(() => expect(bomReads(reads)).toHaveLength(2));
    expect(screen.queryByRole("dialog", { name: /^Alternates for U1/ })).toBeNull();
    expect(retiredAlternates.init.signal?.aborted).toBe(true);
    await respond(bomReads(reads)[1], bom("source-b", "Replacement source component"));
    await respond(retiredAlternates, { ok: true, alternates: [{ partId: "obsolete-alternate", name: "Obsolete alternate", mpn: null, manufacturer: null, package: null, lifecycleStatus: "active", stock: null, bestPrice: null, kind: "drop_in", score: 80, matchReasons: [] }] });
    expect(screen.queryByText("Obsolete alternate")).toBeNull();
    expect(onSwapPart).not.toHaveBeenCalled();
    expect(screen.getByText("Replacement source component", rowName)).toBeTruthy();
  });

  it("changing only the atomic revision refreshes the BOM and discards the old revision's answer", async () => {
    const reads = pendingReads();
    const original = schematic("source-a");
    original.kicadComponents![0].atomicPartRevisionId = "atomic_revision_a";
    const changed: SchematicState = { ...original, kicadComponents: [{ ...original.kicadComponents![0], atomicPartRevisionId: "atomic_revision_b" }] };
    const view = render(<BomView state={original} projectScope={SCOPE} />);
    await waitFor(() => expect(bomReads(reads)).toHaveLength(1));
    view.rerender(<BomView state={changed} projectScope={SCOPE} />);
    await waitFor(() => expect(bomReads(reads)).toHaveLength(2));
    const [retired, active] = bomReads(reads);
    expect(retired.init.signal?.aborted).toBe(true);
    expect(JSON.parse(String(active.init.body)).state.kicadComponents[0].atomicPartRevisionId).toBe("atomic_revision_b");
    const latest = bom("source-a", "Current atomic revision");
    latest.rows[0].atomicRevisionId = "atomic_revision_b";
    await respond(active, latest);
    await screen.findByText("Current atomic revision", rowName);
    const obsolete = bom("source-a", "Obsolete atomic revision");
    obsolete.rows[0].atomicRevisionId = "atomic_revision_a";
    await respond(retired, obsolete);
    expect(screen.queryAllByText("Obsolete atomic revision")).toHaveLength(0);
    expect(screen.getByText("Current atomic revision", rowName)).toBeTruthy();
  });

  it("renaming a theory component's display reference refreshes without changing its stable identity", async () => {
    const reads = pendingReads();
    const original: SchematicState = { components: [{ id: "stable-resistor", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k", refDes: "R1" }], wires: [] };
    const changed: SchematicState = { ...original, components: [{ ...original.components[0], refDes: "R10" }] };
    const view = render(<BomView state={original} projectScope={SCOPE} />);
    await waitFor(() => expect(bomReads(reads)).toHaveLength(1));
    view.rerender(<BomView state={changed} projectScope={SCOPE} />);
    await waitFor(() => expect(bomReads(reads)).toHaveLength(2));
    const [retired, active] = bomReads(reads);
    expect(retired.init.signal?.aborted).toBe(true);
    expect(JSON.parse(String(active.init.body)).state.components[0]).toMatchObject({ id: "stable-resistor", refDes: "R10" });
    const current = bom("unused", "Resistor");
    current.rows[0] = { ...current.rows[0], partId: null, refDes: "R10", refDesList: ["R10"], alternatesCount: 0 };
    await respond(active, current);
    await screen.findByText("R10", { selector: "td" });
    const obsolete = bom("unused", "Resistor");
    obsolete.rows[0] = { ...obsolete.rows[0], partId: null, refDes: "R1", refDesList: ["R1"], alternatesCount: 0 };
    await respond(retired, obsolete);
    expect(screen.queryAllByText("R1", { selector: "td" })).toHaveLength(0);
    expect(screen.getByText("R10", { selector: "td" })).toBeTruthy();
  });

  it("a stale alternate control cannot read the removed source while the fresh replacement still opens", async () => {
    const reads = pendingReads();
    const view = render(<BomView state={schematic("source-a")} projectScope={SCOPE} />);
    await waitFor(() => expect(bomReads(reads)).toHaveLength(1));
    await respond(bomReads(reads)[0], bom("source-a", "Source before replacement"));
    await screen.findByText("Source before replacement", rowName);
    view.rerender(<BomView state={schematic("source-b")} projectScope={SCOPE} />);
    await waitFor(() => expect(bomReads(reads)).toHaveLength(2));
    // A result may remain visible while refreshing; its controls may not act for the new design.
    fireEvent.click(screen.getByTitle("View alternate parts"));
    expect(screen.queryByRole("dialog", { name: /^Alternates for/ })).toBeNull();
    expect(reads.filter((read) => read.url.startsWith("/api/parts/"))).toHaveLength(0);
    await respond(bomReads(reads)[1], bom("source-b", "Fresh replacement source"));
    await screen.findByText("Fresh replacement source", rowName);
    fireEvent.click(screen.getByTitle("View alternate parts"));
    await screen.findByRole("dialog", { name: /^Alternates for U1/ });
    await waitFor(() => expect(reads.filter((read) => read.url.startsWith("/api/parts/"))).toHaveLength(1));
    expect(reads.find((read) => read.url.startsWith("/api/parts/"))!.url).toBe("/api/parts/source-b/alternates?kind=all&limit=50");
  });
});
