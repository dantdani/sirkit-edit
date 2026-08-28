# B16.0.4 §B — Public request-body abuse surface

Public routes accept bodies from **anyone** — no session, no membership, no
CSRF. Before this stage, 16 public route files consumed bodies through direct
`request.json()`/`request.text()`: an anonymous caller could hold a handler
open with a never-settling stream, or make it buffer an arbitrarily large body,
before any application-level size test ran. Public status is not permission to
buffer an unlimited request.

## The rule now enforced

Every public body-consuming method runs the bounded reader — wire-byte
ceiling + hard deadline + abort propagation — **before any compute, export,
catalog, DB, or external work**. The refusal (413/408/400) is produced from
the reader's settled result; nothing downstream starts on a refused body.

## Public body-consuming routes and their bounds

| Route | maxBytes | deadlineMs | Downstream it protects | Rationale |
|---|---|---|---|---|
| `POST /api/parts/search` | 200 000 | 10 000 | DB (drizzle) + embeddings | search bodies are tiny; tight bound |
| `POST /api/components/atomic/search` | 200 000 | 10 000 | DB catalog search | same |
| `POST /api/constraints/explain` | 2 000 000 | 15 000 | constraint compute | schematic-fragment payloads |
| `POST /api/constraints/preview` | 2 000 000 | 15 000 | constraint compute | same |
| `POST /api/export/kicad` | 8 000 000 | 30 000 | export serialization | full schematic state |
| `POST /api/pcb/export/kicad-pcb` | 16 000 000 | 45 000 | board export | full board state |
| `POST /api/pcb/placement/preview` | 16 000 000 | 45 000 | placement compute | full board state |
| `POST /api/bom` | 8 000 000 | 30 000 | BOM build + distributor pricing fetch | full schematic state |
| `POST /api/bom/cart/{digikey,lcsc,mouser}` | 8 000 000 | 30 000 | cart export | BOM rows |
| `POST /api/bom/export-csv`, `/api/bom/procurement-packet` | 8 000 000 | 30 000 | CSV/packet build | BOM rows |
| `POST /api/spice/compile` | 8 000 000 | 30 000 | IR/netlist compile | full simulation project |
| `POST /api/spice/reports` | 8 000 000 | 30 000 | report build | project + run records |
| `POST /api/spice/run-plans/estimate` | 8 000 000 | 30 000 | plan estimation | full simulation project |

(The authoritative, generator-emitted list — including authenticated and
worker methods — is [request-body-boundary-matrix.csv](request-body-boundary-matrix.csv);
public rows carry `authorization_ordering = bounded-body-before-compute`.)

## What an anonymous attacker can and cannot do now

- **Cannot hang a handler**: a stream that never emits or trickles forever
  settles at the route's deadline (408) — proven behaviorally in
  [bounded-reader-settlement-evidence.md](bounded-reader-settlement-evidence.md).
- **Cannot make the server buffer past the ceiling**: consumption stops at the
  first byte over `maxBytes` (413); the ceiling-stop test pins that fewer than
  5 chunk pulls occur on an unbounded stream with a 1 000-byte ceiling.
- **Cannot reach compute/DB with a refused body**: the oversized
  `parts/search` case returns a clean 413 with the DB never resolved (an
  unconfigured `getDb()` would 500 if reached — it doesn't).
- **Can still submit a valid ≤ceiling body** — that is the route's purpose;
  rate/abuse control beyond per-request bounds (e.g. request-rate limiting,
  provider-credit quotas on public compute) remains an infrastructure concern
  outside this stage's scope, recorded in
  [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md).

## Worker route

`POST /api/assignment-queue/materialize` is not public — it requires the
`timingSafeEqual` worker secret FIRST — but it is internet-reachable, so it
carries the same bounded read (8 MB / 30 s) *after* the secret check: an
unauthorized caller gets 401 with zero body pulls; an authorized worker with a
malformed/oversized/stalled bundle triggers zero materialization work.
