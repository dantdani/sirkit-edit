# B16.1A §B — collaborator revocation proof

Subject: **`ShantanuKT`** (Shantanu Todmal) — identified from repository
history (24 historical contributions on the default branch). His historical
commits and attribution are PRESERVED — no rewrite, no deletion, no
authorship change.

## Actions

| step | action | result |
|---|---|---|
| direct/outside collaborator removal | none required | he holds no collaborator access (collaborator check → 404) |
| pending invitation revocation | none required | zero invitations exist |
| team/inherited removal | N/A | user-owned repository; no teams |
| private-fork access | none exists | zero forks |

His current access had already been removed (or never re-granted) before this
stage; the audit records the verified absence rather than fabricating a
removal action.

## Verification (GitHub effective-permission API)

```
GET /repos/dantdani/sirkit-edit/collaborators/ShantanuKT/permission
→ { "user": "ShantanuKT", "permission": "none" }
```

Verified at the access-revocation task (2026-08-28T21:01:42Z), re-verified
immediately before the first push, and re-verified again at B16.1A stage
start — `none` every time. The repository is private, so `none` means no read
access to current or future content.

**CONFIRMED: Shantanu's effective access is removed; historical authorship is
intact.**
