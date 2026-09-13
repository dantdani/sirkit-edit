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
