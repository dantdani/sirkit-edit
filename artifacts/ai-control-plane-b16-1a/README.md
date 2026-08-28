# B16.1A — Private integration and benchmark-CI closure

Stage scope: securely preserve/integrate the completed B01–B16.0 work into the
private `dantdani/sirkit-edit` repository, remove Shantanu's current access
without altering his historical authorship, and repair the benchmark-quality
workflow that failed on every run #1–#24.

Worked ONLY in `C:\Users\robsa\Desktop\sirkit-edit`; the protected original
`C:\Users\robsa\sirkit` was NOT touched. No production-auth qualification,
MCP, multi-agent work, or new product features.

## State found at stage start (material to the record)

Between the access-revocation task and this stage, the integration itself had
ALREADY LANDED: a `-clean` branch (identical tree, re-committed by
`Dandi Desta <dandidesta82@gmail.com>` WITHOUT any AI co-author trailer, plus
the pnpm CI fix) was merged into `main` via **PR #2** (merge commit
`f7bf546`); the earlier PR #1 (whose commit carried an AI co-author trailer)
was CLOSED unmerged. This stage therefore verified, completed, and documented
the remaining objectives rather than redoing the merge — rewriting the merged
history is forbidden (no force-push, no rewrite).

## Artifact index

| file | content |
|---|---|
| [final-verdict.md](final-verdict.md) | stop conditions, item by item |
| [repository-visibility-and-access-audit.md](repository-visibility-and-access-audit.md) | §A/§B |
| [collaborator-revocation-proof.md](collaborator-revocation-proof.md) | §B verification |
| [authorship-verification.md](authorship-verification.md) | §C |
| [working-tree-inventory.md](working-tree-inventory.md) | §D inventory |
| [commit-plan.md](commit-plan.md) | §D plan vs what landed |
| [benchmark-runs-1-23-analysis.md](benchmark-runs-1-23-analysis.md) | §E |
| [benchmark-root-cause.md](benchmark-root-cause.md) | §E root cause |
| [benchmark-local-reproduction.md](benchmark-local-reproduction.md) | §E/§F |
| [workflow-security-review.md](workflow-security-review.md) | §F |
| [validation-report.md](validation-report.md) | §G |
| [commit-and-pr-record.md](commit-and-pr-record.md) | §H |
| [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md) | residuals |

No credentials, tokens, cookies, or secret values appear in any artifact.
