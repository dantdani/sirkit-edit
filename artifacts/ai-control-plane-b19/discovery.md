# B19 — discovery: what exists today for external component acquisition

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised),
**RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Read-only sweep of `main` at `5a59a1f` by six parallel readers (workflow `wf_30aa690a-0c4`): the connectors, the outbound
boundary, the quarantine-to-authority pipeline, inbound import security, the product and agent surfaces, and the existing
tests and gates. 113 findings, 53 gaps, every claim carrying a file:line. Everything below is INFERRED from source until
an increment reproduces it.

## 1. The connectors that exist

| source | file | API | auth (env NAME only) | state |
|---|---|---|---|---|
| DigiKey | `app/lib/distributors/digikey.ts` | Product Information **V4**, OAuth2 client_credentials | `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET` (headers) | live |
| Mouser | `app/lib/distributors/mouser.ts` | Search API **v1** | `MOUSER_API_KEY` — **in the URL query string** | live |
| Octopart / Nexar | `app/lib/distributors/octopart.ts` | Nexar **GraphQL** | `OCTOPART_API_KEY` ?? `NEXAR_API_KEY` (Bearer) | live |
| LCSC | `app/lib/distributors/lcsc.ts` | — | — | deliberately throwing stub |

Three HTTP clients in one directory is the entire external supply-chain surface; nothing else in `app/`, `lib/` or
`scripts/` reaches a distributor. `app/lib/distributor-links.ts` builds deep links as strings and calls nothing.

## 2. What the runbook asks for, against what is there

**B19-A (source registry).** Nothing exists. Each connector hard-codes its own URL, spacing and TTL; there is no
versioned registry of identity, permitted endpoints, secret *reference*, observations, quota, timeout/retry/breaker,
freshness, license/retention/redistribution, region, authority class or enabled state. LCSC is a stub, which matches the
runbook's "blocked unless legitimate partner access exists" — it must become an explicit registry state, not a throw.

**B19-B (safe acquisition boundary).** The single most important discovery: **a complete, unit-tested SSRF guard already
exists and has zero production callers.** `app/lib/atomic/security.ts:121 assertPermittedUrl` enforces https-only,
blocks loopback / `.local` / private IPv4, applies a host allowlist and strips credentials;
`:135 assertPermittedRedirect` re-validates each hop; `app/lib/atomic/ingestion.ts:182 validateFetchChain` walks the
chain. A bounded response reader exists too (`app/lib/http/bounded-stream.ts:44`) and **no server-side outbound call
uses it**. B19 wires these rather than writing new ones. Two structural gaps to close while wiring: the guard validates
the hostname *string* and never the resolved IP (DNS rebinding), and its private-range table is IPv4-only (no IPv6 ULA,
link-local, IPv4-mapped, or CGNAT).

Measured state of the six raw outbound call sites: **none** has an allowlist, a response-size bound, a MIME check or
redirect control; the three distributor calls have **no timeout at all**; only the Supabase path is genuinely bounded
(`app/lib/auth/bounded-fetch.ts:58`), and that helper is the right shape to extend.

**B19-C (quarantine to authority).** The back half already exists and is strong: atomic part revisions with publication
state, portable snapshots, approved mapping certificates, physical bindings and the B13/B14 component authority. The
front half — external observation, normalized candidate, verified evidence bundle — has types in
`app/lib/atomic/ingestion.ts` but **no concrete `SourceAdapter` implementation**; the interface is satisfied only by an
inline test closure. Nothing connects a distributor observation to that pipeline today, which is exactly the separation
the runbook wants preserved.

**B19-D (import security and licensing).** Ingest limits and archive budgets exist (`app/lib/atomic/security.ts`), and
license is enforced at publication (`app/lib/atomic/validation.ts:109`) — but **not at export**: neither
`app/api/export/kicad/route.ts` nor `app/lib/bom/build.ts` mentions license, while the checked-in corpus already
expects a `restricted-cad` row to be export-prohibited. The KiCad s-expression parser behind asset ingest
(`app/lib/kicad/sexp.ts`) has no tests and duplicates a tested parser elsewhere.

**B19-E (product and agent experience).** Parts search, the component-review panel and the BOM exist. There is **no
purchase path anywhere** — the cart routes emit a CSV and place no order — which is the state the runbook wants kept.
Source and freshness labelling on what the user sees is thin, and no agent tool exposes external search today.

## 3. Defects found by the sweep (to reproduce first, then fix)

