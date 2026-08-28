# B16.1A §A/§B — repository visibility & access audit

Audited 2026-08-28 (UTC) as the authenticated owner. Secret-free record.

## Repository

| fact | value |
|---|---|
| repository | `dantdani/sirkit-edit` |
| visibility | **private** |
| owner type | User (`dantdani`, id 149581202) |
| authenticated account | `dantdani` (admin: true) |
| default branch | `main` |
| branch protection on main | **none** (`protected: false`; protection API → 404 "Branch not protected") |
| required checks | none formally required (no protection rule); benchmark-quality runs on every PR and is treated as the de-facto gate |

Because the repository is PRIVATE, collaborator removal genuinely removes
read access. Because the owner is a User account, org membership, team
membership, and base-permission vectors do not exist.

## Effective-access audit (re-verified this stage)

| vector | finding |
|---|---|
| collaborators (all affiliations) | `dantdani` (owner/admin) ONLY |
| outside collaborators | none |
| pending invitations | none |
| forks (incl. private) | none (`forks_count: 0`) |
| deploy keys | none |
| org/team/inherited | N/A (user-owned) |
| GitHub App installations | not enumerable with the CLI OAuth token (requires app-authorized auth); owner-visible at github.com/settings/installations; no repo-scoped machine credential exists |

## Honest limitations

- Revocation cannot erase clones or files previously downloaded; copies
  outside GitHub are beyond its control.
- Historical commits (including ShantanuKT's) remain visible to anyone with
  repository read access, by design.
