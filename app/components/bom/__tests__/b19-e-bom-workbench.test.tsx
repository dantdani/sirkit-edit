// @vitest-environment jsdom
/**
 * [B19-E E1] The BOM workbench says where each offer came from, whether it is live or cached, when it was observed and when
 * it expires; unavailable and paused sources are structured chips; nothing reads as sending or placing an order; offline
 * keeps the last result without serving an expired offer.
 *
 * [B19-E E1-C review] Expiry follows the clock whether or not the view is online, judged in server time; only a request that
 * got no answer is offline; an expired offer drives no sort order, risk note or supply badge; a kept result that was for a
 * different pricing choice or design shows no cost, sources or offer prices.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BomView } from "../BomView";
import { utcMinute } from "@/app/lib/acquisition/source-labels";

const SCOPE = { tenantId: "local", projectId: "p1", branchId: "main" };
const STATE = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", x: 0, y: 0, rotation: 0, refDes: "U1", value: "ATmega328P" }] } as never;
const STATE_CHANGED = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", x: 0, y: 0, rotation: 0, refDes: "U1", value: "ATmega328PB" }] } as never;
const STORAGE_KEY = "sirkit:bom:pricingChoice";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DIGIKEY_PAGE = "https://www.digikey.com/en/products/detail/microchip/ATMEGA328P-AU/1832260";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

function offer(distributor: string, servedFrom: string, retrievedAt: number, price: number, stock: number, extra: Record<string, unknown> = {}) {
  return { distributor, mpn: "ATMEGA328P-AU", manufacturer: "Microchip", description: null, datasheet: null, inStock: stock, minOrderQty: 1, priceBreaks: [{ qty: 1, price, currency: "USD" }], bestUnitPrice: price, productUrl: null, package: null, sku: null, lifecycleStatus: "active", lifecycleRaw: null, fetchedAt: retrievedAt, provenance: { servedFrom, retrievedAt }, ...extra };
}

type Offer = ReturnType<typeof offer>;

const source = (sourceId: string, displayName: string, status: string, ownerDecision: string | null, retryAt: number | null = null) => ({ sourceId, displayName, status, ownerDecision, retryAt, freshnessLabel: `${displayName} freshness`, attribution: `Credit ${displayName}` });

function line(refDes: string, offers: Offer[], best: Offer | null, extra: Record<string, unknown> = {}) {
  return {
    partId: refDes === "U1" ? "p1" : `p-${refDes}`, atomicRevisionId: null, refDes, refDesList: [refDes], qty: 1, name: "ATmega328P-AU", mpn: "ATMEGA328P-AU", manufacturer: "Microchip", package: "TQFP-32", value: "ATmega328P", datasheet: null, category: null,
    pricing: { partId: "p1", mpn: "ATMEGA328P-AU", offers, bestOverall: best, lifecycleStatus: "active", sourcesQueried: ["octopart-aggregated"], sourcesFromCache: 1, sourcesFromLive: 1 },
    lifecycleStatus: "active", alternatesCount: 0,
    riskScore: { total: 90, grade: "excellent", components: { lifecycle: 35, availability: 30, diversity: 10, pricing: 15 }, notes: [] },
    ...extra,
  };
}

const defaultRows = (t0: number) => {
  const digikey = offer("digikey", "offer-cache", t0 - 30 * MINUTE, 2.75, 5000, { sku: "ATMEGA328P-AU-ND", productUrl: DIGIKEY_PAGE });
  const octopart = offer("octopart-aggregated", "live", t0 - MINUTE, 2.9, 1200);
  return [line("U1", [digikey, octopart], digikey)];
};

function bomResult(t0: number, sources = [source("digikey", "DigiKey", "available", "OD-33"), source("mouser", "Mouser", "disabled", "OD-32"), source("octopart", "Octopart (Nexar)", "paused", "OD-33", t0 + 15 * MINUTE), source("lcsc", "LCSC", "blocked", null)], rows: ReturnType<typeof line>[] = defaultRows(t0)) {
  const cost = rows.reduce((sum, row) => sum + (row.pricing.bestOverall?.bestUnitPrice ?? 0) * row.qty, 0);
  return {
    ok: true,
    rows,
    totalUnitsAvailable: [{ mpn: "ATMEGA328P-AU", available: 6200 }],
    estimatedProjectCost: { value: cost, currency: "USD" },
    pricingSource: "all",
    cached: 1,
    fetched: 1,
    lifecycleSummary: { active: rows.length, nrnd: 0, last_time_buy: 0, eol: 0, obsolete: 0, unknown: 0, totalRows: rows.length, riskRecommendation: "ok" },
    riskSummary: { overallScore: 90, overallGrade: "excellent", totalRows: rows.length, rowsAtRisk: 0, worstRows: [], productionReady: true, recommendation: "Supply signals look healthy." },
    warnings: [],
    pricingMode: "live",
    registryVersion: "1.0.0",
    sources,
    generatedAt: t0, // [B19-E E1-C review] the server's clock when it built the result
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
/** [B19-E E1-C review] every anchor the view clicked programmatically, as it was when clicked */
let clickedAnchors: Array<{ href: string | null; target: string | null }>;
let view: ReturnType<typeof render>;

