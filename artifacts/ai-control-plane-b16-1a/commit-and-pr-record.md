# B16.1A §H — commit and PR record

## Backup (recoverable)

- Tag `backup/pre-b16-1a` → `f7bf546` (the pre-stage `origin/main` head),
  pushed to origin.
- The closed PR #1 branch additionally preserves the pre-merge tree.

## Integration branch

`integration/b16-1a-benchmark-ci`, created from `origin/main` (`f7bf546`).
No direct pushes to `main`; no force-pushes anywhere; fast-forward-only sync
of local `main`.

## Commits (author `Dandi Desta <dandidesta82@gmail.com>` — GitHub-verified
on `dantdani`; real timestamps; no AI attribution or co-author trailers)

| hash | subject |
|---|---|
| `5f28825` | ci(benchmark): upload failure diagnostics and junit reports |
| `a997e42` | chore(git): enforce LF working-tree checkout via .gitattributes |
| (this commit) | docs(artifacts): B16.1A integration and benchmark-CI evidence |

Each commit: staged diff inspected, secret-scan clean, focused tests run
before committing.

## Pull request

- **PR #3** — https://github.com/dantdani/sirkit-edit/pull/3
  (`integration/b16-1a-benchmark-ci` → `main`)
- Pre-push re-verification: ShantanuKT permission `none`; visibility
  `private`.
- benchmark-quality runs on the PR head; merge only after it passes
  (recorded in the final report).

## Context: the prior integration

The B06–B16.0.24.1 tree itself landed earlier via **PR #2** (merged;
integration commit `4e99e3e` + CI fix `6956e74`, same verified author, no
trailers). PR #1 was closed unmerged. This stage's PR contains only the
benchmark hardening, the LF enforcement, and this evidence set.
