# B20-B1 — the MCP exposure contract of Sirkit's own registry

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised),
**RECORDED** (written down without a claim), **UNKNOWN**.

B1 decides WHICH of Sirkit's own registry tools an MCP principal may ever be offered, and renders their MCP tool
definitions from the canonical registry. It serves nothing: there is no endpoint, principal or route (B2), no server-side
read (B3) and no proposal delivery (B4). MCP stays an adapter around the canonical registry and command bus (runbook B20):
the exposure subset is derived from the reviewed agent set and can only narrow it. The contract is code, not this page:
`app/lib/engineering/mcp-exposure-review.ts` (the reviewed decision), `app/lib/engineering/mcp-exposure.ts` (the structural
rule and the report) and `app/lib/mcp/server/tool-definitions.ts`, gated by
`app/lib/engineering/__tests__/b20-b1-mcp-exposure.test.ts` — 22 cases and
`app/lib/mcp/server/__tests__/b20-b1-tool-definitions.test.ts` — 20 cases (CONFIRMED, run through the heavy-job runner).
Every `file:line` below is checked against the line it quotes by the first suite, which also checks the tables and these
case counts; the tests, not the numbers, are the gate.

## 1. The 16 exposed tools — CONFIRMED

A tool is exposed only when BOTH hold: the structural rule (section 3) admits its descriptor, AND the reviewed decision
lists it — `INTENTIONAL_MCP_EXPOSED_TOOL_IDS` (`app/lib/engineering/mcp-exposure-review.ts:14` (`export const INTENTIONAL_MCP_EXPOSED_TOOL_IDS`)),
one reason comment per id — and does not withhold it (`MCP_WITHHELD_TOOL_IDS`, empty at B1). The structural rule
admits exactly these 16 from the production registry of 41 descriptors, and `mcpExposureReport` (`app/lib/engineering/mcp-exposure.ts:197` (`export function mcpExposureReport(`))
compares the two in both directions: an admitted id that is neither listed nor withheld is `unexpected` (never exposed, and
drift until reviewed), a listed id that is not exposed is `missing`, any id outside the reviewed agent set is
`outsideAgentSet`, and one id admitted under two versions is a `duplicate`; any of them makes the report not ok and the
listing refuse. They are the agent set's 11 bound reads of project or design state and its 5 inert proposals.

| id | class | tier | exposure | binding | why it is exposed |
|---|---|---|---|---|---|
| `sirkit.component-authority.inspect` | read | 0 | exposed | bound-read | server-owned component authority records; inspection only, never a binding |
| `sirkit.manufacturing.readiness-inspect` | read | 0 | exposed | bound-read | a fabrication readiness report; it never qualifies and never authorizes a release |
| `sirkit.pcb.board-inspect` | read | 0 | exposed | bound-read | the canonical board snapshot |
| `sirkit.pcb.mechanical-inspect` | read | 0 | exposed | bound-read | the board's extents and mounting holes only |
| `sirkit.pcb.propose-bounded-edit` | propose | 2 | exposed | bound-proposal | a sealed bounded PCB proposal a human approves in the PCB editor |
| `sirkit.pcb.revision-inspect` | read | 0 | exposed | bound-read | the pcb2 semantic content revision |
| `sirkit.pcb.via-inspect` | read | 0 | exposed | bound-read | one net's vias with their padstack binding |
| `sirkit.placement.propose` | propose | 2 | exposed | bound-proposal | a revision-bound layout candidate a human applies |
| `sirkit.project.canonical-revision-inspect` | read | 0 | exposed | bound-read | the canonical ProjectRevision digest set |
| `sirkit.project.history-inspect` | read | 0 | exposed | bound-read | the project operation timeline (see limit 1) |
| `sirkit.routing.propose` | propose | 2 | exposed | bound-proposal | a revision-bound routing candidate a human applies |
| `sirkit.schematic.inspect` | read | 0 | exposed | bound-read | the schematic component list, counts and digest |
| `sirkit.schematic.propose-component-replacement` | propose | 2 | exposed | bound-proposal | a sealed exact-replacement proposal; apply stays human-only |
| `sirkit.schematic.propose-tier1-edit` | propose | 2 | exposed | bound-proposal | a sealed tier-1 schematic proposal; apply stays human-only |
| `sirkit.validation.connectivity-verify` | read | 0 | exposed | bound-read | board connectivity (a validation read, not readiness by itself) |
| `sirkit.validation.drc-run` | read | 0 | exposed | bound-read | a DRC run over the canonical board (derived cache only) |

