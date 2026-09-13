/**
 * DigiKey Product Information V4 client.
 * https://developer.digikey.com/products/product-information-v4
 *
 * OAuth2 client_credentials → keyword search → `PartPricing`. Tokens are cached
 * in memory and refreshed on expiry or a 401. Requests are serialized through a
 * 200ms-spaced queue to stay under burst limits (the free tier allows
 * 1000 req/day). Per-MPN failures resolve to null rather than throwing, so one
 * bad part never sinks a whole batch.
 */

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  cheapestUnitPrice,
  type DistributorClient,
  type PartPricing,
  type PriceBreak,
} from "./types";
import { mapLifecycleString } from "./lifecycle";
import { makeCachedLookup } from "./cache";
import { distributorJson, type DistributorEgress } from "./egress"; // [B19-B I1] the bounded, validated egress path
import { describeFailure, DistributorRequestError } from "./types";

const TOKEN_URL = "https://api.digikey.com/v1/oauth2/token";
const SEARCH_URL = "https://api.digikey.com/products/v4/search/keyword";
const MIN_REQUEST_SPACING_MS = 200;

export function makeDigiKeyClient(opts: { clientId: string; clientSecret: string; egress?: DistributorEgress }): DistributorClient {
  const { clientId, clientSecret } = opts;
  const egress = opts.egress ?? {};
  if (!clientId || !clientSecret) {
    throw new Error("DIGIKEY credentials not configured");
  }

  // ── In-memory OAuth token cache ────────────────────────────────────────────
  let token: { accessToken: string; expiresAt: number } | null = null;

  async function fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    });
    const res = await distributorJson("digikey", { url: TOKEN_URL, method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, egress);
    if (!res.ok) throw new DistributorRequestError(`DigiKey token request failed: ${res.message}`);
    const json = asRecord(res.value);
    const accessToken = asString(json.access_token);
    if (!accessToken) throw new Error("DigiKey token response missing access_token");
    // `expires_in` is seconds (~600). Refresh 30s early to dodge edge expiry.
    const expiresIn = asNumber(json.expires_in) ?? 600;
    token = { accessToken, expiresAt: Date.now() + (expiresIn - 30) * 1000 };
    return accessToken;
  }

  async function getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && token && Date.now() < token.expiresAt) return token.accessToken;
    return fetchToken();
  }

  // ── 200ms-spaced request queue ─────────────────────────────────────────────
  let queueTail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queueTail.then(async () => {
      const result = await task();
      await delay(MIN_REQUEST_SPACING_MS);
      return result;
    });
    // Keep the chain alive even if a task rejects.
    queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function searchKeyword(mpn: string): Promise<unknown> {
    const doRequest = (accessToken: string) =>
      distributorJson("digikey", {
        url: SEARCH_URL,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-DIGIKEY-Client-Id": clientId,
        },
        body: JSON.stringify({ Keywords: mpn, Limit: 5 }),
      }, egress);

    let res = await doRequest(await getToken());
    if (!res.ok && res.status === 401) {
      // Token may have expired early — refresh once and retry.
      res = await doRequest(await getToken(true));
    }
    if (!res.ok) throw new DistributorRequestError(`DigiKey search failed: ${res.message}`);
    return res.value;
  }

  async function lookupByMpn(mpn: string): Promise<PartPricing | null> {
    try {
      const json = await enqueue(() => searchKeyword(mpn));
      return mapProduct(mpn, json);
    } catch (err) {
      // [B19-B I1] only the boundary's own redacted sentence is ever logged — never the raw error, which can carry the
      // request, the transport's own text, or a credential.
      console.error(`[digikey] lookup failed: ${describeFailure(err)}`);
      return null;
    }
  }

  const cached = makeCachedLookup("digikey", lookupByMpn);

  async function lookupBatch(mpns: string[]): Promise<Map<string, PartPricing>> {
    const unique = [...new Set(mpns.filter((m) => m.trim() !== ""))];
    const entries = await Promise.all(
      unique.map(async (mpn): Promise<[string, PartPricing] | null> => {
        const pricing = await cached.lookup(mpn);
        return pricing ? [mpn, pricing] : null;
      }),
    );
    return new Map(entries.filter((e): e is [string, PartPricing] => e !== null));
  }

  return { name: "digikey", lookupByMpn: cached.lookup, lookupBatch };
}

// ─── Response mapping ──────────────────────────────────────────────────────────

function mapProduct(requestedMpn: string, json: unknown): PartPricing | null {
  const root = asRecord(json);
  const products = asArray(root.Products);
  if (products.length === 0) return null;

  // Prefer an exact (case-insensitive) MPN match; fall back to the first result.
  const wanted = requestedMpn.trim().toLowerCase();
  const exact = products.find(
    (p) => asString(asRecord(p).ManufacturerProductNumber)?.toLowerCase() === wanted,
  );
  const product = asRecord(exact ?? products[0]);

  const priceBreaks = mapPriceBreaks(asArray(product.StandardPricing));
  const manufacturer = asString(asRecord(product.Manufacturer).Name);
  const description = asString(asRecord(product.Description).ProductDescription);

  // v4 exposes ProductStatus as `{ Id, Status }`; older shapes use a bare string
  // or MarketStatus. Try each in turn.
  const lifecycleRaw =
    asString(asRecord(product.ProductStatus).Status) ??
    asString(product.ProductStatus) ??
    asString(product.MarketStatus);

  return {
    distributor: "digikey",
    mpn: asString(product.ManufacturerProductNumber) ?? requestedMpn,
    manufacturer,
    description,
    datasheet: asString(product.DatasheetUrl),
    inStock: asNumber(product.QuantityAvailable),
    minOrderQty: asNumber(product.MinimumOrderQuantity),
    priceBreaks,
    bestUnitPrice: cheapestUnitPrice(priceBreaks),
    productUrl: asString(product.ProductUrl),
    package: asString(product.Packaging) ?? asString(asRecord(product.Packaging).Value),
    lifecycleStatus: mapLifecycleString(lifecycleRaw),
    lifecycleRaw,
    fetchedAt: Date.now(),
  };
}

function mapPriceBreaks(raw: unknown[]): PriceBreak[] {
  const breaks: PriceBreak[] = [];
  for (const entry of raw) {
    const rec = asRecord(entry);
    const qty = asNumber(rec.BreakQuantity);
    const price = asNumber(rec.UnitPrice);
    if (qty === null || price === null) continue;
    breaks.push({ qty, price, currency: asString(rec.Currency) ?? "USD" });
  }
  return breaks.sort((a, b) => a.qty - b.qty);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
