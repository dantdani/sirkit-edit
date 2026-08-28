# B16.1A §C — authorship verification

| check | result |
|---|---|
| authenticated GitHub user | `dantdani` (id 149581202) — **CONFIRMED** via `gh api user` |
| `git config user.name` | `Dandi Desta` — the owner's own configured identity |
| `git config user.email` | `dandidesta82@gmail.com` |
| email linked to the authenticated account? | **CONFIRMED** — the merged commit `4e99e3e` (author `Dandi Desta <dandidesta82@gmail.com>`) is attributed by GitHub's commits API to `author.login: "dantdani"`. GitHub only attributes a commit email to an account when that email is verified on the account, so the linkage is proven without needing the (unavailable) `user/emails` scope. |

## Attribution policy compliance (this stage's commits)

- Author/committer on every new commit: `Dandi Desta <dandidesta82@gmail.com>`.
- NO Claude/Anthropic/Codex/OpenAI/bot/generic authorship; NO AI-attribution
  or co-author trailers, per the owner's explicit instruction.
- No backdating (all timestamps are the real commit times), no fabricated
  activity, no empty/no-op commits, no force-push, no rewrite of any existing
  commit.

## Historical note (truthful record)

The closed, unmerged PR #1 branch contains a commit whose message carries an
AI co-author trailer (made before this stage's authorship directive). It was
never merged; the tree landed on `main` through PR #2's re-commit `4e99e3e`,
which carries no such trailer. The PR #1 branch is retained only as a
recoverable backup and is superseded; deleting it is an owner option (noted in
unknowns).

Shantanu Todmal's historical commits (as `ShantanuKT <shantanutodmal@gmail.com>`
and `Shantanu Todmal <43564728+ShantanuKT@users.noreply.github.com>`) remain
untouched with full credit.
