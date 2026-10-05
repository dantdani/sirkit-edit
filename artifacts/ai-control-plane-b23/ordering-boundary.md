# B23-C - ordering visibly disabled, with the full contract

Labels: **CONFIRMED** (executed and measured here, or read at the cited file:line), **INFERRED** (a conclusion from reading code; nothing
executed it), **PROPOSED**, **RECORDED** (written down without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Tree: `chapter/b23-external-manufacturing`, base `8bca09e` (B23-B3), working tree of 2026-10-04. Runbook B23-C (`:984-998`): "Ordering
stays feature-disabled until the owner separately supplies:" seven inputs (`:986-994`); "When enabled, require a second explicit
confirmation bound to exact provider, cart/order lines, quantities, currency, total price ceiling, shipping destination reference,
release/BOM digest and expiry. Re-read price and availability immediately before submission. The AI cannot mint or consume the final
purchase authorization." (`:996`); "Duplicate submission, retry after timeout and webhook replay must not create duplicate orders. An
ambiguous provider response must be `UNKNOWN_PENDING_RECONCILIATION`, never silently retried." (`:998`). Closes D23-10 and D23-11, and
D23-4's order-contract half. Owner decisions applied: OD-170, OD-171 and OD-172; C's own choices beyond its task text are OD-186
(section 11).

**Verdict: ordering is visibly disabled.** No owner record supplies any of the seven prerequisites, no composition root wires a
submission port, and no environment variable can change either; the provider panel says so in a fixed notice with no control beside it.
The purchase-authorization and order contract that ordering would need is written and tested offline only, against a fake provider
port. Live ordering is BLOCKED-LIVE-QUALIFICATION (LB-12): no provider is admitted and Sirkit holds no provider account (OD-160).

## 0. What B23-C is

- **Ordering visibly disabled (D23-10; OD-170, OD-171).** `app/lib/manufacturing-providers/ordering-enablement.ts`: a pure
  `orderingEnablement()` that answers disabled, with the closed list of missing prerequisites, unless an owner record carries all seven
  runbook inputs AND a reviewed code change wires a submission port; no record exists and no port is wired. The action record
  `manufacturing.provider-order` (status `missing`, explicitly blocked, `toolExposure: "none"`, approval tier `release`, Tier 3) and a
  fixed notice in the provider panel. CONFIRMED (`b23-c-ordering-disabled`, 7 cases)
- **The purchase authorization (D23-11; OD-172).** `purchase-authorization.ts`: a human project administrator requests; a different one
  confirms the exact request, which mints a single-use, server-held authorization bound to every runbook field, with a decimal price
  ceiling and an expiry at most 10 minutes ahead; one compare-and-set burns it; any changed field refuses; the model and automation are
  refused at every step. An exact approved-importer gate keeps the agent loop, the gateway, the chat route, MCP and orchestration away
  from it. CONFIRMED (`b23-c-purchase-authorization`, 11 cases [B23-C fix, 2026-10-04: 8 before the review round, section 8])
- **The order contract (D23-4's order-contract half, D23-11; OD-172).** `order-contract.ts`: an injected port and no production port;
  price and availability re-read immediately before the one submission; one order per authorization and per unresolved or claimed cart,
  the cart being what is ordered (the parts and their total quantities); `UNKNOWN_PENDING_RECONCILIATION` never retried; no composition
  root wires it. CONFIRMED (`b23-c-order-contract`, 16 cases [B23-C fix, 2026-10-04: 7 before the review round, section 8] [B23-C lead,
  2026-10-04: 13 before the independent check's two low findings; cases 14-16, section 8])
- **Webhook verification.** `webhook-verification.ts`, pure: a signature over the raw body, a timestamp window and a bounded replay store.
  CONFIRMED (`b23-c-webhook-verification`, 7 cases)
- **Unchanged.** No route (census 166 / 163 / 3 / 0), no agent tool (47 / 36 / 9 / 27), no provider client, no composition-root wiring,
  no new dependency (OD-42), the pinned release identities untouched, the B19-E tripwire unchanged, no provider contacted, no account, no
  credential. CONFIRMED (section 10)

## 1. Ordering visibly disabled (D23-10, OD-170, OD-171)

**The enablement (C1-C7).** `orderingEnablement({ ownerRecord, submissionPort, env })` defaults to B23's facts: `ORDERING_OWNER_RECORD`
is null and `ORDER_SUBMISSION_PORT_WIRING` is `"none"`. Its answer is deep-frozen and names its reasons from a closed list
(`owner_record_absent`, `owner_record_invalid`, `prerequisites_missing`, `submission_port_not_wired`, `operator_disabled`) and the
missing prerequisites in the runbook's order. Today it answers `{ enabled: false, reasons: ["owner_record_absent",
"submission_port_not_wired"], missing: <all seven>, ownerDecision: null }` with the notice (case 1). A record missing any one
prerequisite, or giving it as blank or `UNKNOWN`, lists exactly that one; a complete record without a wired port stays disabled; an
invalid record (an extra key, a malformed owner-decision id, a non-text or over-long reference, a line break) enables nothing, even with a
wired port (case 2). Only a complete, valid record and a wired port together answer enabled, and only a test holds such a record (the
fixture's fake `OD-999`). CONFIRMED

**No environment variable can enable it (case 3).** The pure function reads only the environment it is given, and of it only the
operator switch `SIRKIT_ORDERING_DISABLED` (a proxy environment records exactly that one key read). Any non-blank value turns ordering
off, `0`, `false` and `no` included; no value turns it on; seven enabling-looking environments answer exactly the default. The production
default, `orderingEnablementFromProcess()` (C57), which both stores use when no enablement is injected, hands it that one switch read from
the PROCESS environment at each call: with `SIRKIT_ORDERING_ENABLED=1` and `SIRKIT_ORDER_SUBMISSION_PORT=wired` stubbed the answer does not
move, and with the switch stubbed even the fake complete record answers `operator_disabled`. `process.env` occurs once in the four
modules, as `process.env[ORDERING_OPERATOR_DISABLE_ENV]` in `ordering-enablement.ts`. [B23-C fix, 2026-10-04] Before the review round the
defaults read no environment, and case 3 pinned the switch, set in the process, as doing nothing on the production path (security-1;
section 8). CONFIRMED

**The action record (C44-C47, C51).** `manufacturing.provider-order` is appended on `action-registry.ts:186`, after B23-B1's
`manufacturing.provider-exchange`, as B22 appended on `:149`, so `:118` (`manufacturing.assembled-release`), `:159` (`bom.workbench`)
and `:182` (`cd.release-engineering.workbench`, "never orders or releases") keep their lines and records (case 4): kind `destructive`,
status `missing`, handler "explicitly blocked: feature-disabled until the owner supplies OD-171's prerequisites", `domainCommand` null,
`mutationAuthority` and `historyOrRevision` `none`, `toolExposure` `none`, approval tier `release`. Its tier is 3 and the agent decision
`never` for every role. It cites only the provider panel as its source (OD-186 (i)). The B01 toolability CSV moved once, by the generator:
one row appended at `:107`. CONFIRMED

**B17-A's missing-unreachable rule holds (case 5; `b17-a-control-inventory.test.ts:63`, C53).** No classified control, control rule,
route coverage row, route file or tool names the record. B19-E's purchase wording, its lifecycle exception and its route name check are
pinned verbatim and unchanged (C54). CONFIRMED

**The notice (C5, C48; case 6).** The provider panel renders, for a viewer who may act and one who may not, the fixed text:

> Ordering through Sirkit is turned off. The owner has not supplied a provider account, spending and quantity limits, a billing and shipping policy, authorized roles, cancellation and refund terms, legal and compliance requirements or a sandbox path, so nothing in Sirkit can order hardware or spend money.

It names the seven prerequisites in plain words and says why; B19-E's purchase phrases match none of it, nor the record's own text. The
literal sits in the panel's own copy, where B19-E's scan reads it, equal to `ORDERING_DISABLED_NOTICE` (the panel imports nothing from the
provider directory: `b23-a-provider-admission` case 8). It is written knowing that the registry already says "never orders or releases"
(`:182`) and that the BOM view says, in the present tense, that no order is placed. No control comes with it: the panel's controls are
still exactly B23-B1's three (the provider choice, preview, commit), and the control scan of the panel is unchanged. It is appended on the
panel's notice line (`:129`), so B23-B1's citations of the panel (`:122`, `:157`) hold. CONFIRMED

## 2. The seven prerequisites, none supplied

| prerequisite (`ORDERING_PREREQUISITES`) | the runbook's words (`:988-994`) | supplied in B23 |
|---|---|---|
| `account_reference` | a supported account | no (OD-160: no provider account) |
| `spend_and_quantity_limits` | spending and quantity limits | no |
| `billing_shipping_policy` | billing/shipping policy | no |
| `authorized_roles` | authorized human roles | no (OD-172: `project_admin` only until the owner names a role) |
| `cancellation_refund_behaviour` | cancellation/refund behavior | no |
| `legal_compliance` | legal/compliance requirements | no |
| `sandbox_path` | a staging/sandbox provider path | no (LB-12) |

No owner decision supplies any of them (discovery section 1.3; OD-8 authorizes no live purchase). Enabling needs an owner record (a new
OD naming each reference) AND a separately reviewed change that wires a provider port in a composition root; neither is in B23. RECORDED

## 3. The purchase authorization (D23-11, OD-172)

**The binding (C8-C11).** Closed keys, in the runbook's order: `providerId` and `operationId` (a registry provider's `ordering`-tier
operation; a read or quote operation is refused), `lines` (1 to 64, each `lineId`, `providerPartNumber`, a whole `quantity` from 1 to
1,000,000 and the `unitPriceDecimal` the person saw), `currency` (ISO 4217), `priceCeilingDecimal` (at or above the lines' total),
`shippingDestinationRef` (a reference: an address, with its spaces, is refused), `releaseDigest` (the release or BOM digest) and
`expiresAt` (a canonical instant at most 10 minutes ahead). Money is exact decimal text, as CD-12's `unitPriceDecimal`
(`release-engineering/types.ts:37`, C56): at most 12 integer and 6 fraction digits, one canonical spelling in a binding, and a JavaScript
number, an exponent, a sign or a trailing zero is refused. The arithmetic is exact (`addMoney("0.1", "0.2")` is `"0.3"`, where
`0.1 + 0.2` is not) and agrees with CD-12's `addDecimal`, `compareDecimal` and `multiplyDecimalByInteger` (case 3). The server validates and
holds its OWN copy, taken first: an accessor that answers a valid ceiling once and an invalid one after cannot split the two, and a
binding that is not plain data is refused (C15). CONFIRMED

**Arithmetic that never throws (case 9; C58).** Only what comes IN is bounded to 12 integer digits; the arithmetic reads its own results
with any number of integer digits, so a product or sum past 12 digits stays exact and is compared: a binding of 1,000,000 x
`"1000000"` is refused `PA_BINDING_INVALID` ("below the lines' total") even under the largest ceiling, and a binding that throws when
read is the problem `binding: unreadable`, never a throw. [B23-C fix, 2026-10-04] Before the review round such a total threw
`PA_MONEY_DECIMAL_INVALID` out of `purchaseBindingProblems` and, at the re-read, out of a submit whose authorization was already burned
(regressions-1; section 8). CONFIRMED

**Bounded, refusing when full (case 10; C14).** A project holds at most 32 requests and 64 authorizations, the server 2,048 and 4,096
(`PURCHASE_LIMITS`); a full store answers `PA_LIMIT_REACHED` and writes nothing (another project is unaffected, and the refused request is
not held: the server's limit would otherwise refuse the next); an entry is dropped only once its expiry plus the retention hour has
passed, not a millisecond before. CONFIRMED

**Two people, human only (C13, C16, C17).** A human `project_admin` requests; a DIFFERENT human `project_admin` confirms the exact request
digest (`PA_PROPOSER_CANNOT_APPROVE` otherwise, CD-12's `proposerCannotApprove`). That confirmation is the only place an authorization is
minted; the caller gets its id, digest and expiry, never the binding, which stays in server memory. Every other role, the model (`ai`),
automation and the migration actor are refused at request, confirm and consume, before anything is read, and a refusal writes nothing
(case 2). CONFIRMED

**Single use, any change refuses (C12, C18-C21).** `consume` presents the handle and the binding the submission is about to send. A
forged id or digest, or another project, answers `PA_NOT_FOUND` and writes nothing; a used, voided or expired one answers
`PA_ALREADY_USED`; an expired one is burned `expired`; a presented binding that differs in any field - the provider, the operation, any
line's id, part, quantity or price, a line added, removed or reordered, the currency, the ceiling, the destination, the release digest,
the expiry, or an extra key - answers `PA_BINDING_CHANGED` naming the field and burns it `void` (case 5). Every read is a snapshot and
every write a compare-and-set on the revision, so two racing consumers, or two racing approvers, both read it unused and only one gets
through (case 4; with the compare-and-set's condition removed, case 4 fails, section 8). While ordering is turned off, nothing is
requested, confirmed or consumed (`PA_ORDERING_DISABLED`); the store's default enablement is the production one (case 6). CONFIRMED

## 4. The order contract against a fake port

**Turned off first (C29).** With the production enablement the contract refuses `ORDER_DISABLED` before anything: no authorization is
consumed and the port is not called, whoever asks; the operator switch turns even the fake complete record off (case 1). CONFIRMED

**Burn, re-read, submit once (C26-C34).** A human project administrator's submit (every other actor refused with zero writes) burns the
authorization with the exact binding, then re-reads price and availability IMMEDIATELY before the one submission (the fake port sees the
authorization already consumed when it is asked). The re-read must answer the confirmed lines, in order, in the confirmed currency, with a
total that adds up exactly (lines plus the provider's charges); then any changed unit price, up or down, refuses (`ORDER_PRICE_CHANGED`),
stock short of a line or unknown refuses (`ORDER_AVAILABILITY_SHORT`), a total above the ceiling refuses (`ORDER_ABOVE_CEILING`), and
anything unreadable refuses (`ORDER_REQUOTE_MISMATCH`); a re-read that throws or never answers within its deadline is
`ORDER_REQUOTE_FAILED`. In each, nothing is submitted, the record ends `not_submitted`, the authorization is spent, and a repeat answers
the same refusal (case 3). A provider's longer spelling of the bound price (`0.01230` for `0.0123`) and a total exactly at the ceiling are
accepted (controls). The submission carries the re-read prices and total, the ceiling as `maxTotalDecimal`, the destination reference, the
release digest and ONE idempotency key per authorization, `so-` and 64 hex characters of a digest of the project and the authorization
(C25; case 2). The submission uses the server-held binding, never the presented one. CONFIRMED

**The re-read judged line by line, never thrown (case 8).** With the line count unchanged, a substituted part, a relabelled line or the
lines swapped each refuse (`ORDER_REQUOTE_MISMATCH`, failure `lines`); charges given as a JavaScript number or no total at all are
`unreadable`; a re-read whose total passes 12 integer digits is judged exactly (failure `total`, or `unreadable` when the provider spells
that total out); an answer that throws while it is read is `unreadable` (C59). Each ends `not_submitted` with nothing sent, and a new,
separately confirmed authorization for the same cart is then sent: the cart is never left in flight. Stock exactly at a line's quantity is
enough (control). [B23-C fix, 2026-10-04] Before the review round the overflow and the throwing answer threw out of `submit` after the
burn and left the record `prepared`, blocking its cart until a restart (regressions-1; section 8). CONFIRMED

**Checked again before the hand-over (case 13; C60).** Enablement is asked once more immediately before `submitted` is recorded: ordering
turned off during the re-read sends nothing, and the record ends `not_submitted` with `ORDER_DISABLED_BEFORE_SUBMISSION`, the
authorization spent. A re-read or a submission that misses its deadline finds its port signal aborted (case 12). CONFIRMED

**Never a second order (cases 4, 9 and 10).** A duplicate submit of one authorization answers its record (`idempotent: true`) and sends
nothing; two racing submits of one authorization reach the port once, the loser answering the winner's record (`ORDER_IN_FLIGHT`,
`idempotent: true`, the same order id); a submission that times out is `UNKNOWN_PENDING_RECONCILIATION`, its retry answers the record, and
a NEW authorization for the same cart is refused `ORDER_IN_FLIGHT` before its authorization is burned (it stays `issued`), while another
cart is not blocked (case 4). Two DIFFERENT authorizations for one cart submitted at once reach the port once: the first claims the cart
synchronously before its burn and releases the claim in the same turn that records the order, so the second is refused `ORDER_IN_FLIGHT`
[B23-C lead, 2026-10-04: now `ORDER_CART_BUSY`, below] while still `issued`, and is usable once the first order is resolved; the guard after the burn, unreachable while the claim holds, still
keeps a store that answers another cart's binding from the port (case 9; C61, C62). The cart is what is ordered - the provider operation
and each part's total quantity - so a new authorization with the lines reordered, relabelled or split is the same cart and is refused
before its burn, while another quantity is another cart (case 10; C63). [B23-C fix, 2026-10-04] Before the review round the second
racing authorization was burned before it was refused, and line ids and line order made a new cart (coverage-1, tests-1, security-2;
section 8). CONFIRMED

[B23-C lead, 2026-10-04] Since the independent check's two low findings: a cart that another authorization's submit has claimed, and that
holds no order yet, is refused `ORDER_CART_BUSY` (C61, C65): "Another submission of this cart is in progress and holds it until its own
authorization is checked. This request consumed, read and sent nothing; submit the authorization again in a moment." ([B23-C lead, 2026-10-05]: the message first said "this authorization is unspent", which a voided, expired or forged handle is not; the request reads none of it before this answer.) The second
racing authorization of case 9 now answers that, and so does a genuine authorization submitted while a forged, spent, expired or otherwise
bound one holds the claim, its retry then accepted (case 15); `ORDER_IN_FLIGHT` (C30) is kept for a cart with an unresolved order. The
cart is read from the canonical binding consume compares (`durableWorkflowJson`, NFC; C67), and the in-flight check compares the provider
id the same way (C68): a part or a provider id spelled with U+212A KELVIN SIGN for K, alone or on one of two lines that split a part, is
the same cart and is refused before its burn (case 14). Every submit of the claiming authorization holds the claim until its consume ends
(a count, C66), so a twin submit whose claimant fails first (a wrong digest) still keeps a new authorization for the cart out, unspent
(case 16). With both, the guard after the burn is unreachable for the real store, as C62's comment now says. Before, a differently
spelled cart and a twin's unclaimed consume each reached the guard after the burn (an authorization spent, then refused
`ORDER_IN_FLIGHT`), and a claim conflict was refused with the unresolved-order message although no order existed (section 8). CONFIRMED

**Ambiguity is never retried (C28; case 5).** Only an acceptance with a usable provider order id is `accepted` and only a definite refusal
is `rejected`. A throw, an abort, a server-error answer, an unreadable answer, an acceptance without a usable order id, an unknown outcome
or nothing at all is `UNKNOWN_PENDING_RECONCILIATION`, with the port called exactly once and never again; a person reconciles it with the
provider. A throw that arrives after the deadline is dropped and never left unhandled. CONFIRMED

**The record.** In memory, B23-B2's exchange record's pattern: `prepared -> submitted -> accepted | rejected |
UNKNOWN_PENDING_RECONCILIATION`, or `prepared -> not_submitted` (C22). No durable store, no outbox, no transport import (case 7).
RECORDED. Bounded per project (256) and overall (16,384): a full store answers `ORDER_LIMIT_REACHED` before anything is consumed, read
or sent, while another project still orders (case 11; [B23-C fix, 2026-10-04] untested before the review round, coverage-3). CONFIRMED

## 5. Webhook verification

No provider read in discovery section 1.2 documents a webhook signature (section 8 item 9), so the contract is Sirkit's own and offline,
to be re-checked against a provider's documents before any enablement. `verifyWebhook` (C40) accepts an event only when its body is raw
bytes of at most 64 KiB; its `webhook-id`, `webhook-timestamp` (seconds) and `webhook-signature` headers are each present once and well
formed; its timestamp is within five minutes either way (C41); its signature is `v1=` and the hex HMAC-SHA256, under a secret of at least
32 characters, of `<id>.<timestamp>.` and the raw body bytes, compared in constant time (C42); and its id is not in the replay store, which
then remembers it until the timestamp leaves the window (C43), through the window's last instant (case 4: a replay at exactly the
tolerance is still `replayed`; [B23-C fix, 2026-10-04] untested before the review round, tests-6). A re-serialised body, one changed
byte, another id, timestamp or secret is refused; the store is bounded and refuses when full rather than evicting a live entry, and a
forged or out-of-window delivery never takes a slot; no refusal carries the secret, the signature or the body
(`b23-c-webhook-verification`, 7 cases). Its one runtime import is `node:crypto`; it reads no clock, environment, file or network of its
own. CONFIRMED

In the order contract (C35, C36) a verified event `{ type: "order.status", providerOrderId, status }` (a closed status list) is recorded as
an observation on the order it names, of the provider whose secret signed it; a replay, a forged event, an event for an unknown order, an
`order.created` event and an unreadable body are refused or ignored. A webhook never creates, submits or changes an order: the order
count, its state and the port's submissions do not move (case 6). An order already holding `observationsPerOrder` observations (32)
answers a verified event `WEBHOOK_OBSERVATIONS_FULL` and records nothing more (case 11; C64); the event's id is then spent in the replay
store, so a redelivery answers `replayed`. [B23-C fix, 2026-10-04] Before the review round it answered `WEBHOOK_RECORDED` and recorded
nothing (coverage-2). CONFIRMED

## 6. Who can reach it

**The approved-importer gate (C14; `b23-c-purchase-authorization` cases 7 and 8).** The mint/consume module's exact approved-importer set
is two server modules: `purchase-authorization.ts` itself, which holds the human-only confirmation, and `order-contract.ts`, the one
module that imports it, which calls `consume` and never spells `request` or `confirm` at all - as a call, an element-access key, a
`Reflect.apply` argument or a destructured name ([B23-C fix, 2026-10-04] the gate saw only `x.confirm(...)` before the review round,
tests-5); no other production module names the store. The agent
loop, the gateway, the chat route, the orchestration runtime, the MCP route, its read runtime and dispatcher, and every module under
`app/lib/agent/`, `app/lib/mcp/`, `app/api/chat/` and `app/api/mcp/` reach none of the four ordering modules: D21-33's gap (the import
gates covered the MCP and orchestration closures, not the loop, the gateway or the chat closure) is closed for them. Each rule bites: a
gateway importing the module, a third importer (a type-only one included), an orchestration module reaching it through a helper, and an
order contract that confirms - by a call, `store["confirm"]`, `Reflect.apply(store.request, ...)`, a destructured `confirm` or a template
key - are caught (case 8). CONFIRMED

**No composition root wires the port (C24; `b23-c-order-contract` case 7).** `order-contract.ts` has no production importer at all (type
imports and dynamic imports included), no production module names `OrderContract` or `OrderSubmissionPort`, `ORDER_SUBMISSION_PORT_WIRING`
is `"none"` and `ORDERING_OWNER_RECORD` is null; the module imports exactly `durable-workflow/stable`, `ordering-enablement`,
`purchase-authorization` and `webhook-verification`, and names no fetch, egress, provider-egress module, outbox or socket. A route, a root
`instrumentation.ts` dynamic import and a module naming the port type are each caught. B23-A2's structural no-order check reads every name
in each route's closure; no route reaches these modules, so it is unchanged and green. CONFIRMED

## 7. Live: BLOCKED-LIVE-QUALIFICATION (LB-12)

Ordering through any provider is BLOCKED-LIVE-QUALIFICATION (LB-12): it unblocks only with OD-171's owner record (the seven
prerequisites, a sandbox path among them) and a separately reviewed change that wires a provider port, a confirmation surface and a
submission surface, each its own review (B23-C's stop conditions). No route, UI control, provider client or composition-root wiring for
submission exists. Section 1.2's provider facts stay RECORDED (2026-10-01) and were not re-read; no provider was contacted, no account
created and no credential entered. RECORDED

## 8. Test-first record

- **Red first** (`bc-01-red.log`, the four suites with no production edit on `8bca09e`): 4 files failed to load
  (`Cannot find module '../ordering-enablement'`, `'../webhook-verification'`); exit 1. The pre-edit counterexamples, by `git grep` at
  `8bca09e` (`bc-01-counterexamples.txt`): no `manufacturing.provider-order` record, no ordering notice in the panel, no production module
  naming an ordering enablement, purchase authorization or webhook verifier (the one production file naming a webhook is the provider
  registry's UNKNOWN webhook facts). CONFIRMED
- **First code** (`bc-03-first-code.log`): 28 / 29; the one red case was the page check (this page did not exist yet). CONFIRMED
- **Hardening before the gates**: the request validates and holds the server's own copy (an accessor probe added to case 3); a late throw
  after a deadline is dropped (case 5 probe); a webhook names an order of its own provider only (case 6 probe); `bc-06-suites.log` 28 / 29
  (the page). CONFIRMED
- **The suites bite** (`bc-07-mut-*.log`, `bc-07-mutations-{a,b,c}.txt`): twenty source mutations, each applied by exact text, its suite
  run through the lock, the file restored and checked by SHA-256. Each was caught:

| mutation | caught by |
|---|---|
| the operator switch ignored; an environment variable that enables | ordering-disabled case 3 |
| `UNKNOWN` supplies a prerequisite; a complete record enabled without a wired port | ordering-disabled case 2 |
| the notice reworded with "place an order" | ordering-disabled case 6 |
| the requester may confirm; an `ai` actor admitted | purchase-authorization case 2 |
| the authorization's compare-and-set condition removed; the request's | purchase-authorization case 4 |
| the presented binding not compared | purchase-authorization case 5 |
| money added as JavaScript numbers; the expiry left unbounded | purchase-authorization case 3 |
| a cheaper price accepted; the ceiling widened by 1 | order-contract case 3 |
| an UNKNOWN submission retried once | order-contract cases 4 and 5 |
| the unresolved-cart refusal removed | order-contract case 4 |
| the re-read refusals collapsed into one code | order-contract case 3 |
| the replay store skipped | webhook cases 4 and 5 |
| the timestamp window skipped | webhook cases 3, 4 and 5 |
| the body left out of the signature | webhook cases 1 and 2 |

The first compare-and-set mutation survived on the first tree: a load returned the live entry, so a racing consumer saw `consumed`
before reaching the compare-and-set and the race never exercised it. A load now returns a snapshot, as a durable read would, and the
mutation is caught (`bc-07-mutations-c.txt`). CONFIRMED

**The adversarial review round [B23-C fix, 2026-10-04].** An adversarial review of this working tree CONFIRMED fourteen findings
(regressions-1, security-1, security-2, coverage-1..3, tests-1..9; two pairs name one gap). Each was closed test-first, on the reviewed
sources unchanged by hash (`fixC-red-source-hashes.txt`):

- **Red** (`cf-01-red.log`): the strengthened suites on the reviewed sources, 3 files failed, 9 of 38 cases, exit 1, each on its defect.
  CONFIRMED
- **Green** (`cf-02`, `cf-03`, `cf-05`): the four suites 38 / 38 after the fixes (section 10). CONFIRMED
- **The strengthened cases bite** (`cf-04-mutations.txt`, `cf-04-mut-*.log`): nineteen source mutations on the fixed tree, each applied by
  exact text, the ONE case that must catch it run through the lock (`-t`), the file restored and checked by SHA-256
  (`cf-green-source-hashes.txt`). Each was caught. CONFIRMED

| finding | the test | on the reviewed tree, or under mutation | the fix |
|---|---|---|---|
| regressions-1: a re-read total past 12 integer digits threw out of `submit` after the burn, leaving the cart blocked; `purchaseBindingProblems` threw | order-contract case 8; purchase-authorization case 9 | red: `PA_MONEY_DECIMAL_INVALID` thrown from both; f19 (the re-read judgement unwrapped) and f23 (the binding check unwrapped) caught | the arithmetic reads its own results unbounded (C58); a judgement that throws falls back to `unreadable` / UNKNOWN (C59); `binding: unreadable` |
| security-1: the off switch did nothing in the production defaults (case 3 pinned it so) | ordering-disabled case 3 (pin moved in place); order-contract case 13 | red: no process-reading default; a submission went out after ordering was turned off mid-re-read; f21 (the process switch ignored) caught | `orderingEnablementFromProcess()`, the stores' default (C57); a second enablement check before the hand-over (C60) |
| security-2: relabelled or reordered lines made a new cart | order-contract case 10 | red: the reordered cart was sent | the cart is each part's total quantity (C63) |
| coverage-1 and tests-1: a racing second authorization for one cart was burned before it was refused; the guard after the burn was untested | order-contract case 9 | red: the second answer carried a `not_submitted` record, its authorization consumed; f14 (no claim) and f15 (no guard) caught; f16 (neither): two orders for one cart | the cart is claimed before the burn (C61); the guard after the burn kept and tested (C62) |
| coverage-2: a full order answered `WEBHOOK_RECORDED` and recorded nothing | order-contract case 11 | red: `{ ok: true, code: "WEBHOOK_RECORDED" }` | `WEBHOOK_OBSERVATIONS_FULL` (C64) |
| coverage-3 and tests-3: the stores' bounds and the sweep were untested | purchase-authorization case 10; order-contract case 11 | f02-f05 (room always, off by one, sweep skipped, sweep a millisecond late) and f06-f07 caught | none: the bounds were right |
| tests-2: a re-read's line ids and parts were never compared at an unchanged count | order-contract case 8 | f01 (the id and part comparison dropped) caught | none |
| tests-4: the deadline's abort was never asserted | order-contract case 12 | f08 (no abort) caught | none |
| tests-5: the mint-name gate saw only `x.confirm(...)` | purchase-authorization cases 7 and 8 | f09 (`this.authorizations["confirm"](...)`) caught | none (the gate) |
| tests-6: the replay store's last-instant margin was untested | webhook case 4 | f10 (`at + tolerance`) caught | none |
| tests-7: the race loser was not pinned | order-contract case 4 (in place) | f11 (the loser answering `ORDER_AUTHORIZATION_REFUSED`) caught | none |
| tests-8: unreadable charges or total, and stock exactly at the quantity, were untested | order-contract case 8 | f12 (charges defaulted) and f13 (`<=` for `<`) caught | none |
| tests-9: the fixture's nonces repeated ("c1" and "c10") | purchase-authorization case 11 | red: 3,841 distinct values of 4,096 | the fixture's counter is left-padded |

**The independent check's two low findings [B23-C lead, 2026-10-04].** An independent check of the review round's fixes reported two low
findings. Each was closed test-first on the review round's sources, unchanged by hash (`lf/red-source-hashes.txt` in the b23 scratchpad,
equal to the hashes taken before any edit):

- **Red** (`lf-02-red.log`): `b23-c-order-contract`, 5 of 16 cases failed, exit 1, each on its defect: case 14 (all five spellings
  spent, then refused), case 15 (all four holders: the unresolved-order message), case 16 (the twin spent, then refused), and the two pins
  of cases 5 and 9. `lf-01-red.log` was the same run with two new cases' fixture nonces not hexadecimal ("k", "g"), so cases 14 and 16
  stopped at `approve` with `PA_NONCE_INVALID`; that was a slip in the tests, fixed ("b", "f") before the recorded red. CONFIRMED
- **Green** (`lf-03-green.log`): `b23-c-order-contract` and `b23-c-purchase-authorization`, 27 / 27, exit 0. CONFIRMED
- **Each fix is needed by its case** (`lf/mutations.txt`, `lf-04-mut-m1..m4.log`): four mutations of the fixed sources, each applied by
  exact text, only its case run through the lock (`-t`), the file restored and checked by SHA-256 (`lf/green-source-hashes.txt`). Each was
  caught. CONFIRMED

| finding | the test | on the reviewed tree, or under mutation | the fix |
|---|---|---|---|
| low-1: `cartDigestOf` grouped and sorted parts by their raw strings, while consume compares the bindings after NFC, so an equivalent spelling passed the pre-burn check and the claim, and C62's comment called the guard after the burn unreachable | order-contract case 14: a part spelled with U+212A KELVIN SIGN (written `String.fromCharCode(0x212a)`), one part split across two lines with one of them so spelled, and, with a test-only provider whose id holds a K, that id so spelled | red: all five answered `ORDER_IN_FLIGHT` with a `not_submitted` record and the authorization `consumed`; m1 (the raw binding read again) caught on the four part spellings, m2 (the provider id compared raw) on the provider spelling | the cart is read from `JSON.parse(durableWorkflowJson(binding))` (C67); the in-flight check compares provider ids after NFC on both sides (C68); C62's comment corrected in place |
| low-2: a claim conflict answered `ORDER_IN_FLIGHT`, whose message says an order of the cart is unresolved, while a forged, spent, expired or otherwise bound authorization held the claim and no order existed | order-contract case 15 (the four holders); case 9 and case 5 (pins moved) | red: in all four the genuine authorization answered `ORDER_IN_FLIGHT` with the unresolved-order message (still `issued`; its retry accepted); m3 (the conflict answered `ORDER_IN_FLIGHT` again) caught by cases 9 and 15 | the closed code `ORDER_CART_BUSY` with a true message (C65); `ORDER_IN_FLIGHT` stays the unresolved cart's (C30) |
| found while correcting C62's comment: a twin submit of the claiming authorization did not hold the claim, so when the claimant failed first (a wrong digest) a new authorization for the cart took the claim; both were spent, and the twin was refused by the guard after the burn | order-contract case 16 (the real store answering late, as a durable store's round trip would) | red: the twin `ORDER_IN_FLIGHT` / `not_submitted` with its authorization consumed, while the new authorization was submitted (`UNKNOWN_PENDING_RECONCILIATION`); m4 (only the first submit holds the claim) caught | every submit of the claiming authorization holds the claim, counted, until its consume ends (C66) |

For low-2 the closed code was chosen over validating the handle before the claim: any holder makes the code true (the cart IS held by
another submission), while a validation would add a second store read before the claim (a round trip for a durable store) and still
leave a window in which a holder that later fails keeps the cart. RECORDED

## 9. Every pin moved, and why

| pin | moved how | why |
|---|---|---|
| `b23-a-tier3-vocabulary.test.ts:272` (case 5's census, C52) | `105` -> `106`, in place, dated `[B23-C, 2026-10-04]` note on the line | OD-170's record; its id matches no new stem (its `order` was already a family stem) |
| `artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv` | one row appended at `:107`, by `scripts/generate-action-toolability-matrix.ts` | the record (OD-170: the CSV moves once, by review) |

No other pin moved. `action-registry.ts` changed only on `:186` (the record appended, with an `[B23-C] appended in place` comment), and
the provider panel only on `:129` (the notice appended), so every line the B16-B23 pages cite in either file holds its content
(`b23-b-page` case 3 green). No generated artifact other than that one CSV row changed (21 generators, section 10). CONFIRMED

The review round [B23-C fix, 2026-10-04] moved only pins of C's own, uncommitted suites, each in place with a dated note on it, and no file
outside the four modules, the four suites, their fixture and this page:

| pin | moved how | why |
|---|---|---|
| `b23-c-ordering-disabled` case 3 | the switch, set in the process, now turns the production default off (it was pinned as doing nothing); `process.env` occurs once, in `ordering-enablement.ts`; both stores default to `orderingEnablementFromProcess()` | security-1 |
| `b23-c-order-contract` case 4 | the race loser pinned exactly: `ORDER_IN_FLIGHT`, idempotent, the winner's order id (it accepted any of three codes) | tests-7 |
| `b23-c-order-contract` case 5 | the code list gains `ORDER_DISABLED_BEFORE_SUBMISSION` | security-1 |
| `b23-c-purchase-authorization` case 7 | a mint name is refused however it is spelled, not only as a call | tests-5 |
| `b23-c-webhook-verification` case 4 | a replay at the window's last instant is `replayed` | tests-6 |
| the fixture's `testNonces` | the counter left-padded | tests-9 |

The cases appended (order-contract 8-13, purchase-authorization 9-11) changed no earlier case beyond the pins above; the order-contract
harness gained an optional `limits` and a scope for `approve`, defaulting to what every earlier case used. No page cites these suites by
line. CONFIRMED

[B23-C lead, 2026-10-04] The two low fixes moved two pins of C's own suite, each in place with a dated note on it, and changed no file
other than `order-contract.ts`, `purchase-authorization.ts`, `b23-c-order-contract.test.ts` and this page:

| pin | moved how | why |
|---|---|---|
| `b23-c-order-contract` case 5 | the code list gains `ORDER_CART_BUSY` | low-2 |
| `b23-c-order-contract` case 9 | the second racing authorization answers `ORDER_CART_BUSY` (pinned `ORDER_IN_FLIGHT` before); its title says so | low-2 |

Cases 14-16 are appended, and the suite gained two import lines (`durableWorkflowJson`, `PROVIDER_ROWS`) and `cartDigestOf` in an
existing one. Both modules keep their line counts (398 and 348) and every cited line its number: the edits are in place, with
`ORDER_CART_BUSY` appended on `order-contract.ts:47` and two statements on `purchase-authorization.ts:203` and `order-contract.ts:250`
and `:256`; the two claim comments became one line (`:245`), so the unresolved-cart check moved from `:247` to `:246` (C30) and `:247`
holds the claim conflict (C61). CONFIRMED

## 10. Gates

Every run went through the shared lock, one at a time; every CLI process was stopped after it (leftover count 0 each time). No run printed
`Timeout calling "onTaskUpdate"`.

| gate | result |
|---|---|
| every suite that reads a file C changed, before any edit (`bc-00`): `app/lib/engineering/__tests__`, `app/lib/manufacturing-providers/__tests__`, the action-registry readers in `app/api`, `app/lib/atomic`, `app/lib/auth`, `app/lib/computation`, `app/lib/mcp`, `app/lib/project`, `recovery-pipeline`, both closeout suites | 136 files; 1636 / 1636; exit 0 |
| the four new suites, red (`bc-01`) | 4 files failed to load; exit 1 |
| `app/lib/manufacturing-providers/__tests__` + `app/lib/acquisition/__tests__` (`bc-10`) | 40 files (37 passed, 2 failed, 1 skipped); 550 passed, 2 failed, 2 skipped; exit 1: the page case (no page yet) and `b23-a-provider-admission` case 8 - the record's first sources named the four modules' paths, so `action-registry.ts` named the provider directory; the record now cites the panel only (OD-186 (i)) |
| `app/lib/engineering/__tests__` (B17-A, the B19-E tripwire, B18-A tiers, the B01 byte gate) + `b23-a-provider-admission` (`bc-12`) | 100 files; 1118 / 1118; exit 0 |
| `app/lib/agent/__tests__` (B11.5 case 12, the B18-C sweep) + `app/lib/agent/orchestration/__tests__` (`bc-13`) | 85 files; 875 / 875; exit 0 |
| `app/lib/mcp` (counts 47 / 36 / 9 / 27, `b20-b4-process-gate`) + `app/lib/auth/__tests__` (`bc-14`) | 86 files; 1304 passed, 9 skipped; exit 0 |
| `app/api/__tests__` (census 166 / 163 / 3 / 0) + `app/api/chat/__tests__` + `app/api/components/__tests__` + the remaining action-registry readers (`bc-15`) | 57 files; 1351 / 1351; exit 0 |
| `app/lib/computation/__tests__` (the B22 process census, `b22-closeout-statements`) + `b14-4-ast-import-gates`, `b18-b-import-gates`, `b14-5-lexical-require-and-diagnostics` (`bc-16`) | 31 files (29 passed, 2 skipped); 348 passed, 18 skipped; exit 0 |
| every generator (21; `bc-21`) | each exit 0; no drift beyond the one CSV row (B09 agent artifacts 36 / 47; B17-A inventory 631 controls, 63 surfaces, unchanged) |
| eslint on the 12 changed or added `.ts` and `.tsx` files (`bc-22`) | exit 0, no output |
| the page suites over this page: `b23-c-ordering-disabled`, `b21-closeout-statements`, `b22-closeout-statements`, `b21-f-page`, `b21-e1-page`, `b23-b-page`, `b23-b-dfm-quote-flow-page` (`bc-30`) | 7 files; 71 / 71; exit 0 |
| `app/lib/manufacturing-providers/__tests__` + `app/lib/acquisition/__tests__` again, with this page (`bc-31`) | 40 files (39 passed, 1 skipped); 552 passed, 2 skipped; exit 0 |
| the `bc-00` reader set again, after every edit (`bc-32`) | 140 files; 1665 / 1665; exit 0 (before: 136 files, 1636; the difference is the four new suites and their 29 cases) |
| tsc (`--noEmit -p tsconfig.json`, `bc-04`, `bc-23`) | exit 2: one error, `b23-b-approval-plan.test.ts(512,6)` TS2554 "Expected 1-3 arguments, but got 4" - NOT C's: `a02c9fb` added `{ timeout: 60_000 }` to case 18's `it(` line while its closing `}, 60_000);` stayed (CONFIRMED by `git show a02c9fb`; the file is unchanged by C); no error in any file C touched |

The review round [B23-C fix, 2026-10-04], every run through the same lock, one at a time, leftover count 0 each time, no
`Timeout calling "onTaskUpdate"`:

| gate | result |
|---|---|
| the four suites and the six page suites, before any edit (`cf-00`) | 10 files; 93 / 93; exit 0 |
| the four strengthened suites on the reviewed sources (`cf-01`) | 4 files (3 failed, 1 passed); 38 cases (9 failed, 29 passed); exit 1 - each failure the defect named in section 8 |
| the four suites after the fixes (`cf-02`, then `cf-03`) | `cf-02`: 36 / 38, exit 1 - this page's citations (not yet moved) and a case-10 fixture slip (the fake re-read's total did not follow a changed quantity, so the control answered `ORDER_REQUOTE_MISMATCH`; the fake now totals the lines it is asked for); `cf-03`: order-contract 13 / 13, exit 0 |
| nineteen source mutations, each on its one case (`cf-04`) | 19 caught; each source restored, SHA-256 equal to `cf-green-source-hashes.txt` |
| the four suites and the six page suites, after (`cf-05`; final `cf-30`) | 10 files; 102 / 102; exit 0 (both) |
| `app/lib/manufacturing-providers/__tests__` + `app/lib/acquisition/__tests__` (`cf-10`; final `cf-31`) | 40 files (39 passed, 1 skipped); 561 passed, 2 skipped; exit 0 (both) |
| `app/lib/engineering/__tests__` + `b23-a-provider-admission` (`cf-11`) | 100 files; 1118 / 1118; exit 0 |
| `app/lib/agent/__tests__` + `app/lib/agent/orchestration/__tests__` (`cf-12`) | 85 files; 875 / 875; exit 0 |
| `app/lib/mcp` (counts 47 / 36 / 9 / 27) + `app/lib/auth/__tests__` (`cf-13`) | 86 files; 1304 passed, 9 skipped; exit 0 |
| `app/api/__tests__` (census 166 / 163 / 3 / 0) (`cf-14`) | 27 files; 1059 / 1059; exit 0 |
| `app/lib/computation/__tests__` + `b14-4-ast-import-gates`, `b18-b-import-gates`, `b14-5-lexical-require-and-diagnostics` (`cf-15`) | 31 files (29 passed, 2 skipped); 348 passed, 18 skipped; exit 0 |
| tsc (`cf-20`, `cf-21`) | `cf-20`: exit 2, nine errors - eight in this round's tests (the `limits` option typed by the frozen defaults' literal types, so `2` was not a `256`; a doubled `scope` in the order-contract harness), and `a02c9fb`'s; both fixed (the option is `Partial<Record<..., number>>`, type-only, one line each; the harness passes the approval's scope); `cf-21`: exit 2, the one `a02c9fb` error only |
| eslint on the twelve B23-C `.ts` and `.tsx` files (`cf-22`) | exit 0, no output |
| every generator (21; `cf-23`) | each exit 0; no drift (status, diff and untracked hashes equal before and after) |

The mutations ran on sources that differ from the final ones only by the two type-only `limits` lines; the final suites and page suites
(`cf-30`, `cf-31`) ran on the final tree.

[B23-C lead, 2026-10-04] The two low fixes, on `d5f5512` with this working tree, every run through the same lock, one at a time,
leftover count 0 each time:

| gate | result |
|---|---|
| the four suites and the six page suites, before any edit (`lf-00`) | 10 files; 102 / 102; exit 0 |
| the strengthened order-contract suite on the review round's sources (`lf-01`, `lf-02`) | `lf-01`: 5 of 16 failed, cases 14 and 16 on the tests' own non-hexadecimal nonces; `lf-02` (nonces fixed): 5 of 16 failed (cases 5, 9, 14, 15, 16), each on its defect; exit 1 (both) |
| order-contract and purchase-authorization after the fixes (`lf-03`) | 2 files; 27 / 27; exit 0 |
| four mutations, each on its case (`lf-04`) | 4 caught; each source restored, SHA-256 equal to `lf/green-source-hashes.txt` |
| the four suites and the six page suites, after (`lf-05`; final `lf-30`) | 10 files; 105 / 105; exit 0 (both) |
| `app/lib/manufacturing-providers/__tests__` (`lf-10`) | 25 files; 351 / 351; exit 0 |
| `app/lib/engineering/__tests__` (`lf-11`) | 99 files; 1107 / 1107; exit 0 |
| `app/lib/agent/__tests__` + `app/lib/agent/orchestration/__tests__` (`lf-12`) | 85 files; 875 / 875; exit 0 |
| `app/lib/mcp` (`lf-13`) | 45 files; 825 / 825; exit 0 |
| `b14-4-ast-import-gates`, alone (`lf-14`) | 1 file; 22 / 22; exit 0 |
| tsc (`--noEmit -p tsconfig.json`, `lf-20`) | exit 0, no output: `a02c9fb`'s error is gone at `d5f5512` |
| eslint on the three changed `.ts` files (`lf-21`) | exit 0, no output |
| every generator (21; `lf-22`) | each exit 0; no drift (status, diff and untracked hashes equal before and after); no generator reads either module |

## 11. OD-186 - B23-C's choices beyond its task text

(a) The exact approved-importer set is the B18-B form (`b18-b-import-gates`: an authority module and the one composition module that
imports it): `purchase-authorization.ts`, which holds the human-only confirmation, and `order-contract.ts`, its only importer, which only
consumes. A confirmation route is a later, separately reviewed change that adds itself to the set. (b) The owner record is an
owner-decision id and one reference text per prerequisite; blank or `UNKNOWN` supplies nothing; an invalid record enables nothing and is
the one reason given. Its limits and roles are applied by the reviewed change that enables ordering. (c) The operator switch
`SIRKIT_ORDERING_DISABLED`: any non-blank value turns ordering off, `0` and `false` included; the function reads only the environment it is
given [B23-C fix, 2026-10-04: and the stores' production default, `orderingEnablementFromProcess()`, gives it that one switch read from
the process at each call - the only process variable any ordering module reads]. (d) Money: decimal text of at most 12 integer and 6
fraction digits, one canonical spelling in a binding, exact integer arithmetic; a provider's re-read is canonicalised before it is
compared [B23-C fix, 2026-10-04: only what comes in is bounded; the arithmetic reads its own results unbounded, so a sum past 12 digits is
compared, never thrown]. (e) A binding carries each line's unit price as the person saw it; "a change"
at the re-read is any differing unit price, up or down; the ceiling covers the lines and the provider's charges, and the provider's total
must add up exactly. (f) Any human project administrator of the project may consume an authorization (the order contract's caller); the
submission uses the held binding. (g) The order contract burns the authorization before the re-read, so a refused re-read spends it and
two people confirm again at the new price; a new authorization for an unresolved cart is refused before it is burned [B23-C fix,
2026-10-04: also when it races: a submit claims its cart synchronously before the burn and releases it in the turn that records the
order, so a second authorization for that cart is refused still unspent] [B23-C lead, 2026-10-04: also when it is presented with an
equivalent spelling, since the cart is read from the canonical (NFC) binding consume compares, and when a twin submit of the claiming
authorization outlives a failing claimant, since every submit of it holds the claim; a cart that is claimed but holds no order yet is
refused `ORDER_CART_BUSY` (p)]. (h) One order in flight per cart [B23-C fix, 2026-10-04: the
cart is the provider, the operation and each part's total quantity; line ids and line order are labels and no longer count (they did:
"provider, operation, line ids, parts and quantities")]; an accepted order does not block a new, separately confirmed one.
(i) `manufacturing.provider-order` carries no `sideEffects`: it is Tier 3 by approval tier `release` and by its id's `order` stem, and the
side effect would move B23-B1's pin that the provider exchange alone carries it; its sources cite only the provider panel, because naming
the provider directory from `action-registry.ts` would fail `b23-a-provider-admission` case 8. (j) The webhook contract is Sirkit's own:
`webhook-id`, `webhook-timestamp`, `webhook-signature` headers, `v1=` hex HMAC-SHA256 over `<id>.<timestamp>.<raw body>`, a five-minute
window, a 4096-entry replay store that refuses when full, a secret of at least 32 characters, one provider per configured secret; a
verified event is an observation only. (k) Requests, authorizations, orders and the replay store live in memory: a restart forgets them,
and a forgotten authorization cannot be consumed; durable storage is the enabling increment's. (l) Deadlines: the re-read 15 s, the
submission 30 s; a timed-out re-read ends `not_submitted`, a timed-out submission `UNKNOWN_PENDING_RECONCILIATION`. Added by the review
round [B23-C fix, 2026-10-04]: (m) enablement is checked again immediately before the hand-over; turned off after the burn, nothing is
sent and the record ends `not_submitted` with `ORDER_DISABLED_BEFORE_SUBMISSION`, the authorization spent. (n) A judgement of an
untrusted answer that throws while it is read is a refusal, never a throw: a re-read is `ORDER_REQUOTE_MISMATCH` (`unreadable`), a
submission's answer `UNKNOWN_PENDING_RECONCILIATION` (`unreadable`); `purchaseBindingProblems` answers `binding: unreadable`. (o) An order
holding 32 observations answers a verified event `WEBHOOK_OBSERVATIONS_FULL` and records nothing more; the event's id is spent, so its
redelivery is `replayed`. Added by the independent check's low fixes [B23-C lead, 2026-10-04]: (p) a cart that another authorization's
submit has claimed for its consume, and that holds no order yet, is refused `ORDER_CART_BUSY` ("submit it again in a moment"; this
authorization unspent [B23-C lead, 2026-10-05: the request spends nothing, but it reads no handle first, so the message no longer
claims the authorization is unspent]), never `ORDER_IN_FLIGHT`, which names an unresolved order; chosen over validating the handle before the claim
(section 8). RECORDED

## 12. What stays open

- **Live ordering: BLOCKED-LIVE-QUALIFICATION (LB-12)**, section 7. RECORDED
- **The seven prerequisites**: none supplied; no new role exists (`project_admin` only, OD-172). RECORDED
- **Reconciliation** of an `UNKNOWN_PENDING_RECONCILIATION` order is a person's, with the provider; no status read is built, so an
  unresolved cart stays blocked until a reviewed reconciliation exists. RECORDED
- **Durability**: in memory only (OD-186 (k)); several server instances would each hold their own authorizations and orders. INFERRED
- **The webhook contract** is checked against no provider's documents (none documents one); a provider's own scheme is the enabling
  increment's review. RECORDED
- **tsc** is red on `8bca09e` already, from `a02c9fb` (section 10); the review round left it so (it is not C's file). RECORDED
  [B23-C lead, 2026-10-04: the lead's `d5f5512` restored that case; tsc on this working tree is exit 0 with no output (`lf-20`).
  CONFIRMED]
- **The browser suite was not run**: the provider panel gained one line of copy (no control; the B17-A suite and its generator are green
  and unchanged). The review round changed no UI file. RECORDED
- **The operator switch takes effect per call, not per process start**: the production default reads `SIRKIT_ORDERING_DISABLED` at each
  call, and enablement is asked again before the hand-over (OD-186 (c), (m)); how an operator sets it on a running server is the deployment's
  concern. INFERRED

## 13. Citations

As of this working tree on `8bca09e` (2026-10-04); the anchor text is the check, the line is for the reader; `b23-c-ordering-disabled`
case 7 checks every row. [B23-C lead, 2026-10-04] Re-checked on this working tree on `d5f5512` (since `8bca09e` only
`b23-b-approval-plan.test.ts` changed, which no row cites): C30 moved from `:247` to `:246`, C30 and C61 re-anchored in place, and C65-C68
added for the low fixes.

| # | file | line | anchor |
|---|---|---|---|
| C1 | `app/lib/manufacturing-providers/ordering-enablement.ts` | 14 | `export const ORDERING_PREREQUISITES = Object.freeze(` |
| C2 | `app/lib/manufacturing-providers/ordering-enablement.ts` | 36 | `export const ORDERING_OWNER_RECORD: OrderingOwnerRecord \| null = null;` |
| C3 | `app/lib/manufacturing-providers/ordering-enablement.ts` | 39 | `export const ORDER_SUBMISSION_PORT_WIRING: OrderSubmissionPortWiring = "none";` |
| C4 | `app/lib/manufacturing-providers/ordering-enablement.ts` | 41 | `export const ORDERING_OPERATOR_DISABLE_ENV = "SIRKIT_ORDERING_DISABLED";` |
| C5 | `app/lib/manufacturing-providers/ordering-enablement.ts` | 43 | `export const ORDERING_DISABLED_NOTICE = "Ordering through Sirkit is turned off.` |
| C6 | `app/lib/manufacturing-providers/ordering-enablement.ts` | 93 | `export function orderingEnablement(input:` |
| C7 | `app/lib/manufacturing-providers/ordering-enablement.ts` | 105 | `if (typeof switched === "string" && switched.trim() !== "") reasons.push("operator_disabled");` |
| C8 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 31 | `export const PURCHASE_AUTHORIZATION_MAX_TTL_MS = 10 * 60_000;` |
| C9 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 33 | `export const PURCHASE_BINDING_FIELDS = Object.freeze(` |
| C10 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 82 | `const MONEY_SCALE = 6;` |
| C11 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 143 | `export function purchaseBindingProblems(value: unknown, now: number` |
| C12 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 182 | `function bindingDifferences(held: PurchaseBinding, presented: unknown): string[] {` |
| C13 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 218 | `const isHumanAdmin = (actor: unknown): actor is PurchaseActor => isRecord(actor) && actor.actorKind === "human" && actor.role === "project_admin"` |
| C14 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 254 | `export class PurchaseAuthorizationStore {` |
| C15 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 282 | `binding = structuredClone(input.binding);` |
| C16 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 305 | `async confirm(input:` |
| C17 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 317 | `if (approver.actorId === held.request.requestedBy) return refused("PA_PROPOSER_CANNOT_APPROVE");` |
| C18 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 335 | `async consume(input:` |
| C19 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 347 | `const fields = bindingDifferences(held.record.binding, input.binding);` |
| C20 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 376 | `return held ? { held: { ...held }, revision: held.revision } : null;` |
| C21 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 380 | `if (!held \|\| held.revision !== expected \|\| held.state !== "issued") return false;` |
| C22 | `app/lib/manufacturing-providers/order-contract.ts` | 26 | `export const ORDER_STATES = Object.freeze(` |
| C23 | `app/lib/manufacturing-providers/order-contract.ts` | 29 | `export const ORDER_DEADLINES_MS = Object.freeze({ requoteMs: 15_000, submitMs: 30_000 });` |
| C24 | `app/lib/manufacturing-providers/order-contract.ts` | 65 | `export interface OrderSubmissionPort {` |
| C25 | `app/lib/manufacturing-providers/order-contract.ts` | 112 | `export function orderIdempotencyKeyOf(scope: PurchaseScope, authorizationId: string): string {` |
| C26 | `app/lib/manufacturing-providers/order-contract.ts` | 147 | `async function withinDeadline(` |
| C27 | `app/lib/manufacturing-providers/order-contract.ts` | 170 | `function judgeRequote(binding: PurchaseBinding, answer: unknown)` |
| C28 | `app/lib/manufacturing-providers/order-contract.ts` | 200 | `function judgeSubmission(answer: unknown)` |
| C29 | `app/lib/manufacturing-providers/order-contract.ts` | 234 | `if (!this.enablement().enabled) return this.answer("ORDER_DISABLED", null, false);` |
| C30 | `app/lib/manufacturing-providers/order-contract.ts` | 246 | `if (cartDigest !== null && this.unresolvedCart(scope, cartDigest, presented)) return this.answer("ORDER_IN_FLIGHT", null, false);` |
| C31 | `app/lib/manufacturing-providers/order-contract.ts` | 253 | `consumed = await this.authorizations.consume(` |
| C32 | `app/lib/manufacturing-providers/order-contract.ts` | 274 | `const reread = await withinDeadline((signal) => this.port.requote(` |
| C33 | `app/lib/manufacturing-providers/order-contract.ts` | 282 | `state: "submitted", submittedAt:` |
| C34 | `app/lib/manufacturing-providers/order-contract.ts` | 284 | `const sent = await withinDeadline((signal) => this.port.submit(submission, signal), this.deadlines.submitMs);` |
| C35 | `app/lib/manufacturing-providers/order-contract.ts` | 293 | `receiveWebhook(input: { readonly rawBody: Uint8Array; readonly headers: WebhookHeaders }): OrderWebhookAnswer {` |
| C36 | `app/lib/manufacturing-providers/order-contract.ts` | 306 | `entry.record.providerId === providerId && entry.record.providerOrderId === providerOrderId` |
| C37 | `app/lib/manufacturing-providers/webhook-verification.ts` | 19 | `export const WEBHOOK_LIMITS = Object.freeze({ maxBodyBytes: 64 * 1024, toleranceMs: 5 * 60_000, minSecretLength: 32, replayCapacity: 4096 });` |
| C38 | `app/lib/manufacturing-providers/webhook-verification.ts` | 33 | `export function signWebhook(input:` |
| C39 | `app/lib/manufacturing-providers/webhook-verification.ts` | 39 | `export class WebhookReplayStore {` |
| C40 | `app/lib/manufacturing-providers/webhook-verification.ts` | 74 | `export function verifyWebhook(input:` |
| C41 | `app/lib/manufacturing-providers/webhook-verification.ts` | 88 | `Math.abs(input.now - at) > tolerance) return refuse("timestamp_outside_window");` |
| C42 | `app/lib/manufacturing-providers/webhook-verification.ts` | 92 | `!timingSafeEqual(expected, given)) return refuse("signature_mismatch");` |
| C43 | `app/lib/manufacturing-providers/webhook-verification.ts` | 93 | `const admitted = input.replay.admit(id, input.now, at + tolerance + 1);` |
| C44 | `app/lib/engineering/action-registry.ts` | 186 | `action({ id: "manufacturing.provider-order", version: 1, area: "manufacturing",` |
| C45 | `app/lib/engineering/action-registry.ts` | 118 | `action({ id: "manufacturing.assembled-release"` |
| C46 | `app/lib/engineering/action-registry.ts` | 159 | `action({ id: "bom.workbench"` |
| C47 | `app/lib/engineering/action-registry.ts` | 182 | `never orders or releases` |
| C48 | `app/components/pcb/ProviderExchangePanel.tsx` | 129 | `data-testid="p2g-ordering-notice">Ordering through Sirkit is turned off.` |
| C49 | `app/components/pcb/ProviderExchangePanel.tsx` | 122 | `export function ProviderExchangePanel(props: ProviderExchangePanelProps) {` |
| C50 | `app/components/pcb/ProviderExchangePanel.tsx` | 157 | `data-testid="p2g-provider-carried"` |
| C51 | `artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv` | 107 | `manufacturing.provider-order,1,manufacturing,` |
| C52 | `app/lib/manufacturing-providers/__tests__/b23-a-tier3-vocabulary.test.ts` | 272 | `expect(actionIds).toHaveLength(106);` |
| C53 | `app/lib/engineering/__tests__/b17-a-control-inventory.test.ts` | 63 | `if (record.status === "missing") expect(reached.has(record.id) \|\| routed.has(record.id)` |
| C54 | `app/lib/engineering/__tests__/b19-e-no-purchase-tripwire.test.ts` | 26 | `const PURCHASE_WORDING = /add to cart` |
| C55 | `app/lib/project/__tests__/b18-b-import-gates.test.ts` | 34 | `const MINT_APPROVED = new Set(["app/lib/execution-grant/mint.ts", "app/api/chat/route.ts"]);` |
| C56 | `app/lib/release-engineering/types.ts` | 37 | `unitPriceDecimal: string; extendedPriceDecimal: string;` |
| C57 | `app/lib/manufacturing-providers/ordering-enablement.ts` | 116 | `export function orderingEnablementFromProcess(input:` |
| C58 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 85 | `const AMOUNT_TEXT = ` |
| C59 | `app/lib/manufacturing-providers/order-contract.ts` | 276 | `const judged = reread.answered ? judgedOr(() => judgeRequote(binding, reread.value), unreadable)` |
| C60 | `app/lib/manufacturing-providers/order-contract.ts` | 279 | `if (!this.enablement().enabled) return this.settle(held, { state: "not_submitted", code: "ORDER_DISABLED_BEFORE_SUBMISSION"` |
| C61 | `app/lib/manufacturing-providers/order-contract.ts` | 247 | `this.claims.get(claim!)!.key !== key) return this.answer("ORDER_CART_BUSY", null, false);` |
| C62 | `app/lib/manufacturing-providers/order-contract.ts` | 266 | `if (this.unresolvedCart(scope, cart, binding)) {` |
| C63 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 201 | `export function cartDigestOf(binding: unknown)` |
| C64 | `app/lib/manufacturing-providers/order-contract.ts` | 309 | `return { ok: false, code: "WEBHOOK_OBSERVATIONS_FULL", orderId: held.record.orderId };` |
| C65 | `app/lib/manufacturing-providers/order-contract.ts` | 47 | `ORDER_CART_BUSY: "Another submission of this cart is in progress and holds it until its own authorization is checked.` |
| C66 | `app/lib/manufacturing-providers/order-contract.ts` | 249 | `const claimed = claim !== null; // [B23-C lead, 2026-10-04] every submit of the claiming authorization holds the claim` |
| C67 | `app/lib/manufacturing-providers/purchase-authorization.ts` | 203 | `const read: unknown = JSON.parse(durableWorkflowJson(binding));` |
| C68 | `app/lib/manufacturing-providers/order-contract.ts` | 336 | `binding.providerId.normalize("NFC") : undefined;` |
