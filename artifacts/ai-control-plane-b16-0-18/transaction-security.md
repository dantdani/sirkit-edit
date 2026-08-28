# B16.0.18 §F — Transaction security (CONFIRMED)

| Rule | Evidence |
|---|---|
| required state/baseStateDigest/idempotencyKey/reason/operations | 400 exact message (pinned) |
| project/branch scope binding | foreign scope → 422 BEFORE `createComponentSelectionTransaction` (zero calls, pinned) |
| actor exclusively from trusted context | captured actor = `{actorId:"u1", actorKind:"human", sessionId:<derived>, role:"pcb_editor"}`; attacker body actor ignored (pinned) |
| accepted/conflict/refused mapping | `record.state` → 200 / 409 / 403 (unchanged) |
| direct AI mutation denied | the domain transaction layer's AI-denial (standing routes.test/domain suite) unchanged and green |
| no new operation types | the `ComponentSelectionOperation` union and its validation untouched |