beforeEach(() => {
  window.localStorage.setItem(STORAGE_KEY, "all");
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:sirkit-bom"), configurable: true, writable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true, writable: true });
  clickedAnchors = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clickedAnchors.push({ href: this.getAttribute("href"), target: this.getAttribute("target") });
  });
  openSpy = vi.fn(() => null);
  vi.spyOn(window, "open").mockImplementation(openSpy as never);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

async function renderLoaded(t0: number, answer: { bom: BomAnswer } = { bom: () => json(bomResult(t0)) }) {
  const fetchMock = stubFetch(answer);
  view = render(<BomView state={STATE} projectScope={SCOPE} />);
  await screen.findByText("U1");
  await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("all"));
  return fetchMock;
}

const offerRow = (distributor: string): HTMLElement => screen.getAllByTestId("bom-offer").find((row) => row.getAttribute("data-distributor") === distributor)!;
const tableRow = (refDes: string): HTMLElement => screen.getByText(refDes).closest("tr")!;
const refDesOrder = (): string[] => screen.getAllByText(/^U[12]$/).map((element) => element.textContent ?? "");
const breakdownNote = (refDes: string, label: string): string => within(tableRow(refDes)).getByText(label).parentElement!.textContent ?? "";

/** [B19-E E1-C review] a location whose navigations are recorded: jsdom never changes href for a cross-document navigation */
function stubLocation() {
  const real = window.location;
  const navigations: string[] = [];
  const fake = {
    get href() { return real.href; },
    set href(value: string) { navigations.push(String(value)); },
    origin: real.origin, protocol: real.protocol, host: real.host, hostname: real.hostname, port: real.port, pathname: real.pathname, search: real.search, hash: real.hash,
    assign: vi.fn((url: string) => { navigations.push(String(url)); }),
    replace: vi.fn((url: string) => { navigations.push(String(url)); }),
    reload: vi.fn(),
    toString: () => real.href,
  };
  vi.stubGlobal("location", fake);
  return { fake, navigations };
}