Every one is active, discoverable, callable, carries no approval tier of its own, no `executionMode` and no `grantOnly`,
and none matches `NEVER_EXPOSED_TOOL_PATTERNS` (`app/lib/engineering/granted-execution-families.ts:74` (`export const NEVER_EXPOSED_TOOL_PATTERNS`))
or the b17-f id tripwire (`process|exec|shell|database|db.|file.|replace-state|import-state`). Tiers are
`permissionTierOfDescriptor` (`app/lib/engineering/permission-tiers.ts:51` (`export function permissionTierOfDescriptor(`)):
a read with no approval tier is Tier 0, a proposal is Tier 2 by construction (an inert sealed artifact a human approves).

## 2. The 25 excluded descriptors, by closed reason — CONFIRMED

`MCP_EXCLUSION_REASONS` (`app/lib/engineering/mcp-exposure.ts:33` (`export const MCP_EXCLUSION_REASONS`)) is closed and
ordered by precedence: the first reason that applies is THE reason, so every descriptor carries exactly one. The first ten
are the structural rule; the last two are the reviewed decision over a descriptor the rule admits.

| reason | registry ids that carry it | the decision that excludes them |
|---|---|---|
| `tier3` | `sirkit.manufacturing.release` | permission Tier 3 (publish, release, upload, purchase or order, qualification) is never agent-executable (`app/lib/engineering/permission-tiers.ts:36` (`export const TIER3_FAMILY_PATTERN`)) |
| `never_exposed` | `sirkit.pcb.create-via`, `sirkit.pcb.delete-item`, `sirkit.pcb.edit-track`, `sirkit.pcb.undo-redo-canonical`, `sirkit.pcb.zone-edit` | the never-exposed patterns: never-granted canonical mutations, the canonical replay primitive, release, qualification, catalog authority |
| `not_agent_exposed` | `sirkit.parts.search`, `sirkit.pcb.repair-plan`, `sirkit.schematic.add-component` | outside the reviewed agent set; the MCP set is a subset of it |
| `granted_execution` | `sirkit.pcb.arrange`, `sirkit.pcb.dimension`, `sirkit.pcb.move-footprint`, `sirkit.pcb.rotate-side-footprint`, `sirkit.pcb.silkscreen-text`, `sirkit.pcb.undo-redo-granted` | D20-2, D20-33: a grant is minted for a cookie-session human and tendered by the browser's editor session; an MCP principal has neither, so every granted execution and every grant-only tool is excluded by type |
| `view_session` | `sirkit.selection.control`, `sirkit.view.canvas-navigation`, `sirkit.view.layers`, `sirkit.view.measure`, `sirkit.view.pcb3d`, `sirkit.view.reveal-finding` | OD-49 (D20-7): a view-session command is executed by an open editor in the user's browser, which an MCP principal does not have |
| `not_read_or_propose` | none in the registry (a forged or future mutate or destructive descriptor) | only read and propose are MCP-exposable: no mutation and no command execution over MCP (runbook B20-B) |
| `side_effects` | none in the registry (a forged or future read or proposal that declares a state-writing side effect) | a read may declare no side effect or a derived cache, a proposal a proposal artifact only — the rule the executors behind MCP apply (`app/lib/engineering/tool-invocation.ts:304` (`if (descriptor.sideEffects !== "none" && descriptor.sideEffects !== "derived-cache") {`), `gateway.ts`, `layout-proposals.ts`); the registry validator does not tie these classes to their side effects, so the MCP rule does |
| `external_read` | `sirkit.parts.evidence-read`, `sirkit.parts.external-search` | OD-55: live vendor quota, labels only while agent disclosure is unknown (OD-36, OD-40) |
| `view_state_read` | `sirkit.selection.inspect`, `sirkit.view.read-state` | OD-49 (D20-7): they read an open editor's selection or view state |
| `not_servable` | none in the registry (a forged or future descriptor) | not an active, discoverable, callable descriptor bound to a server-side read or an inert proposal with no approval tier of its own |
| `withheld` | none in the registry at B1 (`MCP_WITHHELD_TOOL_IDS` is empty) | structurally admissible, but withheld from MCP by a reviewed decision recorded with its reason (how B3 and B4 remove an id) |
| `not_mcp_reviewed` | none in the registry (a forged or future admissible descriptor under an id that is not listed) | structurally admissible, but not reviewed for MCP: never exposed, and the report calls it `unexpected` (drift) until it is listed or withheld |

