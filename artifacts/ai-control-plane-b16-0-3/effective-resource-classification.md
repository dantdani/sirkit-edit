# Effective resource classification (§C / R3)

## The untrue row
Before this stage the byte-pinned
`route-data-and-resource-classification.csv` said:

```
/api/replacement-authority,POST,false,none,caller-supplied-only,false,,false,false,false,false
```

while the handler resolves and reads DURABLE, project-scoped authority:
`resolveComponentAuthoritySource` → `loadRunComponentAuthority` (durable
binding aggregates + published-atomic confirmation) and
`resolveReplacementPinFactsSource` → `loadRunReplacementPinFacts` (published
pin facts). `durable_access=none` / `caller-supplied-only` was untrue.

## The corrected rows (regenerated ONLY through the generator; byte-stable ×2)
```
/api/replacement-authority,POST,false,read,project-durable,false,,false,false,false,false
/api/chat,POST,false,read,session-identity,true,,false,false,false,false
```

- `/api/replacement-authority`: `is_public=false`, `durable_access=read`,
  `project_data_sensitivity=project-durable`, `authoritative_write=false`,
  `provider_credit=false`, `external_process` empty — exactly as mandated.
- `/api/chat` was surfaced BY the new connective check as a second untrue row:
  it reads the SAME durable component-authority/pin-facts sources for the
  agent's replacement-facts path, so its durable access is now truthfully
  `read` (sensitivity stays `session-identity`; provider_credit stays true).
  This was not silently absorbed — it is a genuine finding of the check.

## The permanent connective check (not policy-derived)
`app/lib/auth/route-resource-classification.ts` now exports
`KNOWN_DURABLE_SOURCE_SYMBOLS` (`resolveComponentAuthoritySource`,
`loadRunComponentAuthority`, `loadRunReplacementPinFacts`,
`resolveReplacementPinFactsSource`), and
`b16-0-3-effective-classification.test.ts` walks EVERY `app/api/**/route.ts`,
extracts its REACHABLE IMPORTED CALLS with the same AST machinery as the
boundary gate (not text matching, not the policy table), and fails if any
route that actually CALLS a durable-source symbol carries
`durable_access=none`. The suite additionally pins that the replacement-
authority handler really does call those symbols (so the check cannot go
vacuous) and demonstrates the flagging logic on the durable-caller set.

Effective security classification is therefore connected to what handlers DO,
not solely to what the policy table declares.
