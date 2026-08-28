# B16.0.21 — Zero-call refusal evidence (CONFIRMED)

Domain-work seams (pass-through spies over the REAL compile functions):
`compileFirmwareTestBringUpProblem`, `compileReleaseEngineeringProblem` —
asserted NEVER called on: unauthenticated (401), foreign/revoked membership
(403), viewer (403), production cross-origin (403 with **0 body pulls**),
media (415), invalid JSON (400), 64 MB+1 (413), pre-aborted (400), and the
non-human actor gates (403).

Provider calls: zero by absence ([provider-boundary-proof.md](provider-boundary-proof.md)).
Process/device/network calls: zero by absence
([firmware-authority-proof.md](firmware-authority-proof.md) + the code-only
gate). The cross-origin pins use counting body streams — zero pulls on all
eight routes.
