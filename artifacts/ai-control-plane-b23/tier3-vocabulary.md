# B23-A2 - Tier 3 and the route vocabulary

Labels: **CONFIRMED** (executed and measured here, or read at the cited file:line), **INFERRED** (a conclusion from reading code; nothing
executed it), **PROPOSED**, **RECORDED** (written down without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Tree: `chapter/b23-external-manufacturing`, base `79fa18b` (B23-A1). Closes D23-8, D23-9, D23-12 and D23-21. Owner decisions applied:
OD-173 and OD-174; A2's own choices beyond its task text are OD-182 (section 11). Runbook B23 `:946-951`, `:1015-1017`: "Never allow an
agent or a single ambiguous click to order hardware or spend money"; pass: "no agent can release or spend". Section 15 records the
adversarial review of the first A2 tree and what it changed. [B23-A2 lead, 2026-10-02] Section 16 records the independent check of
those fixes (four low issues) and what it changed.

## 0. What B23-A2 is

- **A structural Tier 3 for data leaving Sirkit (OD-173, D23-8).** A new side effect, `external-transfer`, in `TOOL_SIDE_EFFECTS` and its
  action-registry equivalent (`ActionCoverageRecord.sideEffects`, the closed vocabulary `ACTION_SIDE_EFFECTS`). Every place a tier is
  computed yields Tier 3 for it whatever the id, class or approval tier says, and discovery never lists it for an agent (section 1).
  CONFIRMED
- **The id floor's seven new stems (OD-173)** - `quote|dfm|submit|checkout|cart|buy|payment` - and the whole word `pay`, in
  `TIER3_FLOOR_PATTERN`, added only after a census proved that no current tool or action id changes tier and no B21 role row changes
  (section 2). CONFIRMED
- **The B21 withdrawal** drops every `external-*` authority through one predicate and keeps dropping B22's `computation-engine`; the
  specialist-claims check does not follow, by decision (section 3). CONFIRMED
- **The chat-closure tripwire** also forbids `app/lib/net/outbound-fetch.ts` and the provider directory (a reviewed move, section 4). CONFIRMED
- **Foreign MCP tool names** matching the floor, or a money or data-leaving word, are refused at registry validation and approve nothing in
  the agent port (D23-12; the registry is empty, OD-48) (section 5). CONFIRMED
- **The route vocabulary (OD-174, D23-9):** `RoutePolicy.externalTransfer` and `RoutePolicy.spend` with their gates, and the B16.0.2
  classification's `outboundEgress` (what leaves through the egress boundary) and `modelEgress` (a model input sent to the LLM provider
  through its SDK), both derived from the code (section 6). CONFIRMED
- **A structural no-order route check (D23-12)** beside B19-E's name check (section 7), and **the four CD-12 stubs pinned by id**
  (D23-21, section 8). CONFIRMED
- **No route, no tool, no UI, no egress.** The census stays 165 / 162 / 3 / 0 and the agent-tool counts 47 / 36 / 9 / 27; no provider
  was contacted and nothing was fetched. CONFIRMED

## 1. The structural side effect, wherever a tier is computed

| where | what it does with `external-transfer` | anchor |
|---|---|---|
| `app/lib/engineering/tool-registry.ts:54` | the seventh tool side effect | `export const TOOL_SIDE_EFFECTS = [` |
| `app/lib/engineering/action-registry.ts:67` | the action equivalent, optional, carried by no record | `sideEffects?: ActionSideEffect;` |
| `app/lib/engineering/permission-tiers.ts:52` | a tool's tier is 3 | `if (TIER3_FLOOR_PATTERN.test(descriptor.toolId) \|\| descriptor.sideEffects === EXTERNAL_TRANSFER_SIDE_EFFECT) return 3;` |
| `app/lib/engineering/permission-tiers.ts:57` | an action's tier is 3, before the view shortcut | `if (TIER3_FLOOR_PATTERN.test(record.id) \|\| record.sideEffects === EXTERNAL_TRANSFER_SIDE_EFFECT) return 3;` |
| `app/lib/engineering/mcp-exposure.ts:130` | the MCP structural rule passes the side effect, so the reason is `tier3`, first | `sideEffects: facts.sideEffects as` |
| `app/lib/mcp/server/tool-definitions.ts:284` | the served `dev.sirkit/permissionTier` passes it too | `sideEffects: facts.candidate.sideEffects` |
| `app/lib/engineering/tool-registry.ts:295`, `:504` | the validator refuses an exposed transfer tool | `function externalTransferIssues(descriptor: ToolDescriptor): string[] {` |
| `app/lib/engineering/action-registry.ts:392` | the action validator refuses a tool-exposed transfer action and any value outside the vocabulary | `an external-transfer action is never tool-exposed` |
| `app/lib/engineering/agent-exposure.ts:26` | the exposure rule refuses it whatever its class | `if (descriptor.sideEffects === "external-transfer") return false;` |
| `app/lib/engineering/tool-discovery.ts:179` | [review] the agent and automation channels never list it, whatever exposure a registry claims | `descriptor.sideEffects === "external-transfer")) { // [B23-A2 review]` |
| `app/lib/agent/orchestration/role-tools.ts:130` | a B21 role row refuses it (`never_exposed_pattern`) | `descriptor.sideEffects === "external-transfer"` |

The other tier computations take whole descriptors or records (`execution-intents.ts:266`, `loop.ts:420`,
`granted-execution-families.ts:100`, `tool-definitions.ts:369`, `execution-grant/consume.ts:48`), so they see the side effect without a
change. `permissionTierOfDescriptor` now REQUIRES `sideEffects` in its argument type (tsc exit 0), so a tool-tier caller that forgets
it does not compile; an action record's field is optional, and its absence means no side effect. The B05 read layer already refuses any
side effect beyond a derived cache (`tool-invocation.ts:304`). CONFIRMED

A forged descriptor - the board read renamed `sirkit.pcb.board-share`, an id no floor stem matches - with the side effect is Tier 3 for
every class and approval tier, the decision is `never` for every role, and the same read without it is Tier 0: the side effect, not a
word, makes it Tier 3 (`b23-a-tier3-vocabulary` case 1). It is never agent-exposed (the validator refuses it, the exposure rule refuses
it), excluded from MCP as `tier3`, outside every B21 role row, and never listed for an agent (case 2). CONFIRMED

**Refused by the never-execution sweep, by the side effect (case 3).** The sweep's selection picks it by the computed tier alone. Through
the real gateway with and without a real minter: the forged read at its own version (`1.1.0`) is refused `not_discoverable`; in a
registry DOUBLE that skips the validator (as no production path can: the ToolRegistry constructor validates), the exposed board read
re-labelled as a transfer is refused `not_discoverable`, while the real board read runs (control); the move tool renamed, exposed, given
a reviewed granted-execution row and the side effect is refused `not_callable` on "permission tier 3 is not Tier 1" with valid move
arguments and the minter is never called, while the same double without the side effect mints once (control); and the seal refuses the
transfer `tier_exceeded` with valid arguments while the same descriptor without it seals. Each part stops only on the side effect. CONFIRMED

