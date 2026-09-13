# B19-A — the versioned source registry (I3)

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED**, **RECORDED**, **UNKNOWN**.

The registry is code, not a document: `app/lib/acquisition/source-registry.ts` (version `1.0.0`). Its render is
`source-registry.csv` in this directory, gated byte-for-byte by `app/lib/acquisition/__tests__/b19-source-registry.test.ts`
(regenerate with `npx tsx scripts/generate-b19-source-registry.ts`). This page records where every fact came from and
what checking the vendors' current documentation changed.

## 1. Documentation read at execution time (2026-09-13)

Only the vendors' own pages. A fact they do not state is **UNKNOWN** in the registry, never guessed.

| source | official pages read |
|---|---|
| DigiKey | [documentation](https://developer.digikey.com/documentation), [FAQ: products, plans and APIs](https://developer.digikey.com/faq/products-plans-and-apis), [V4 OpenAPI download](https://developer.digikey.com/node/2357/oas-download), [changelog](https://developer.digikey.com/changelog), [API user agreement](https://developer.digikey.com/api-user-agreement) |
| Mouser | [Search API](https://www.mouser.com/en/api-search/), [V1 specification](https://api.mouser.com/api/docs/V1), [V2 specification](https://api.mouser.com/api/docs/V2), [API terms](https://www.mouser.com/en/apiterms/) |
| Nexar (Octopart) | [authorization](https://support.nexar.com/support/solutions/articles/101000471994-authorization), [application access token](https://support.nexar.com/support/solutions/articles/101000452406-application-access-token), [part limits](https://support.nexar.com/support/solutions/articles/101000476314-part-limits-and-how-they-work), [FAQ](https://support.nexar.com/support/solutions/articles/101000497890-frequently-asked-questions), [compare plans](https://nexar.com/compare-plans), [API legal terms](https://nexar.com/api/legal) |
| LCSC | [Open API](https://www.lcsc.com/docs/openapi/index.html), [API docs and terms](https://www.lcsc.com/docs/index.html), [getting LCSC APIs](https://www.lcsc.com/help-center/api/get-lcsc-apis), [access frequency](https://www.lcsc.com/help-center/api/api-access-frequency) |

Pages that could not be read: Mouser's API hub and PDF guide (timed out; the API page and terms were read in a browser
instead), the Octopart site terms (behind a CAPTCHA, not attempted), DigiKey's V3 product page (403).

## 2. The four sources

| | DigiKey | Mouser | Octopart / Nexar | LCSC |
|---|---|---|---|---|
| **state** | enabled | **disabled** (OD-32) | enabled | **blocked** |
| API / version | Product Information **V4** (current) | Search API **V1** part-number search (not deprecated; V2 has no plain part-number endpoint) | Nexar Supply GraphQL (current) | LCSC Open API (unversioned) |
| hosts called | `api.digikey.com` | `api.mouser.com` | `api.nexar.com` | none |
| documented, not called | `sandbox-api.digikey.com` | — | `identity.nexar.com` (token service) | `ips.lcsc.com` (no access) |
| authentication | OAuth2 client credentials; token 10 min | `apiKey` query parameter (vendor design) | Bearer access token, 24 h | key + nonce + timestamp + signature (partner) |
| secret references | `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET` | `MOUSER_API_KEY` | `OCTOPART_API_KEY` or `NEXAR_API_KEY` | none |
| quota (documented) | 120 / minute, 1000 / day | 30 / minute, 1000 / day | 2000 matched parts / month (Standard plan; plan-dependent) | 200 / minute, 1000 / day |
| request spacing | **500 ms** (was 200) | 2000 ms | serial batches | — |
| deadline / body | 15 s / 2 MB | 15 s / 2 MB | 20 s / 4 MB | — |
| redirects | refused | refused | refused | — |
| served for | 1 h | **never** | 24 h | never |
| kept for | 1 h (UNKNOWN in terms; OD-33) | **never** (terms) | 24 h (terms) | never |
| bulk refresh | prohibited (no bulk download) | prohibited | unknown, so refused (OD-33) | prohibited |
| export disposition | private review only | private review only | private review only | prohibited |
| attribution | credit DigiKey as the source | credit Mouser; keep its links intact | link to octopart.com or the part page | credit LCSC |
| region / currency | US site, USD (defaults) | UNKNOWN | per offer | USD, CNY, EUR, HKD |
| authority class | sourcing observation | sourcing observation | sourcing observation | sourcing observation |

Every source is a `distributor_catalog` source whose data is a **sourcing observation**: it may support availability,
price and a lifecycle claim, and can never alone establish exact part identity, electrical pin mapping, symbol,
footprint, package geometry or CAD correctness. B19-C (I4) builds on that rule.

## 3. What checking the documentation changed (CONFIRMED by reproduction before the fix)

| # | finding | measured before the fix | now |
|---|---|---|---|
| D19-8 | DigiKey allows **120 requests a minute**; the connector spaced requests 200 ms apart (up to 300 a minute), and DigiKey's agreement suspends an account for 10 minutes over its burst threshold | three searches **214 ms and 203 ms** apart | 500 ms, derived from the registry's per-minute limit; the validator refuses a spacing faster than the documented rate |
| D19-9 | Mouser's terms prohibit **caching or storing** its content; the offer cache persisted Mouser offers | `putCachedOffer(…, "mouser")` wrote a row (real, migrated PostgreSQL) | a no-storage source is never persisted or memoized, a stored Mouser row is never served, and it is purged |
| D19-9 | Nexar's terms allow storage for **at most 24 hours**; every stored row was served 24 h and **kept forever**; DigiKey rows were served 24 h | a 2-hour-old DigiKey row was served | rows are served only within their source's freshness (`isOfferServable`, used by every reader: the pricing cache, the alternates route and both operator scripts) and deleted past its retention (`purgeExpiredOffers`, run at most every five minutes on the read path) |
| D19-10 | **A regression B19-B I2 introduced**, found by reading every reader of stored offers: the operator's `refresh-bom-pricing` job still passed only `forceRefresh`, so after live pricing became a grant it silently refreshed nothing | tripwire on the script's pricing call | the job is granted live pricing and declares itself a **bulk refresh**, which touches only sources whose terms permit it — none today (OD-33), so it now says so instead of silently doing nothing |
| D19-11 | Mouser's terms also require the application's **primary purpose** to be driving Mouser sales; a multi-distributor comparison does not meet that on its face | Mouser was constructed and asked whenever its key was set | **disabled** in the registry until the owner decides (OD-32); a disabled source is never constructed, key or no key |
| D19-12 | Nexar issues tokens by **OAuth2 client credentials** (24 h); the connector sends a pre-issued token from the environment, which expires | INFERRED from code and documentation | RECORDED as a connector gap; not changed in I3 |

Unchanged by the check, and recorded: Mouser's `apiKey` query parameter is the vendor's design (contained since I1);
DigiKey's `X-DIGIKEY-Customer-Id` header was replaced by `X-DIGIKEY-Account-ID` on 2025-11-24 and the connector sends
neither; LCSC is blocked (an official API exists but needs an approved partner application), and JLCPCB's API is
likewise approval-gated and not registered.

## 4. How the registry is enforced

| rule | enforced by | proof |
|---|---|---|
| hosts, deadline, body ceiling, secret query parameters | `DISTRIBUTOR_EGRESS_POLICIES` derived from the registry | `b19-connector-policy` (policy equality) and the I1 egress suite |
| a blocked source is never constructed; a disabled one only after a reviewed registry change | `admitSource`, used by the pricing orchestrator for every client | `b19-source-registry` (admission), `b19-source-admission` (Mouser never constructed with its key set) |
| an operator may switch a source off, never on | `SIRKIT_ACQUISITION_DISABLED_SOURCES`; there is no enabling switch | `b19-source-admission` |
| credentials by reference only; messages name variables, never values | `admitSource` returns values only to the constructor; refusals name variables | `b19-source-registry`, `b19-source-admission` |
| a BOM says why a source is unavailable | `unavailableSources` replaces the hard-coded credential warnings | `b19-source-admission` |
| request spacing from the documented per-minute limit | DigiKey and Mouser read `minRequestSpacingMs` | `b19-connector-policy` (measured gaps) |
| freshness, storage and retention | `ttlFor`, `isOfferServable`, `purgeExpiredOffers`, `putCachedOffer` | `b19-offer-retention` against a real migrated PostgreSQL (PGlite) |
| bulk refresh only where terms permit | `getPricingFor(…, { purpose: "bulk-refresh" })` | `b19-source-admission` |
| no secret value, no wildcard host, no plain HTTP, no redirect allowance, no cached no-storage source, no serving past retention | `validateSourceRegistry`, run by the generator and the gate | eleven crafted violations, each refused |
| the committed artifact is the registry | byte-for-byte render gate | `b19-source-registry` |
| quotas (every registered window) and the circuit breaker | `requestAdmission` / `recordOutcome` in `distributorJson` (I3b) | `b19-admission-control`, `b19-quota-breaker-coalescing` |

## 5. Recorded, not enforced here

- **Quotas, circuit breakers and coalescing** are enforced since I3b (`acquisition-boundary.md`). Retries stay as the
  registry records them: no automatic retry; a failure degrades to a missing price. The meters are per process (stated
  limit in I3b).
- The admission decision is taken once per process, as credentials were before: switching a source off takes effect
  on restart.
- The consolidated lifecycle status written to `parts` is a derived fact; whether the vendors' "no database" clauses
  reach a derived status is part of OD-33.
- The BOM source picker still offers Mouser; choosing it now prices nothing and says why. Source and freshness labels
  in the product are B19-E (I6).
- Optional live contract checks against the real APIs are not run here (no credentials in CI); they belong to the
  chapter's validation increment and stay opt-in.
