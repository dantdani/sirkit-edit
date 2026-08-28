# B14.3 §E — specifier-resolving capability import gates (R4 closure)

## The defect

The B14.2 channel gate searched raw file text for ONE substring —
`project/replacement-reauthorization` — so a forbidden file inside
`app/lib/project/` could import `"./replacement-reauthorization"` (no
`project/` in the specifier) undetected; parent-relative chains and alias
spellings that avoid the exact substring were equally invisible. A pure
FILENAME substring would not fix it soundly: the endpoint legitimately
contains `"replacement-reauthorization"` as its `canonicalRevision` string
literal (route.ts), which is not an import.

## The closure

`app/lib/project/__tests__/_import-gate-helpers.ts` (shared by the B14.2
and B14.3 suites):

1. `importSpecifiers(source)` EXTRACTS every specifier: static
   `import … from`, side-effect `import "x"`, `export … from` re-exports
   (including `export * from`), dynamic `import(...)`, and `require(...)` —
   multiline binding lists included.
2. `resolveSpecifier(importerPath, spec)` NORMALIZES it to a repo-relative
   extensionless module path: `@/x` → `x`; `./` and `../` resolved
   segment-by-segment against the importing file's directory (`.` and
   empty segments skipped, `..` pops); bare package specifiers → null.
3. `moduleImportOffenders(files, modulePath, approved)` flags a file iff
   ANY resolved specifier equals the target module path.

Applied to ALL FOUR capability targets with their EXACT approved importer
sets unchanged from B14.1/B14.2:

| target | approved importers |
| --- | --- |
| `app/lib/project/replacement-reauthorization` | itself, `replacement-approval-controller.internal.ts`, `approved-replacement-mutations.ts` |
| `app/lib/project/replacement-approval-controller.internal` | itself, `app/page.tsx` |
| `app/lib/engineering/replacement-approval.internal` | itself, `approved-replacement-mutations.ts`, `replacement-approval-controller.internal.ts` |
| `__createTestReplacementReauthorizationChannel` (test-only factory) | identifier gate: must not APPEAR outside its gated definition |

The B14.2 suite's 15b gate now calls `moduleImportOffenders` (same
approved set), so the previously bypassable substring check no longer
exists anywhere.

## Negative tripwires (all detected — §E test 18)

- same-directory `./replacement-reauthorization` (THE R4 bypass);
- parent-relative `../project/replacement-reauthorization`;
- alias `@/app/lib/project/replacement-reauthorization`;
- dynamic `await import("../project/replacement-reauthorization")`;
- re-export `export * from "../project/replacement-reauthorization"`;
- a noisy mixed spelling `./../project/./replacement-reauthorization`;
- same-directory controller import, intent re-export, and alias dynamic
  intent import.

## Soundness (§E test 19)

The endpoint file is IN the walked FileMap, CONTAINS the module name as a
string literal, is NOT in the approved set — and is correctly NOT flagged,
because the literal is not an import specifier. A raw-substring gate could
not make that distinction; this one holds completeness AND soundness.

The engineering barrel remains incapable of exporting these capabilities
(the B14.2 barrel non-export check is unchanged and green).

---

> **SUPERSESSION NOTE (B14.4).** The closing claim above — that this gate
> "holds completeness AND soundness" — was WRONG on completeness.
> Independent verification proved the REGEX extraction missed valid
> TypeScript: a comment inside the dynamic-import parentheses, a comment
> between `from` and its literal, an escaped module literal
> (`-` for `-`), and a statically concatenated
> `import("…-" + "…")` all parse cleanly and extracted NOTHING. The regex
> approach was replaced in B14.4 by TypeScript AST extraction with bounded
> static string evaluation, fail-closed opaque-load reporting, hardened
> canonical resolution, and an 8-extension scan surface. The approved
> importer sets and the soundness result (non-import literals unflagged)
> carry forward unchanged. See `../ai-control-plane-b14-4/`.
