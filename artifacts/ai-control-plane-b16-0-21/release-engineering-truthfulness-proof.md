# B16.0.21 §E — Release-engineering truthfulness (CONFIRMED)

Both routes remain problem/proposal surfaces only:

| Rule | Evidence |
|---|---|
| no manufacturing-release authority minted | gate: no `releaseManufacturingPackage`/`DurableManufacturingAuthorityStore` reference; the MFG01 gates pass unchanged |
| no production-ready marking | `requestedReleaseLevel` is a REQUEST label validated against the enum; the compiler returns ok/409 — never a released status |
| no DRC/ERC/readiness waivers | `activeWaiverRefs` are REFERENCES passed into the problem for evaluation, not waiver creation; no waiver-minting surface exists (gated) |
| no signing/certification | no such field or claim in either response |
| no released Gerbers | no artifact generation exists in these routes |
| MFG01 gates not bypassed | statically gated + the manufacturing-release suite green in the battery |
| human/proposal distinction | problem compilation requires a HUMAN actor (exact 403 pinned, compile zero); propose returns `requiresHumanReview: true` + `hasExternalOrPurchasingSideEffects: false` with trusted `proposedBy` — proposal, evidence, assessment, approval, and released authority remain distinct output categories |