const EXPORT_MENU = { digikey: /DigiKey BOM Manager/, mouser: /Mouser project upload/, lcsc: /LCSC BOM Tool/ } as const;
const UPLOAD_HOST = { digikey: /^https:\/\/(www\.)?digikey\.com\//, mouser: /^https:\/\/(www\.)?mouser\.com\//, lcsc: /^https:\/\/(www\.)?lcsc\.com\// } as const;

describe("[B19-E E1] exporting for a distributor downloads a file; nothing is opened, sent or ordered", () => {
  it.each(["digikey", "mouser", "lcsc"] as const)("%s: never opens or navigates; only blob downloads are clicked; no notice or menu label says cart, with an MPN-only row", async (dist) => {
    const t0 = Date.now();
    // [B19-E E1-C review] U2 has no SKU at any vendor, so every notice renders its MPN-only sentence
    const mpnOnly = line("U2", [offer("octopart-aggregated", "live", t0 - MINUTE, 0.5, 900)], null, { mpn: "NE555DR", name: "NE555DR" });
    const fetchMock = await renderLoaded(t0, { bom: () => json(bomResult(t0, undefined, [...defaultRows(t0), mpnOnly])) });
    const { fake, navigations } = stubLocation();
    expect(screen.queryByText(/Send to/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Export for distributor/ }));
    for (const item of Object.values(EXPORT_MENU)) expect(screen.getByRole("button", { name: item }).textContent).not.toMatch(/cart/i);
    fireEvent.click(screen.getByRole("button", { name: EXPORT_MENU[dist] }));
    const notice = await screen.findByTestId("bom-export-notice");
    expect(fetchMock.mock.calls.some(([url]) => url === `/api/bom/cart/${dist}`)).toBe(true);
    expect(openSpy).not.toHaveBeenCalled();
    expect(fake.assign).not.toHaveBeenCalled();
    expect(fake.replace).not.toHaveBeenCalled();
    expect(navigations).toEqual([]);
    expect(window.location).toBe(fake);
    expect(clickedAnchors.length).toBeGreaterThan(0); // the file download
    for (const anchor of clickedAnchors) {
      expect(anchor.href ?? "").toMatch(/^blob:/);
      expect(anchor.target).not.toBe("_blank");
    }
    const text = notice.textContent ?? "";
    expect(text).toMatch(/downloaded/i);
    expect(text.toLowerCase()).toContain("no order was placed");
    expect(text).toMatch(/matched by MPN/);
    expect(text).not.toMatch(/cart/i);
    const link = within(notice).getByRole("link", { name: /upload page/ }) as HTMLAnchorElement;
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("href")).toMatch(UPLOAD_HOST[dist]);
    fireEvent.click(within(notice).getByTitle("Dismiss"));
    expect(screen.queryByTestId("bom-export-notice")).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
    expect(navigations).toEqual([]);
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

  it("[B19-E E1-C review] online, the clock keeps moving: past DigiKey's hour the offer reads expired and is blanked, with a Refresh prices notice, and nothing was refetched", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "clearInterval", "Date"] });
    const t0 = Date.now();
    const fetchMock = await renderLoaded(t0);
    fireEvent.click(screen.getByText("U1"));
    await screen.findAllByTestId("bom-offer");
    expect(screen.getAllByText("2.75 USD").length).toBeGreaterThan(0);
    const calls = bomBodies(fetchMock).length;

    act(() => { vi.advanceTimersByTime(HOUR); }); // DigiKey's observation (t0 - 30 min, one hour) expired at t0 + 30 min
    const digikey = offerRow("digikey");
    expect(within(digikey).getByTestId("offer-expires").textContent).toBe(`expired ${utcMinute(t0 + 30 * MINUTE)}`);
    expect(digikey.textContent).not.toContain("2.75");
    expect(digikey.textContent).not.toContain("5,000");
    expect(digikey.querySelector("a")).toBeNull();
    expect(offerRow("octopart-aggregated").textContent).toContain("2.90 USD");
    expect(screen.queryByText("2.75 USD")).toBeNull(); // not in the row, the offers or the project cost
    expect(screen.getByText("Project cost hidden: offers expired")).toBeTruthy();
    expect(document.querySelector(`a[href="${DIGIKEY_PAGE}"]`)).toBeNull();
    expect(screen.queryByTestId("bom-offline")).toBeNull();
    expect(screen.queryByText("Supply signals OK (observed)")).toBeNull();
    expect(screen.getByText("last result · 1 cached · 1 live")).toBeTruthy();
    const notice = screen.getByTestId("bom-expired");
    expect(bomBodies(fetchMock).length).toBe(calls); // the clock moved; nothing was refetched

    // [B19-E E1-C review follow-up] the notice's refetch is not the header's cache-bypassing "Refresh prices": it has its own name
    expect(within(notice).queryByRole("button", { name: "Refresh prices" })).toBeNull();
    fireEvent.click(within(notice).getByRole("button", { name: "Get current offers" }));
    await waitFor(() => expect(bomBodies(fetchMock).length).toBe(calls + 1));
  });

  it("[B19-E E1-C review] a client clock two hours slow: observed, expiry and offline blanking are judged in server time", async () => {
    const server = Date.now();
    const clientNow = vi.spyOn(Date, "now").mockReturnValue(server - 2 * HOUR);
    const answer: { bom: BomAnswer } = { bom: () => json(bomResult(server)) };
    await renderLoaded(server, answer);
    fireEvent.click(screen.getByText("U1"));
    await screen.findAllByTestId("bom-offer");
    expect(within(offerRow("digikey")).getByTestId("offer-observed").textContent).toBe(utcMinute(server - 30 * MINUTE));
    expect(within(offerRow("digikey")).getByTestId("offer-expires").textContent).toBe(utcMinute(server + 30 * MINUTE));

    // offline 90 minutes after the server answered, which the slow client reads as 30 minutes before it
    clientNow.mockReturnValue(server - 30 * MINUTE);
    answer.bom = offline;
    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));
    const banner = await screen.findByTestId("bom-offline");
    expect(banner.textContent).toContain(utcMinute(server));
    const digikey = offerRow("digikey");
    expect(within(digikey).getByTestId("offer-observed").textContent).toBe(utcMinute(server - 30 * MINUTE));
    expect(within(digikey).getByTestId("offer-expires").textContent).toMatch(/^expired /);
    expect(digikey.textContent).not.toContain("2.75");
    expect(digikey.querySelector("a")).toBeNull();
  });
});

