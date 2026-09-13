# B19-B — The safe acquisition boundary

Labels as in `README.md`. Every claim below is CONFIRMED by a test named beside it unless marked otherwise.

## I1 — one bounded, validated egress path (CONFIRMED)

### What was there

Discovery (`discovery.md` §2) found every server-side call to a distributor unbounded, and found the pieces to fix that
already in the repository and unused: a complete SSRF guard with **zero production callers**
(`app/lib/atomic/security.ts` `assertPermittedUrl`) and a streaming bounded reader that **no server-side outbound call
used** (`app/lib/http/bounded-stream.ts`). I1 wires them into one call path instead of writing new ones.

### What a request now has to pass

`app/lib/net/outbound-fetch.ts` — `outboundFetch(request, policy, deps)`. It never throws; every failure is a closed code
and a redacted sentence.

| rule | refusal code | test |
|---|---|---|
| HTTPS only; no credentials in the URL | `scheme_not_https`, `url_credentials` | `b19-outbound-fetch` "what may be reached" |
| the host must be on THIS SOURCE's allowlist, exactly — no wildcard, no implicit subdomain | `host_not_allowed` | same |
| the name must not be loopback / `.local` / `.internal` / metadata, and **every** address it resolves to must be public (loopback, link-local incl. 169.254.169.254, private, CGNAT, ULA, multicast all refused; one private answer among public ones is enough) | `address_blocked` | "an ALLOWED name that resolves to a private or metadata address is refused" |
| one hard deadline over resolution, connection, headers and body; the caller's abort ends it; a pre-aborted request never starts | `timeout`, `aborted` | "how long, and how much" |
| the body is read through the bounded reader; an oversized body is refused, not buffered | `response_too_large` | same |
| a body of the wrong media type is refused before it is read | `unexpected_content_type` | same |
| redirects are never followed implicitly (`redirect: "manual"`); each hop is revalidated with every rule above; hops are bounded; **credentials never cross an origin**; a request whose URL carries a secret is **never redirected at all** | `too_many_redirects`, `redirect_refused`, and the hop's own reason | "where a redirect may go" |
| an error never contains the secret, the query string or the remote body | — | "what an error may say" |

The address policy is one module, `app/lib/net/ip-policy.ts`, shared with the existing guard.

### Two holes in the existing guard, reproduced and closed

1. **IPv4-only private ranges.** With the literal on the allowlist, `https://[::1]`, `[fd00::1]`, `[::ffff:127.0.0.1]` and
   `https://100.64.0.1` all passed `assertPermittedUrl` — the allowlist was doing all the work. Reproduced as a failing
   test, then closed by routing the guard through the shared address policy.
2. **Found while closing (1):** the WHATWG URL parser **rewrites** a mapped address before any check sees it —
   `new URL("https://[::ffff:127.0.0.1]/").hostname` is `[::ffff:7f00:1]`. A rule that matched the dotted form never saw
   it. IPv6 is now read as numbers (all eight groups, zone ids stripped), so every spelling of one address is judged the
   same. Pinned for `::ffff:127.0.0.1`, `::ffff:7f00:1`, the fully expanded form, upper case, `::ffff:a9fe:a9fe`
   (169.254.169.254) and `fe80::1%eth0`.

A third gap, also reproduced before it was fixed: **a resolver that never answers ignored the deadline** (the test timed
out at 5 s). Resolution now races the same abort as the exchange.

### A limit, stated

The resolved addresses are checked at admission, but the transport resolves the name again when it connects. A DNS
rebinding that flips a record in that window is **not** excluded by this module; the per-source allowlist of exact vendor
API hosts is what closes it in practice. Pinning the connection to the checked address needs a custom dispatcher and is
recorded as a follow-up, not claimed.

### The three distributor clients

`app/lib/distributors/egress.ts` gives each source ONE policy — its exact host (unchanged from what each client already
called: `api.digikey.com`, `api.mouser.com`, `api.nexar.com`), a deadline (15 s, 15 s, 20 s), a body ceiling (2 MB, 2 MB,
4 MB), **no redirects**, JSON only — and one call shape that returns parsed JSON or a redacted sentence. DigiKey (token and
search), Mouser and Nexar now call nothing else. Each client logs only the boundary's own sentence; the raw error object
— which can carry the request URL, the transport's text or a credential — is never logged.

`b19-distributor-egress` proves, against a fake transport with the **real global fetch poisoned** (any client that
bypassed the boundary would fail the test instead of reaching the internet):

- a hung socket settles all three lookups at the deadline, as a missing price rather than a crash;
- each client reaches only its own host, over `redirect: "manual"`;
- a vendor host that resolves to 169.254.169.254 is refused before any byte leaves the process;
- an oversized vendor response is refused rather than buffered;
- nothing any client logs contains a credential, whatever the transport's own error says, and a vendor's own error body is
  never repeated.

### D19-3 corrected: Mouser's key in the URL is the vendor's design

