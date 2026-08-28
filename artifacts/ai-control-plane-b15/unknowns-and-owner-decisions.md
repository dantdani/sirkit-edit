# B15 — unknowns and owner decisions

## Decisions I made (and why)

1. **The candidate board is compiled by the EXISTING delta layer, not by a
   new mutation implementation.** `commitPcbCandidate` already accepts a
   `buildCandidate(board)` producer and compiles the difference through
   `compilePcbBoardDelta`. The B15 compiler therefore produces an isolated
   candidate and lets that layer decide canonical expressibility. This is
   why no second mutation path exists, and why unsupported changes refuse
   (`PcbDeltaUnsupportedError` ⇒ `not-canonical`) instead of being
   improvised.

2. **Unprovable copper contacts fail closed, exactly like shorts.** Testing
   showed that crossing copper on two different nets yields
   `unknownContacts`, not `shorts`, from the connectivity engine (it cannot
   prove separation from stable identities). Accepting those would have let
   a proposal introduce a probable short while reporting "no new shorts".
   Any increase in unprovable contacts now refuses.

3. **`approvalTier: "topology-or-geometry"`**, not `destructive`. The
   allowlist contains no deletion or destructive intent; the tier vocabulary
   already distinguishes them. **Owner check requested** — if the intent is
   that every AI-originated board mutation carries the destructive tier
   regardless of content, this must change before the tool is exposed.

4. **`set_net_class_rule` guards enforced minima empirically** — a rule may
   not take a net below the narrowest copper or smallest drill already
   present on that net. **Owner check requested**: if Sirkit has a
   fabrication-profile floor that should bound this instead of (or as well
   as) the board's existing geometry, that source should be wired in.

5. **The excluded-intent list is explicit and closed.** A misspelled
   allowed kind refuses as `unknown-operation`; a recognized out-of-scope
   intent refuses as `excluded-operation` with a specific message. That
   distinction is deliberate so refusals are legible to a model.

## Open unknowns for the owner

1. **Board instance identity.** The sealed proposal carries
   `scope.boardInstanceId`; `pcbBoardInstanceId(projectId)` exists and is
   what the schematic path uses. Confirm that is the right binding for a
   multi-board future, or name the intended identity now — it is sealed
   into every proposal and changing it later invalidates stored artifacts.

2. **Canonical resource identity for PCB proposals.** The schematic path
   binds `canonicalResource {resourceId, contentDigest}` from the read
   resource the run consumed. The equivalent PCB read resource
   (`sirkit.pcb.board-inspect`) needs to be pinned as the proposal's
   authority source — I have left the field in the seal but not chosen its
   producer.

3. **Where the review dialog mounts.** `PcbEditor` owns board state
   internally and exposes no board-out prop, so a page-level dialog cannot
   read the board or the history. The dialog therefore has to mount INSIDE
   `PcbEditor` (alongside the existing FabDialog/SyncPlacementDialog) or a
   new explicit prop must be threaded. This is a composition decision with
   consequences for the B08 source tripwire registry.

4. **Rotation vocabulary.** I restricted rotation to quarter turns. If
   Sirkit intends arbitrary angles for AI proposals, the bound and the
   validator need to change together with a DRC/courtyard story.

5. **Whether `pcb-tool-service.ts` should become a gated capability.** The
   pre-edit census shows it already imports `commitPcbCandidate` and is
   UI-invoked. It is not provider-reachable today, but once a PCB proposal
   class exists, that module deserves the same AST importer gate as the new
   approval modules.
