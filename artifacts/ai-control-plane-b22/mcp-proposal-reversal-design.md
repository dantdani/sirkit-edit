# The reserved MCP proposal-reversal design (OD-83..86, OD-88): a verbatim copy, RECORDED only

Labels: **RECORDED** (copied from a record, without a claim of our own).

**Provenance.** Copied by the B22 lead from the B20-B4 task scratchpad (`scratchpad/b20/task-B4.md`, lines 786-923: its section 8,
"Owner decisions") on 2026-10-01, and placed in the repository by B22-B at the lead's instruction. It was never committed before
(discovery D22-22; section 9.5 item 12): a temporary scratchpad is not durable. B22-B compared the text below the rule with those
lines byte for byte (identical, the source's final blank line included) and scanned it for secret-shaped text (none).

**Status.** A RECORDED design only. The MCP proposal reversal is **NOT performed** in B22: MCP stays read-only (OD-82 as recorded
in `OWNER_DECISIONS.md`), `sirkit.placement.propose` and `sirkit.routing.propose` stay in `MCP_WITHHELD_TOOL_IDS`, and the reserved
rows OD-83, OD-84, OD-85, OD-86 and OD-88 stay reserved and unspent. The text below is the B20-B4 task's proposal as it stood
before B20-B4 withheld every proposal (OD-82, OD-87 as recorded differ from it: they withheld all five). What B22-B now provides
toward it - the bounded engine host - is recorded in `named-computations.md` section 7.

---

## 8. Owner decisions (the lead records them; renumber if taken)

### OD-50 — Inert proposal delivery over MCP (recorded now, B20-B4; departs from the discovery default at `discovery.md:281`)

**Facts.** The sealed layout candidate embeds the whole board: the problem and the board's constraint history, including other members' actor ids, waiver reasons and authorizations. No MCP read or native model surface exposes these, and the whole candidate may exceed the result bound on a real board.

**Default applied.**
- The server compiles and seals the candidate as the agent does, then returns a bounded, sanitized projection `sirkit.mcp-placement-proposal.v1` as `structuredContent` `{result}`: its identity, base, scope, legality, run summary, per-footprint transforms, hard counts, objective report and a fixed data note.
- The projection carries its own sha256 digest (`dev.sirkit/projectionDigest`). The sealed candidate's digest is named as identity only.
- A text block carries the agent's bounded summary plus the note.
- There is no durable store in B20.

**The owner may choose otherwise:**
- return the raw sealed artifact;
- a durable inert-proposal record;
- text-only results.

### OD-82 — Which proposals Sirkit serves over MCP (B20-B4, 2026-09-21)

**Default applied.** One proposal is served: `sirkit.placement.propose`.
- Every input it needs has a durable server source: the durable board, the project id and its own bounded arguments.
- It is authorized, validated and compiled by the same shared rules and producer the agent's `LayoutProposalService` uses.

Four proposals move to `MCP_WITHHELD_TOOL_IDS`, each with its reason:
- the two schematic proposals need the editor's `SchematicState` and head mark, which are browser-only;
- `sirkit.pcb.propose-bounded-edit` seals the open editor's history head, lineage and DRC preset, which apply re-verifies against the live editor;
- `sirkit.routing.propose` runs the FreeRouting child process.

The subset becomes 10 tools: 9 reads and 1 proposal. The agent set is unchanged. Restoring an id needs an owner decision.

**The owner may choose otherwise:**
- withhold placement too (MCP read-only);
- synchronize the PCB proposal basis durably and restore the bounded edit;
- a sandboxed routing worker;
- a durable `SchematicState` store.

### OD-83 — The placement proposal's registry entry (B20-B4)

**Default applied.**
- `sirkit.placement.propose` declares `["local-working-copy", "durable-server-board"]`.
- Its description becomes channel-neutral: it no longer claims the candidate appears in the user's placement panel, because over MCP it does not. The exact text is in the page.
- No version bump: the input and output schemas are unchanged. `versionNotes` is appended.
- Agent discovery is unchanged (authority is any-of). The only agent-visible change is that description.
- The registry digest moves, and every derived artifact is regenerated in the same commit.

**The owner may choose otherwise:**
- a minor version bump;
- an MCP-only description rendered from a closed table (this breaks registry-to-MCP description parity, runbook `:746`, `:750`).

### OD-84 — What an MCP token must carry to create a proposal (B20-B4)

**Facts.** Natively, a proposal needs a role in `requiredRoles` and `read_project`. The agent actor holds only `read_project`. B2's MCP principal is an `ai` actor with the live role and `read_project`.

**Default applied.** A proposal needs an explicit propose delegation: the scope `sirkit.mcp.propose` beside `sirkit.mcp`.
- **Minting.** POST `/api/mcp/token` with exactly `{"scope": "sirkit.mcp sirkit.mcp.propose"}` mints it only for a member whose live role is in the union of the served proposals' `requiredRoles`, derived from the registry (pcb_editor and project_admin at B4). Any other member gets 403 `MCP_TOKEN_SCOPE_REFUSED`. `{}` still mints a read-only token.
- **The token is otherwise unchanged:** eleven claims, one hour, the audience, and the membership revision pinned on every call.
- **The actor stays delegated `read_project` only.** The scope narrows the credential; it never widens authority.
- **Every call checks** the live membership, the scope, and the native role and capability order.
- **tools/list** shows a proposal only to a propose-scoped token whose role permits it. A read-only token that calls one gets B2's identical `-32602`, unless the live specification makes the 403 `insufficient_scope` challenge mandatory; then that challenge is applied and recorded.
- **The protected-resource metadata** lists both scopes.

**The owner may choose otherwise:**
- no separate scope;
- the 403 `insufficient_scope` step-up always;
- a shorter lifetime for propose tokens;
- project_admin only.

### OD-85 — Whether an MCP proposal reaches a Sirkit reviewer (B20-B4; closes D20-8)

**Default applied.**
- **Returned only.** An MCP placement candidate is returned to the MCP client only (OD-50). It is not persisted, not placed in the PCB editor's panel, and cannot be applied in Sirkit.
- **Why.** The only review surfaces are the page's run-stream handlers, and an MCP call has none. The returned projection has its own schema, so the page's candidate receiver refuses it by construction.
- **The label.** The server-side candidate keeps the producer label `agent` because it is the same producer and compile path, and its digest equals the agent's for the same board and arguments. The MCP origin is stated in the projection, in `_meta` and in the trace.
- **Still read-only.** `/api/mcp` stays classified durable `read`. No grant is minted, and nothing is applied, executed or released; the import gates pin this.

**The owner may choose otherwise:**
- a durable inert-proposal inbox the PCB editor lists for review. That needs a durable write, route reclassification, a retention decision and an editor intake UI (its own increment);
- a distinct `mcp` producer label.

### OD-86 — Revision binding, replay and cancellation of MCP proposals (B20-B4)

**Default applied.**
- **Pin.** Every call pins `_meta dev.sirkit/expectedRevision`, the durable board's `eng1-` revision, with no exemption. The refusals are `revision_required` and `stale_revision` (with the current revision).
- **Re-verification.** The board is re-verified after the compile (board id, `pcb2-`, `pb1-`), and the membership is re-read. The candidate's base is the `pcb2-` revision of exactly that board.
- **Replay.** An optional `dev.sirkit/idempotencyKey` replays through a separate per-process cache:
  - TTL 10 minutes;
  - 4 entries per principal, 32 in total;
  - 1 048 576 characters per entry, 8 388 608 in total;
  - 1 in-flight key per principal;
  - successes only.

  There is no durable commit key, because no durable proposal record exists.
- **Cancellation.** The engine takes no AbortSignal. Its cancellation hook is polled only between candidate specs, and it is passed an abort-or-budget check. A result that finishes after an abort or after the budget is discarded: never rendered, stored, replayed or traced as success.
- **Admission.** A slot is held until every durable query the call started has settled, for at most 60 s after the answer.
- **A recorded limit on reads.** A read replayed under the other delegation's token carries the listing digest it was first served under.

**The owner may choose otherwise:**
- an unpinned call (a departure from runbook `:735`);
- a durable replay record;
- a worker-thread engine that honours a signal.

### OD-87 — Bounds and admission of MCP proposals (B20-B4)

**Default applied.**
- **Engine budget:** `min(15 s, descriptor, remaining)`, at least 1 s. **Deadlines:** 30 s total; 5 s per durable and membership stage.
- **Concurrency:** 1 proposal in flight per principal and 1 per process (`busy`).
- **Attempts:** 12 admitted attempts per principal per 10 minutes.
- **Runs:** 4 per principal and 8 per process per 10 minutes (`rate_limited`).
- **Board, judged before the engine:** at most 500 footprints, footprint ids of at most 256 characters, and a board of at most 4 000 000 serialized characters (`board_too_large`). These caps and the `maxIterations` cap are confirmed or lowered by a recorded timing probe, so the synchronous section at the caps stays at most 20 s.
- **Arguments:** `instanceIds` must match `ID_PATTERN`.
- **Output:**
  - projection strings of at most 256 characters, the projection at most 262 144 characters;
  - text at most 60 000 characters;
  - the whole result at most 1 000 000 characters;
  - everything sanitized.
- **Refusals:** a closed code with a fixed sentence.
- **Limits:**
  - The engine runs on the event loop.
  - The process run window is one budget shared by every tenant on the process, so two permitted principals can use it up for 10 minutes. A per-tenant cap would multiply the event-loop stall that bound exists to limit.
  - Every cap is per process.

**The owner may choose otherwise:** a worker-thread engine host; per-tenant quotas or fair queueing; other caps and windows; withholding placement.

### OD-88 — The MCP proposal trace (B20-B4)

**Default applied.**
- **Schema:** one `sirkit.mcp-proposal-trace.v1` record per call, in a per-process ring of 1 000, with a sink seam.
- **What it records:**
  - the principal with its delegation; the bindings; the durable board identity; the post-checks;
  - admission, the attempt and run windows, and the key's digest;
  - the engine's budget, termination and stop reason;
  - the proposal's identity (candidate id and digest, projection digest, base revision, legality, scope size, expiry);
  - the delivery, and a closed outcome.
- **What it never records:** content, arguments, keys or the token.
- **What else changes:** B2's request trace gains `proposal_served` and `proposal_refused`. B3's read trace, `AgentTraceIdentity`, the B05 trace and the B11 files are unchanged.

**The owner may choose otherwise:** one generalized call-trace schema for reads and proposals.

