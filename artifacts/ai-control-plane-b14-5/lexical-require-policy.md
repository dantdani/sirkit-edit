# B14.5 — the lexical `require` policy

## What was wrong

B14.4 classified `require(…)` calls **unless the file declared any binding
named `require`**, in which case the WHOLE FILE was exempt. The exemption
was justified by one real production helper
(`app/lib/pcb/fab/validate-package.ts` declared `const require = (role) => …`)
and "pinned" by asserting exactly which file was exempt.

The pin proved *which* file was exempt. It never proved the exemption was
safe — and it was not, in two independent directions:

- **R1 (over-reach).** The trigger was any declaration ANYWHERE in the
  file, at any depth. An unrelated parameter named `require` inside one
  function suppressed classification of a genuinely global, top-level
  `require("…/replacement-reauthorization")` in the same file. Gate output
  was `[]` on every axis.
- **R2 (poisonability).** Because the exempt file's identity was the whole
  admission criterion, prepending a global `require()` of a protected
  module to that file produced a file that still satisfied the pin and
  still reported no offender.

## The closure

**The exemption is deleted.** There is no file-wide exemption, no path
allowlist, and no source-digest carve-out — those mechanisms are
explicitly forbidden by this policy, because each of them admits a file
rather than a fact.

1. **Classification is unconditional.** Every `require(…)` /
   `require.resolve(…)` / `require.context(…)` / `import.meta.resolve(…)`
   call and every dynamic `import(…)` is classified on its own merits: a
   statically evaluable string argument becomes a module reference
   (resolved canonically and compared to the protected identities);
   anything else becomes an opaque load that FAILS CLOSED. No declaration
   elsewhere in the file changes this.
2. **A `require` shadow is itself a boundary violation.** Declarations
   named `require` — variable, function, parameter, binding element,
   import specifier/clause, class, method, property — are collected by
   `requireShadowDeclarations()` as records (`file`, declaration `kind`,
   `line`, `character`), and the production tree is **pinned at ZERO**. A
   future production binding named bare `require` therefore fails the gate
   and must be reviewed explicitly, exactly as an unclassifiable loader
   reference would be.
3. **The one real production shadow was removed at the source.** The role
   helper in `app/lib/pcb/fab/validate-package.ts` was renamed
   `require` → `requireRole`, with only its four local call sites updated.
   This is authorized solely as a behaviour-preserving identifier change,
   and it is proven so: mechanically reversing the rename reproduces the
   original file **byte-for-byte** (`diff` of the un-renamed file against
   the pre-edit copy is empty), and the manufacturing/release suites pass
   unchanged (see [regression-evidence.md](regression-evidence.md)).
   Manufacturing output, manifests, digests, validation behaviour, error
   codes/messages (`MFG_REQUIRED_FILE_MISSING`, "Required … output is
   missing."), and every public API are untouched.

## Consequence for the shadow's own calls

Under the old rule, `require(role)` inside the helper was *skipped*. Under
the new rule the same call would be *classified* — and since `role` is not
a statically known string it would be reported as an opaque load, failing
the gate. That is the correct fail-closed behaviour: the gate cannot know
lexically-shadowed intent, so the source must not shadow the loader name.
The rename removes the ambiguity at its origin rather than teaching the
gate to trust a file.

## `require` is not the only loader name (adversarial-audit closure)

The independent audit proved the policy above was necessary but not
sufficient: `createRequire()` from `node:module` mints a CommonJS loader
bound to ANY identifier, so a file with no `require` anywhere could load a
protected module. Loader minting is therefore tracked as part of this
policy: bindings initialized from `createRequire(…)` — including through
renamed imports, namespace members, and factory-alias chains — are LOADER
ALIASES whose calls classify exactly like `require(…)`;
immediately-invoked mints and `Module._load` / `module.require` reflection
classify directly; any unclassified `createRequire` reference fails closed
as an opaque load. See [adversarial-audit.md](adversarial-audit.md).

Conversely, an identifier spelled `require` in a NAME position — a member
read, an object/JSX/type/enum key, an import/export specifier name — does
NOT denote the loader and is not reported. Excluding those cannot hide a
loader call (a call carries the loader as its callee or base, both
classified independently) and keeps idiomatic non-loader code from failing
the zero-opaque pin.

## Why not a full lexical binding resolver

The stage permitted a genuinely lexical TypeScript binding resolver as an
alternative. Removing the shadow entirely is strictly stronger and
simpler: with zero shadows in production and a gate pinned at zero, there
is no scope-resolution question left to get wrong, and any future
reintroduction fails loudly at the pin instead of quietly widening a
resolver's trust surface.
