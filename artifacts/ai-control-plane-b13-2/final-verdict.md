# B13.2 — final verdict

**Stop condition:** B13.2 is complete only when authority for one
component/hierarchy/variant cannot be projected as another; `verified-exact`
requires internally consistent selected and exact authority; mid-flight
request abort settles immediately; production database reads attempt real
cancellation; and the actual `/api/chat` handler proves the complete
production path.

**Verdict: MET on all five.**

1. **Cross-identity projection is impossible.** The binding source receives
   ONE complete `AuthorityComponentScope`; every aggregate must match all
   seven fields (including element-wise hierarchy equality and variant
   applicability) and every binding must carry its set's complete owner
   scope, all BEFORE validation or projection. The projected `componentId`
   derives from the validated durable scope, not the request. A mismatch
   fails the load closed with a bounded reason carrying no foreign
   identifier. Proven for component, hierarchy, variant, board, branch,
   project, tenant, mixed bindings, and wrong-owner selection — and again
   end-to-end through the real route handler.
2. **`verified-exact` is internally consistent.** MPN *and* manufacturer must
   agree between `selectedPart` and `exactAuthority`, every identifier must
   be a valid bounded identifier, and no empty or whitespace-only identity
   passes. Inspection classification and grant eligibility agree — the
   manufacturer-mismatched record is refused `not_verified` through the real
   grant path while the consistent control still grants.
3. **Mid-flight abort settles immediately.** External abort is a terminal
   race member: settlement occurs with zero timer advance, the internal
   controller aborts exactly once, the timer is cleared, the listener is
   removed, late resolution and rejection are discarded with no unhandled
   rejection, and a pre-aborted request performs no I/O. Confirmed through
   the real handler with a hanging durable source.
4. **Production reads attempt real cancellation.** All six authority reads go
   through the cancellable adapter, which invokes postgres.js
   `query.cancel()` on abort, refuses to start further queries once aborted,
   and normalizes every driver failure without leaking SQL, connection
   details, or raw errors. PostgreSQL cancellation is best-effort by
   protocol; that limit is documented and user-facing settlement never
   depends on it.
5. **The actual handler proves the path.** `POST` is imported and invoked;
   scope validation, shared board identity, resolver, loader, assembly,
   sealing, and toolset construction all run unmodified, and the assertions
   read what the running handler produced.

Classification of claims:

- **CONFIRMED:** all seven reproductions (verbatim probe output and source
  evidence in [pre-edit-counterexamples.md](pre-edit-counterexamples.md));
  all closures via 31 new permanent tests plus the strengthened B13/B13.1
  suites; full suite 2639 passed / 20 skipped / 0 failures; b11 pins
  unchanged (`03e043f4…`); B05 fixtures and PCB hashes unchanged; ten-tool
  exposure unchanged; protected original untouched.
- **INFERRED:** behaviour against a live PostgreSQL server — the cancellation
  adapter is proven against controllable query objects that implement the
  documented postgres.js `PendingQuery` contract (`cancel(): void`, 57014
  rejection), and the 6 DB-gated integration tests remain skipped without
  `DATABASE_URL` on this machine.
- **PROPOSED:** none required for the stop condition. (Optional future work:
  an authority-bearing replay capsule, and a live-database integration run
  once a test instance is available.)
- **UNKNOWN:** how often a real PostgreSQL cancel request wins its race
  against query completion under production load. This affects only how much
  server work is saved, never correctness or settlement latency.

**B14 is NOT started. Stopped; awaiting independent verification.**