describe("[B19-E E1] offline keeps the last result and never serves an expired offer", () => {
  it("a failed refetch shows the offline banner with Retry; an offer is blanked by its expiry alone, not its basis, rank or distributor; Retry fetches again", async () => {
    const t0 = Date.now();
    // [B19-E E1-C review] DigiKey is live, not best, and expires at t0 + 10 min; Octopart is cached, best, and expires at t0 + 1 h
    const digikey = offer("digikey", "live", t0 - 50 * MINUTE, 2.61, 5000, { sku: "ATMEGA328P-AU-ND", productUrl: DIGIKEY_PAGE });
    const octopart = offer("octopart-aggregated", "offer-cache", t0 - 23 * HOUR, 2.93, 1200);
    const answer: { bom: BomAnswer } = { bom: () => json(bomResult(t0, undefined, [line("U1", [digikey, octopart], octopart)])) };
    const fetchMock = await renderLoaded(t0, answer);
    fireEvent.click(screen.getByText("U1"));
    await screen.findAllByTestId("bom-offer");
    expect(offerRow("digikey").textContent).toContain("2.61 USD");

    vi.spyOn(Date, "now").mockReturnValue(t0 + 30 * MINUTE);
    answer.bom = offline;
    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));
    const banner = await screen.findByTestId("bom-offline");
    expect(banner.textContent).toMatch(/offline/i);
    expect(screen.getByText("U1")).toBeTruthy(); // the last result stays
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();

    // the live, non-best DigiKey offer has expired: blanked
    const expired = offerRow("digikey");
    expect(within(expired).getByTestId("offer-expires").textContent).toMatch(/^expired /);
    expect(expired.textContent).not.toContain("2.61");
    expect(expired.textContent).not.toContain("5,000");
    expect(expired.querySelector("a")).toBeNull();
    // the cached, best Octopart offer has not: it keeps its price and stock, in the offers, the row and the project cost
    const kept = offerRow("octopart-aggregated");
    expect(within(kept).getByTestId("offer-expires").textContent).not.toMatch(/expired/);
    expect(kept.textContent).toContain("2.93 USD");
    expect(kept.textContent).toContain("1,200");
    expect(within(tableRow("U1")).getAllByText("2.93 USD").length).toBeGreaterThan(0);
    expect(screen.queryByText("Project cost hidden: offers expired")).toBeNull();
    expect(screen.queryByText("2.61 USD")).toBeNull();
    expect(document.body.textContent).not.toContain("5,000");
    expect(document.querySelector(`a[href="${DIGIKEY_PAGE}"]`)).toBeNull();
    // the risk breakdown counts only the offer still shown
    expect(breakdownNote("U1", "Availability")).toContain("1,200 units");
    expect(breakdownNote("U1", "Supplier mix")).toContain("1 supplier");
    expect(document.body.textContent).not.toContain("6,200");

    // later, the best offer has expired too: the row and the project cost are blanked, apart from the offers
    vi.spyOn(Date, "now").mockReturnValue(t0 + 2 * HOUR);
    const calls = bomBodies(fetchMock).length;
    fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(bomBodies(fetchMock).length).toBe(calls + 1));
    await waitFor(() => expect(screen.queryByText("2.93 USD")).toBeNull());
    expect(within(offerRow("octopart-aggregated")).getByTestId("offer-expires").textContent).toMatch(/^expired /);
    expect(screen.getByText("Project cost hidden: offers expired")).toBeTruthy();
    expect(document.body.textContent).not.toContain("1,200");

    answer.bom = () => json(bomResult(t0));
    fireEvent.click(within(screen.getByTestId("bom-offline")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByTestId("bom-offline")).toBeNull());
    expect(bomBodies(fetchMock).length).toBe(calls + 2);
  });

  it("[B19-E E1-C review] an expired best offer drives no sort order, no priced note, no supply-OK badge, and the counts say last result", async () => {
    const t0 = Date.now();
    const u1 = offer("digikey", "offer-cache", t0 - 30 * MINUTE, 2.75, 5000); // one hour: expired by t0 + 2 h
    const u2 = offer("octopart-aggregated", "live", t0 - MINUTE, 3.1, 8000); // one day: still served
    const answer: { bom: BomAnswer } = { bom: () => json(bomResult(t0, undefined, [line("U1", [u1], u1), line("U2", [u2], u2)])) };
    await renderLoaded(t0, answer);
    expect(breakdownNote("U1", "Pricing")).toContain("(priced)");

    vi.spyOn(Date, "now").mockReturnValue(t0 + 2 * HOUR);
    answer.bom = offline;
    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));
    await screen.findByTestId("bom-offline");

    for (const column of ["Unit Price", "Stock", "Ext. Price"]) {
      fireEvent.click(screen.getByText(column));
      if (!/▲/.test(screen.getByText(column).closest("th")!.textContent ?? "")) fireEvent.click(screen.getByText(column));
      expect(refDesOrder(), column).toEqual(["U2", "U1"]); // ascending: U1's hidden 2.75 / 5,000 would sort it first
    }
    expect(breakdownNote("U1", "Pricing")).not.toContain("(priced)");
    expect(breakdownNote("U1", "Pricing")).toContain("(expired)");
    expect(breakdownNote("U2", "Pricing")).toContain("(priced)");
    expect(screen.queryByText("Supply signals OK (observed)")).toBeNull();
    expect(screen.queryByText("Supply signals look healthy.")).toBeNull();
    expect(screen.getByText("Observations expired")).toBeTruthy();
    expect(screen.getByText("last result · 1 cached · 1 live")).toBeTruthy();
    expect(screen.getByText("last result · 2 line items · 1 cached · 1 live")).toBeTruthy();
  });

  it.each([
    ["a non-ok JSON answer", () => json({ ok: false, error: "BOM build failed" }, 500), /BOM build failed \(HTTP 500\)/],
    ["an unreadable answer body", () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }), /HTTP 502/],
  ] as const)("[B19-E E1-C review] %s is an error with its HTTP status, not offline, and the last result is not shown as current", async (_name, failure, message) => {
    const t0 = Date.now();
    const answer: { bom: BomAnswer } = { bom: () => json(bomResult(t0)) };
    await renderLoaded(t0, answer);
    answer.bom = failure;
    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(screen.queryByTestId("bom-offline")).toBeNull();
    expect(screen.queryByText("U1")).toBeNull();
    expect(screen.queryByText(/Project cost:/)).toBeNull();
  });

  it("[B19-E E1-C review follow-up] a connection that drops while the answer body downloads is offline, and the last result stays", async () => {
    const t0 = Date.now();
    const answer: { bom: BomAnswer } = { bom: () => json(bomResult(t0)) };
    await renderLoaded(t0, answer);
    answer.bom = () => ({ ok: true, status: 200, json: () => Promise.reject(new TypeError("network error")) }) as unknown as Response;
    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));
    await screen.findByTestId("bom-offline");
    expect(screen.getByText("U1")).toBeTruthy();
    expect(screen.queryByText(/HTTP 200/)).toBeNull();
  });

  it("[B19-E E1-C review follow-up] a clock tick that re-sorts the rows keeps an expanded row expanded", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "clearInterval", "Date"] });
    const t0 = Date.now();
    const u1 = offer("digikey", "offer-cache", t0 - 30 * MINUTE, 2.75, 5000); // one hour: expires at t0 + 30 min
    const u2 = offer("octopart-aggregated", "live", t0 - MINUTE, 3.1, 8000);
    await renderLoaded(t0, { bom: () => json(bomResult(t0, undefined, [line("U1", [u1], u1), line("U2", [u2], u2)])) });
    fireEvent.click(screen.getByText("Unit Price"));
    if (!/▲/.test(screen.getByText("Unit Price").closest("th")!.textContent ?? "")) fireEvent.click(screen.getByText("Unit Price"));
    expect(refDesOrder()).toEqual(["U1", "U2"]);
    fireEvent.click(screen.getByText("U2"));
    expect(offerRow("octopart-aggregated")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(HOUR); });
    expect(refDesOrder()).toEqual(["U2", "U1"]); // U1's expired price no longer sorts it first
    expect(offerRow("octopart-aggregated")).toBeTruthy(); // U2 stayed expanded through the re-sort
  });
});

