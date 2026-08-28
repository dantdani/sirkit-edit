# B12.4 §D — failed-transition rollback

> **SUPERSESSION NOTE (B12.5).** The §D reactivation below was correct
> for the hook-failure moment but not for what its own OUTCOME CALLBACK
> could do next: reentrant code that leased the reactivated interlock
> and requested another target saw that target install immediately while
> the lease sat on an abandoned interlock (B12.5 counterexample R3), and
> a thrown install left the FAILED target's interlock live and ACTIVE.
> The completion loop now retires the current live interlock and awaits
> FULL settlement before every winner, with typed §C install-failure
> semantics: `../ai-control-plane-b12-5/reentrant-transition-settlement.md`.
> Preserved as historical evidence.


Module: [`project-transition-coordinator.ts`](../../app/lib/engineering/project-transition-coordinator.ts)
(the hook-failure branch of `completeCycle`). Supersedes B12.3's behavior
(R4: after a failed `beforeInstall` the surviving project kept its RETIRED
interlock — visible but with approved-mutation capability LOST until a
successful switch).

## The contract

A failed `beforeInstall` leaves the existing project **genuinely usable**:

| Requirement | Mechanism / evidence |
| --- | --- |
| The surviving project has an ACTIVE interlock after failure | the hook-failure branch replaces `live` with a FRESH `ProjectCommitInterlock` (when no newer request superseded the cycle) |
| Reactivation never races an old lease | it happens strictly AFTER the retirement barrier settled — `retire()` resolves only when every lease has released, and the hook runs after that barrier; there is no path to reactivation with an outstanding lease (proven with a held-lease ordering test) |
| Approved mutation lease acquisition works again without a successful switch | proven end-to-end: after the failed switch, a REAL sealed proposal applies through the full service/coordinator/session composition (`committed`, one history entry) |
| The existing session, history, and scope remain authoritative | the hook failed BEFORE any install — nothing invalidated, disposed, or replaced them |
| No target installation or hydration runs | the install body never executes; asserted |
| `transitionPending` settles false | the loop's `finally`; asserted |
| One typed `transition-failed` outcome | exactly one, to the requester; asserted |
| No unhandled rejection escapes | hooks caught; barrier consumed with both continuations; process-level capture in the §F suite |

A newer request arriving during the failing hook still wins (latest-wins is
unaffected): reactivation is skipped and the loop proceeds to the newer
target, which installs with its own fresh incarnation.

Install-THROW failures keep their B12.3 semantics (the new incarnation is
already active; the failure is reported typed) — §D's scope is the
pre-install hook, where the survivor would otherwise be stranded with a
retired interlock.
