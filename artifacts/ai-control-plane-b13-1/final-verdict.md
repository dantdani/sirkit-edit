# B13.1 — final verdict

**Stage stop condition:** "B13.1 is complete only when an ordinary
production /api/chat request can resolve real server-owned component
authority without a test setter, while every malformed or mismatched
durable source fails closed."

**Verdict: MET.**

- The default source factory IS the production adapter: with
  `DATABASE_URL` configured, `resolveComponentAuthoritySource` returns a
  real Postgres-backed binding source and published-atomic confirmer with
  NO setter involved (§A test 1 proves the default path; the setter is
  test-only with a deterministic reset).
- The write path and the read path share ONE board identity
  (`pcbBoardInstanceId`, `["root"]`, `variant-default`) — a production
  binding is findable by the production chat load (§B + §D end-to-end on
  real-service data).
- Every malformed durable source fails closed: 7 tamper classes ⇒
  truthful `conflicted` (never exactAuthority, never silent); 5
  atomic-mismatch classes ⇒ truthful `exact-authority-unresolved` (never
  a grant-capable record); unpublished/incomplete snapshots ⇒ no exact
  authority; source/config failure ⇒ resource withheld, run unaffected;
  deadline ⇒ underlying work actually aborted, one settlement, no
  unhandled rejections.
- Provider parity is proven against the REAL render transforms; the
  vacuous test is gone.

Classification of claims:

- **CONFIRMED:** all eight reproductions (probe outputs in
  [pre-edit-counterexamples.md](pre-edit-counterexamples.md)); all
  closures via the 22-test permanent suite + rewritten b13 suite;
  full-suite 2608/0-fail; pins unchanged (`03e043f4…`); PCB foundation
  hashes unchanged; protected original untouched.
- **INFERRED:** the production Postgres adapter behaves correctly against
  a live database (adapter seams are exercised with real service data and
  real snapshot shapes; the 6 DB-gated integration tests remain skipped
  without `DATABASE_URL` on this machine).
- **PROPOSED:** none pending — no follow-on work is required for the
  stop condition.
- **UNKNOWN:** live-database end-to-end latency of the authority load
  under production data volumes (bounded by the existing deadline, which
  now truly cancels).

**B14 is NOT started. Stopped; awaiting independent verification.**
