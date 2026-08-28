# B11.7 — exported-boundary matrix (updated from B11.6)

The B11.6 matrix remains the authority for totality; this update records the
two contract corrections and re-states the full surface.

| Boundary | Contract | B11.7 change |
| --- | --- | --- |
| `projectBoardForReplay` | public/untrusted, total, **capture-first for every foreign value** | primitive shortcut removed — non-JSON primitives now `ok: false`; valid-JSON primitive roots `ok: true` + structural issue |
| `projectCapturedBoard` | captured-only, registry-enforced, total | inherits the same discipline through its misuse path |
| `projectReplayContext` | public/untrusted, total, capture-first | same; plus non-record roots now carry the deterministic `must be a plain object` issue instead of an empty list; refusal is an explicit channel, not inferred from a `null` value |
| `validateBoardShape` | public/untrusted, total | unchanged (`projectBoardForReplay(raw).issues`) — now also refuses the five non-JSON primitives via capture |
| `validateCapturedReplayContext` | captured-only, registry-enforced, total | unchanged |
| `validateReplayContext` | public/untrusted, total | unchanged |
| `parseReplayCapsule` / `validateReplayCapsule` / `replayCapsule` | public/untrusted, total at parse | unchanged |
| `validateAgentRunTrace` | public/untrusted, total | unchanged |
| `findNonPlainJsonPath` / `findSecretShapedPath` | public/untrusted, total, depth-enforced | unchanged |
| `capturePlainJson` / `scanPlainJson` | public/untrusted, total | unchanged — the single source of JSON discipline |
| `isOwnedCapture` | public/untrusted, total | unchanged |
| `isCapturedRecord` | public/untrusted, total, **truthful** | runtime test now requires ownership-registry membership, matching its TypeScript claim |
| redaction functions / `isValidFailureReason` | public, total trivially | unchanged |
| `agentRunTraceDigest` | internal/trusted, documented | unchanged (see B11.6 matrix) |
| recorder methods | public/untrusted, total | unchanged (B11.2 boundary) |
| evaluation helpers | internal/trusted, documented | unchanged |

## The unifying invariant

After B11.7 there is exactly **one** JSON discipline — `capturePlainJson` —
and every public result honours it: a projection can never report `ok: true`
with data capture would refuse, and no successful result can throw under,
change meaning under, or lose data under `JSON.stringify`.
