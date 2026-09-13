/**
 * DigiKey Product Information V4 client.
 * https://developer.digikey.com/products/product-information-v4
 *
 * OAuth2 client_credentials → keyword search → `PartPricing`. Tokens are cached
 * in memory and refreshed on expiry or a 401. Requests are serialized through a
 * queue spaced by the source registry: 500 ms, DigiKey's documented 120 requests
 * a minute (and 1000 a day). [B19-A I3: it was 200 ms — up to 300 a minute.] Per-MPN failures resolve to null rather than throwing, so one
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
import { makeCachedLookup, rememberNoExactMatch } from "./cache";
import { distributorJson, type DistributorEgress } from "./egress"; // [B19-B I1] the bounded, validated egress path
import { describeFailure, DistributorRequestError } from "./types";
import { SOURCE_REGISTRY } from "../acquisition/source-registry";
import { makeCoalescer } from "../acquisition/admission-control";
import { canonicalExactMpn, sameExactMpn } from "../atomic/identity";

const TOKEN_URL = "https://api.digikey.com/v1/oauth2/token";
const SEARCH_URL = "https://api.digikey.com/products/v4/search/keyword";
// [B19-A I3] the registry derives this from DigiKey's documented per-minute limit (60 000 ms / 120).
const MIN_REQUEST_SPACING_MS = SOURCE_REGISTRY.digikey.resilience.minRequestSpacingMs;

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
    // [B19-B I3b] cost 0: DigiKey's documented quota counts product requests; the token request still respects the breaker
    const res = await distributorJson("digikey", { url: TOKEN_URL, method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, egress, 0);
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

  async function searchKeyword(mpn: string): Promise<{ value: unknown; contentHash: string; retrievedAt: number }> {
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
    return { value: res.value, contentHash: res.contentHash, retrievedAt: res.retrievedAt };
  }

  async function lookupByMpn(mpn: string): Promise<PartPricing | null> {
    try {
      const answer = await enqueue(() => searchKeyword(mpn));
      const pricing = mapProduct(mpn, answer.value);
      if (!pricing) rememberNoExactMatch("digikey", mpn); // [B19-D I5b review] a successful answer with no exact product
      // [B19-C I4] pin the result to the exact bytes DigiKey sent
      return pricing ? { ...pricing, evidence: { rawContentHash: answer.contentHash, retrievedAt: answer.retrievedAt } } : null;
    } catch (err) {
      // [B19-B I1] only the boundary's own redacted sentence is ever logged — never the raw error, which can carry the
      // request, the transport's own text, or a credential.
      console.error(`[digikey] lookup failed: ${describeFailure(err)}`);
      return null;
    }
  }

  const cached = makeCachedLookup("digikey", lookupByMpn);
  // [B19-B I3b] a second identical lookup already in flight joins the first instead of paying for its own search
  const coalesce = makeCoalescer<PartPricing | null>();
  const lookup = (mpn: string): Promise<PartPricing | null> => coalesce(inFlightKey(mpn), () => cached.lookup(mpn));

  async function lookupBatch(mpns: string[]): Promise<Map<string, PartPricing>> {
    const unique = [...new Set(mpns.filter((m) => m.trim() !== ""))];
    const entries = await Promise.all(
      unique.map(async (mpn): Promise<[string, PartPricing] | null> => {
        const pricing = await lookup(mpn);
        return pricing ? [mpn, pricing] : null;
      }),
    );
    return new Map(entries.filter((e): e is [string, PartPricing] => e !== null));
  }

  return { name: "digikey", lookupByMpn: lookup, lookupBatch };
}

/** [B19-D I5b review] identical requests join; a confusable spelling only ever joins its own byte-identical twin */
function inFlightKey(mpn: string): string {
  try {
    return canonicalExactMpn(mpn);
  } catch {
    return `\u0000raw:${mpn}`;
  }
}

// ─── Response mapping ──────────────────────────────────────────────────────────

function mapProduct(requestedMpn: string, json: unknown): PartPricing | null {
  const root = asRecord(json);
  const products = asArray(root.Products);
  if (products.length === 0) return null;

  // [B19-D I5b row 01] only the product whose published MPN IS the requested one — never the first result as a stand-in
  const exact = products.find((p) => sameExactMpn(asString(asRecord(p).ManufacturerProductNumber), requestedMpn));
  if (!exact) return null;
  const product = asRecord(exact);

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
    mpn: asString(product.ManufacturerProductNumber)!,
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
