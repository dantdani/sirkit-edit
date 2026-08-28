# B12 §G / R9 — approval and authority boundary

> **SUPERSESSION NOTE (B12.1).** The §F flow described below (service
> called directly with a captured state; success surfaced from the command
> result) is superseded: Apply now flows through the page's
> SchematicGestureCoordinator with adoption-gated finalization and the
> project commit interlock — see
> `../ai-control-plane-b12-1/corrected-execution-and-adoption-contract.md`.
> The authority boundary itself (nine tools, no serialized approval, R9/R10)
> is unchanged and still enforced. Preserved as historical evidence.


The single most important property of this stage:

> **The model can never approve, and no serialized claim can approve for it.**
> Mutation authority is an out-of-band human action holding a live trusted
> session — a capability that cannot be minted from a request body, a tool
> argument, or the agent runtime.

## The three surfaces and what each may hold

| Surface | Holds | Cannot obtain |
| --- | --- | --- |
| Provider-facing agent (nine tools) | read/propose classes only | the apply command; a session; the interactive channel |
| `/api/chat` route | validated request → agent run | any caller-supplied approval/authority/actor/capability |
| Interactive composition root (`page.tsx`) | a live `SchematicEditorSession` | — (this **is** the trusted root) |

## §G.1 — the provider surface stays exactly nine read/propose tools

Permanent assertions:

- Static agent exposure is **exactly nine** tools, every one read/propose;
  **apply is not among them.**
- The apply action (`schematic.edit-tier1-apply`) has `toolExposure: "none"`,
  `approvalTier: "destructive"`, `kind: "destructive"` — never read/propose.
- A **fresh provider tool declaration set** contains no apply/approval
  descriptor.
- The agent **gateway executes only read/propose classes** — a
  mutate/destructive tool id is refused at the gateway.

## §G.2 — no supported surface can construct the trusted channel

The internal `InteractiveUiChannel` / `createEditorSessionChannel` lives in
`interactive-channel.internal.ts`. A permanent import scan (aligned with the
B03.2 boundary CI scan) asserts the **only** importers are the four approved
composition-root modules:

```
app/lib/engineering/executor.ts
app/lib/engineering/editor-adapter.ts
app/lib/engineering/schematic-session.ts
app/lib/engineering/interactive-channel.internal.ts
```

Positive assertions confirm these do **NOT** import the channel:

- the approved-mutations **service itself**,
- the `/api/chat` route,
- the agent gateway,
- the agent loop,
- and the engineering **barrel does not re-export** the internal channel.

The service holding trust never *creates* it — trust is supplied as the live
`session` handle by the interactive root, and nowhere else.

## R9 — serialized client claims cannot authorize execution

Confirmed against the live `/api/chat` handler (pre-existing
`AUTHORITY_CLAIM_KEYS` + `exactObjectShape` gate), now locked with a permanent
test. Posting any of the following to the route draws a `400` **before** any run:

- **Top-level:** `approval`, `approved`, `authority`, `interactiveChannel`,
  `role`, `capabilities`, `idempotencyKey`, and the obsolete `boardState`.
- **Nested:** `editorContext` lookalikes — a `scope.approval` /
  `scope.interactiveChannel`, extra keys, wrong schema, scope inequality, or a
  non-local-working-copy shape.

No request body can carry approval, authority, an actor/role, a capability, or
the interactive channel into an execution. Approval is **not data** — it is a
human clicking Apply while holding the live session.

## §F — how the interactive root actually approves (production UI)

In [`app/page.tsx`](../../app/page.tsx):

- The `proposal_ready` agent event sets `pendingTier1RunId` and records an
  `approval-displayed` audit entry — it **displays**, it does not apply.
- **Apply** (`applyTier1Proposal`) is a distinct human gesture. It calls
  `applyApprovedTier1Proposal` with the live session and the scope pinned by
  `scope.ifCurrent` guards, then surfaces the receipt.
- **Cancel** (`cancelTier1Proposal`) records a `canceled` audit entry and
  mutates nothing; it is ignored while an apply is in flight.
- While applying, the dialog is modal-locked (`tier1ApplyBusy`): `onOpenChange`
  is guarded, both buttons are disabled, the Apply label reads "Applying…", and
  a receipt confirmation panel renders on success.

The model produces the proposal; a **different actor** — the human at the
interactive root — approves it. The two can never be the same party.
