/**
 * [B19-D I5c rows 09, 10, 34, 35] Externally supplied links and text in what Sirkit renders and exports.
 *
 *  - row 34: a vendor product link and a KiCad Datasheet were rendered as `href` with no scheme or host policy (React blocks
 *    `javascript:` but not `data:`, `vbscript:` or `//host`).
 *  - row 35 (reproduce-first in the matrix): the KiCad export copied a part's Datasheet into the file with only quote escaping.
 *    Whether KiCad would launch a `file:` or UNC datasheet could not be tested here (no KiCad on this machine); the export now
 *    applies the same document-link policy, recorded as policy rather than as a reproduced exploit.
 *  - row 09: the cart CSVs and the procurement packet quoted fields but never neutralised a spreadsheet formula, and the
 *    packet's URL columns took the stored vendor link as-is.
 *  - row 10: the BOM CSV quoted on `"`, `,` and `\n` but not a lone `\r`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("[B19-D I5c row 34] only plain web links survive, in the browser too", () => {
  it("safeHref refuses every non-web, credentialed, protocol-relative, whitespace or IP-literal link", async () => {
    const { safeHref } = await import("../net/href-policy");
    for (const bad of ["javascript:alert(1)", " \u0001JaVa\tScRiPt:alert(1)", "data:text/html;base64,PGI+", "vbscript:msgbox(1)", "//evil.example/x", "https://user:pw@www.digikey.com/x", "file:///C:/x.hta", "\\\\server\\share\\x.pdf", "https://127.0.0.1/x", "https://[::1]/x", "https://10.0.0.8/x"]) {
      expect(safeHref(bad, "document"), bad).toBeNull();
    }
    expect(safeHref("http://www.digikey.com/x", "page")).toBeNull();
    expect(safeHref("https://evil.example/x", "page", ["digikey.com"])).toBeNull();
    expect(safeHref("https://www.digikey.com/x", "page", ["digikey.com"])).toBe("https://www.digikey.com/x");
    expect(safeHref("http://www.ti.com/lit/ds/ne555.pdf", "document")).toBe("http://www.ti.com/lit/ds/ne555.pdf");
  });

  it("[review] a local or single-label host is refused (the browser callers rely on this alone)", async () => {
    const { safeHref } = await import("../net/href-policy");
    for (const bad of ["https://localhost/x", "https://intranet/x", "https://printer.local/x", "https://svc.internal/x", "https://app.localhost/x", "https://router.home.arpa/x"]) {
      expect(safeHref(bad, "document"), bad).toBeNull();
    }
  });

  it("[review] a scheme-less 'www.' datasheet (80 of the upstream KiCad library's values) is a web link, not dropped", async () => {
    const { safeHref } = await import("../net/href-policy");
    expect(safeHref("www.ti.com/lit/ds/symlink/sn74ls07.pdf", "document")).toBe("https://www.ti.com/lit/ds/symlink/sn74ls07.pdf");
    expect(safeHref("www.st.com/resource/en/datasheet/lm358.pdf", "page")).toBeNull(); // a stored vendor page link must carry its scheme
    for (const bad of ["www./x", "www.localhost/x", "www.10.0.0.1/x", "wwwevil.example/x"]) expect(safeHref(bad, "document"), bad).toBeNull();
    const { extractLibrary } = await import("../kicad/extract");
    const [symbol] = extractLibrary(['(kicad_symbol_lib (version 20241209) (symbol "X" (property "Datasheet" "www.ti.com/lit/gpn/TLV767") (pin output line (at 0 0 0) (length 2.54) (name "O") (number "1"))))']);
    expect(symbol!.datasheet).toBe("https://www.ti.com/lit/gpn/TLV767");
  });

  it("[review] vendor links for BOM rows and offers follow the policy, falling back to the distributor's search", async () => {
    const { offerLinkUrl, vendorProductPageUrl } = await import("../distributor-links");
    expect(vendorProductPageUrl("https://www.digikey.com/en/products/detail/x")).toBe("https://www.digikey.com/en/products/detail/x");
    expect(vendorProductPageUrl("https://evil.example/phish")).toBeNull();
    expect(vendorProductPageUrl('=HYPERLINK("https://evil.example","x")')).toBeNull();
    expect(offerLinkUrl({ distributor: "digikey", productUrl: "https://evil.example/phish", sku: "296-1411-5-ND", mpn: "NE555P" })).toBe("https://www.digikey.com/short/?keywords=296-1411-5-ND");
    expect(offerLinkUrl({ distributor: "octopart", productUrl: "https://octopart.com/ne555p", sku: null, mpn: "NE555P" })).toBe("https://octopart.com/ne555p");
    expect(offerLinkUrl({ distributor: "octopart", productUrl: "javascript:alert(1)", sku: null, mpn: "NE555P" })).toBeNull();
  });

  it("a KiCad Datasheet that is not a web link is not a datasheet link (the raw property is kept)", async () => {
    const { extractLibrary } = await import("../kicad/extract");
    const [symbol] = extractLibrary(['(kicad_symbol_lib (version 20241209) (symbol "X" (property "Datasheet" "javascript:alert(1)") (pin output line (at 0 0 0) (length 2.54) (name "O") (number "1"))))']);
    expect(symbol!.datasheet).toBeNull();
    expect(symbol!.properties.Datasheet).toBe("javascript:alert(1)");
  });

  it.each([
    ["app/components/bom/BomView.tsx", /\bvendorProductPageUrl\(/],
    ["app/components/bom/BomView.tsx", /\bofferLinkUrl\(/],
    ["app/components/editor/BuildLibraryPanel.tsx", /<DatasheetLink\b/],
    ["app/page.tsx", /<DatasheetLink\b/],
  ])("%s renders external links through the shared policy helpers (tripwire)", (file, pattern) => {
    expect(readFileSync(resolve(process.cwd(), file), "utf8")).toMatch(pattern);
  });

  it.each(["app/components/bom/BomView.tsx", "app/components/editor/BuildLibraryPanel.tsx", "app/page.tsx"])("[review] %s never puts a stored link straight into an href", (file) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(source).not.toMatch(/<a\b[^>]*\bhref=\{[^}]*(?:datasheet|productUrl)[^}]*\}/i);
    expect(source).not.toMatch(/function (?:productUrlOf|searchUrlFor)\b/);
  });

  it("[review] DatasheetLink renders only a policy-approved link", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { DatasheetLink } = await import("@/app/components/parts/DatasheetLink");
    const render = (href: unknown) => renderToStaticMarkup(createElement(DatasheetLink, { href, className: "c", children: "Datasheet" }));
    for (const bad of ["data:text/html,<b>", "javascript:alert(1)", "file:///C:/x.hta", "https://localhost/x", null, undefined, ""]) expect(render(bad), String(bad)).toBe("");
    const good = render("https://www.ti.com/ds.pdf");
    expect(good).toMatch(/^<a href="https:\/\/www\.ti\.com\/ds\.pdf" target="_blank" rel="noopener noreferrer" class="c">Datasheet<\/a>$/);
    expect(render("www.ti.com/ds.pdf")).toContain('href="https://www.ti.com/ds.pdf"');
  });
});

describe("[B19-D I5c row 35] the KiCad export writes only a web datasheet link", () => {
  it("a file: datasheet becomes empty, an https one is kept", async () => {
    const { exportToKicadSch } = await import("../kicad-export");
    const part = (datasheet: string) => ({ id: "p1", name: "R", libraryName: "Device", symbolRaw: '(symbol "R" (pin passive line (at 0 0 0) (length 2.54) (name "~") (number "1")))', pins: [], datasheet, properties: {} });
    const state = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", x: 100, y: 100, rotation: 0, refDes: "R1", value: "10k" }] };
    const bad = exportToKicadSch({ state: state as never, parts: new Map([["p1", part("file:///C:/x.hta") as never]]) });
    expect(bad).not.toContain("file:///");
    const good = exportToKicadSch({ state: state as never, parts: new Map([["p1", part("https://www.ti.com/ds.pdf") as never]]) });
    expect(good).toContain('"https://www.ti.com/ds.pdf"');
  });

  it("[review] a file: or UNC Datasheet inside the part's own symbol block is not copied into lib_symbols", async () => {
    const { exportToKicadSch } = await import("../kicad-export");
    const raw = (value: string) => `(symbol "R" (property "Datasheet" "${value}" (at 0 0 0)) (property "Description" "see file:///C:/notes.txt" (at 0 0 0)) (pin passive line (at 0 0 0) (length 2.54) (name "~") (number "1")))`;
    const state = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", x: 100, y: 100, rotation: 0, refDes: "R1", value: "10k" }] };
    for (const [value, forbidden] of [["file:///C:/x.hta", "x.hta"], ["\\\\\\\\server\\\\share\\\\x.pdf", "server"]] as const) {
      const out = exportToKicadSch({ state: state as never, parts: new Map([["p1", { id: "p1", name: "R", libraryName: "Device", symbolRaw: raw(value), pins: [], datasheet: value, properties: {} } as never]]) });
      expect(out, value).not.toContain(forbidden);
      expect(out).toContain("see file:///C:/notes.txt"); // other text is untouched
    }
    const www = exportToKicadSch({ state: state as never, parts: new Map([["p1", { id: "p1", name: "R", libraryName: "Device", symbolRaw: raw("www.ti.com/ds.pdf"), pins: [], datasheet: "www.ti.com/ds.pdf", properties: {} } as never]]) });
    expect(www.match(/\(property "Datasheet" "https:\/\/www\.ti\.com\/ds\.pdf"/g)).toHaveLength(2); // lib_symbols and the instance
  });
});

describe("[B19-D I5c row 09] cart CSVs and the procurement packet never hand a spreadsheet a formula", () => {
  const dk = { distributor: "digikey", mpn: "", manufacturer: null, description: null, sku: "=1+1", productUrl: '=HYPERLINK("https://evil.example","x")', priceBreaks: [{ qty: 1, price: 1, currency: "USD" }], bestUnitPrice: 1, inStock: 1, minOrderQty: 1, datasheet: null, package: null, lifecycleStatus: "active", lifecycleRaw: null, fetchedAt: 0 };
  const row = { refDesList: ["=R1", "@SUM(1+1)"], qty: 1, name: "=cmd", mpn: "+NE555", manufacturer: "-TI", value: "=1+1", package: null, lifecycleStatus: "active", riskScore: { total: 0, grade: "A", notes: [] }, pricing: { offers: [dk], bestOverall: dk } };

  /** RFC-4180 cells of every line. */
  function cells(csv: string): string[][] {
    return csv.split(/\r?\n/).filter(Boolean).map((line) => {
      const out: string[] = [];
      let cell = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i]!;
        if (quoted) {
          if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
          else if (c === '"') quoted = false;
          else cell += c;
        } else if (c === '"') quoted = true;
        else if (c === ",") { out.push(cell); cell = ""; }
        else cell += c;
      }
      out.push(cell);
      return out;
    });
  }

  it.each(["toDigiKeyCsv", "toMouserCsv", "toLcscCsv"] as const)("%s", async (name) => {
    const formats = (await import("../cart-formats")) as unknown as Record<string, (rows: unknown[]) => string>;
    for (const cell of cells(formats[name]!([row])).flat()) expect(cell, cell).not.toMatch(/^\s*[=+\-@]/);
  });

  it("toProcurementPacketCsv: no formula in any cell, and a non-vendor URL is replaced by the vendor search link", async () => {
    const { toProcurementPacketCsv } = await import("../cart-formats");
    const csv = toProcurementPacketCsv([row] as never, { title: "t", buildQuantity: 1, date: new Date("2026-09-13T00:00:00Z") });
    for (const cell of cells(csv).flat()) expect(cell, cell).not.toMatch(/^\s*[=+\-@]/);
    expect(csv).not.toContain("evil.example");
  });
});

