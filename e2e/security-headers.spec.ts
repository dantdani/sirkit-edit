/**
 * [B19-D I5c review] The image source policy is SERVED, not only configured.
 *
 * The chat renderer never emits an <img> for markdown (unit-tested); this header is the second line: even an image element
 * that some future renderer emitted could only load from Sirkit itself, data: or blob:. The unit test reads next.config's
 * headers(); this proves the running application sends it on the page and on an API response.
 */
import { expect, test } from "@playwright/test";

const POLICY = "img-src 'self' data: blob:";

test("the page response carries the image source policy", async ({ page }) => {
  const response = await page.goto("/");
  expect(response, "the page loaded").not.toBeNull();
  expect(response!.headers()["content-security-policy"] ?? "").toContain(POLICY);
});

test("an API response carries it too", async ({ request }) => {
  const response = await request.get("/api/ai/runtime");
  expect(response.headers()["content-security-policy"] ?? "").toContain(POLICY);
});

/**
 * [B24-A2] D24-5, OD-196: every security header with its exact value, SERVED - on the page, an API route, a file outside the
 * proxy's matcher (`/favicon.ico`, proxy.ts:19-24) and the liveness route. `X-Powered-By` is absent (`poweredByHeader: false`), and
 * so is HSTS: this server's origin is http://localhost:3100 (playwright.config.ts), and HSTS follows an https
 * `SIRKIT_EXPECTED_ORIGIN` only. The values are the builder's (`securityHeaders`, next.config.ts); `b24-a2-headers` pins these
 * literals equal to it. Names are lower-cased, as Playwright reports them.
 */
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["content-security-policy", "img-src 'self' data: blob:; frame-ancestors 'none'"],
  ["x-frame-options", "DENY"],
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
  ["content-security-policy-report-only", "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'"],
];
const SECURITY_HEADER_PATHS = ["/", "/api/ai/runtime", "/favicon.ico", "/api/health"] as const;

for (const path of SECURITY_HEADER_PATHS) {
  test(`[B24-A2] ${path} carries every security header with its exact value, no X-Powered-By and no HSTS`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status(), `${path} answered`).toBeLessThan(500);
    const headers = response.headers();
    for (const [name, value] of SECURITY_HEADERS) expect(headers[name], `${path} ${name}`).toBe(value);
    expect(headers["x-powered-by"], `${path} x-powered-by`).toBeUndefined();
    expect(headers["strict-transport-security"], `${path} strict-transport-security`).toBeUndefined();
  });
}

/**
 * [B24-A2] The framing case: a page on another origin (about:blank) that frames `/` gets no Sirkit document in the frame
 * (`frame-ancestors 'none'` and `X-Frame-Options: DENY`). Every approval surface lives on `/` -
 * the Tier 1 grant card, the Tier 2 dialogs and B23's latent ProviderExchangePanel preview and commit controls
 * (app/components/pcb/ProviderExchangePanel.tsx:135-140) - so none of them can be overlaid by a framing page.
 */
test("[B24-A2] framing: an about:blank page that frames / gets no Sirkit document in the frame", async ({ page, baseURL }) => {
  const target = new URL("/", baseURL).toString();
  // [B24-A2 lead, 2026-10-06] the headers are read by a direct request: Chromium emits no page response event for a document it refuses
  // to frame, so the review's waitForResponse on the framed navigation never settled (180 s timeout, reproduced alone)
  const response = await page.request.get(target);
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["content-security-policy"] ?? "").toContain("frame-ancestors 'none'");
  // a positive control: loaded directly, / does show Sirkit's layout body, so the frame check below would see a document wrongly allowed
  await page.goto(target);
  expect(await page.locator("body.min-h-full").count(), "the Sirkit layout body on / itself").toBe(1);
  await page.goto("about:blank");
  await page.setContent(`<iframe id="sirkit-frame" src="${target}" width="800" height="600"></iframe>`);
  const frame = await (await page.waitForSelector("#sirkit-frame")).contentFrame();
  expect(frame, "the iframe element has a frame").not.toBeNull();
  // the browser refuses the document (Chromium commits its own error page in the frame): a negative check, so a document wrongly
  // allowed is given time to commit before the frame is read
  await frame?.waitForLoadState("load").catch(() => undefined);
  await page.waitForTimeout(1_000);
  expect(frame?.url() ?? "").not.toBe(target);
  const sirkitBody = await frame!.locator("body.min-h-full").count().catch(() => 0);
  expect(sirkitBody, "no Sirkit layout body in the frame").toBe(0);
});

/**
 * [B24-A2] The report-only policy's violations on `/`, as Chromium reports them: attached to this test's result and asserted on
 * nothing. `next dev` adds violations a production build would not (its inline and eval'd scripts), so this run says what an
 * enforced policy would have to allow; the owner decides when one is enforced (OD-196).
 */
test("[B24-A2] report-only: the violations Chromium reports on / are attached to the result, asserted on nothing", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const store = window as unknown as { __sirkitCspReports: unknown[] };
    store.__sirkitCspReports = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      store.__sirkitCspReports.push({ directive: event.violatedDirective, effective: event.effectiveDirective, blocked: event.blockedURI, disposition: event.disposition, source: event.sourceFile, line: event.lineNumber });
    });
  });
  const consoleLines: string[] = [];
  page.on("console", (message) => {
    if (/Content.Security.Policy/i.test(message.text())) consoleLines.push(message.text());
  });
  await page.goto("/");
  await page.waitForLoadState("load");
  const reports = await page.evaluate(() => (window as unknown as { __sirkitCspReports?: unknown[] }).__sirkitCspReports ?? []);
  await testInfo.attach("csp-report-only-violations.json", { body: JSON.stringify({ reports, console: consoleLines }, null, 2), contentType: "application/json" });
});