describe("[B19-E E1-C review] a kept result that was for a different request shows no cost, sources or offer prices", () => {
  const expectNothingPriced = () => {
    expect(screen.queryByText(/Project cost:/)).toBeNull();
    expect(screen.queryAllByTestId("bom-source-chip")).toHaveLength(0);
    for (const value of ["2.75", "2.90", "5,000", "1,200"]) expect(document.body.textContent, value).not.toContain(value);
    expect(document.querySelector(`a[href="${DIGIKEY_PAGE}"]`)).toBeNull();
    expect(screen.queryByText("Supply signals OK (observed)")).toBeNull();
  };

  it("offline after a picker change: the banner says so; under another source and under None nothing is priced", async () => {
    const t0 = Date.now();
    const answer: { bom: BomAnswer } = { bom: () => json(bomResult(t0)) };
    await renderLoaded(t0, answer);
    expect(screen.getByText(/Project cost:/)).toBeTruthy();
    answer.bom = offline;

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "digikey" } });
    const banner = await screen.findByTestId("bom-offline");
    await waitFor(() => expect(banner.textContent).toMatch(/different pricing choice or design/));
    fireEvent.click(screen.getByText("U1"));
    expectNothingPriced();
    for (const row of screen.queryAllByTestId("bom-offer")) expect(row.textContent).toMatch(/different/);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "none" } });
    await waitFor(() => expect(screen.getByText("Pricing off")).toBeTruthy());
    expect(screen.getByTestId("bom-offline").textContent).toMatch(/different pricing choice or design/);
    expectNothingPriced();
  });

  it("offline after a design change: the banner says so and nothing is priced", async () => {
    const t0 = Date.now();
    const answer: { bom: BomAnswer } = { bom: () => json(bomResult(t0)) };
    await renderLoaded(t0, answer);
    answer.bom = offline;
    view.rerender(<BomView state={STATE_CHANGED} projectScope={SCOPE} />);
    const banner = await screen.findByTestId("bom-offline");
    await waitFor(() => expect(banner.textContent).toMatch(/different pricing choice or design/));
    fireEvent.click(screen.getByText("U1"));
    expectNothingPriced();
  });

  it("pricing None never shows a cost, even when an answer carries one", async () => {
    window.localStorage.setItem(STORAGE_KEY, "none");
    const t0 = Date.now();
    const fetchMock = stubFetch({ bom: () => json({ ...bomResult(t0), pricingSource: "none" }) });
    render(<BomView state={STATE} projectScope={SCOPE} />);
    await screen.findByText("U1");
    await waitFor(() => expect(bomBodies(fetchMock).length).toBeGreaterThan(0));
    expect(screen.getByText("Pricing off")).toBeTruthy();
    expect(screen.queryByText(/Project cost:/)).toBeNull();
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