**Both port-bound classes forbid an approval tier** (`tool-registry.ts:285`, `:494`) **and refuse the side effect** (`:284`, `:493`: no
side effect beyond a derived cache), so a port-bound provider read can never carry it: a bound read that sent files would have to be a
separately reviewed, non-port-bound descriptor, which computes Tier 3 and is never exposed (case 4, run on `sirkit.parts.external-search`,
`sirkit.mcp.observation-read` and `sirkit.computation.analytical-equation`). At `79fa18b` such a read computed Tier 0 (section 10).
CONFIRMED

## 2. The floor's new stems, and the census before and after

`TIER3_FAMILY_PATTERN` (`permission-tiers.ts:36`) is unchanged: its nine stems are also the router's nine chat families, and
`b21-b-router` case 1 pins that every stem of it is covered by a family word. OD-173 keeps the router's families as they are (discovery
section 8 item 16: no provider tool exists, so a quote ask in chat reaches nothing), so the seven stems live beside it: the id floor is
`TIER3_FLOOR_PATTERN` (`:169`) = the nine family stems, `quote|dfm|submit|checkout|cart|buy|payment` (`TIER3_B23_STEMS`, `:161`) and the
whole word `pay` (`TIER3_B23_WORDS`, `:165`, matched as `(?<![a-z0-9])pay(?![a-z0-9])`, so `payload` and `display` move nothing), and
every tier computation, the B21 role rows (`role-tools.ts:121`) and the consumed MCP tool names (section 5) apply it. The split is OD-182
(b); the word `pay` is OD-182 (h). CONFIRMED

| census (`b23-a-tier3-vocabulary` case 5) | at `79fa18b` | after A2 |
|---|---|---|
| tool ids in `artifacts/ai-control-plane-b04/tool-registry.csv` (= the registry) | 47 | 47 |
| action ids in `artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv` (= the registry) | 104 | 104 |
| ids matching any of the seven new stems or the word `pay` (B22's five `sirkit.computation.*` included) | 0 | 0 |
| descriptors or records carrying `external-transfer` | - (no such value) | 0 |
| tool or action ids whose tier differs from the `79fa18b` rule | - | 0 (each recomputed against the old rule) |
| MCP `tier3` exclusions differing from tier 3 | - | 0 |
| B21 role rows (`roleExposureReport`) | ok | ok, no specialist id matches the widened floor |
| router families | 9 | 9, unchanged |
| agent-tool counts registry / agent / MCP / agent-only | 47 / 36 / 9 / 27 | 47 / 36 / 9 / 27 |

No stem or word moved a tier or a role row, so OD-173's stop did not apply. `export` is NOT in the id floor: Sirkit's own
`pcb.export-kicad` and `schematic.import-export-kicad` are browser downloads, and the word would move them. CONFIRMED

## 3. The B21 withdrawal, and the claims check

`withdrawAuthority` and `deriveSpecialistContext` (`scheduler.ts:183`, `:220`, edited in place) now drop every authority
`isWithdrawnAuthority` (`:853`) names: any `external-*` authority, and `computation-engine`. A prefix, never a list, so a later external
authority is withdrawn before anyone names it; a context carrying a forged `external-transfer` authority loses it. `b22-b-exposure` case 4
(`:127-156`), `:68` (the `computation` reason right after `never_exposed`) and `:121` are unchanged and green. CONFIRMED

**The specialist-claims check (`:257-258`) does not follow** (OD-182 (c)). Each of its eight claims is one closed fact (OD-109,
`SPECIALIST_CONTEXT_CLAIMS`); the authority vocabulary (`TOOL_AUTHORITY_SOURCES`) holds exactly the two external authorities the check
names, and A2 adds no authority (the transfer is a side effect, never an authority a tool can require). A prefix rule there would have to
map a future authority onto an existing claim name. Instead case 6 pins that the vocabulary's `external-*` members are exactly those two,
so a third fails the suite until the check follows (and B21's eight-claim pin moves by review). The derivation already drops any
`external-*` authority, so a specialist's context carries none. CONFIRMED

## 4. The chat-closure tripwire (a reviewed pin move)

`app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts:128` (the `FORBIDDEN` list) gains
`/^app\/lib\/net\/outbound-fetch\.ts$/` and the provider directory, edited in place so the line stays line 128 (B21-E1's citation C59
reads it there), with the dated `[B23-A2, 2026-10-02]` note on and below the line. The directory's pattern is spelled in two joined parts
because `b23-a-provider-admission` case 8 refuses any file outside the directory whose text names it. Every earlier entry stands. The chat,
Build-mode and LLM-router closures reach neither module; walked through the two approved boundaries, the chat closure reaches the egress
module, so the rule is not vacuous (`b23-a-tier3-vocabulary` case 7). CONFIRMED

## 5. Foreign MCP tool names (D23-12)

`validateMcpServerRegistry` (`app/lib/mcp/server-registry.ts:564`, edited in place; the import replaced the blank line `:26`) refuses a row
whose `agentTools` holds a name `isTier3McpToolName` (`:665`) matches, under the existing `agent-tools` rule with one fixed sentence
(`MCP_TIER3_TOOL_NAME_REFUSAL`, `:654`), whatever the tool's annotations claim; the name is never echoed. A name matches when the id floor
matches it, or when one of its words - split at case changes and at every non-alphanumeric character, so `payInvoice`, `pay_invoice` and
`PAY_NOW` read alike - is in `MCP_TIER3_NAME_WORDS` (`:660`): money (`pay`, a purchase order `po`, `procure`, `procurement`) and design data
leaving Sirkit (`send`, `transfer`, `share`, `export`, `email`), with their common inflections. Refused: `create-order`, `checkout`,
`get_quote`, `upload_gerbers`, `dfm-check`, `make_payment`, `pay_invoice`, `send_gerbers`, `transfer_design`, `export_gerbers`, `create_po`,
`procure_parts` and the rest (case 8). CONFIRMED

**The sentence claims no completeness** (OD-182 (j)): it says a word list refuses the names it holds and "proves no other name harmless,
so a row is still approved only by a human review". A neutral name for a writing tool (`update-record`) passes the word list, as any word
list lets some name pass; the listing's own write declarations and the operator's per-tool list are the other two rules. RECORDED

**The agent port applies the same floor** (`app/lib/mcp/agent-port.ts:223`, OD-182 (e)): B20-A4L made the port re-check each `agentTools`
rule because a crafted revision reaches it without the validator, so `mcpAgentToolAllowlist` now approves NOTHING for a list naming a
floor tool - as the validator refuses the row whole, and as the port already fails closed on an over-bound list - and `mcpAgentRoster`
drops the row (case 9). The registry is empty (OD-48), so no committed row moves, and the registry CSV and version are unchanged.
B20-A4's case 14 named its writing tool `create-order`; its premise (the listing accepts the writing tool and only the operator's list
narrows it) needs a writing tool outside the floor, so the fixture is now `update-record`, a reviewed pin move dated in place (section
9). CONFIRMED

**[B23-A2 lead, 2026-10-02] The connector policy reads the same floor, and B20-A4 case 17 proves its own bound again.** B20-A5's
statement `providerConnectorVerdict` judged `agentTools` with a private copy of the port's rule, so once the port voided a list naming a
floor tool, a row such as `["create-order", "lookup"]` approved nothing in the port yet carried no `no_agent_tools` (the verdict still
refused it: `connectors_refused`, and `server_not_admitted` because the validator names the row). The policy now applies the port's own
predicate, the registry's `isTier3McpToolName`, to every name the port reads at all (`app/lib/mcp/provider-connector-policy.ts:156`,
edited in place; `usableAgentToolName` appended at `:170`), still through its one runtime import (`:19`). B20-A5's parity case
(`no_agent_tools` agrees with `mcpAgentToolAllowlist` row for row) gained five shapes: a floor name first, a floor name last, a money
word beside a read, only floor names, and a floor-like name outside the pattern beside a valid one, which both readers skip. B20-A4
case 17's 33-name list named `create-order` first, so a port that truncated the list to its first 32 names still approved nothing,
through the floor, and the case no longer proved that the port voids the whole list; its writing tool is now `update-record`, outside
the floor (the case pins that no name of its list is a floor name), in place with a dated note. CONFIRMED (section 16)

