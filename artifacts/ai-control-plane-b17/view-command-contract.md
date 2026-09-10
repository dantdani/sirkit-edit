# B17-B — View-session command contract (`sirkit.view-command.v1`)

Labels: CONFIRMED = executed and measured on this machine; INFERRED = derived from code reading; PROPOSED = designed, not exercised; RECORDED = written down without a claim.

## Envelope (CONFIRMED — `app/lib/view-session/types.ts`)

```ts
interface ViewCommandEnvelope {
  schemaVersion: "sirkit.view-command.v1";
  commandId: string;            // e.g. "pcb3d.camera-preset"
  invocationId: string;         // single settlement key — unique per issue; a caller reuses one ONLY to retry/replay the same invocation
  sessionId: string;            // the browser tab's view session (never persisted)
  projectId: string; branchId: string;
  editor: "schematic" | "pcb" | "pcb3d";
  expectedViewRevision: number; // what the issuer observed
  actor: { actorId: string; role: ProjectRole; actorKind: "human" | "agent" };  // a label, never authority
  payload: unknown;
  issuedAt: string; expiresAt: string;
}
```

The UI, keyboard shortcuts and agent tools build the SAME envelope (`createViewCommand`) and dispatch it to the SAME bus (`ViewSessionBus.dispatch`). The result is `settled` (with the resulting view state, the new view revision, `rebased`, `changed`), `refused` (a bounded code + message + the current revision) or `cancelled`.

## Requirements and how each is met (CONFIRMED by `app/lib/view-session/__tests__/b17-b-view-session-bus.test.ts`, 12 cases)

| requirement | mechanism | proof |
|---|---|---|
| view state is never confused with engineering authority | the bus owns a VIEW state only; descriptors are pure view transitions; the bus has no history/undo member and accepts none; nothing it settles touches a schematic, board, binding, plan or release | "never creates an engineering undo entry" |
| commands are scoped to the current browser/editor session and project | `VS_SESSION_MISMATCH`, `VS_PROJECT_MISMATCH` (project or branch), `VS_EDITOR_MISMATCH`; a bus is built for exactly one identity | "scopes commands…" |
| stale view revisions refuse or rebase by a documented deterministic rule | per command `staleness`: `refuse` for commands whose meaning depends on what was seen (relative zoom/pan, add-to-selection, toggle-without-target) → `VS_STALE_REVISION` naming the current revision; `rebase` for idempotent commands (fit, preset, focus, set-visible, open/close) → applied on the current state, result says `rebased: true` | "stale revisions…" |
| project switch, logout and tab disposal retire the session | `retire(reason)` aborts in-flight work (settles `cancelled`) and refuses everything after with `VS_SESSION_RETIRED (<reason>)`; reasons: `project-switch`, `logout`, `tab-disposed`, `editor-closed` | "retires with the session…" |
| commands settle once, are cancelable and return the resulting view state | a replayed `invocationId` returns the SAME settled result without executing again (bounded retention 256); an in-flight duplicate shares the settlement; `cancel(invocationId)` aborts the handler's signal and settles `cancelled` with no state change; every settled result carries `state` and `viewRevision`. [B17-D] `createViewCommand` mints a UNIQUE default id per call (issue counter + digest): the earlier content-derived id replayed an old settled `pcb.observe` when the renderer returned to an earlier camera under the frozen fixture clock — replay is for a deliberately reused id, never for equal content | "settles every invocation exactly once", "is cancellable" |
| durable persistence is limited to explicit workspace preferences | only descriptors declaring `persist: { scope: "workspace-preference", keys, project }` write, and only their projected keys; everything else lives in memory; preferences load once at construction | "persists ONLY explicit workspace preferences" |
| no engineering undo entry for visual-only actions | the view revision is the only counter; it moves only when the view actually changed (structural comparison) | "never creates an engineering undo entry", "stale revisions… changed: false" |
| trace records redact private project content while retaining command evidence | `ViewCommandTrace` carries ids, editor, actor kind/role, expected/resulting revisions, status/refusal code, `rebased`, a canonical payload DIGEST and the payload's top-level keys — never the payload content | "trace records keep command evidence… and redact private content" |

Further bounded refusals: `VS_SCHEMA_UNSUPPORTED`, `VS_ENVELOPE_INVALID` (fields, actor shape, revision, time window), `VS_COMMAND_UNKNOWN`, `VS_EXPIRED`, `VS_PAYLOAD_INVALID` (exact per-command validation), `VS_ROLE_FORBIDDEN` (per-command role list), `VS_UNAVAILABLE` (a handler's bounded "model/geometry unavailable"), `VS_HANDLER_FAILED` (a thrown handler, message bounded).

## Descriptor (CONFIRMED)

```ts
interface ViewCommandDescriptor<State, Payload> {
  commandId; editor; title; staleness: "rebase" | "refuse"; roles?; persist?;
  validate(payload): { ok: true; value } | { ok: false; message };
  apply(payload, { signal, state, actor, identity }): { ok: true; state } | { ok: false; refusal } | Promise<…>;
}
```

Registration refuses duplicates (`VS_COMMAND_DUPLICATE`) and editor mismatches (`VS_COMMAND_EDITOR_MISMATCH`); identities are validated (`VS_IDENTITY_INVALID`).

## Adopters (RECORDED — wired in the following checkpoints)

- B17-C: the `pcb3d` editor's command set (open/close, camera presets, fit, reset, focus by component/selection/net, per-layer visibility including top and bottom silkscreen independently, finish, read state) behind `PcbPreview3D`.
- B17-D: the `schematic` and `pcb` canvas commands (open editor/tab, fit, bounded zoom, pan to object, selection, focus, layers, net highlight, reveal finding, measure).
- B17-F: registry-backed tool exposure issuing the same envelope from agent tools (contextual discovery).
