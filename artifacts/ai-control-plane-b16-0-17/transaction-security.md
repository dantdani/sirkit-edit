# B16.0.17 §G — Transaction security (CONFIRMED)

`/transaction` (migrated) preserves the deterministic transaction contract:

| Rule | Evidence |
|---|---|
| required state, operations, reason, idempotencyKey, baseStateDigest | 400 exact message (pinned) |
| project/branch validation | foreign scope → 422 BEFORE `createSchematicTransaction` (pinned zero calls) |
| actor exclusively from trusted context | captured actor = `{actorId:"u1", actorKind:"human", sessionId:<derived>, role:"pcb_editor"}`; body actor/role/session ignored (pinned) |
| accepted/conflict/refused status mapping | `record.state` → 200 / 409 / 403 (unchanged) |
| idempotency + base-digest conflict semantics | `applySchematicTransaction` internals untouched (domain suite green) |
| direct AI graph transactions remain refused | the standing routes.test "denies direct AI graph transactions" passes UNCHANGED against the migrated route |
| no new SchematicOperation kinds | the operation union and its validation are untouched |
| no transaction authority exposed to providers | propose emits `graphMutation: null`; no provider tool routes to /transaction; tool exposure unchanged at 12 |