| # | defect | evidence |
|---|---|---|
| D19-1 | `/api/bom` is a **public, CSRF-free** route whose body drives live, paid distributor calls, and it honours a caller-supplied `forceRefresh` that bypasses the cache — an anonymous caller can exhaust a ~1000-query/month quota. **Closed in I2**, and wider than recorded: five more public BOM routes priced live too | `app/lib/auth/route-policy.ts:218` + `:55-56`; `app/api/bom/route.ts:45-47`; `app/lib/bom/build.ts:181` |
| D19-2 | The same route reflects **raw distributor error text** (remote status, queried MPN) to an unauthenticated caller. **Closed in I2** for every BOM route, which all did the same | `app/api/bom/route.ts:48-51` |
| D19-3 | ~~The Mouser API key travels in the URL query string~~ — **corrected in I1**: checked against Mouser's current documentation, the Search API authenticates with an `apiKey` query parameter *by design*. Not a defect to move; a vendor constraint to CONTAIN (never logged, never in a message, never redirected) | `app/lib/distributors/mouser.ts:52`; `acquisition-boundary.md` |
| D19-4 | No distributor call has a timeout or an `AbortSignal`; a hung socket holds a handler open | `digikey.ts:44,84`, `mouser.ts:52`, `octopart.ts:58` |
| D19-5 | Every server-side outbound response is read with an unbounded `res.json()` | the five sites above + `app/api/schematic/cross-verify/route.ts:92` |
| D19-6 | `/api/schematic/cross-verify` follows redirects by default with its bearer attached, and reflects 200 bytes of the remote body — the SSRF read primitive, if that env URL is ever pointed inward. **Closed in I2b, and corrected**: measured on Node 24.15, the bearer is dropped on a cross-origin hop and kept on a same-origin one; the redirect to any address, the prompt re-sent there, and the reflection were real | `app/api/schematic/cross-verify/route.ts:30,68,86-88` |
| D19-7 | License is enforced at publication but **not at export** | `app/lib/atomic/validation.ts:109` vs `app/api/export/kicad/route.ts` (no `license` occurrence) |

The `providerCredit: boolean` flag already exists on ~20 route-policy rows and **nothing reads it** — the taxonomy for
quotas is written down and inert (`app/lib/auth/route-policy.ts:37`).

## 4. Increments

| # | increment | checkpoint | state |
|---|---|---|---|
| I1 | The bounded outbound boundary: one shared server-side egress helper that wires the EXISTING SSRF guard, a per-source allowlist, deadlines, bounded reads, redirect revalidation and redacted errors — applied to the three distributor clients; plus the IP-resolution and IPv6 gaps in the guard | B19-B | CONFIRMED — `acquisition-boundary.md` |
| I2 | `/api/bom`: close the anonymous paid-quota drain and the error reflection (D19-1, D19-2), make `forceRefresh` an authorized capability. Reproduction widened it: FIVE more public BOM routes priced live, and every BOM route repeated a failure's text | B19-B | CONFIRMED — `acquisition-boundary.md` |
| I2b | `/api/schematic/cross-verify`'s credential-carrying redirects and body reflection (D19-6, moved out of I2 so each route-level fix is reproduced on its own) | B19-B | CONFIRMED — `acquisition-boundary.md` (D19-6 corrected: Node drops the bearer on a cross-origin hop; the redirect, the prompt re-sent inward and the reflection were real) |
| I3 | The versioned source registry, with every field the runbook names, secret REFERENCES only, LCSC recorded as blocked; the connectors read their policy from it instead of hard-coding it | B19-A | planned |
| I4 | The quarantine pipeline's front half: observation → normalized candidate → verified evidence bundle, with a real `SourceAdapter`, and the rule that distributor data can never alone prove pin mapping or CAD correctness | B19-C | planned |
| I5 | Import security and licensing: malicious PDFs, SVGs, archives, KiCad files, traversal, nested archives, active content, Unicode-confusable MPNs, unit ambiguity, stale source revisions; license enforced at export | B19-D | planned |
| I6 | Product and agent experience: source/freshness labels, candidate review, bounded external-search and evidence-read tools, and no purchase path | B19-E | planned |
| I7 | Validation and closeout | all | planned |

## 5. Standing rules for this chapter

- Use **current official API documentation at execution time** for any connector change (B19-A).
- **LCSC stays blocked** unless legitimate partner access exists; no scraping around an unavailable official API, and no
  terms bypass.
- Distributor inventory may support sourcing and must **never alone** prove electrical pin mapping or CAD correctness.
- AI-extracted datasheet facts stay **quarantined** until deterministic validation and required human review.
- **No purchasing**, and no control that could be mistaken for verified procurement.
- Never commit vendor content whose license does not permit repository redistribution.
