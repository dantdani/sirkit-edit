# BOM ownership CHECK truth table (§D / R4)

## The invariant
A `bom_snapshots` / `bom_notifications` row is EITHER a quarantined legacy row
(all three ownership columns NULL) OR fully owned (all three non-null AND
nonblank). A partially-owned row must be impossible.

## Why the B16.0.2 form failed (SQL three-valued logic)
PostgreSQL rejects a row on a CHECK only when the predicate is **FALSE**;
**UNKNOWN passes**. The old second disjunct was `btrim(col) <> ''` alone, and
`btrim(NULL) <> ''` is UNKNOWN — so for a partial row (one column NULL, the
others set) the first disjunct was FALSE, the second UNKNOWN, `FALSE OR
UNKNOWN = UNKNOWN`, and the row PASSED.

## The six-value truth table (pinned in `b16-0-3-bom-ownership-check.test.ts`)
| case | (tenant, project, branch) | OLD CHECK | OLD passes | NEW CHECK | NEW passes |
|---|---|---|---|---|---|
| 1 partial: tenant NULL | (NULL, "p", "main") | UNKNOWN | **true — DEFECT** | FALSE | **false** |
| 2 partial: project NULL | ("local", NULL, "main") | UNKNOWN | **true — DEFECT** | FALSE | **false** |
| 3 partial: branch NULL | ("local", "p", NULL) | UNKNOWN | **true — DEFECT** | FALSE | **false** |
| 4 legacy: all NULL | (NULL, NULL, NULL) | TRUE | true | TRUE | true |
| 5 owned: all set nonblank | ("local", "p", "main") | TRUE | true | TRUE | true |
| 6 invalid: one blank | ("local", "", "main") | FALSE | false | FALSE | false |

The suite models Kleene 3-valued AND/OR/IS NULL/btrim exactly, keeps the OLD
form as a REGRESSION WITNESS (cases 1–3 must evaluate UNKNOWN under it and be
rejected under the new form), and pins that cases 4–6 behave identically in
both forms.

## The fixed expression (both tables, migration 0028 AND schema.ts)
```sql
( tenant_id IS NULL AND project_id IS NULL AND branch_id IS NULL )
OR (
  tenant_id IS NOT NULL AND project_id IS NOT NULL AND branch_id IS NOT NULL
  AND btrim(tenant_id) <> '' AND btrim(project_id) <> '' AND btrim(branch_id) <> ''
)
```
With `IS NOT NULL` explicit, a partial row makes the second disjunct FALSE
(not UNKNOWN), so `FALSE OR FALSE = FALSE` and the row is rejected.

Declared twice, name-identical (`bom_snapshots_ownership_complete_check`,
`bom_notifications_ownership_complete_check`):
- `drizzle/0028_bom_project_ownership.sql` (DROP CONSTRAINT IF EXISTS + ADD);
- `app/lib/db/schema.ts` as drizzle `check(...)` constraints — so `db:push` /
  `db:generate` can no longer silently omit them.
Schema/migration parity (names + IS NOT NULL form on both tables in both
sources) is test-pinned.
