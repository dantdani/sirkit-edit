# B08.2 — Bare-History Capability: Export/Import Boundary Matrix

## The capability

`app/lib/engineering/pcb-bare-authority.internal.ts`
- `authorizeBarePcbHistory(history)` — GRANT. Refuses (`false`) unless
  `historyBindingState(history) === "unbound"`. TEST-ONLY: no production
  module calls it (enforced by the b08-2 gate below).
- `isBareHistoryAuthorized(history)` — CHECK (read-only).
- `BARE_AUTHORIZED` WeakSet — module-private; unreachable.

## Export surface (proven by b08-2 test 1: namespace inspection)

| surface | before B08.2 | after B08.2 |
|---|---|---|
| `app/lib/engineering/editor-adapter.ts` | exported grant + check | exports NEITHER (imports the check internally) |
| `app/lib/engineering/pcb-commit-gateway.ts` | re-exported grant (line 31) | re-export DELETED; imports the check internally |
| `app/lib/engineering/index.ts` (`export * from "./editor-adapter"`) | leaked grant + check | leaks nothing (nothing to leak); never exports the internal module |
| any barrel/module elsewhere | n/a | none exports it (source walk) |

## Approved importers (pinned by b08-2 test 5 — CI import gate)

| file | role | may grant? |
|---|---|---|
| `app/lib/engineering/pcb-bare-authority.internal.ts` | defines the capability | (defines) |
| `app/lib/engineering/editor-adapter.ts` | `applyEditsCanonical` unbound-refusal check | NO — check only |
| `app/lib/engineering/pcb-commit-gateway.ts` | `commitPcbCandidate` unbound-refusal check | NO — check only |
| `app/lib/pcb/tools/select-move.ts` | `legacyMutationAllowed` gesture/delete guard | NO — check only |
| `__tests__` files (excluded from the walk) | explicit test compositions | yes (test-only) |

A SECOND scan asserts no production file (outside the internal module)
contains the call `authorizeBarePcbHistory(` at all — the grant is
unreachable from production even by an approved check-importer.

## Authorized compositions after B08.2

| composition | authority |
|---|---|
| Editor UI (bound history) | CanonicalEditorSession via the ONE gateway — never bare |
| Server repair-agent route | NONE — pure planning (read/plan tools; `planRepairs` uses `applyDerived`, not the mutation funnel; board discarded). Grant call removed. |
| inspector-commands / routing-rules-panel / pcb-repair-agent / b08-1 / b08-2 tests | explicit grant via the internal module import (test-only) |
| everything else | `canonical_authority_missing` structured refusal, zero mutation |

## Refusal taxonomy (b08-2 test 3)

| binding state | capability | gateway reasonCode | diagnostics | applyEditsCanonical error |
|---|---|---|---|---|
| active | n/a | (canonical commit path) | — | — |
| retired | can never be granted | `session_retired` | `HISTORY_RETIRED` | "…retired…" |
| unbound, no grant | — | `canonical_authority_missing` | `HISTORY_UNAUTHORIZED_BARE` | "…no bare-history capability…" |
| unbound, granted (tests) | legacy funnel | — | — | legacy applyEdits |
