// @vitest-environment jsdom
/**
 * [B19-E E2] g — the Build Library's "Search distributors" section.
 *
 * Every external hit is labelled: its source, where it was served from (live or a recent cached answer), when it was observed
 * and when it expires, whether its MPN is an exact match, and that it is a sourcing observation, not engineering authority.
 * There is no Place, add or buy control on an external hit: a hit is a lead for review, never a part on the canvas. The
 * request carries the project selector and data only — never a live flag.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildLibraryPanel } from "../BuildLibraryPanel";
import { EXTERNAL_OBSERVATION_AUTHORITY } from "@/app/lib/acquisition/external-search-contract";
import { utcMinute } from "@/app/lib/acquisition/source-labels";

const SCOPE = { tenantId: "local", projectId: "p-e2", branchId: "main" };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 13, 12, 0, 0);

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function hit(sourceId: string, sourceDisplayName: string, mpn: string, exactMatch: boolean, servedFrom: string, observedAt: number, ttl: number) {
  return {
    sourceId, sourceDisplayName, attribution: `Credit ${sourceDisplayName}`, mpn, exactMatch, manufacturer: "Analog Devices", description: "RS-232 transceiver", packaging: null, lifecycle: "active",
    stock: 1200, minimumOrderQuantity: 1, priceBreaks: [{ quantity: 1, unitPrice: 2.5, currency: "USD" }], datasheetUrl: null,
    // [B19-E E2 review] a Nexar hit whose offers named no product link: its terms still require the octopart.com link
    productUrl: sourceId === "octopart" ? null : "https://www.digikey.com/en/products/detail/analog-devices/1", attributionLink: sourceId === "octopart" ? "https://octopart.com/" : null,
    servedFrom, observedAt, expiresAt: observedAt + ttl, authority: EXTERNAL_OBSERVATION_AUTHORITY, observationId: `observation_${"a".repeat(64)}`, candidateId: `candidate_${"b".repeat(64)}`,
  };
}

const status = (sourceId: string, displayName: string, value: string, ownerDecision: string | null, extra: Record<string, unknown> = {}) => ({ sourceId, displayName, status: value, ownerDecision, retryAt: null, freshnessLabel: `${displayName} freshness`, attribution: `Credit ${displayName}`, attributionLink: sourceId === "octopart" ? "https://octopart.com/" : null, servedFrom: null, hitCount: 0, withheldHits: 0, ...extra });

const RESULT = {
  ok: true, query: "MAX3232CSE", mode: "exact", limit: 5, live: true, registryVersion: "1.1.0", authority: EXTERNAL_OBSERVATION_AUTHORITY, generatedAt: T0,
  sources: [
    status("digikey", "DigiKey", "available", "OD-33", { servedFrom: "live", hitCount: 1 }),
    status("mouser", "Mouser", "disabled", "OD-32"),
    status("octopart", "Octopart (Nexar)", "paused", "OD-33", { retryAt: T0 + 15 * MINUTE }),
    status("lcsc", "LCSC", "blocked", null),
  ],
  hits: [
    hit("digikey", "DigiKey", "MAX3232CSE", true, "live", T0 - MINUTE, HOUR),
    hit("octopart", "Octopart (Nexar)", "MAX3232CSE+", false, "process-memo", T0 - 2 * HOUR, DAY),
  ],
};

function stubFetch(result: unknown = RESULT) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url === "/api/parts/categories") return json({ ok: true, categories: [{ mainCategory: "Interface", partCount: 3 }] });
    if (url === "/api/parts/external-search") return json(result);
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const searchCalls = (fetchMock: ReturnType<typeof stubFetch>) => fetchMock.mock.calls.filter(([url]) => url === "/api/parts/external-search");

// jsdom lacks two browser APIs the panel's scroll area (Base UI) calls: ResizeObserver and Element.getAnimations
const elementPrototype = Element.prototype as unknown as { getAnimations?: () => unknown[] };
const hadGetAnimations = typeof elementPrototype.getAnimations === "function";
beforeEach(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  }
  if (!hadGetAnimations) elementPrototype.getAnimations = () => [];
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0)); // let the scroll area's pending timers settle before the stubs go
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openSearch(scope: typeof SCOPE | null = SCOPE, onPlace = vi.fn()) {
  render(<BuildLibraryPanel onSelectForPlacement={onPlace} projectScope={scope} />);
  await screen.findByText("Interface");
  fireEvent.click(screen.getByRole("button", { name: /search distributors/i }));
  return onPlace;
}

describe("[B19-E E2] g — Search distributors", () => {
  it("each hit shows a source chip, served-from, observed, expires and the authority label — and has no Place, add or buy control", async () => {
    const fetchMock = stubFetch();
    const onPlace = await openSearch();
    fireEvent.click(screen.getByRole("button", { name: "Exact MPN" }));
    fireEvent.change(screen.getByLabelText("Distributor search query"), { target: { value: "MAX3232CSE" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const hits = await screen.findAllByTestId("external-hit");
    expect(hits).toHaveLength(2);
    const [digikey, nexar] = hits as [HTMLElement, HTMLElement];

    expect(within(digikey).getByTestId("external-hit-source").textContent).toBe("DigiKey");
    expect(digikey.textContent).toContain("MAX3232CSE");
    expect(digikey.textContent).toContain("exact MPN match");
    expect(within(digikey).getByTestId("external-hit-served-from").textContent).toBe("live");
    expect(digikey.textContent).toContain(`observed ${utcMinute(T0 - MINUTE)}`);
    expect(digikey.textContent).toContain(`expires ${utcMinute(T0 - MINUTE + HOUR)}`);
    expect(digikey.textContent).toContain(EXTERNAL_OBSERVATION_AUTHORITY);

    expect(within(nexar).getByTestId("external-hit-source").textContent).toBe("Octopart (Nexar)");
    expect(nexar.textContent).toContain("MAX3232CSE+");
    expect(nexar.textContent).toContain("not an exact match");
    expect(within(nexar).getByTestId("external-hit-served-from").textContent).toBe("cached (recent answer)");
    expect(nexar.textContent).toContain(`observed ${utcMinute(T0 - 2 * HOUR)}`);
    expect(nexar.textContent).toContain(`expires ${utcMinute(T0 - 2 * HOUR + DAY)}`);
    expect(nexar.textContent).toContain(EXTERNAL_OBSERVATION_AUTHORITY);

    for (const element of hits) {
      expect(within(element).queryAllByRole("button"), "no control of any kind on an external hit").toEqual([]);
      expect(element.textContent ?? "").not.toMatch(/\bplace\b|add to|\bbuy\b|order|cart/i);
    }
    const results = screen.getByTestId("external-search-results");
    expect(within(results).queryByRole("button", { name: /place|add|buy|order|cart/i })).toBeNull();
    expect(onPlace).not.toHaveBeenCalled();

    expect(screen.getByTestId("external-source-mouser").textContent).toMatch(/disabled.*OD-32/);
    expect(screen.getByTestId("external-source-lcsc").textContent).toMatch(/blocked/);
    expect(screen.getByTestId("external-source-octopart").textContent).toContain(`paused until ${utcMinute(T0 + 15 * MINUTE)}`);

    const [[, init]] = searchCalls(fetchMock) as [[string, RequestInit]];
    expect(JSON.parse(String(init.body))).toEqual({ query: "MAX3232CSE", mode: "exact", limit: 5 });
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "p-e2", "x-sirkit-branch-id": "main" });
  });

  it("keyword mode sends a keyword search when Enter is pressed", async () => {
    const fetchMock = stubFetch({ ...RESULT, mode: "keyword", query: "rs232 transceiver" });
    await openSearch();
    fireEvent.click(screen.getByRole("button", { name: "Keyword" }));
    const input = screen.getByLabelText("Distributor search query");
    fireEvent.change(input, { target: { value: "rs232 transceiver" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(searchCalls(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String(searchCalls(fetchMock)[0]![1]!.body))).toEqual({ query: "rs232 transceiver", mode: "keyword", limit: 5 });
    await screen.findAllByTestId("external-hit");
  });

  it("a refused or failed search shows a message and no hits", async () => {
    stubFetch({ ok: false, code: "EXTERNAL_SEARCH_QUERY_INVALID", error: "The query must be 1 to 64 printable ASCII characters." });
    await openSearch();
    fireEvent.change(screen.getByLabelText("Distributor search query"), { target: { value: "NE555" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("The query must be 1 to 64 printable ASCII characters.")).toBeTruthy();
    expect(screen.queryAllByTestId("external-hit")).toEqual([]);
  });

  it("[B19-E E2 review] every hit credits its source (the registry attribution) and a Nexar hit with no product link still links to octopart.com", async () => {
    stubFetch();
    await openSearch();
    fireEvent.change(screen.getByLabelText("Distributor search query"), { target: { value: "MAX3232CSE" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const [digikey, nexar] = (await screen.findAllByTestId("external-hit")) as [HTMLElement, HTMLElement];
    for (const [element, name] of [[digikey, "DigiKey"], [nexar, "Octopart (Nexar)"]] as const) {
      const credit = within(element).getByTestId("external-hit-attribution");
      expect(credit.textContent, name).toContain(`data from ${name}`);
      expect(credit.getAttribute("title"), name).toBe(`Credit ${name}`);
    }
    expect(within(nexar).queryByRole("link", { name: /Octopart \(Nexar\) page/ }), "the fixture's Nexar hit has no product link").toBeNull();
    const link = within(nexar).getByRole("link", { name: "octopart.com" });
    expect(link.getAttribute("href")).toBe("https://octopart.com/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(digikey).queryByRole("link", { name: "octopart.com" })).toBeNull();
    expect(within(digikey).getByRole("link", { name: /DigiKey page/ }).getAttribute("href")).toBe("https://www.digikey.com/en/products/detail/analog-devices/1");
    expect(screen.getByTestId("external-source-octopart").getAttribute("title")).toBe("Credit Octopart (Nexar)");
  });

  it("without an open project the search is unavailable with a visible reason, and nothing is sent", async () => {
    const fetchMock = stubFetch();
    await openSearch(null);
    expect(screen.getByText(/open a project to search distributors/i)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Search" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Distributor search query"), { target: { value: "NE555" } });
    fireEvent.click(button);
    expect(searchCalls(fetchMock)).toHaveLength(0);
  });
});

describe("[B19-E E2 review] the page mounts the panel with the active project's selector", () => {
  it("app/page.tsx passes BuildLibraryPanel the same active-project projectScope that BomView gets", () => {
    const page = readFileSync(join(process.cwd(), "app", "page.tsx"), "utf8");
    const mounts = [...page.matchAll(/<BuildLibraryPanel\b[^>]*\/>/g)].map((match) => match[0]);
    expect(mounts, "one mount of the panel").toHaveLength(1);
    const scopeOf = (element: string): string | null => /\bprojectScope=\{(project \? \{[^}]*\} : null)\}/.exec(element)?.[1] ?? null;
    const bom = /<BomView\b[\s\S]*?\bprojectScope=\{(project \? \{[^}]*\} : null)\}/.exec(page)?.[1] ?? null;
    expect(bom).toContain("projectId: project.id");
    expect(scopeOf(mounts[0]!), "without it the panel can never search").toBe(bom);
  });
});