`tier3` and `never_exposed` precede `not_agent_exposed`, so a descriptor outside the agent set still names the stronger
reason (`sirkit.manufacturing.release` is Tier 3 and matches `\.release$`; the page and the manifest say `tier3`).
The agent set (`app/lib/engineering/agent-exposure.ts:30` (`export const INTENTIONAL_AGENT_EXPOSED_TOOL_IDS`)) holds:
32 ids = the 16 above + 6 granted executions + 2 external reads + 6 view-session controls + 2 open-editor reads.
B3 and B4 may REMOVE an id they cannot serve safely, as a reviewed ratchet move of `app/lib/engineering/mcp-exposure-review.ts`:
the id moves from `INTENTIONAL_MCP_EXPOSED_TOOL_IDS` to `MCP_WITHHELD_TOOL_IDS`
(`app/lib/engineering/mcp-exposure-review.ts:34` (`export const MCP_WITHHELD_TOOL_IDS`)) with its reason, and the pins of
the two B1 suites and the manifest move with it. The descriptor, the registry digest and the agent path stay untouched. The
first suite performs exactly that move on `sirkit.project.history-inspect` (the modules loaded fresh with the moved lists)
and proves a clean report, a 15-tool listing that names the id `withheld`, the channel excluding it and an unchanged agent
discovery. Nothing in B20 adds an id without an owner decision.

## 3. The structural rule — CONFIRMED

`mcpExclusionReason(descriptor)` (`app/lib/engineering/mcp-exposure.ts:157` (`export function mcpExclusionReason(`)) reads
each field once into a plain snapshot (a malformed or hostile descriptor, including one whose getters throw, answers
`not_servable` and never throws), applies the structural rule `structuralReasonOf`
(`app/lib/engineering/mcp-exposure.ts:129` (`function structuralReasonOf(facts: ExposureFacts)`)) over the descriptor's own
classification, and then, for a descriptor the rule admits, the reviewed decision `reviewReasonOf`
(`app/lib/engineering/mcp-exposure.ts:145` (`function reviewReasonOf(toolId: string)`)):

