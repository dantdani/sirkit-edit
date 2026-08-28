# B07.2 — Invalid-Projection Recovery

## Outcome handling is exhaustive

`app/page.tsx` handles every `SchematicHydrationOutcome` in one `switch`
with a compile-time `never` guard in `default:` — a future outcome variant
is a TypeScript error, not a silent fall-through.

| Outcome | UI behavior |
|---|---|
| `fresh` / `resumed` / `rebased-local-newer` | session ready; no dialog |
| `recovered-canonical` | preserve superseded projection, adopt + handshake, toast (B06.2, unchanged) |
| `projection-conflict` | recovery dialog. B07.2: when `reason === "invalid-projection-identity"`, "Keep my local schematic" is HIDDEN (an identity-invalid projection may only adopt the intact canonical head — `resolveConflictKeepLocal` also structurally refuses it) and a local-copy JSON download is offered |
| `corrupt-history` | recovery dialog with quarantine-first "start fresh" (B06.2/B06.3, unchanged) |
| `invalid-projection` | **persistent blocking recovery state** (below) |
| `unavailable` | truthful toast; canonical editing disabled (B06.2, unchanged) |

## The blocking invalid-projection state (no valid fallback)

- The dialog cannot be dismissed (`onOpenChange` refuses and re-explains).
- Sanitized validation issues are listed (capped, truncated).
- The copy states plainly that the schematic cannot be edited, exported,
  simulated, synchronized to a PCB, autosaved, or released until the data
  is repaired, that no valid canonical history exists to fall back to, and
  that nothing has been changed or deleted.
- The ONLY offered operation is truth-preserving: a read-only raw JSON
  backup download (`sirkit-recovery-<projectId>.json` with the exact stored
  projection and the named issues). No repair is claimed; no deterministic
  repair command exists in this stage.
- `recoverStartFresh` with the invalid projection is structurally refused
  by the session — there is no side door to mint a lineage from invalid
  data.
- Reload reproduces the identical outcome: the stored record is untouched
  and `openForProject` re-validates on every hydration (test T16).

## What is blocked, and where

| Operation | Gate |
|---|---|
| Canonical edits | session lifecycle `conflicted` — every `execute` structurally rejected (`session_conflicted`); `adoptLifecycleProjection` refused |
| KiCad export | `schematicConsumerGate("export")` in `handleExportKicad` + the route's own 422 validation |
| Simulation | `schematicConsumerGate("simulation")` in `handleRunSim` (surfaced as the sim error, not a transient toast) |
| PCB synchronization | `gateSchematicSync` prop checked inside `PcbEditor.handleSync` |
| Autosave | `evaluateSchematicConsumerGate({consumer:"autosave"})` in `persistProject` — refuses while conflicted/recovery-pending, so the stored record stays exactly as it was; still allowed while the canonical store is merely unavailable/loading (the SavedProject record is the user's own data) |
| Checkpoint creation | gate in `addCheckpoint` |
| Release/manufacturing | reached only through PCB sync / export, both gated; pcb-sync publication additionally fails closed on duplicate identity (PS_COMPONENT_IDENTITY_DUPLICATE, B07.1) |

The gate itself (`schematic-consumer-gate.ts`) is a pure function with
behavioral tests (T17b/T17c) — the policy is not just UI copy.
