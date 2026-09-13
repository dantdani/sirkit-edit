// @vitest-environment jsdom
/**
 * [B19-E E1] The BOM workbench says where each offer came from, whether it is live or cached, when it was observed and when
 * it expires; unavailable and paused sources are structured chips; nothing reads as sending or placing an order; offline
 * keeps the last result without serving an expired offer.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BomView } from "../BomView";
import { utcMinute } from "@/app/lib/acquisition/source-labels";

const SCOPE = { tenantId: "local", projectId: "p1", branchId: "main" };
const STATE = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", x: 0, y: 0, rotation: 0, refDes: "U1", value: "ATmega328P" }] } as never;
const STORAGE_KEY = "sirkit:bom:pricingChoice";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DIGIKEY_PAGE = "https://www.digikey.com/en/products/detail/microchip/ATMEGA328P-AU/1832260";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function offer(distributor: string, servedFrom: string, retrievedAt: number, price: number, stock: number, extra: Record<string, unknown> = {}) {
  return { distributor, mpn: "ATMEGA328P-AU", manufacturer: "Microchip", description: null, datasheet: null, inStock: stock, minOrderQty: 1, priceBreaks: [{ qty: 1, price, currency: "USD" }], bestUnitPrice: price, productUrl: null, package: null, sku: null, lifecycleStatus: "active", lifecycleRaw: null, fetchedAt: retrievedAt, provenance: { servedFrom, retrievedAt }, ...extra };
}

const source = (sourceId: string, displayName: string, status: string, ownerDecision: string | null, retryAt: number | null = null) => ({ sourceId, displayName, status, ownerDecision, retryAt, freshnessLabel: `${displayName} freshness`, attribution: `Credit ${displayName}` });

function bomResult(t0: number, sources = [source("digikey", "DigiKey", "available", "OD-33"), source("mouser", "Mouser", "disabled", "OD-32"), source("octopart", "Octopart (Nexar)", "paused", "OD-33", t0 + 15 * MINUTE), source("lcsc", "LCSC", "blocked", null)]) {
  const digikey = offer("digikey", "offer-cache", t0 - 30 * MINUTE, 2.75, 5000, { sku: "ATMEGA328P-AU-ND", productUrl: DIGIKEY_PAGE });
  const octopart = offer("octopart-aggregated", "live", t0 - MINUTE, 2.9, 1200);
  return {
    ok: true,
    rows: [{
      partId: "p1", atomicRevisionId: null, refDes: "U1", refDesList: ["U1"], qty: 1, name: "ATmega328P-AU", mpn: "ATMEGA328P-AU", manufacturer: "Microchip", package: "TQFP-32", value: "ATmega328P", datasheet: null, category: null,
      pricing: { partId: "p1", mpn: "ATMEGA328P-AU", offers: [digikey, octopart], bestOverall: digikey, lifecycleStatus: "active", sourcesQueried: ["octopart-aggregated"], sourcesFromCache: 1, sourcesFromLive: 1 },
      lifecycleStatus: "active", alternatesCount: 0,
      riskScore: { total: 90, grade: "excellent", components: { lifecycle: 35, availability: 30, diversity: 10, pricing: 15 }, notes: [] },
    }],
    totalUnitsAvailable: [{ mpn: "ATMEGA328P-AU", available: 6200 }],
    estimatedProjectCost: { value: 2.75, currency: "USD" },
    pricingSource: "all",
    cached: 1,
    fetched: 1,
    lifecycleSummary: { active: 1, nrnd: 0, last_time_buy: 0, eol: 0, obsolete: 0, unknown: 0, totalRows: 1, riskRecommendation: "ok" },
    riskSummary: { overallScore: 90, overallGrade: "excellent", totalRows: 1, rowsAtRisk: 0, worstRows: [], productionReady: true, recommendation: "Supply signals look healthy." },
    warnings: [],
    pricingMode: "live",
    registryVersion: "1.0.0",
    sources,
  };
}

type BomAnswer = () => Promise<Response> | Response;

function stubFetch(answer: { bom: BomAnswer }) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url === "/api/bom") return answer.bom();
    if (url === "/api/bom/snapshot") return json({ ok: true, snapshots: [] });
    if (url === "/api/bom/notifications") return json({ ok: true, notifications: [] });
    if (url.startsWith("/api/bom/cart/")) return new Response("Quantity,Manufacturer Part Number\n1,ATMEGA328P-AU\n", { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8" } });
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bomBodies = (fetchMock: ReturnType<typeof stubFetch>) => fetchMock.mock.calls.filter(([url]) => url === "/api/bom").map(([, init]) => JSON.parse(String(init?.body)) as { pricingChoice: string });

let openSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.setItem(STORAGE_KEY, "all");
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:sirkit-bom"), configurable: true, writable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true, writable: true });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  openSpy = vi.fn(() => null);
  vi.spyOn(window, "open").mockImplementation(openSpy as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

async function renderLoaded(t0: number, answer: { bom: BomAnswer } = { bom: () => json(bomResult(t0)) }) {
  const fetchMock = stubFetch(answer);
  render(<BomView state={STATE} projectScope={SCOPE} />);
  await screen.findByText("U1");
  await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("all"));
  return fetchMock;
}

describe("[B19-E E1] exporting for a distributor downloads a file; nothing is opened, sent or ordered", () => {
  it("never calls window.open; the banner says the file downloaded and no order was placed, without the word cart; the person clicks the vendor link", async () => {
    const t0 = Date.now();
    const fetchMock = await renderLoaded(t0);
    const before = window.location.href;
    expect(screen.queryByText(/Send to/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Export for distributor/ }));
    fireEvent.click(screen.getByRole("button", { name: /DigiKey BOM Manager/ }));
    const notice = await screen.findByTestId("bom-export-notice");
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/bom/cart/digikey")).toBe(true);
    expect(openSpy).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
    const text = notice.textContent ?? "";
    expect(text).toMatch(/downloaded/i);
    expect(text.toLowerCase()).toContain("no order was placed");
    expect(text).not.toMatch(/cart/i);
    const link = within(notice).getByRole("link", { name: /Open DigiKey upload page/ }) as HTMLAnchorElement;
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("href")).toMatch(/^https:\/\/(www\.)?digikey\.com\//);
    fireEvent.click(within(notice).getByTitle("Dismiss"));
    expect(screen.queryByTestId("bom-export-notice")).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("the worksheet reads as an unverified sourcing worksheet, not procurement; counts read cached and live", async () => {
    const t0 = Date.now();
    await renderLoaded(t0);
    expect(screen.getByText("1 cached · 1 live")).toBeTruthy();
    expect(screen.getByText("1 line item · 1 cached · 1 live")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Export for distributor/ }));
    fireEvent.click(screen.getByRole("button", { name: /Sourcing worksheet \(CSV, unverified\)/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Sourcing worksheet \(CSV, unverified\)/);
    expect(document.body.textContent).not.toMatch(/procurement packet/i);
  });
});

describe("[B19-E E1] each offer states its basis, observation and expiry", () => {
  it("OfferDetail shows live or cached, the observed time and the expiry from the registry's freshness", async () => {
    const t0 = Date.now();
    await renderLoaded(t0);
    fireEvent.click(screen.getByText("U1"));
    const rows = await screen.findAllByTestId("bom-offer");
    const byDistributor = Object.fromEntries(rows.map((row) => [row.getAttribute("data-distributor"), row]));
    const digikey = byDistributor["digikey"]!;
    expect(within(digikey).getByTestId("offer-basis").textContent).toBe("cached");
    expect(within(digikey).getByTestId("offer-observed").textContent).toContain(utcMinute(t0 - 30 * MINUTE));
    expect(within(digikey).getByTestId("offer-expires").textContent).toContain(utcMinute(t0 + 30 * MINUTE));
    const octopart = byDistributor["octopart-aggregated"]!;
    expect(within(octopart).getByTestId("offer-basis").textContent).toBe("live");
    expect(within(octopart).getByTestId("offer-observed").textContent).toContain(utcMinute(t0 - MINUTE));
    expect(within(octopart).getByTestId("offer-expires").textContent).toContain(utcMinute(t0 - MINUTE + 24 * HOUR));
  });
});

describe("[B19-E E1] offline keeps the last result and never serves an expired offer", () => {
  it("a failed refetch shows the offline banner with Retry; an offer past its expiry is blanked; Retry fetches again", async () => {
    const t0 = Date.now();
    const answer: { bom: BomAnswer } = { bom: () => json(bomResult(t0)) };
    const fetchMock = await renderLoaded(t0, answer);
    fireEvent.click(screen.getByText("U1"));
    await screen.findAllByTestId("bom-offer");
    expect(screen.getAllByText("2.75 USD").length).toBeGreaterThan(0);

    vi.spyOn(Date, "now").mockReturnValue(t0 + 2 * HOUR); // DigiKey's one-hour observation has expired; Octopart's day has not
    answer.bom = () => Promise.reject(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));
    const banner = await screen.findByTestId("bom-offline");
    expect(banner.textContent).toMatch(/offline/i);
    expect(screen.getByText("U1")).toBeTruthy(); // the last result stays
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();

    const rows = screen.getAllByTestId("bom-offer");
    const digikey = rows.find((row) => row.getAttribute("data-distributor") === "digikey")!;
    const octopart = rows.find((row) => row.getAttribute("data-distributor") === "octopart-aggregated")!;
    expect(digikey.textContent).toMatch(/expired/i);
    expect(digikey.textContent).not.toContain("2.75");
    expect(digikey.textContent).not.toContain("5,000");
    expect(digikey.querySelector("a")).toBeNull();
    expect(octopart.textContent).toContain("2.90 USD");
    expect(screen.queryByText("2.75 USD")).toBeNull(); // not in the row, the offers or the project cost
    expect(document.body.textContent).not.toContain("5,000"); // nor its stock, anywhere (the risk breakdown included)
    expect(document.querySelector(`a[href="${DIGIKEY_PAGE}"]`)).toBeNull();

    const calls = bomBodies(fetchMock).length;
    answer.bom = () => json(bomResult(t0));
    fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByTestId("bom-offline")).toBeNull());
    expect(bomBodies(fetchMock).length).toBe(calls + 1);
  });
});

describe("[B19-E E1] the picker and the source chips come from the registry", () => {
  it("Mouser is listed but disabled under OD-32; a stored choice that is no longer selectable is not kept", async () => {
    window.localStorage.setItem(STORAGE_KEY, "mouser");
    const t0 = Date.now();
    const fetchMock = stubFetch({ bom: () => json(bomResult(t0)) });
    render(<BomView state={STATE} projectScope={SCOPE} />);
    await screen.findByText("U1");
    const mouser = screen.getByRole("option", { name: /Mouser/ }) as HTMLOptionElement;
    expect(mouser.disabled).toBe(true);
    expect(mouser.textContent).toContain("OD-32");
    for (const name of [/DigiKey/, /Octopart/]) expect((screen.getByRole("option", { name }) as HTMLOptionElement).disabled).toBe(false);
    await waitFor(() => expect(bomBodies(fetchMock).length).toBeGreaterThan(0));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("none");
    expect(bomBodies(fetchMock).every((body) => body.pricingChoice !== "mouser")).toBe(true);
  });

  it("no Production-ready claim; chips show paused with its retry time and disabled with its owner decision", async () => {
    const t0 = Date.now();
    await renderLoaded(t0);
    expect(screen.queryByText(/Production-ready/i)).toBeNull();
    expect(screen.getByText("Supply signals OK (observed)")).toBeTruthy();
    const chips = screen.getAllByTestId("bom-source-chip");
    const chip = (id: string) => chips.find((element) => element.getAttribute("data-source") === id)!;
    expect(chip("octopart").getAttribute("data-status")).toBe("paused");
    expect(chip("octopart").textContent).toContain("Octopart (Nexar)");
    expect(chip("octopart").textContent).toContain(utcMinute(t0 + 15 * MINUTE));
    expect(chip("mouser").textContent).toMatch(/disabled/);
    expect(chip("mouser").textContent).toContain("OD-32");
    expect(chip("lcsc").textContent).toMatch(/blocked/);
    expect(chip("digikey").textContent).toMatch(/available/);
  });

  it("a source without credentials says only that credentials are not configured", async () => {
    const t0 = Date.now();
    await renderLoaded(t0, { bom: () => json(bomResult(t0, [source("digikey", "DigiKey", "credentials_missing", "OD-33"), source("octopart", "Octopart (Nexar)", "operator_disabled", "OD-33")])) });
    const chips = screen.getAllByTestId("bom-source-chip");
    const digikey = chips.find((element) => element.getAttribute("data-source") === "digikey")!;
    expect(digikey.textContent).toMatch(/credentials not configured/);
    expect(digikey.textContent).not.toMatch(/DIGIKEY_|CLIENT_ID|SECRET|=/);
    expect(chips.find((element) => element.getAttribute("data-source") === "octopart")!.textContent).toMatch(/switched off/);
  });
});