1. `app/lib/engineering/mcp-exposure.ts:131` (`if (tier === 3) return "tier3";`) — permission Tier 3 by id family, class or approval tier;
2. `app/lib/engineering/mcp-exposure.ts:132` (`return "never_exposed";`) — any `NEVER_EXPOSED_TOOL_PATTERNS` match;
3. `app/lib/engineering/mcp-exposure.ts:133` (`if (!facts.agentExposed) return "not_agent_exposed";`) — the subset rule;
4. `app/lib/engineering/mcp-exposure.ts:134` (`if (facts.granted) return "granted_execution";`) — any `executionMode` or `grantOnly`;
5. `app/lib/engineering/mcp-exposure.ts:135` (`return "view_session";`) — class `view-session`;
6. `app/lib/engineering/mcp-exposure.ts:136` (`return "not_read_or_propose";`) — any class but `read` and `propose`;
7. `app/lib/engineering/mcp-exposure.ts:137` (`return "side_effects";`) — a read whose side effects are not `none` or `derived-cache`, or a proposal whose side effect is not `proposal-artifact`;
8. `app/lib/engineering/mcp-exposure.ts:138` (`return "external_read";`) — binding `bound-external-read` or the `external-observation` authority;
9. `app/lib/engineering/mcp-exposure.ts:139` (`return "view_state_read";`) — category `view` or `selection`, or any `*-surface` project state (an open editor);
10. `app/lib/engineering/mcp-exposure.ts:140` (`return "not_servable";`) — a binding other than `bound-read` / `bound-proposal`, not active, not discoverable, not callable, or an approval tier of its own;
11. `app/lib/engineering/mcp-exposure.ts:146` (`return "withheld";`) — the id is in `MCP_WITHHELD_TOOL_IDS` (checked first: an id in both lists is withheld);
12. `app/lib/engineering/mcp-exposure.ts:147` (`return "not_mcp_reviewed";`) — the id is not in `INTENTIONAL_MCP_EXPOSED_TOOL_IDS`.

The structural rule refuses a forged descriptor that is agent-exposed but granted, grant-only, view-session, external,
mutate, destructive, release, a Tier 3 family, a never-exposed id, or a read or proposal that declares a state-writing side
effect (one forged case per kind in the first suite). For a plain bound read or inert proposal, being in the agent set is
the last structural input, so the rule alone would admit a new one: the reviewed decision is what keeps it out. A
descriptor therefore never becomes MCP-exposed merely by joining the agent set: every runtime gate refuses it (the
channel excludes it as `not_mcp_exposed`, the render refuses it as `not_exposable` with the detail `not_mcp_reviewed`,
the listing refuses the whole listing as `exposure_drift`), and the report calls it `unexpected`
(`app/lib/engineering/mcp-exposure.ts:221` (`const unexpected = `)), which the first suite pins with an agent-set read made
admissible by a re-categorisation. The report proves the subset:
`app/lib/engineering/mcp-exposure.ts:222` (`const outsideAgentSet = `). Annotation-like fields (`readOnlyHint`,
`destructiveHint`, `idempotentHint`, `openWorldHint`, `annotations`, `_meta`) are never read: adding them to any registry
descriptor changes neither its exposure nor its permission tier, whose only inputs are the id, the class and the approval
tier.

## 4. The discovery channel `mcp` — CONFIRMED

`DISCOVERY_CHANNELS` gains `mcp`, appended (`app/lib/engineering/tool-discovery.ts:32` (`"api", "mcp"] as const;`)), and
the exclusion reasons gain `not_mcp_exposed`, appended. The channel is deny-by-default
(`app/lib/engineering/tool-discovery.ts:173` (`if (context.channel === "mcp" && mcpExclusionReason(descriptor) !== null) {`)):
after the lifecycle and internal-only checks, a descriptor `mcpExclusionReason` excludes (structurally or by the reviewed
decision) is dropped as `not_agent_exposed` (outside the agent set) or `not_mcp_exposed` (inside it), whatever the context
claims — a release risk ceiling, every approval, a grant context and the external-observation authority together still
yield exactly the 16, and an unreviewed admissible tool is never offered. The import carries its `[B20 B1]` tag on the line
above it (`app/lib/engineering/tool-discovery.ts:27` (`import { mcpExclusionReason } from "./mcp-exposure";`)), so the B04
import gate, which matches only an import line that ends at its semicolon, sees it (pinned by the second suite). Every later contextual rule (role,
capability, revision, lineage, editor, project state, authority, name length, budgets) applies unchanged, and internal-only
tools are never reported on the channel. The four existing channels are unchanged: their included and excluded ids,
versions and reasons under the pinned contexts byte-match pins computed at `0ae9b57`, before the channel existed, and the B04,
B10, B17-F and B18-C discovery suites pass unchanged.

## 5. How a definition is rendered — CONFIRMED

`renderMcpToolDefinition(descriptor, registryDigest)` returns a new object frozen at every depth, sharing nothing with the
registry, per the Tool contract of revision 2026-07-28 (`mcp-reference-notes.md` sections 6 and 7):

