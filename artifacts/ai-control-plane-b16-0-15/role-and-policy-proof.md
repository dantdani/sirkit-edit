# B16.0.15 §C — Role & policy proof (CONFIRMED)

Both routes keep their exact `authenticated-release` policies (unchanged in the
route-policy table; `requiresAuth`, `requiresCsrf`, `authoritativeWrite`,
`releaseOrQualification` all true). The wrapper resolves the role SERVER-SIDE
and enforces `permittedRoles`; the callback cannot override it.

## Membership → project-role mapping (verified)

`editor → pcb_editor`, `admin → project_admin`, `reviewer → reviewer`,
`viewer → viewer`, `commenter → commenter`.

## qualify — permitted `pcb_editor | project_admin`

| Role | Result |
|---|---|
| viewer | 403 (pinned) |
| commenter | 403 (pinned) |
| reviewer | 403 (pinned) |
| pcb_editor (editor) | reaches `getBoard` → 404 not-found (authorization passed) |
| project_admin (admin) | reaches `getBoard` → 404 not-found (authorization passed) |

## release — permitted `project_admin` ONLY

| Role | Result |
|---|---|
| viewer | 403 (pinned) |
| commenter | 403 (pinned) |
| reviewer | 403 (pinned) |
| pcb_editor (editor) | **403** — reaches neither authority load nor release (pinned) |
| project_admin (admin) | reaches `store.get` → 404 not-found (authorization passed) |

## Guarantees

- viewer/commenter/reviewer never reach either operation — CONFIRMED;
- pcb_editor may qualify but **never** release — CONFIRMED (release 403 for editor);
- only project_admin may release — CONFIRMED;
- no route/wrapper fallback widens these roles — the wrapper enforces
  `policy.permittedRoles` from `policyFor(pathname, method)`; a missing/malformed
  policy fails closed (the wrapper's non-authenticated branch → 403, and
  `authorizeRequest` denies when no policy matches);
- the callback cannot override the policy-derived decision — role is resolved in
  the wrapper before the callback runs and is not a callback input;
- neither route was reclassified as an ordinary mutation/POST — the policy rows
  and the `authoritativeWrite`/`releaseOrQualification` flags are untouched.
