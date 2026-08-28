# B13 — replay and trace results

## How authority participates in identity

The `component-authority-records` envelope is sealed into the read
resource bundle, so it appears in the bundle MANIFEST and the
`manifestDigest`. The route and the replay recorder both compute
`resourceManifestDigest = buildAgentResourceBundle(context).manifestDigest`
and place it in the trace `contextDigests`. Therefore:

- **Context integrity**: `verifyAgentContextIntegrity` recomputes
  `componentAuthorityDigest` and refuses on post-assembly mutation or a
  dangling authority claim.
- **Trace identity / replay**: any change to an authority record changes
  the envelope content digest → the manifest digest → `resourceManifestDigest`
  → the trace digest. Proven (B13 #21): the SAME canonical board with a
  DIFFERENT authority record produces a DIFFERENT manifest digest, and the
  manifest deterministically reproduces on rebuild; the authority envelope
  is present in the manifest.
- **No raw records or secrets in traces**: the trace carries only digests;
  the envelope content (records) never enters the trace, and the closed
  authority summary is the only provider-visible projection.

## The 19 replay pins moved — justified

Exposing `sirkit.component-authority.inspect` as the tenth agent tool
changes the per-run discovery result (the tool now passes the agent-
channel gate and is excluded later for resource-satisfaction rather than
`not_agent_exposed`), which shifts the discovery digest baked into every
committed eval capsule's trace. The `replay-trace-pins.json` were
regenerated deterministically (byte-stable ×2: `03e043f4…`) and all 19
evaluation cases + 59 checks pass. This is the stage's "unavoidable
generated change, explicitly justified" — the authoritative PCB hashes
(`types.ts` `72ad7c77…`, descriptor `5501d810…`) are UNCHANGED, as B13
touches no PCB types.

## Deviation (documented)

The committed eval capsules do not yet carry a `componentAuthority` raw
input, because the local-only build loads no authority — so no capsule
reproduces an authority-bearing run through `REPLAY_CONTEXT_KEYS`.
Adding an authority-bearing eval capsule (and the replay-context key) is a
PROPOSED follow-up; the manifest-digest path above already makes authority
changes detectable in trace identity, which is the required guarantee.
