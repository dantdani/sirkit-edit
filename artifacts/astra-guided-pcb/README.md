# Post-B24 prerequisites and additive Astra continuation

Date: 2026-10-11. Working checkout: `C:\Users\robsa\Desktop\sirkit-edit`.
Starting main: `32b081e` (B24 merge). Local branch: `codex/astra-foundation`.
The legacy `C:\Users\robsa\sirkit` checkout is not the current merged app and was not edited.

## Scope and owner decisions

The owner confirmed that only the other coding agent's credits ran out, and explicitly approved both recommended B24 fixes:

- **OD-236 / D24-43:** treat strict-provider null as omitted only for schema-optional, originally non-null fields.
- **OD-229 / D24-42:** refuse AI component deletion that disconnects surviving circuitry. Do not change human-editor deletion.

This is prerequisite work, not a new numbered chapter or a claim that the original program is production-qualified.
The owner's additive directive remains in force: finish existing requirements before activating the Astra extension.
No credentials, paid API calls, live databases, orders, provider configuration, new exposed tools, or manufacturing permissions are involved.

## Reproductions and implementation

CONFIRMED before production edits: the initial five-test regression suite produced three failures and two passes. Both provider-labelled real-gateway reads with `{netName:null}` refused; the shared-wire AI delete incorrectly compiled. Human deletion and ordinary leaf deletion passed.

`app/lib/agent/normalize-tool-arguments.ts` captures bounded plain JSON without invoking getters or serialization hooks, then reads the original registry schema. It removes only synthetic optional nulls. Required nulls, explicitly nullable values, array null entries and unknown fields remain subject to existing validation. Ambiguous unions do not license erasure. The gateway applies this before dispatch; the loop uses the same normalized representation for repetition detection. Provider continuation and trace input are not rewritten. Existing B05 domain validation is unchanged.

`app/lib/engineering/agent-delete-connectivity.ts` uses the existing `buildNetUnionFind` topology authority, comparing partitions over surviving pin sites, retained labels and retained wire vertices before/after the entire planned cleanup. A split refuses the whole AI proposal before sealing. Redundant surviving paths remain valid. Missing pin evidence for surviving KiCad parts refuses cleanup conservatively. The interactive `planSchematicDelete` function is unchanged.

The two B24 tests that intentionally pinned the known failures now pin their approved corrections. Historical B24 reports remain historical evidence, not rewritten successes.

## Verification

Validation is recorded here after the final-source checks finish. No live provider or browser claim is implied by fake-adapter tests.

## Remaining limits

The B24 program verdict remains PARTIAL. Fixing these two defects does not qualify production authentication, distributors, model behavior, fabrication, or the sandbox. B24 recorded a diagnostic sandbox class-4 containment failure; authoritative simulation remains blocked. Existing lint debt and the live qualification register also remain outstanding.

See [CONTINUATION.md](CONTINUATION.md) for the incremental continuation and missing-part policy. This document does not authorize bypassing any existing gate.
