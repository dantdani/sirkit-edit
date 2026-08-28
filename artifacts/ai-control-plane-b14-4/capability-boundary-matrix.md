# B14.4 — capability boundary matrix

The approved importer sets are EXACTLY those of B14.1/B14.2 — no set was
widened.

| protected target | approved importers (exact-case) | gate |
| --- | --- | --- |
| `app/lib/project/replacement-reauthorization` (the one-shot reauthorization channel) | itself · `replacement-approval-controller.internal.ts` · `approved-replacement-mutations.ts` | `moduleImportOffenders` (AST + canonical resolution) |
| `app/lib/project/replacement-approval-controller.internal` (the authority-bearing controller) | itself · `app/page.tsx` | `moduleImportOffenders` |
| `app/lib/engineering/replacement-approval.internal` (the one-shot approval intent) | itself · `approved-replacement-mutations.ts` · `replacement-approval-controller.internal.ts` | `moduleImportOffenders` |
| `__createTestReplacementReauthorizationChannel` (test-only factory) | its gated definition (`replacement-reauthorization.ts`) | `identifierReferences` (AST identifiers + decoded string literals: aliased named imports, namespace access, destructuring, element access by string, arbitrary-module-namespace strings, re-exports, unicode-escaped identifiers) |
| engineering barrel (`app/lib/engineering/index.ts`) | must re-export NONE of the above (nor `approved-replacement-mutations`) | AST re-export resolution + injected-poisoning tripwire (plus the raw B14.2 check, retained) |

Cross-cutting, target-independent gates (all asserted on the REAL tree and
by injected tripwires):

| condition | gate | production state |
| --- | --- | --- |
| non-static dynamic `import()`/`require()` target | `opaqueModuleLoads` — FAIL CLOSED | ZERO |
| import specifier escaping the repository root | `rootEscapingImports` | ZERO |
| local `require` shadowing (exempt from require classification) | `localRequireDeclarations` — PINNED | exactly `app/lib/pcb/fab/validate-package.ts` |
| harmless non-import string literal naming a module | NOT flagged (soundness) | endpoint `canonicalRevision` literal verified unflagged |

Transitive note: a production file that RE-EXPORTS a protected module is
itself an offender at the point of re-export (the suite proves poisoned
barrel and named/star re-export forms are flagged), so a capability cannot
leak through an intermediate module without that intermediate failing the
gate.

---

> **SUPERSESSION NOTE (B14.5).** The cross-cutting row "local `require`
> shadowing (exempt from require classification) — PINNED … exactly
> `app/lib/pcb/fab/validate-package.ts`" is WITHDRAWN. There is no
> exemption: `require` shadow declarations are BOUNDARY VIOLATIONS pinned
> at ZERO, and that production file no longer contains the identifier at
> all (its role helper is `requireRole`). A further cross-cutting row now
> applies: parser diagnostics for the complete scanned tree, pinned at
> ZERO. The protected targets and their approved importer sets are
> UNCHANGED. See `../ai-control-plane-b14-5/`.
