# B16.0.13 §G — Protected copper & source-revision parity

The standing `app/api/pcb/autoroute/__tests__/route.test.ts` (fake runner +
fake runtime; 24 tests) is the authoritative parity suite for these behaviors
and passes UNCHANGED against the migrated route:

- **sourceRevision conflict behavior** — a stale `sourceRevision` refuses with
  the historical conflict contract before any pass runs;
- **protected copper preservation** — pre-routed tracks/vias marked protected
  survive candidate generation; the route's preservation logic is byte-
  identical;
- **candidate revision generation** — deterministic candidate revision ids
  over the same inputs (unchanged code path);
- **net-id validation** and positive-number option validation — exact
  historical 400s;
- **SES parsing and fabrication-readiness evaluation** — unchanged modules,
  same evidence/diagnostics in the response;
- **debug-bundle behavior** — unchanged.

The migration replaced only the authorization/read prologue and the two
`request.signal` references (now the wrapper-projected `signal`, the same
lifecycle signal object). Nothing that computes revisions, preserves copper,
parses SES, or evaluates readiness was modified —
`git diff` over the route shows the prologue + signal lines only
([changed-files.md](changed-files.md)).