describe("[B19-D I5c review] the BOM CSV link columns follow the link policy", () => {
  it("a non-distributor product URL and a file: datasheet are not written", async () => {
    const { bomToCsv } = await import("../bom/build");
    const offer = { distributor: "digikey", mpn: "M", manufacturer: null, description: null, sku: "S", productUrl: "https://evil.example/phish", priceBreaks: [], bestUnitPrice: null, inStock: 0, minOrderQty: 1, datasheet: null, package: null, lifecycleStatus: "active", lifecycleRaw: null, fetchedAt: 0 };
    const csv = bomToCsv({ rows: [{ refDes: "R1", refDesList: ["R1"], qty: 1, name: "R", mpn: "M", manufacturer: null, package: null, value: "x", datasheet: "file:///C:/x.hta", pricing: { offers: [offer], bestOverall: offer }, riskScore: { total: 0, grade: "A", notes: [] } }] } as never);
    expect(csv).not.toContain("evil.example");
    expect(csv).not.toContain("file:///");
    const good = bomToCsv({ rows: [{ refDes: "R1", refDesList: ["R1"], qty: 1, name: "R", mpn: "M", manufacturer: null, package: null, value: "x", datasheet: "https://www.ti.com/ds.pdf", pricing: { offers: [{ ...offer, productUrl: "https://www.digikey.com/p/1" }], bestOverall: { ...offer, productUrl: "https://www.digikey.com/p/1" } }, riskScore: { total: 0, grade: "A", notes: [] } }] } as never);
    expect(good).toContain("https://www.ti.com/ds.pdf,https://www.digikey.com/p/1");
  });
});

describe("[B19-D I5c row 10] the BOM CSV never leaves a bare carriage return", () => {
  it("a value or name containing CR is quoted", async () => {
    const { bomToCsv } = await import("../bom/build");
    const csv = bomToCsv({ rows: [{ refDes: "R1", refDesList: ["R1"], qty: 1, name: "R\r=1+1", mpn: "M", manufacturer: null, package: null, value: "x\r=HYPERLINK(1)", datasheet: null, pricing: null, riskScore: { total: 0, grade: "A", notes: [] } }] } as never);
    let quoted = false;
    for (let i = 0; i < csv.length; i++) {
      const c = csv[i];
      if (c === '"') quoted = !quoted;
      else if (c === "\r" && !quoted) expect(csv[i + 1], "a bare CR outside quotes").toBe("\n");
    }
  });
});