## 6. The route vocabulary (OD-174, D23-9)

**Two booleans on every policy row.** `RoutePolicy` gains `externalTransfer` (design or part files leave Sirkit through the row) and
`spend` (the row can spend money). They are merged into the interface at the end of `route-policy.ts` (`:358`) so every cited line above
stays where it is; every constructor and both literal rows set them `false` in place. `routeVocabularyViolations` (`:375`) is the gate,
with nine closed reasons: `flags_not_explicit`, `spend_in_b23` (no spend row may exist in B23), and for a transfer or spend row `public`,
`not_human_session` (only a trusted human session: never a worker secret, an MCP bearer or a body-scope server actor), `no_csrf`,
`any_member`, `viewer_or_commenter`, `automation` and `release_vocabulary` (a transfer never reuses `releaseOrQualification`; its two-row
pin, `b16-0-1-ci-gates.test.ts:186-196`, stays as it is). The table carries no transfer and no spend row. CONFIRMED [superseded 2026-10-05 by the B23 closeout (B23-B1, OD-174): since B23-B1 the table carries one transfer row, POST /api/pcb/provider-exchange (outbound-disclosure.md section 5); no row is spend]

**`outboundEgress`: what leaves through the egress boundary (OD-182 (a)).** A closed vocabulary (`route-resource-classification.ts:112`):
`none` (nothing through the boundary: no observation query and no files), `observation-query` (a bounded query whose answer is an
observation: a distributor or aggregator search, an approved MCP server's tool call, the cross-verify prompt to the operator's SchGen
endpoint - never a file) or `files` (only through a human-only `externalTransfer` row). `none` does NOT mean the route sends nothing: the
model-provider SDKs open their own connections (discovery section 2.3). CONFIRMED

**`modelEgress`: a model input sent to the LLM provider (OD-182 (a), (k)).** A boolean per path (`:128`, `:199`): the route can send a
prompt or an embedding input to the configured LLM provider (OpenAI or Anthropic) through the provider SDK's own transport. A row sends
nothing out of Sirkit exactly when it is `none` and not `modelEgress` - Sirkit's own Supabase and Postgres store aside (the
`durable_access` column). The `provider_credit` column is a cost marker, not this: 12 of its 33 true rows send no model input, and the two
public searches below send one with `provider_credit` false. Both values are rendered as the LAST two columns of
`route-data-and-resource-classification.csv` (so `external_process` stays at index 6, `b22-a2-process-census` case 3) and gated by
`outboundEgressViolations` (`:236`): a closed value and a boolean; `files` exactly with a transfer row; a public row sends no observation
query and no files (`public_sends`); a public row that sends a model input is one of the reviewed `PUBLIC_MODEL_EGRESS` paths (`:137`,
`public_model_egress`). CONFIRMED

**Derived, not asserted.** `b23-a-route-vocabulary` case 4 derives both values per path and checks every row and CSV cell against them. [B23-B1, 2026-10-04] Since B23-B1 a transfer path's `files` is declared by its transfer row and checked against the reviewed transfer list (`TRANSFER_PATHS`), its closure-derived value pinned beside it (none in B1); case 4 derives the query and none values (`outbound-disclosure.md` section 5).
- `outboundEgress`: the route's runtime import closure (the gates' edges, checked equal to `importClosure`) reaches
  `app/lib/net/outbound-fetch.ts`, the way census case 3 derives `external_process`. Eleven route files reach the boundary ([B23-B2, 2026-10-04] twelve since B23-B2: the provider exchange route, whose value is the declared `files`, reaches it through `provider-egress.ts` alone; `dfm-quote-flow.md` section 7); five are
  reviewed cache-only exemptions, each holding by reachability and by its own calls (case 5): bridged at the pricing gateway
  (`app/lib/bom-builder.ts`, `app/lib/bom/build.ts`) the route reaches no egress; the route is the gateway's one importer in its
  closure; it imports only its reviewed names; it calls the pricing function with two arguments (no pricing grant); and [review] the
  gateway's OWN edges are the reviewed ones - the builder's one runtime import is the build, the build is the distributor index's one
  importer in the gateway, it imports exactly `getPricingFor`, `pausedSources`, `pricingKey`, `pricingSourceStatuses` and
  `unavailableSources`, unaliased, and makes exactly the one pinned pricing call (`live: pricing.live === true`). Case 6 shows every way
  an exemption is lost: a grant, a spread, the function handed on, an unreviewed or namespace import, a path around the gateway, a helper
  that imports the gateway, and [review] the builder calling the index live itself, the build importing and calling `lookupExactMpns`
  live, a second pricing call, and the one call passing `live: true`. The four other names read the source registry's pause and status
  state and take no `live` option (INFERRED). CONFIRMED
- `modelEgress`: module reachability says nothing here - the DB schema imports the embedding module's dimension constant
  (`app/lib/db/schema.ts:31`), so nearly every route's closure reaches an OpenAI client it never calls (case 8 shows it for
  `/api/pcb-sync`). The derivation is binding-level: every local bound to a model SDK import is a seed; a top-level declaration that
  references a sending local is sending; an imported binding is sending when the export it names is (a namespace import, `export *` or
  a dynamic import when any export is); a module sends at import when its import-time code calls a sending binding (constructing one with
  `new` sends nothing). A route sends a model input when one of its handler exports is sending, or a module in its closure sends at
  import. References are names, never runtime values: an over-approximation inside a module (shadowing is ignored), and INFERRED sound
  across modules for code that passes functions by import (a value handed between modules through a module-level registry would escape
  it). An independent import-level script over the same tree marks every derived path and two more, `/api/export/kicad` and
  `/api/schematic/cross-verify`, which import only `getFullPartsByIds` - a database read - from `app/lib/parts-search.ts`. Case 8 probes
  it: a handler calling an SDK client through a hop is model egress, one reading a constant beside it is not, a wrapped handler is, and a
  module calling a sending binding at import is. CONFIRMED

