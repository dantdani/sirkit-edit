# requiredApplyRole contract (§F / R7)

## Before
`evaluateMembershipReauthorization` ignored `binding.requiredApplyRole`. A
sealed binding requiring `project_admin` authorized a live `pcb_editor`
(both were in the family apply-role list). The sealed field was inert.

## After — explicit accepted-role mapping (no invented ordering; gate-pinned)
`ACCEPTED_LIVE_ROLES_FOR_REQUIRED_APPLY_ROLE` (frozen):
- `project_admin` → accepts **only** `project_admin`;
- `pcb_editor`    → accepts `pcb_editor` **or** `project_admin`;
- any other required role → accepts **nothing** (fail closed).

`evaluateMembershipReauthorization` now requires **both** gates to admit the
live role: the family-permitted apply list AND the sealed required role (via the
mapping). An unknown sealed required role refuses `required-role-unknown` before
the family check. Precedence: `membership-unavailable → principal-changed →
scope-changed → required-role-unknown → role-insufficient → membership-changed`.

## Coverage (all three families)
- **Schematic** (tier-1 + replacement share the binding): a `project_admin`
  binding refuses a live `pcb_editor`; well-formed-binding validation rejects a
  required role outside `SCHEMATIC_APPLY_ROLES`.
- **Bounded PCB**: `evaluatePcbApplyReauthorization` honours the sealed required
  role identically (admin-only refuses pcb_editor; unknown role fails closed).
- **Tier-1 end-to-end** through the real apply service: an admin-required
  proposal refuses a live `pcb_editor` with ZERO mutation (head stays 0) and
  applies for a live `project_admin` (head 0→1).
