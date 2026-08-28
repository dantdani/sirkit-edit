# B16.0.13 §D — Authorization & body ordering evidence

## Runtime ordering (wrapper-enforced, all 5 routes)

1. exact route/method policy → `authorizeRequest` (identity + active
   membership + role class + same-origin CSRF) — role/capability requirements
   from the policy table unchanged, access NOT broadened (viewer 403 pinned);
2. principal-kind check;
3. media type (415 before any body pull);
4. bounded read (16 MB, 45 s advisory / 60 s autoroute+gerbers) — deadline,
   ceiling, abort settle once;
5. JSON object parse;
6. ONLY THEN the callback — which is where provider selection/invocation,
   runtime discovery, FreeRouting process creation, DSN generation,
   kicad-cli/exporter invocation, repair computation, rules generation, edit
   assistance, and artifact compilation live.

## Behavioral proof (pre = post, zero assertion changes)

Every §A refusal pin asserts BOTH zero body pulls (counting streams) AND zero
calls across all five work fakes — so authorization completes before any body
pull and before every category of downstream work. The pre-aborted autoroute
pin proves the reader's abort refusal precedes even runtime discovery.

## Trusted context

Project/branch/actor/role/session/membership reach the callbacks only through
the wrapper's `TrustedRequestContext` (gerbers attribution) — the three
advisory routes consume no identity at all, and gerbers' forbidden-key pins
prove caller-supplied authority fields cannot override context.
