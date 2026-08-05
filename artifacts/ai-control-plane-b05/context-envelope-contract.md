# B05 — Engineering Context Envelope Contract

Authoritative code: `app/lib/engineering/context-assembler.ts`
(`assembleEngineeringContext`, schema `sirkit.engineering-context.v1`).

## Purpose

A deterministic, provider-neutral fact envelope for FUTURE model/runtime use.
It is not connected to /api/chat, contains no prompt text and no provider
message objects, and performs no retrieval: every input is an explicit
snapshot or authority record supplied by the caller.

## Shape

`tenant/project/branch` · `pinnedRevision` (canonical state digest, head
sequence/transaction, `pcb2-…` board semantic revision) · `lineageId` ·
`authority {source, status}` · `currentEditor` · `units: "nm"` · sections:
`selection`, `boardSummary`, `schematicSummary` (only when explicitly
supplied), `componentAuthority` (via the B05 inspector), `relevantNets`
(by copper-item count), `validationFailures`, `readiness`, `recentChanges`
(accepted transaction references) · `truncation` report · `sourceDigests` ·
`contextDigest`.

## Section states

Every section is `{status: "present", data}` | `{status: "unknown", reason}`
| `{status: "omitted"}` — UNKNOWN (asked-for but unavailable at this
revision) is distinguishable from OMITTED (deliberately not supplied), and
both are distinguishable from empty data. Facts carry the pinned revision;
collections are bounded by an explicit budget with per-section truncation
reporting (`{section, kept, dropped}`); ordering is deterministic; the
envelope digest is deterministic (tested byte-for-byte).

## Exclusions

No secrets, credentials, or tokens (by type and by rule); no hidden
retrieval; no mutation; no provider-specific structures.