**Every way out is reviewed (case 8).** A transport census over every module some route's closure reaches pins each one that holds a
connection primitive - a runtime import of a model SDK or a network package (`@supabase/ssr`, `postgres`, `undici`, `node:https`, `ws` and
the rest), or a global fetch - to one reviewed kind: the egress boundary (`outbound-fetch.ts`), a model-provider client
(`app/lib/agent/adapters.ts`, `app/lib/embeddings.ts`, `app/lib/llm/anthropic-provider.ts`, `app/lib/llm/openai-provider.ts`,
`app/lib/parts-search.ts`), Sirkit's own store (`identity-provider.ts`, `bounded-fetch.ts`, `db/client.ts` and the three auth routes),
a browser-side same-origin call whose every fetch names a Sirkit path (`app/lib/pcb/netlist-bridge.ts`,
`app/lib/project/membership-reauthorization.ts`), or no connection (`app/lib/net/ip-policy.ts` imports `isIP` only). A new transport fails
the census until it is reviewed. CONFIRMED

[B23-A2 lead, 2026-10-02] **The census reviews primitives, not only modules.** Each reviewed module also pins its exact primitive list
and its number of connection sites: each global fetch; each runtime reference to a binding imported from a model SDK or a network
package (a call, a construction, a class it extends or a hand-on alike; an address classifier such as `isIP` is no site); and each
side-effect import, dynamic import, require or runtime re-export of such a package. A no-connection module holds no site, and only a
no-connection module may. So a third-party fetch added to `app/lib/db/client.ts`, to `app/lib/net/ip-policy.ts` or beside the OpenAI
client in `app/lib/embeddings.ts`, a second fetch in `bounded-fetch.ts`, a socket opened through `node:net` in the classifier and a
second `postgres` client each fail case 8, in an injected file map; two controls that open nothing (a constant, another classifier)
pass. The reviewed sites are one per module, except `adapters.ts` and `netlist-bridge.ts` (two each) and `ip-policy.ts` (none). Stated
limits: a binding taken from a dynamic import or a require is counted once, at the import (`identity-provider.ts`); a global fetch held
under another name is not seen, as in the primitive rule. CONFIRMED

| `outboundEgress` / `modelEgress` | paths (method rows) |
|---|---|
| `observation-query`, model input | `/api/chat` - 1 row |
| `observation-query`, no model input | `/api/bom`, `/api/bom/diff`, `/api/bom/snapshot` (GET and POST), `/api/parts/external-search`, `/api/schematic/cross-verify` - 5 paths, 6 rows |
| `none`, model input | 22 paths, 22 rows: `/api/architecture/propose`, `/api/calculation/propose`, `/api/circuit-knowledge/propose`, `/api/circuit-verification/propose`, `/api/component-selection/propose`, `/api/interfaces/propose`, `/api/parts/search` (public), `/api/pcb/ai-rules/from-brief`, `/api/pcb/assign/suggest`, `/api/pcb/edit/assist`, `/api/pcb/footprints/search` (public), `/api/pcb/repair/agent`, `/api/power/propose`, `/api/schematic`, `/api/schematic-compiler/propose`, `/api/schematic/build`, `/api/schematic/build-multi`, `/api/schematic/edit`, `/api/schematic/edit-build`, `/api/schematic/layout-critic`, `/api/schematic/review`, `/api/spice/ai` |
| `none`, no model input: sends nothing out of Sirkit | 136 rows, the five cache-only BOM routes (public, OD-31) among them |
| `files` | none: no route sends files in A2; the provider exchange route is B23-B1's |

**The public model egress is recorded, not changed.** `POST /api/parts/search` and `GET /api/pcb/footprints/search` are public and embed
the anonymous caller's search text with OpenAI (`embedQuery`) for their semantic ranking; the reviewers named the first, the derivation
found the second. Both carry `provider_credit` false. A2 adds no route change, so both stand as reviewed `PUBLIC_MODEL_EGRESS` entries,
and the owner's question is in section 12. CONFIRMED

The classification CSV is byte-pinned (B16.0.2): it was regenerated by `scripts/generate-b16-0-2-artifacts.ts` only, and its diff is
exactly the two new last columns on all 166 lines (header plus 165 rows). The census stays 165 / 162 / 3 / 0. CONFIRMED

## 7. The structural no-order route check (D23-12)

B19-E's check reads each `route.ts` file's own text (`b19-e-no-purchase-tripwire.test.ts:168`, `:302-307`) and stays as it is (case 5
pins its pattern and walk). Beside it, `b23-a-no-order-structural`: no policy row is `spend`, and the gate refuses one whatever its shape
(case 1); no route's runtime import closure - delegated handler modules included - reaches a module that declares or calls an order,
purchase, checkout, cart-fill or payment port (case 2, every route file). [review] A port is any NAME a reached module declares or calls,
not only a top-level export: functions and classes (exported or module-private), variables, class members, object-literal properties
(shorthand included), export-list names, and each called property chain joined (`client.orders.create(...)` reads
`client_orders_create`); types are skipped. A name is a port when its words name such an operation (an `order` with a verb such as
place, submit, create or confirm; any `purchas*`, `checkout`, `payment`, `pay` or `buy`; a `cart` with add, fill or populate). Case 3 shows
the check catches what the name check cannot (a `route.ts` naming only a helper that delegates to `submitOrder` and nine other port names,
and a re-exported port); case 3b catches a class method, an object property and its shorthand, a module-private function behind a
neutral export, an anonymous default export calling an SDK's `orders.create`, and a called `checkout` chain. [B23-A2 lead, 2026-10-02] A
port is also every runtime import binding (the imported name and its local alias; default, namespace and `import x = require(...)`; a
type-only import is none), every destructured binding (its local name and the property it reads), a call through a single part
(`createOrder(lines)`, `this.placeOrder(lines)`), a string-keyed call (`client["placeOrder"](...)` reads `client_placeOrder`) and a
construction (`new sdk.CheckoutSession(...)` reads `sdk_CheckoutSession`). Case 3b's nine new probes - the check's own two (an order
function imported by name from a package and called directly; one destructured from a client and called), then one per new rule -
each failed on the previous scanner and pass now; no route reaches a new port and the reviewed look-alikes are unchanged. Seven reviewed look-alikes
are not ports (OD-182 (d)): `app/lib/kicad/pinned-checkout.ts` (a git checkout) and the CD-12 stub `placePurchaseOrder`, reached by no
route; and, reached by routes, the lifecycle status `last_time_buy` (`distributors/lifecycle.ts`, `risk-scoring.ts`, `bom/build.ts`), the
offline sourcing quantity `buyUnits` (`component-selection/sourcing.ts`) and the CD-12 propose answer's `hasExternalOrPurchasingSideEffects`
(pinned false). Each module's declared port-like names equal its reviewed list exactly (case 4). CONFIRMED

**The stated limit.** A name check cannot see a neutrally named function that posts to a vendor's order endpoint. Such a route's egress
is the classification's `observation-query`, and no route outside the reviewed six sends one. RECORDED [B23-A2 lead, 2026-10-02] Nor an
order member read without a call and held under a neutral local name (`const go = client.placeOrder;`). RECORDED

## 8. The four CD-12 stubs, by id (D23-21)

