// @vitest-environment jsdom
/**
 * [B19-E E5 g, h] "Use published exact revision" in the Build Library part preview.
 *
 * Shown only when the part has a selectable atomic link for the value a placement would take (the part's `atomicAssignments`,
 * resolved the way Build auto-layout resolves them); it starts a placement that adopts that exact identity through the canonical
 * schematic edit path. An unlinked part, or a value whose own link was withdrawn, offers nothing to adopt. Place is unchanged.
 *
 * Reproduced on the unchanged code: the control did not exist and placement never carried an exact identity.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildLibraryPanel } from "../BuildLibraryPanel";

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const link = (revisionId: string) => ({ revisionId, symbolVersionId: `sym-${revisionId}`, footprintVersionId: `fp-${revisionId}`, mappingCertificateId: `map-${revisionId}`, footprintFullName: "Resistor_SMD:R_0805_2012Metric", approved: true });

function detail(extra: Record<string, unknown>) {
  return { id: "part-r", name: "R", description: null, keywords: null, mpn: null, manufacturer: null, datasheet: null, footprintHint: null, mainCategory: "Resistor", libraryName: "Device", pins: [], symbolRaw: "", properties: { Value: "10k" }, ...extra };
}

function stubFetch(part: ReturnType<typeof detail>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/parts/categories") return json({ ok: true, categories: [{ mainCategory: "Resistor", partCount: 1 }] });
    if (url === "/api/parts/search") return json({ ok: true, results: [{ id: "part-r", name: "R", description: null, keywords: null, mpn: null, manufacturer: null, datasheet: null, mainCategory: "Resistor", libraryName: "Device", pinCount: 2, score: 1 }], pagination: { total: 1, offset: 0, limit: 30 } });
    if (url === "/api/parts/part-r") return json({ ok: true, part });
    throw new Error(`unexpected request ${url}`);
  }));
}

async function openPreview(onSelectForPlacement: (...args: unknown[]) => void) {
  render(<BuildLibraryPanel onSelectForPlacement={onSelectForPlacement} />);
  fireEvent.click(await screen.findByText("Resistor"));
  fireEvent.click(await screen.findByText("R", { selector: "div" }));
  await screen.findByRole("button", { name: /Place/ });
}

const elementPrototype = Element.prototype as unknown as { getAnimations?: () => unknown[] };
const hadGetAnimations = typeof elementPrototype.getAnimations === "function";
beforeEach(() => {
  if (typeof globalThis.ResizeObserver === "undefined") vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  if (!hadGetAnimations) elementPrototype.getAnimations = () => [];
});
afterEach(async () => { cleanup(); await new Promise((resolve) => setTimeout(resolve, 0)); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("[B19-E E5] Use published exact revision", () => {
  it("a part with a selectable link for its value offers it, and the placement it starts adopts the exact revision", async () => {
    stubFetch(detail({ atomicAssignments: { "10k": link("rev-10k") } }));
    const onSelectForPlacement = vi.fn();
    await openPreview(onSelectForPlacement);
    fireEvent.click(screen.getByRole("button", { name: "Use published exact revision" }));
    // [B19-E E5 review] the identity is resolved from the fresh /api/parts/[id] detail that made the control visible — never from
    // the page's process-lifetime part cache, which is never invalidated when a link is withdrawn
    expect(onSelectForPlacement).toHaveBeenCalledWith("part-r", { exactIdentity: { atomicPartRevisionId: "rev-10k", symbolAssetVersionId: "sym-rev-10k", footprintAssetVersionId: "fp-rev-10k", mappingCertificateId: "map-rev-10k", forValue: "10k" } });
    fireEvent.click(screen.getByRole("button", { name: /Place/ }));
    expect(onSelectForPlacement).toHaveBeenLastCalledWith("part-r");
  });

  it("an unlinked part offers nothing to adopt", async () => {
    stubFetch(detail({}));
    await openPreview(vi.fn());
    expect(screen.queryByRole("button", { name: "Use published exact revision" })).toBeNull();
  });

  it("a value whose own link was withdrawn does not fall back to the default link", async () => {
    stubFetch(detail({ atomicAssignments: { "": link("rev-default") }, withdrawnValueKeys: ["10k"] }));
    await openPreview(vi.fn());
    expect(screen.queryByRole("button", { name: "Use published exact revision" })).toBeNull();
  });
});
