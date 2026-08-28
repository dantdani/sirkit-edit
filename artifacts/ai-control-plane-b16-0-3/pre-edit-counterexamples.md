# B16.0.3 — pre-edit counterexamples (R1–R5)

Recorded BEFORE any production edit, against the current modules. No live
database was contacted. The R1 probe (`app/api/replacement-authority/__tests__/_b16-0-3-probe.test.ts`)
drove the REAL `POST` handler with instrumented source seams and was deleted
after recording. Every finding is converted to permanent regression coverage.

## R1 — anonymous `/api/replacement-authority` reaches component-authority resolution (no auth gate)

Probe: same-origin `Origin`, valid JSON, `scope=local/project-victim/main`,
valid `componentInstanceId`, `currentAtomicPartRevisionId=null`, valid nonce,
`injectIdentity(null)` (explicitly unauthenticated).

```
R1 anonymous POST → status=503 body={"ok":false,"error":"fresh component authority could not be resolved"}
R1 component-authority SOURCE resolved (reached past validation, NO auth gate)= true (count=1)
R1 loader invoked before any auth refusal = 0
R1 anonymous POST (default unconfigured source) → status=503 body={"ok":false,"error":"no durable authority source is configured"}
R1 cross-origin POST → status=503 (403 would mean CSRF is enforced; anything else = not enforced)
```

An anonymous same-origin caller passes all validation and reaches
`resolveComponentAuthoritySource` (source factory invoked, count=1); the result
is `503`, **not** `401`/`403`. Authorization does NOT precede source
resolution. A cross-origin caller is likewise NOT refused for CSRF (503, not
403). (The loader itself was not called only because the injected/default
source returned null first — the security-relevant fact is that the durable
authority source is resolved with no authentication.)

## R2 — the CI boundary gate deliberately exempts this route

`app/lib/auth/__tests__/b16-0-2-gates.test.ts`:

```
133  const KNOWN_NON_BOUNDARY_ROUTES = new Set(["app/api/replacement-authority/route.ts"]);
157          if (KNOWN_NON_BOUNDARY_ROUTES.has(route.rel)) continue;
```

The "every authenticated route reaches the shared authorization boundary" gate
explicitly `continue`s past `app/api/replacement-authority/route.ts`. Removing
the exception makes the current handler (which references no approved boundary
helper) fail the gate — demonstrated by the negative tripwire added in
`b16-0-3-*` (the previous handler shape is one of the four injected failing
cases).

## R3 — incorrect effective-resource classification

`artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv`:

```
/api/replacement-authority,POST,false,none,caller-supplied-only,false,,false,false,false,false
```

i.e. `durable_access=none`, `project_data_sensitivity=caller-supplied-only`.
The handler nevertheless resolves and reads durable authority:
`resolveComponentAuthoritySource`, `loadRunComponentAuthority`,
`loadRunReplacementPinFacts`. The effective resource classification is untrue —
this route reads durable, project-scoped authority.

## R4 — partially-owned BOM rows pass the current CHECK (SQL 3-valued logic)

Current `drizzle/0028_bom_project_ownership.sql` CHECK (both tables):

```
("tenant_id" IS NULL AND "project_id" IS NULL AND "branch_id" IS NULL)
OR (btrim("tenant_id") <> '' AND btrim("project_id") <> '' AND btrim("branch_id") <> '')
```

Evaluated under Kleene 3-valued logic (PostgreSQL CHECK rejects a row ONLY when
the predicate is FALSE; UNKNOWN passes):

```
1 tenant NULL, others set        -> CHECK=UNKNOWN  postgres_passes=True   ← DEFECT
2 project NULL                   -> CHECK=UNKNOWN  postgres_passes=True   ← DEFECT
3 branch NULL                    -> CHECK=UNKNOWN  postgres_passes=True   ← DEFECT
4 all NULL                       -> CHECK=True     postgres_passes=True
5 all set nonblank               -> CHECK=True     postgres_passes=True
6 all set, one blank             -> CHECK=False    postgres_passes=False
```

Cases 1–3 (a partially-owned row, e.g. `tenant_id` NULL but `project_id`/
`branch_id` set) produce SQL UNKNOWN in the second disjunct
(`btrim(NULL) <> ''` = UNKNOWN) and therefore **pass** the CHECK. The documented
"a partially-owned row can never exist" invariant is NOT enforced.

## R5 — unproven migration delivery

```
drizzle/meta/_journal.json  entries: 27  last tag: 0026_parts_atomic_links (idx 26)
has 0027 registered: False
has 0028 registered: False
package.json migration scripts: {'db:generate': 'drizzle-kit generate', 'db:push': 'drizzle-kit push'}
app/lib/db/schema.ts: bom_snapshots/bom_notifications declare tenant_id/project_id/branch_id + owner indexes,
                      but NO ownership-completeness check() constraint (grep of `check(` shows none on these tables)
```

The journal registers migrations only through `0026`; `0027_project_membership`
and `0028_bom_project_ownership` are unregistered. `db:push` diffs the schema
directly (and the schema does not declare the ownership CHECK, so `db:push`
would silently omit it); `db:generate` regenerates from the schema. There is no
verified/applied migration command and no single reproducible delivery path for
`0028`. (No live database was contacted.)
