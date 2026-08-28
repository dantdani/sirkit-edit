# B13.2 — component / hierarchy / variant isolation

The three substitutions that B13.1 accepted (R1, R2, R3) now fail closed.
Every case below starts from a genuinely VALID aggregate produced by the real
`PhysicalBindingService`, so the refusal can only come from the scope rule.

| substitution | durable aggregate | requested | B13.1 | B13.2 |
| --- | --- | --- | --- | --- |
| component | `component-uuid-2` | `component-uuid-1` | projected as `component-uuid-1` WITH exact authority | `unavailable` (out of scope) |
| hierarchy | `["root","power"]` | `["root","motor-control"]` | accepted with exact authority | `unavailable` (out of scope) |
| variant | `["variant-alt"]` | `variant-default` | accepted with exact authority | `unavailable` (out of scope) |
| board | `board-other` | `board-1` | dropped silently | `unavailable` (out of scope) |
| branch/project/tenant | `release` / `project-other` / `tenant-other` | fixture scope | dropped silently | `unavailable` (out of scope) |
| mixed bindings in one set | own set + another component's bindings | fixture scope | accepted (only 4 fields compared) | `unavailable` (binding outside owner scope) |
| wrong-owner selected binding | selected binding's hierarchy altered | fixture scope | treated as selected | `unavailable` (binding outside owner scope) |
| universal variant | `[]` | `variant-default` | accepted | accepted — correct, universal applicability |
| variant list containing request | `["variant-alt","variant-default"]` | `variant-default` | accepted | accepted — correct |
| oversized raw collection | 9 aggregates (limit 8) | fixture scope | bounded only AFTER filtering | `unavailable` before any filtering/validation |

## Identity derivation

```
componentId(record) = aggregate.set.scope.componentInstanceId   // VALIDATED durable value
```

not the requested id. The two are provably equal at that point (the scope
comparison ran first), so the record is labeled with a fact, not a request —
a durable record can never be relabeled as a different component.

## Where this is enforced

- `aggregateScopeMatches(set.scope, requestedScope)` — the seven-field
  comparison including hierarchy equality and variant applicability;
- `bindingOwnsSetScope(binding.scope, set.scope)` — every binding, including
  the selected one;
- both run BEFORE `aggregateIsValid`, before conflict handling, and before
  any projection.

Tests: §A 1–7 plus 7b (shared-identity defaults) in
`b13-2-authority-scope-and-cancellation.test.ts`; end-to-end through the real
`/api/chat` handler in §E test 20.