`b23-a-cd12-stubs` pins `approveAsAgent`, `placePurchaseOrder`, `sendExternalReviewRequest` (`app/lib/release-engineering/governance.ts:8-10`)
and `writeManufacturingBytesFromLlm` (`agent-tools.ts:8`) by id: each throws exactly its literal with no argument and with any argument;
its cited line is exactly the one-line declaration with that literal, and the literal appears in no other production file; no other
production file calls or names it (the barrel re-exports the module with `export *`); the CD-12 propose route names none of them and still answers
`hasExternalOrPurchasingSideEffects: false`. Their sibling `applyCd12Proposal` stays pinned where it was (`foundation.test.ts:2`, `:42`).
[review] "Production" is the import gates' whole-root walk (`collectProductionFiles`), so the repository root's own `proxy.ts` and
`instrumentation.ts` are scanned (case 3 pins both and probes a call added to `proxy.ts`). CONFIRMED

## 9. Every pin moved, and why

| pin | moved how | why |
|---|---|---|
| `app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts:128` | two entries appended in place, dated `[B23-A2, 2026-10-02]` note on and below the line | OD-173: the chat closure must never reach the egress boundary or a provider module except through a reviewed boundary |
| `app/lib/auth/__tests__/b20-b2-mcp-route-policy.test.ts` cases 2 and 3 (three whole-row `toEqual` objects) | `externalTransfer: false, spend: false` added in place to each expected row, dated note on each line | the rows now state both booleans; the pin is tightened (two more fields asserted), not loosened |
| `app/lib/mcp/__tests__/b20-a4-agent-read-port.test.ts` case 14 (`:565-596`) | [review] the writing-tool fixture `create-order` renamed `update-record` on its eight lines, in place, dated `[B23-A2 review, 2026-10-02]` note on `:565` | the port now refuses a floor name itself (section 5); the case's premise needs a writing tool outside the floor; every assertion of the case stands as it was |
| `app/lib/mcp/__tests__/b20-a4-agent-read-port.test.ts` case 17 (`:646-656`) | [B23-A2 lead, 2026-10-02] the 33-name list's first name `create-order` renamed `update-record` on `:646`, `:647`, `:649` and `:656`; `:648` also pins that no name of the list is a floor name; dated notes on `:22`, `:646` and `:648`; line-neutral | the floor masked a truncate-to-32 mutation of the port's bound, so the case no longer proved its own claim (section 16) |
| `app/lib/mcp/__tests__/b20-a5-provider-connector-policy.test.ts` parity case (its shape list) | [B23-A2 lead, 2026-10-02] five shapes appended, dated note | the policy's `no_agent_tools` must agree with the port for floor names too; the pin is tightened, not loosened (section 16) |
| `artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv` | regenerated by its generator: two appended columns | OD-174's `outboundEgress` and OD-182 (a)'s `modelEgress`; every reader re-run (`b16-0-2-gates`, `b16-0-3-effective-classification`, `b22-a2-process-census`, `b23-a-route-vocabulary`, the route readers) |

No other pin moved: every file was edited line-neutrally up to its last cited line (new declarations appended at the end, as B22-B did
with `computationBindingIssues`; `tool-discovery.ts:179`, `agent-port.ts:45`, `:223` and `server-registry.ts:564` edited on their own
lines), so the B20, B21 and B22 page citations of these files still resolve. The tool and action CSVs, the B16.0.1 policy CSV (it does
not render the two booleans in A2: OD-182 (f)), the B20 parity, manifest and server-registry artifacts and the B21 artifacts regenerate
byte-identical. B20's page `mcp-client-boundary.md:1543` still tells B20's own history with `create-order`; it is a record of that
increment, not a pin. CONFIRMED [B23-A2 lead, 2026-10-02] `app/lib/mcp/provider-connector-policy.ts` was edited on `:19`, `:153` and `:156`
with its helper appended at `:170`, so B20's page citations of it (`:27-42`, `:64-79`, `:103`, `:129-162`) still resolve. CONFIRMED

## 10. Test-first record

- **Red first on `79fa18b` (CONFIRMED):** the four suites, before any production edit: 14 failed / 15 passed of 29 (log
  `a2-red-1.log`). Every `b23-a-tier3-vocabulary` case failed, each on the missing feature (`external-transfer` not a side effect; an
  exposed transfer validated; the bound external read computed `+0` where 3 was expected - the D23-8 counterexample reproduced; no
  `TIER3_B23_STEMS`; no `isWithdrawnAuthority`; the `FORBIDDEN` line without the egress module; `create-order` accepted as an agent tool -
  the D23-12 counterexample reproduced). `b23-a-route-vocabulary` cases 1-5 failed (no booleans: `GET /api/pcb-sync: expected 'undefined'
  to be 'boolean'`; no gate; no `OUTBOUND_EGRESS`), cases 6-7 passed (the derivation and the census over the unchanged tree).
  `b23-a-no-order-structural` case 1 failed (165 rows without `spend`); cases 2-5 passed (no port is reached today; the synthetic routes
  are caught). `b23-a-cd12-stubs` passed 9 / 9: the stubs already throw - D23-21 is a missing pin, not a code defect.
- **The pin bites (CONFIRMED):** with the four stubs broken at once (a changed literal, a `return`, a different message, a message that
  changes with an argument) and a production caller added, all 9 cases of `b23-a-cd12-stubs` failed (`a2-cd12-breakage.log`); the three
  files were restored byte for byte and checked by SHA-256.
- **Green:** after the edits, 27 / 29 on the first run - two expectations of the suite itself were wrong (the board read's version is
  `1.1.0`; a registry violation's message is prefixed by the row label) and were corrected - then 29 / 29.
- **The review round** is section 15. [B23-A2 lead, 2026-10-02] The independent check of its fixes is section 16.

## 11. OD-182 - B23-A2's choices beyond its task text

(a) [amended by the review] `outboundEgress` is the closed vocabulary `none | observation-query | files`, per path, derived from the
import closure reaching the egress boundary with reviewed cache-only exemptions (the B22-A2 census pattern); `files` is never derived,
only declared with a transfer row; `none` means nothing through the boundary, and the separate derived boolean `modelEgress` records a
model input sent to the LLM provider through its SDK, so a row sends nothing out of Sirkit exactly when it is `none` and not
`modelEgress`; a public row with `modelEgress` is a reviewed `PUBLIC_MODEL_EGRESS` path. (b) The id floor is a new constant,
`TIER3_FLOOR_PATTERN`; `TIER3_FAMILY_PATTERN` stays the router's nine chat families, so the B21 router pins stay as they are. (c) The
specialist-claims check (`scheduler.ts:257-258`) does not follow the withdrawal; a tripwire pins the two external authorities instead.
(d) The structural no-order check's port vocabulary, over every declared or called name, with seven reviewed look-alikes. (e) [amended
by the review] The MCP name floor applies at registry validation AND in the agent port's allowlist (a list naming a floor tool approves
nothing). (f) The B16.0.1 policy CSV does not render the two booleans in A2. (g) A validator rule refuses an agent-exposed
`external-transfer` tool and a tool-exposed `external-transfer` action. (h) [review] The id floor gains the whole word `pay`. (i)
[review] Discovery never lists an `external-transfer` tool on the agent or automation channel, whatever exposure a registry claims.
(j) [review] The consumed-tool name floor adds the money and data-leaving words, and its refusal claims no completeness. (k) [review]
`modelEgress` is derived binding by binding (handler exports and import-time calls), not by module reachability. RECORDED

