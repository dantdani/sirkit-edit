# B13.2 — pre-edit counterexamples (verbatim probe outputs)

Captured with a disposable vitest probe (`b13-2-probe.test.ts`, deleted after
capture) against the UNMODIFIED B13.1 tree, using genuinely VALID aggregates
built through the real `PhysicalBindingService`
(`__tests__/_authority-fixtures.ts`). R6/R7 are source-inspection findings.

## R1 — component identity substitution

Requested authority for `component-uuid-1`; the source returned a completely
valid durable aggregate for `component-uuid-2`:

```json
R1 {"status":"loaded","requestedComponent":"component-uuid-1","durableComponent":"component-uuid-2","projectedComponent":"component-uuid-1","exactAuthorityMinted":true}
```

The loader relabeled component 2's authority as component 1 AND minted
exactAuthority for it. Root cause: `scopesEqual`
(component-authority-source.ts:138) compares only
tenant/project/branch/board — `componentInstanceId` never participates — and
`projectRecord` labels the record with the REQUESTED id.

## R2 — hierarchy substitution

A valid aggregate with the correct tenant/project/branch/board/component but
`hierarchyPath: ["root","motor-control"]`:

```json
R2 {"status":"loaded","aggregateHierarchyPath":["root","motor-control"],"requestedHierarchyContract":"ABSENT — LoadComponentAuthorityInput has no hierarchyPath field; the loader never compares it","accepted":true,"exactAuthorityMinted":true}
```

Accepted with exact authority. `LoadComponentAuthorityInput` carries no
hierarchy at all, so the loader cannot compare it.

## R3 — variant substitution

Requested `variant-default` (the loader default); the source returned a valid
approved binding whose `assemblyVariantIds` is `["variant-alt"]` — neither
containing the requested variant nor universal (`[]`):

```json
R3 {"status":"loaded","requestedVariant":"variant-default","aggregateVariants":["variant-alt"],"universal":false,"accepted":true,"exactAuthorityMinted":true}
```

Accepted with exact authority — the loader never checks variant applicability.

## R4 — internal classification mismatch

A record with `selectedPart.mpn === exactAuthority.mpn` but
`selectedPart.manufacturer` ≠ `exactAuthority.manufacturer`, all other facets
verified:

```json
R4 {"selectedMpn":"MPN-1","exactMpn":"MPN-1","selectedManufacturer":"Vendor-A","exactManufacturer":"Vendor-B","state":"verified-exact"}
```

`hasCompleteExactAuthority` (component-authority.ts:155) checks MPN agreement
only — manufacturer disagreement still classifies `verified-exact`.

## R5 — mid-flight request abort does not settle

A source that never settles (even after observing abort); external signal
aborted 4 s before the 5 s deadline (fake timers):

```json
R5 {"midFlightExternalAbort":"HUNG","sourceSawAbort":true,"settledOnlyAtDeadline":true}
```

The settlement race (component-authority-source.ts:284) is
`Promise.race([load, deadline])` — external abort aborts the internal
controller but is NOT itself a terminal race member, so a non-cooperative
source leaves the returned promise pending until the separate deadline.

## R6 — production database work is not cancelled

Source inspection of `app/api/chat/component-authority-runtime.ts` (B13.1):

```
42:      void signal; // the Postgres adapter does not accept an AbortSignal today
57:  const atomic = async (atomicPartRevisionId: string): Promise<AtomicRevisionConfirmation | null> => {
```

- the binding adapter DISCARDS the abort signal (`void signal`);
- the atomic confirmer does not accept or pass an AbortSignal;
- `PostgresPhysicalBindingRepository.findForComponentVariant` takes no signal.

The installed postgres.js **3.4.9** supports cancellable query objects:
`node_modules/postgres/types/index.d.ts:608` declares `cancel(): void` on
`PendingQueryModifiers` (returned by `sql.unsafe(query, params)` at line 691),
and line 455 classifies server error `'57014' // canceling statement due to
user request`. No production read invokes `cancel()`; signal delivery alone
is NOT database cancellation.

## R7 — route integration is simulated

The B13.1 §G "route and provider integration" tests
(`b13-1-authority-integrity.test.ts:260–331`) call
`resolveComponentAuthoritySource`, `loadRunComponentAuthority`,
`assembleAgentRunContext`, `buildRunToolset`,
`renderOpenAiResponsesTool`/`renderAnthropicAgentTool`, and
`buildAgentResourceBundle` DIRECTLY. The exported `POST` handler is never
imported or invoked: the only reference to `app/api/chat/route.ts` in the
whole suite is a `readFileSync` source-text scan (line 96, the §B static
gate). No `Request` object is constructed anywhere in the file. The claimed
"route integration" therefore proved a manual re-composition of the pipeline,
not the production `/api/chat` handler.
