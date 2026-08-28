# Access-revocation audit — dantdani/sirkit-edit

Performed: 2026-08-28T21:01:42Z (UTC) · Actor: `dantdani` (repository owner,
admin) · Authorization: explicit owner instruction. This record contains only
usernames, access levels, actions, and timestamps — no tokens or secrets.

## Repository facts

| fact | value |
|---|---|
| repository | `dantdani/sirkit-edit` |
| visibility | **private** |
| owner type | **User** (not an organization) |
| default branch | main |
| forks_count | 0 |

Because the owner is a User account, the organization-only access vectors
(org membership, base permissions, team membership, inherited team access) do
not exist for this repository.

## Discovered access (audit, 2026-08-28T21:01:42Z)

| vector | finding |
|---|---|
| collaborators (affiliation=all) | `dantdani` (admin) — the owner, and NO ONE else |
| direct collaborators | `dantdani` only |
| outside collaborators | none |
| pending invitations | none (zero entries, including expired) |
| forks (incl. private forks visible to the owner) | none |
| deploy keys | none |
| org/team/inherited access | N/A (user-owned repository) |
| GitHub App installations | NOT enumerable with the current CLI OAuth token (the installations API requires a GitHub-App-authorized token — HTTP 403). Owner-visible at github.com/settings/installations. No repo-level machine credential (deploy key) exists. |

## Subject identification

"Shantanu" identified from repository history as GitHub login **`ShantanuKT`**
(Shantanu Todmal) — 24 historical contributions on the default branch.
Historical commits are PRESERVED: no history rewrite, no authorship change,
no credit removal.

## Actions taken

| step | action | result |
|---|---|---|
| remove direct/outside collaborator access | none required | `ShantanuKT` holds NO collaborator access (collaborator check → 404) |
| remove team/inherited access | N/A | user-owned repo; no teams exist |
| revoke pending invitations | none required | zero invitations exist |
| deploy keys / machine credentials | none required | zero deploy keys exist |

## Verification (effective-permission API, 2026-08-28T21:01:42Z)

```
GET /repos/dantdani/sirkit-edit/collaborators/ShantanuKT/permission
→ { "user": "ShantanuKT", "permission": "none", "role_name": "" }
```

**`ShantanuKT` has NO effective access to `dantdani/sirkit-edit`.** The
repository is private, so no-access means no read access to current or future
content.

## Honest limitations (stated for the record)

- Revocation cannot erase repositories, commits, or files anyone previously
  cloned or downloaded; copies already outside GitHub are beyond its control.
- Historical commits (including ShantanuKT's 24) remain visible to anyone who
  can read the repository, by design — contribution credit is preserved.
- The GitHub-Apps installation list could not be enumerated with the current
  token; the owner should glance at github.com/settings/installations to
  confirm no app was installed on Shantanu's behalf. No repo-scoped machine
  credential exists regardless (zero deploy keys).