## 12. What stays open

- **Runtime enforcement** of a transfer row's human-only rule is the route's own (the release route's pattern), with B23-B1's route; the
  gate pins what the table can say. PROPOSED
- **Quote asks in chat** ("get a quote from PCBWay") are not refused by the router: no tool reaches a provider, so they reach nothing
  (OD-173; discovery section 8 item 16 stays the owner's question). RECORDED
- **The two public searches send the anonymous caller's text to OpenAI** (`/api/parts/search`, `/api/pcb/footprints/search`) with
  `provider_credit` false: whether a public route may spend model credit on an anonymous query, and whether the classification's
  `provider_credit` should say so, is the owner's question; A2 records it and changes no route. PROPOSED
- **Live exchange and ordering** stay BLOCKED-LIVE-QUALIFICATION (LB-11, LB-12): no provider is admitted, no account exists (OD-160).
- **The cache-only exemption** rests on the pricing gateway's source pins, its pinned edges and B19's behavioural pin
  (`b19-bom-quota.test.ts:75`); the gateway's internals beyond them are INFERRED.
- **`modelEgress` follows names, not values**: a model client handed between modules through a module-level registry, rather than by
  import, would escape the derivation (INFERRED: no such registry exists in the reached code today).

## 13. Gates

Every run went through the shared lock, one at a time, and every CLI process was stopped after it. The "after" column is the tree after
the review round (section 15).

| gate | before (`79fa18b`, the four suites present) | after |
|---|---|---|
| the four new suites | 14 failed / 15 passed of 29; exit 1 | 32 / 32; exit 0 |
| `app/lib/manufacturing-providers/__tests__` + `app/lib/acquisition/__tests__` (the CI job-scope guard admits the new suites) | (acquisition ran in the computation row) | 20 files passed, 1 skipped; 350 passed, 2 skipped; exit 0 |
| `app/lib/engineering/__tests__` (B18-A tiers, B17-F exposure, the B01 and B04 byte gates) | 99 files; 1107 / 1107; exit 0 | 99 files; 1107 / 1107; exit 0 |
| `app/lib/agent/__tests__` + `app/lib/agent/orchestration/__tests__` (B18-C sweep, B11.5 case 12, B21 router, role rows, pages) | 85 files; 875 / 875; exit 0 | 85 files; 875 / 875; exit 0 |
| `app/lib/mcp` + `app/lib/auth/__tests__` (counts 47 / 36 / 9 / 27, `b20-b4-process-gate`, the two-row release pin, the B16.0.2 byte gate, the moved B20-B2 rows and B20-A4 case 14) | 86 files; 1304 passed, 9 skipped; exit 0 | 86 files; 1304 passed, 9 skipped; exit 0 |
| `app/api/__tests__` + `app/api/chat/__tests__` (census 165 / 162 / 3 / 0, the moved B19-D list) | 49 files; 1208 / 1208; exit 0 | 49 files; 1208 / 1208; exit 0 |
| `app/lib/computation/__tests__` + `app/lib/release-engineering` (B22 exposure, census, closeout) | with acquisition: 41 files passed, 3 skipped; 523 passed, 20 skipped; exit 0 | 27 files passed, 2 skipped; 310 passed, 18 skipped; exit 0 |
| `b14-4-ast-import-gates` alone | 22 / 22; exit 0 (70.3 s) | 22 / 22; exit 0 (41.4 s) |
| the route-policy and classification readers outside those directories (15 paths, `app/api/mcp/__tests__` and `app/api/release-engineering/__tests__` included) | 21 files; 264 passed, 1 skipped; exit 0 | 21 files; 264 passed, 1 skipped; exit 0 |
| `b21-closeout-statements` + `b22-closeout-statements` over this page | - | 2 files; 19 / 19; exit 0 (re-run on this page) |
| tsc (`--noEmit -p tsconfig.json`) | - | exit 0, no output |
| eslint on the 20 changed or added `.ts` files | - | exit 0, no output |
| generators: tool registry, action toolability, B16.0.1, B16.0.2, B20 parity, B20 manifest, B20 server registry, B21 | - | all exit 0; only the B16.0.2 classification CSV changed (its two new last columns); registry digest `eng1-e0641e224aa61a63` unchanged |

No run printed `Timeout calling "onTaskUpdate"`; `b20-b4-process-gate` and `b14-4-ast-import-gates` exited 0.

[B23-A2 lead, 2026-10-02] After the independent check's four fixes (section 16), through the lock one at a time:
`app/lib/manufacturing-providers/__tests__` + `app/lib/acquisition/__tests__` 20 files passed, 1 skipped; 350 passed, 2 skipped; exit 0.
`app/lib/mcp` (whole) 45 files; 825 / 825; exit 0. `app/lib/engineering/__tests__` 99 files; 1107 / 1107; exit 0. `app/lib/agent/__tests__`
36 files; 415 / 415; exit 0. tsc exit 0, no output; eslint on the five changed `.ts` files exit 0, no output; the B16.0.2 generator
exit 0 with zero drift (all 1395 artifact files byte-identical, the classification CSV's SHA-256 unchanged). The B21 and B22 closeout
statements and `b21-f-page` over this page: section 16.

## 14. Citations

As of this increment's working tree on `79fa18b`; the anchor text is the check, the line is for the reader.

| # | file | line | anchor |
|---|---|---|---|
| C1 | `app/lib/engineering/permission-tiers.ts` | 36 | `export const TIER3_FAMILY_PATTERN = ` |
| C2 | `app/lib/engineering/permission-tiers.ts` | 52 | `if (TIER3_FLOOR_PATTERN.test(descriptor.toolId)` |
| C3 | `app/lib/engineering/permission-tiers.ts` | 57 | `if (TIER3_FLOOR_PATTERN.test(record.id)` |
| C4 | `app/lib/engineering/permission-tiers.ts` | 156 | `export const EXTERNAL_TRANSFER_SIDE_EFFECT` |
| C5 | `app/lib/engineering/permission-tiers.ts` | 161 | `export const TIER3_B23_STEMS = ` |
| C6 | `app/lib/engineering/permission-tiers.ts` | 169 | `export const TIER3_FLOOR_PATTERN = ` |
| C7 | `app/lib/engineering/tool-registry.ts` | 54 | `"session-state", "external-transfer"] as const;` |
| C8 | `app/lib/engineering/tool-registry.ts` | 504 | `function externalTransferIssues(descriptor: ToolDescriptor): string[] {` |
| C9 | `app/lib/engineering/action-registry.ts` | 67 | `sideEffects?: ActionSideEffect;` |
| C10 | `app/lib/engineering/action-registry.ts` | 450 | `export const ACTION_SIDE_EFFECTS = ` |
| C11 | `app/lib/engineering/agent-exposure.ts` | 26 | `if (descriptor.sideEffects === "external-transfer") return false;` |
| C12 | `app/lib/engineering/mcp-exposure.ts` | 130 | `sideEffects: facts.sideEffects as ToolDescriptor["sideEffects"]` |
| C13 | `app/lib/mcp/server/tool-definitions.ts` | 284 | `sideEffects: facts.candidate.sideEffects` |
| C14 | `app/lib/agent/orchestration/scheduler.ts` | 183 | `filter((authority) => !isWithdrawnAuthority(authority))` |
| C15 | `app/lib/agent/orchestration/scheduler.ts` | 220 | `filter((authority) => !isWithdrawnAuthority(authority))` |
| C16 | `app/lib/agent/orchestration/scheduler.ts` | 853 | `export function isWithdrawnAuthority(authority: string): boolean {` |
| C17 | `app/lib/agent/orchestration/role-tools.ts` | 121 | `TIER3_FLOOR_PATTERN.test(toolId)` |
| C18 | `app/lib/agent/orchestration/role-tools.ts` | 130 | `descriptor.sideEffects === "external-transfer"` |
| C19 | `app/lib/mcp/server-registry.ts` | 564 | `if (names.some((name) => isTier3McpToolName(name))) at("agent-tools", MCP_TIER3_TOOL_NAME_REFUSAL);` |
| C20 | `app/lib/mcp/server-registry.ts` | 654 | `export const MCP_TIER3_TOOL_NAME_REFUSAL = ` |
| C21 | `app/lib/auth/route-policy.ts` | 358 | `export interface RoutePolicy {` |
| C22 | `app/lib/auth/route-policy.ts` | 375 | `export function routeVocabularyViolations(` |
| C23 | `app/lib/auth/route-resource-classification.ts` | 112 | `export const OUTBOUND_EGRESS = ` |
| C24 | `app/lib/auth/route-resource-classification.ts` | 236 | `export function outboundEgressViolations(` |
| C25 | `app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts` | 128 | `/^app\/lib\/net\/outbound-fetch\.ts$/` |
| C26 | `app/lib/release-engineering/governance.ts` | 9 | `export function placePurchaseOrder(): never {` |
| C27 | `app/lib/release-engineering/agent-tools.ts` | 8 | `export function writeManufacturingBytesFromLlm(): never {` |
| C28 | `app/lib/engineering/permission-tiers.ts` | 165 | `export const TIER3_B23_WORDS = ` |
| C29 | `app/lib/engineering/tool-discovery.ts` | 179 | `descriptor.sideEffects === "external-transfer")) { // [B23-A2 review]` |
| C30 | `app/lib/mcp/server-registry.ts` | 660 | `export const MCP_TIER3_NAME_WORDS = ` |
| C31 | `app/lib/mcp/server-registry.ts` | 665 | `export function isTier3McpToolName(name: string): boolean {` |
| C32 | `app/lib/mcp/agent-port.ts` | 223 | `if (isTier3McpToolName(name)) { names.clear(); return names; }` |
| C33 | `app/lib/auth/route-resource-classification.ts` | 128 | `const MODEL_EGRESS_PATHS: ReadonlySet<string> = new Set([` |
| C34 | `app/lib/auth/route-resource-classification.ts` | 137 | `export const PUBLIC_MODEL_EGRESS: ` |
| C35 | `app/lib/auth/route-resource-classification.ts` | 199 | `modelEgress: MODEL_EGRESS_PATHS.has(policy.path),` |
| C36 | `app/lib/engineering/tool-invocation.ts` | 304 | `if (descriptor.sideEffects !== "none" && descriptor.sideEffects !== "derived-cache") {` |
| C37 | `app/lib/mcp/provider-connector-policy.ts` | 156 | `approved.some(usableAgentToolName) && !approved.some((name) => usableAgentToolName(name) && isTier3McpToolName(name))` |
| C38 | `app/lib/mcp/provider-connector-policy.ts` | 170 | `function usableAgentToolName(name: unknown): name is string {` |

## 15. The adversarial review of the first A2 tree, and what it changed

An adversarial review CONFIRMED twelve findings against the first A2 tree ([B23-A2 lead, 2026-10-03]: the twelve ids of the table
below; this sentence first said eleven); each was fixed test-first through the shared lock, and every
gate of section 13 was re-run on the result. CONFIRMED unless marked.

| finding(s) | what was wrong | reproduced (red) | fix | after |
|---|---|---|---|---|
| regressions-1, security-2, coverage-1, tests-5 | `outboundEgress: none` was documented as "the route sends nothing", but 22 routes that send a prompt or an embedding input to OpenAI or Anthropic through the SDKs' own transports carried it, the public `/api/parts/search` among them, and the public gate passed it | `a2fix-red-1`, `-2`: case 3 (no `model_egress` column), case 4 (165 rows with no `modelEgress`; the binding-level derivation marks 23 paths), case 8 (the reached transports were unreviewed; `/api/schematic/edit` not model egress) | the `none` doc narrowed to the boundary; the derived `modelEgress` column; the reviewed `PUBLIC_MODEL_EGRESS` (two paths: the derivation found `/api/pcb/footprints/search` too); the transport census; OD-182 (a), (k) | cases 3, 4, 8 green |
| security-4, coverage-3, tests-4 | the structural no-order check read only top-level exported names: a class method, an object property, a module-private port behind a neutral export or an anonymous default export passed | `a2fix-red-1`: case 3b "a class method: expected [] to include '/api/b23-probe: placeOrder ...'" with A2's scanner | every declared or called name is scanned; five new reviewed look-alikes; the neutral-name limit stated | cases 2-4, 3b green |
| security-5 | the floor lacked `pay` (which the no-order check counts) and every data-leaving word; the refusal claimed no acting tool is ever approved | `a2fix-red-3`: case 5 (floor source without `pay`), case 8 (the sentence); with the validator reverted, `payInvoice: expected [] to deeply equal ['agent-tools']` (`a2fix-mut-C`) | the word-bounded `pay` in the id floor (census: no id moves); `isTier3McpToolName` with the money and data-leaving words; the sentence claims no completeness | cases 5, 8 green |
| coverage-2 | the agent port's allowlist still approved `create-order`, against B20-A4L's re-check contract | `a2fix-red-1`, `-3`: case 9 "create-order: expected Set{ 'create-order' } to deeply equal Set{}" | `mcpAgentToolAllowlist` approves nothing for a list naming a floor tool; B20-A4 case 14's fixture moved to `update-record` (section 9) | case 9 and the `app/lib/mcp` gate green |
| tests-1 | case 3 invoked version `1.0.0` (not_registered before any rule) and sealed `{ moves: [] }` (invalid_input), so it could not fail; case 2's discovery loop held by exposure alone | `a2fix-red-1`, `-3`: the strengthened cases 2 and 3 failed (a double's exposed transfer listed for the agent; refused only later, `not_callable`); `a2fix-mut-A`: with the seal's tier check deleted, "expected { ok: true, ... } to match object { ok: false, status: 'tier_exceeded' }"; `a2fix-mut-B`: without the side-effect clause in the tool tier, cases 1-4 failed; `a2fix-mut-C`: without the discovery rule, cases 2-3 failed | the registry doubles with controls; the discovery rule (`tool-discovery.ts:179`, OD-182 (i)) | cases 2, 3 green; every mutated file restored byte for byte and checked by SHA-256 |
| tests-3 | the cache-only exemption bridged both gateway modules, so a live call added inside them kept five routes at `none` | `a2fix-red-1`: case 6 "BUILDER_EDGES:...: expected [] to include 'BUILDER_EDGES:app/lib/bom/build.ts,app/lib/distributors/index.ts'" with A2's exemption | `gatewayViolations`: the gateway's own edges, imported names and one pricing call pinned; four new tripwires | cases 5, 6 green |
| tests-8 | the CD-12 "no production caller" scan walked app/, lib/, components/ and scripts/ only | `a2fix-mut-A`: a `placePurchaseOrder()` call added to `proxy.ts` left the pre-review suite green (9 / 9) and failed the new case 3 ("placePurchaseOrder: expected [ 'proxy.ts' ] to deeply equal []") | the import gates' whole-root walk; an in-memory `proxy.ts` probe | case 3 green; `proxy.ts` restored by hash |

The red and mutation logs are `a2fix-red-1.log`, `a2fix-red-2.log`, `a2fix-red-3.log`, `a2fix-mut-A.log`, `a2fix-mut-B.log` and
`a2fix-mut-C.log` in the increment's scratch log directory; the green run is `a2fix-green-2.log` (32 / 32).

## 16. The independent check of the review fixes, and what it changed

[B23-A2 lead, 2026-10-02] An independent check of section 15's fixes raised four low issues. None was an admission (the connector verdict
still refused the row; the other three were test strength). Each was reproduced first - a red run on the unchanged code, or, for the
test-strength issue, a source mutation the old case let through - then fixed, and the gates re-run (section 13). No test case was added
or removed: the four A2 suites stay 32 cases, B20-A4 18 and B20-A5 10. CONFIRMED unless marked.

| issue | what was wrong | reproduced | fix | after |
|---|---|---|---|---|
| connector policy vs the port (`provider-connector-policy.ts`) | the policy's private copy of the `agentTools` rule counted any pattern-valid name, so a list naming a floor tool approved nothing in the port yet drew no `no_agent_tools`; B20-A5's parity shapes held no floor name | `a2low2-02-red`: the parity case listed four disagreements, each "the port allows false, the policy says no_agent_tools false" (a floor name first, a floor name last, a money word beside a read, only floor names) | the policy applies the registry's `isTier3McpToolName` to every name the port reads (`:156`, helper `:170`); five shapes appended to the parity list (section 5) | parity green; the policy's one runtime import is unchanged (B20-A5 T4) |
| the no-order scan (`b23-a-no-order-structural`) | `declaredNames` returned at every import declaration, named a variable only when its name is an identifier, and recorded a call only when its chain had more than one part, so an order function imported by name from a package and called directly, or destructured from a client, was invisible | `a2low2-02-red`: case 3b "every vendor-client shape is a port", all nine new probes missed, each "... not in []" | import bindings, destructured bindings, single-part calls, string keys and constructions are names too (section 7) | case 3b green; case 2 still finds no port reached by a route; case 4's seven look-alikes unchanged |
| the transport census (`b23-a-route-vocabulary` case 8) | the census compared reached modules with the reviewed list, so a new connection added to an already-reviewed module passed | `a2low2-02-red`: case 8 "every injected connection fails the review", the six injections each "found []" (the two controls passed) | each reviewed module pins its primitive list and its connection sites; a no-connection module holds none (section 6) | case 8 green |
| B20-A4 case 17 masked by the floor | its 33-name list put `create-order` first, so a truncate-to-32 mutation of `mcpAgentToolAllowlist` still yielded an empty allowlist | `a2low2-01`: with that mutation, B20-A4 passed 18 / 18 (case 17 included) and only B20-A5's "33 names" shape failed; `a2low2-03`: the same mutation with case 17 moved failed it, "the whole list is void, never its first 32 names: expected Set{ 'update-record', 't00', ...(30) } to deeply equal Set{}" | the writing tool is `update-record`, in place with dated notes; the case pins that no name of its list is a floor name (sections 5, 9) | B20-A4 18 / 18 on the unmutated port; `agent-port.ts` restored after each mutation run and checked by SHA-256 |

**A residual of the same class, recorded and not changed.** B20-A4 case 18's array-like shape (`{ 0: "create-order", 1: "lookup", length: 2 }`)
also puts the floor name first. With the port mutated to coerce an array-like list through `Array.from`, B20-A4 still passed 18 / 18, and
B20-A5's parity shape "an array-like object" (`{ 0: "search", length: 1 }`) caught it ("the port allows true, the policy says
no_agent_tools true"; `a2low2-05-obs-mut-arraylike`; `agent-port.ts` restored and checked by SHA-256). Coverage is not lost overall, but
case 18's array-like line no longer proves its own claim; moving it to a name outside the floor is the lead's call. RECORDED

[B23-A2 lead, 2026-10-02] Done: case 18's array-like shape now names `update-record` (in place, dated note). Under the same
`Array.from` coercion of `mcpAgentToolAllowlist` the suite passed 18 of 18 before the change and fails 1 of 18 after it; without
the mutation it passes 18 of 18; `agent-port.ts` restored by SHA-256. CONFIRMED

The runs, in order, are `a2low2-00-before` (the readers of every edited file on the unchanged tree: 14 files; 167 / 167; exit 0),
`a2low2-01-mut-truncate-orig-tests` (exit 1), `a2low2-02-red` (3 failed / 39 passed of 42; exit 1), `a2low2-03-mut-truncate-moved-case17`
(1 failed / 17 passed; exit 1), `a2low2-04-green-1` (42 / 42; exit 0), `a2low2-05-obs-mut-arraylike` (exit 1, as expected) and the gates
`a2low2-10` to `a2low2-13`, `a2low2-20` (tsc), `a2low2-21` (eslint), `a2low2-22` (the B16.0.2 generator) and `a2low2-30` (the B21 and B22
closeout statements and `b21-f-page` over this page: 3 files; 38 / 38; exit 0), in the increment's scratch log directory.

## 17. The B23 closeout's export record

[B23 closeout (1/2), 2026-10-05] The A2 exports no production module calls, and why each stays. The table is in
`closeout-statements.md` section 3, which `b23-closeout-statements` case 7 re-derives from the tree. RECORDED; nothing here is
retired.

- `ACTION_SIDE_EFFECTS`: the action side effect as data beside `ActionSideEffect`; its one run-time read is
  `validateActionCoverageRegistry`, which only the B01 generator and the suites call.
- `routeVocabularyViolations` and `ROUTE_VOCABULARY_VIOLATIONS`: OD-174's gate over the route table and its nine closed reasons (section
  6). The suites run it (`b23-a-route-vocabulary`, `b23-a-no-order-structural`, `b23-b-exchange-route`), as they run the route-coverage
  gates before it; no route calls a gate at run time.
- `outboundEgressViolations` and `PUBLIC_MODEL_EGRESS`: the egress columns' gate and its reviewed allow-list of public model-egress
  paths (OD-182 (a)); the allow-list is read only by the gate, which `b23-a-route-vocabulary` and `b23-b-exchange-route` run.
- `OUTBOUND_EGRESS`: the closed `outboundEgress` vocabulary as data beside `OutboundEgress`.
