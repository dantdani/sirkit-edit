# B13.2 §D — real production query cancellation

## The defect (R6)

The B13.1 production adapter carried `void signal; // the Postgres adapter
does not accept an AbortSignal today`, and the atomic confirmer accepted no
signal at all. An aborted request left database work running to completion.

## What the driver actually supports

Installed **postgres.js 3.4.9**:

- `node_modules/postgres/types/index.d.ts:608` —
  `PendingQueryModifiers.cancel(): void`, present on the object returned by
  `sql.unsafe(text, params)` (line 691);
- line 455 lists server error `'57014' // canceling statement due to user
  request`.

`cancel()` issues the PostgreSQL out-of-band cancel request on a separate
connection; the in-flight query then rejects with 57014.

## The adapter

NEW server-only module
[authority-cancellable-reads.ts](../../app/api/chat/authority-cancellable-reads.ts).
`runCancellableAuthorityRead(client, text, params, signal)`:

1. **refuses to START** when `signal.aborted` (so an abort between sequential
   reads ends the sequence);
2. registers an abort listener that calls the driver's real `query.cancel()`
   (a throwing `cancel()` is swallowed — cancellation is best-effort);
3. awaits the query;
4. normalizes EVERY failure to `AUTHORITY_READ_ABORTED` (signal aborted) or
   `AUTHORITY_READ_UNAVAILABLE` — no SQL text, connection string,
   credential, or raw driver error escapes;
5. always removes the listener.

## Queries made cancellable

| read | table | cancellable |
| --- | --- | --- |
| binding-set lookup (full component scope) | `physical_binding_sets` | yes |
| binding revision / aggregate read | `physical_binding_revisions` | yes |
| atomic revision lookup (published only) | `atomic_part_revisions` | yes |
| CAD asset lookup (symbol + footprint versions) | `atomic_cad_assets` | yes |
| mapping lookup (approved only) | `atomic_mapping_certificates` | yes |
| exact-part lookup | `atomic_exact_parts` | yes |

The manufacturer identity is the `manufacturer_id` column of the exact-part
row, so the confirmation projection reaches no separate manufacturers query;
there is no uncancellable read left on this path. Once the signal aborts, no
subsequent query in the sequence starts.

Unrelated paths are untouched: `PostgresPhysicalBindingRepository.commit`,
every write, migration, audit, assessment, and the general
`loadPublishedPortableSnapshot` used by other consumers are unchanged. The
authority path simply no longer routes through them.

## Honest limits

PostgreSQL cancellation is **best-effort by protocol** — the cancel request
travels on its own connection and can lose the race with query completion, and
a cancel that arrives after the server finished has no effect. User-facing
behaviour never depends on it: §C makes settlement immediate and
deterministic regardless, and the adapter's refuse-to-start rule bounds the
work that can still be issued. Driver cancellation is converted into ordinary
fail-closed unavailability, never surfaced as an error to the caller.

## Proof

Adapter-level tests drive controllable `PendingQuery` objects whose `cancel()`
is observable and which reject the way the driver's 57014 does:

- **16** abort during a BINDING query ⇒ `cancel()` invoked once, failure
  normalized to `AUTHORITY_READ_ABORTED`;
- **17** abort during an ATOMIC query ⇒ `cancel()` invoked once, no
  confirmation;
- **18** abort BETWEEN sequential reads ⇒ the second query never issues
  (`issued.length === 1`);
- **18b** a leaky driver error (connection string + SQL text) normalizes to
  `AUTHORITY_READ_UNAVAILABLE` with neither secret nor table name present;
- **18c** a successful read projects ONLY `{ set, bindings }` (extra row
  columns marked `LEAK` never appear) and applies hierarchy/variant filtering
  at the query layer;
- **18d** supplementary static tripwire: `void signal` is gone and the
  runtime wires both cancellable readers.

A test that merely observes `signal.aborted` would not satisfy any of 16–18;
each asserts the driver's `cancel()` call count or the absence of a
subsequent query.