- `name`: the raw registry id, checked against `app/lib/mcp/server/tool-definitions.ts:27` (`export const MCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;`)
  before anything else (`app/lib/mcp/server/tool-definitions.ts:237` (`if (!MCP_TOOL_NAME_PATTERN.test(facts.toolId)) throw new McpToolRenderError("name_invalid");`))
  (first-party naming, the OD-52 amendment; the longest exposed id is 46 characters); `title` and `description` verbatim.
- `inputSchema`: `app/lib/mcp/server/tool-definitions.ts:246` (`const strict = strictCompatibility(`) — the SAME conversion
  the OpenAI and Anthropic adapters use (`app/lib/agent/provider-tools.ts:289` (`export function strictCompatibility(`)), so for
  every exposed tool the MCP input schema deep-equals the declaration both adapters render (C1's three-way parity starts
  true). A no-argument tool renders `{type: "object", additionalProperties: false, properties: {}, required: []}`. A
  schema outside the proven wire subset, a non-object root, a cycle, a nesting deeper than the scan bound or a key named
  `__proto__`, `constructor` or `prototype` is refused, never weakened.
- `outputSchema` (OD-56): declared only when the registry's output schema passes the wire-subset and structure checks with
  an explicit object root and no reserved key (`app/lib/mcp/server/tool-definitions.ts:153` (`function outputDecisionOf(`));
  otherwise omitted, and the manifest records `omitted (<closed reason>)`. It is the registry's declared schema, copied —
  not strict-normalized, because strict normalization turns optional fields into required nullable ones, which a
  conforming output that omits the field would then violate. At B1 all 16 exposed tools declare it.
- `annotations`, derived only from Sirkit's classification: `readOnlyHint` = class `read`
  (`app/lib/mcp/server/tool-definitions.ts:250` (`readOnlyHint: facts.operationClass === "read",`)), which the rule admits
  only with no side effect or a derived cache; `destructiveHint` = false (nothing destructive passes the rule);
  `idempotentHint` = the registry idempotency is `natural`, false for `required-key`, `not-applicable` or anything else
  (`app/lib/mcp/server/tool-definitions.ts:252` (`idempotentHint: facts.idempotency === "natural",`)); `openWorldHint` =
  false (the external reads are excluded). Fields on the descriptor that look like annotations are ignored.
- `_meta` under Sirkit's own prefix (OD-60, `app/lib/mcp/server/tool-definitions.ts:30` (`export const MCP_META_PREFIX = "dev.sirkit/"`)),
  whose second label is neither `modelcontextprotocol` nor `mcp` (the reserved ones): `dev.sirkit/toolId`,
  `dev.sirkit/toolVersion`, `dev.sirkit/registryDigest`, `dev.sirkit/operationClass`, `dev.sirkit/permissionTier`.

The one thing these functions throw is `McpToolRenderError`
(`app/lib/mcp/server/tool-definitions.ts:54` (`export class McpToolRenderError extends Error {`)) with a closed code —
`exposure_drift`, `not_exposable`, `descriptor_invalid`, `name_invalid`, `reserved_key`, `input_schema_not_strict`,
`registry_digest_invalid` — and a `toolId` only when that id passes the MCP name rule: the constructor itself drops any
other value (`app/lib/mcp/server/tool-definitions.ts:60` (`const named = typeof toolId === "string" && MCP_TOOL_NAME_PATTERN.test(toolId) ? toolId : null;`)),
so a refused name is never echoed, whatever a call site hands it. Any other error inside the render, the listing or the
manifest (a throwing getter, a schema whose key listing throws, a registry whose `digest()` throws) becomes
`descriptor_invalid`; a registry whose `list()` throws is `exposure_drift` (the report reads it as empty).

## 6. The listing and its identity (D20-14, order and identity half) — CONFIRMED