Discovery recorded "the Mouser API key travels in the URL query string" as a defect. Checked against Mouser's current
documentation at execution time (the Search API guide and the API portal): the Search API **authenticates with an
`apiKey` query parameter** by design. Moving it to a header would break the connector. It is therefore a vendor constraint
to **contain**, and it is: the parameter is declared a secret in the source's policy, so it is never logged, never in a
message, and a request carrying it is never redirected. `discovery.md` is corrected to say so.

Sources: [Mouser Search API](https://www.mouser.com/en/api-search/), [Mouser API guide (PDF)](https://www.mouser.com/pdfDocs/api-guide.pdf), [Mouser API documentation](https://api.mouser.com/api/docs/ui/index).

### Measured while building it, and fixed in the test

Run against the clients as they were, the `egress` seam did not exist, so the clients used the REAL global fetch — with
dummy test credentials, so nothing sensitive left the machine — and several cases passed only because a real vendor call
failed fast, not because of any deadline. Only the three cases that failed were genuine reproductions. The suite now
poisons the global fetch for every case, so that can never recur silently.

### Not in I1

`/api/schematic/cross-verify` is an outbound call too (D19-6: it follows redirects with its bearer and reflects 200 bytes
of the remote body), but it is not an acquisition source and its endpoint is operator-configured. Its two leaks move to I2
with `/api/bom`'s error reflection, where both route-level fixes can be reproduced together.

## I2 — who may spend paid quota, and what a failure may say (CONFIRMED)

### Reproduced first, and wider than discovery recorded

Discovery named one route (D19-1): `/api/bom` was public, CSRF-free, priced live and honoured a caller-sent
`forceRefresh`. Reading every caller of the pricing layer found **six** public BOM routes that priced live: `/api/bom`,
`/api/bom/export-csv`, `/api/bom/procurement-packet` and the three cart routes. Each accepts a schematic body, and the
server resolves a part id to its catalog MPN before pricing, so an anonymous caller who names catalog parts spends quota
on real MPNs without typing one. The pricing layer had no notion of a caller: `getPricingFor` went live for every cache
miss, whoever asked.

D19-2 was wider too: **every** BOM route (the six above plus snapshot, diff and notifications) answered a failure with
the failure's own `message` — database hosts, connection strings, a distributor's status text.

### What changed

| rule | where |
|---|---|
| Live pricing is a capability the caller must be GRANTED: `getPricingFor(..., { live })` serves the cache and never calls a vendor unless `live: true`; `forceRefresh` means nothing without it. The safe value is the default, so a new caller that forgets to decide cannot spend quota | `app/lib/distributors/index.ts` |
| The builders carry the grant explicitly (`buildBom(state, choice, { live, forceRefresh }, selections)`); a cache-only build says so in its warnings | `app/lib/bom/build.ts`, `app/lib/bom-builder.ts` |
| `/api/bom` — the workbench, where a person asks for fresh prices — is an **authenticated project read** declared `providerCredit: true`, with the trusted project scope and the server-derived-key refusal the other authenticated BOM routes already had. It is the one route that asks for live pricing, and a member's refresh is honoured | `app/api/bom/route.ts`, `app/lib/auth/route-policy.ts` |
| The authenticated snapshot and diff routes ask for live pricing explicitly | `app/api/bom/snapshot/route.ts`, `app/api/bom/diff/route.ts` |
| The CSV export, procurement packet and three cart routes stay public and price from the cache only. A body claiming `live: true` or `forceRefresh: true` is not a grant | the five routes (unchanged code path; the default now fails closed) |
| No BOM route repeats a failure: a fixed sentence to the caller, a redacted and bounded line to the server log | `app/api/bom/_failure.ts`, all nine BOM routes |
| The batch failure log names the error class only | `app/lib/distributors/index.ts` |
| The workbench sends the project scope with its request, and without a project it says why instead of showing an empty table | `app/components/bom/BomView.tsx` |

### Proven

- `b19-pricing-live-gate.test.ts` (4): with no grant, a cache miss calls no vendor and `forceRefresh` does not pierce
  the cache; with the grant, it does both. **This is the real reproduction**: run against the old pricing layer, the
  vendor was called with no grant.
- `b19-bom-quota.test.ts` (12): the five public routes, under production auth with no identity, build once and never with
  a live grant or a refresh — even when the body claims both; `/api/bom`'s policy is `requiresAuth + providerCredit +
  trusted-context`; an anonymous production caller gets 401 with zero builds; a member gets `{ live: true, forceRefresh:
  true }`; a failure carrying a host, a password and a key is never in any response.
- A vacuous pass, recorded: against the old routes, the five "never asks for live" cases **passed**, because the old
  builder took a positional `forceRefresh` and live was the implicit default — the route-level assertion could not see
  it. The pricing-layer test above is what failed before the fix.
- Reviewed pin moves, each a strengthening: `b16-0-4` and `b16-0-5` list `/api/bom` as authenticated, and every body and
  media-type contract still runs against it; `b16-0-11` moves it from the public tranche (now x5) to the authenticated
  one, where the oversize, CSRF, 401 and scope cases now run against it too, and its passthrough pin is exercised as a
  member. The three committed route CSVs were regenerated; each changed exactly one row, `/api/bom POST`.
- The migration ratchet is unchanged at 158 (155 canonical + 3 factories + 0 raw): the route moved between canonical
  wrappers.

### Measured along the way

- In isolation (cold imports), the pre-existing "a revoked member is refused at the chat surface" case times out at
  5 s. Stashing all of I2 (`git stash push --include-untracked`) reproduced the same timeout on the I1 tree, so it is not
  caused by this change; the tree was restored identically. It passes in the broad run. A follow-up task was filed to give
  it a cold-import budget rather than calling it a flake.
- `BomView.tsx` has four `react-hooks/set-state-in-effect` lint errors; the same four exist on the committed file (the
  line numbers moved by three). None is introduced here.

### Not proven here

- The workbench in a browser. No Playwright spec reaches the BOM tab today, and the local dev server loads the owner's
  `.env.local`, which may carry real vendor credentials; it was stopped before any pricing request rather than spend
  quota. The browser proof (a member's BOM loads with its scope; no project shows the sentence) is carried by B19-E (I6),
  which changes that surface anyway. Label: **PROPOSED** for the browser, **CONFIRMED** at the route and pricing layer.
- The owner decision this makes is recorded as OD-31: an anonymous visitor now sees cached prices only.

## I2b — the second opinion's outbound call (CONFIRMED)

`/api/schematic/cross-verify` POSTs the user's prompt, with a bearer, to the operator-configured `SCHGEN_ENDPOINT_URL`. It
is not an acquisition source, but it is a server-side outbound call carrying a credential, so it takes the same boundary.

### Measured first: what the old call really did

Two loopback servers and a dummy bearer (`scratchpad` script, nothing left the machine), driving the old call shape on
Node 24.15:

| endpoint answer | followed? | bearer at the destination | prompt re-sent | the old route's reply to the caller |
|---|---|---|---|---|
| 307 to another origin (a loopback port) | yes | **absent** — Node drops `Authorization` cross-origin | yes | `SchGen endpoint 500: ` + the destination's body |
| 307 to the same origin | yes | present (by design) | yes | the same, from the same-origin page |

So discovery's D19-6 is **corrected**: the bearer does not cross origins on this runtime. What was real: a redirect is
followed to any address, loopback included; the prompt is re-sent there; the answer is buffered whole; and the caller is
told the final hop's status plus the first 200 bytes of its body — or the transport's own error text.

### Reproduced in the suite, before the fix

`b19-cross-verify-egress.test.ts` against the old route: **9 of 12 failed** — the redirect case (no `redirect: "manual"`),
all five non-permitted endpoints (a request was made to each: metadata over HTTP, `127.0.0.1`, `[::1]`, a name resolving
to `10.0.0.5`, plain HTTP), the body reflection, the transport-text reflection, and the oversized answer (accepted). Three
passed as baselines: the working path, the unconfigured path, and "nothing logged carries the token" — **vacuous** on the
old code, which logged nothing at all; it guards the new log line.

A test-harness mistake was found and fixed before recording: the unconfigured case passed `undefined` to a helper whose
default filled in the endpoint, so it "reproduced" a request that the old route never made. With the helper taking `null`,
that case passes on the old code, as it should.

### What changed

| rule | where |
|---|---|
| One client for the endpoint, through `outboundFetch`: HTTPS, the configured host is the only allowed host, no URL credentials, no loopback / link-local / private name or resolved address, a 240 s deadline per attempt, a 1 MB body ceiling, JSON only | `app/lib/schgen/endpoint-client.ts` |
| Redirects refused outright (`maxRedirects: 0`): the request carries a bearer and the prompt | same |
| The 503 wake-up retry kept, bounded: 3 attempts, 5 s / 10 s back-off, and a 300 s total budget (the old loop had none: up to three 240 s attempts plus back-off) | same |
| Configuration read at request time, not frozen at module load | same |
| A failure is a closed reason with a fixed sentence (`HTTP <status>` is the only remote detail kept); the server log gets the boundary's redacted line | same; `app/api/schematic/cross-verify/route.ts` |

### Proven

- Route (12): the redirect is refused after one request; five non-permitted endpoints make no request; neither the
  endpoint's body nor the transport's text nor the token reaches the caller; nothing logged carries the token; a 2 MB
  answer is refused; the working path sends the bearer to the configured URL only and compares; unconfigured stays
  `available: false` with no request.
- Client (14): configuration and policy; four refusals before any byte; the bounded retry (3 calls, 5000/10000 ms), the
  still-starting stop, no retry on other statuses; the attempt deadline on a hung endpoint; the total budget ending a
  retry run; the three answer shapes; non-JSON, invalid JSON and empty code; the bearer as a header with manual redirects.
- The B16.0.10 cross-verify pins (401, CSRF, 415, 413, the refusal, unconfigured) unchanged and green.

### Stated limit

As in I1: the transport resolves the name again at connect, so a sub-connect rebinding window is not excluded here; the
exact configured host is the only name allowed.