`renderMcpToolListing(registry)` (`app/lib/mcp/server/tool-definitions.ts:295` (`export function renderMcpToolListing(`))
returns `{tools, listingDigest, registryDigest, excluded}`. It refuses the whole listing when the report is not ok
(`app/lib/mcp/server/tool-definitions.ts:298` (`if (!report.ok) throw new McpToolRenderError("exposure_drift"`)),
when any exposed descriptor cannot be rendered, or when what it rendered differs from what the report checked (a registry
whose second read answers differently: `app/lib/mcp/server/tool-definitions.ts:303` (`if (tools.length !== report.count`))
— never a partial list. Tools are sorted by name in code-point order
(`app/lib/mcp/server/tool-definitions.ts:301` (`tools.sort((a, b) => byCodePoint(a.name, b.name));`)); `excluded` lists
every other descriptor once with its closed reason, sorted by id. The listing digest is the repository's digest helper over
the schema, the registry digest and the rendered tools
(`app/lib/mcp/server/tool-definitions.ts:307` (`const listingDigest = engineeringDigest({ schema: MCP_TOOL_LISTING_SCHEMA, registryDigest, tools });`)),
where the registry digest is `ToolRegistry.digest()` (`app/lib/engineering/tool-registry.ts:391` (`digest(): string {`)). It
is stable under the registry's input order, and changes when any rendered definition changes or the registry digest alone
changes (so any registry change, even to an excluded descriptor's text, moves it: the registry version is bound in).

The manifest is `mcp-tool-manifest.csv` (one row per registry descriptor: `tool_id`, `version`, `operation_class`,
`permission_tier`, `binding`, `exposed`, `exclusion_reason`, `read_only_hint`, `idempotent_hint`, `output_schema`) and
`mcp-tool-manifest.json` (the rendered listing as canonical JSON, carrying both digests), written by
`scripts/generate-b20-mcp-tool-manifest.ts` and byte-gated by the second suite.

## 7. What B1 does NOT do — RECORDED

- No endpoint, principal, route, policy row or ratchet move: B2 (`POST /api/mcp`, the bearer principal, OD-43/OD-44/OD-54).
  The route census stays 162 = 159 canonical + 3 factories + 0 raw.
- No tools/call and no server-side read: B3 (a durable resource bundle, the expected revision, membership revision and
  idempotency binding, D20-6/9/10). No `-32602` unknown-tool answer exists yet; it is B3's for every excluded id.
- No proposal delivery: B4 (OD-50).
- No pagination, `ttlMs` or `cacheScope` (the C2 half of D20-14, OD-57); no three-way parity report, no title/description
  lexical gate (C1, C3).
- Nothing on the client side (A2..A5), and no new dependency (OD-42).

## 8. Stated limits — RECORDED / INFERRED

1. **INFERRED** — `sirkit.project.history-inspect` is bound to the captured browser timeline snapshot
   (`app/lib/agent/view-context.ts` `inspectProjectTimeline`; its description says "in this session"). It is in the subset by
   decision because it reads project history, not an editor's view; B3 must serve it from durable history or withhold it (the
   list move of section 2).
2. **INFERRED** — every exposed read and proposal is bound today to a bundle the browser assembles (`local-working-copy`
   authority, D20-6); the listing states what may be offered, not what B2 can already serve.
3. **RECORDED** — the declared output schemas are the registry's own, which are shallow (`report: {type: "object"}` and
   similar): an MCP client can check the top level of `structuredContent`, not its contents. Tightening them is C1's.
4. **RECORDED** — `idempotentHint` follows the registry's `natural` idempotency, so the five proposals render it true: a
   repeated call has no additional effect on project state (the result is inert), though a routing or placement candidate
   need not be byte-identical between calls.
5. **RECORDED** — the listing's `excluded` array and the discovery channel's exclusion list are diagnostics for Sirkit; B2
   must serve `tools` only, never `excluded`.
6. **RECORDED** — the b10 test title "… no MCP surface exists" (`app/lib/agent/__tests__/b10-editor-context.test.ts`) stays
   true after B1 (nothing is served); B2 re-words it in the increment that adds the surface (D20-30).
