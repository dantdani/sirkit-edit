# Qualification census addendum — 2026-10-11

The B24 report describes CI at commit `26dc8b8a71a2471cc0f542da9ecc05c37c1abc51`. Its dated counts remain 878 Vitest files, 302 selected by no CI job, 73 `b16-0-*` security suites, and 64 of those selected by no CI job. These figures were independently reproduced from that Git commit, using the existing `ciAdmission` reader with only the commit's archived configuration text and browser-spec existence entries.

`artifacts/ai-control-plane-b24/ci-census-26dc8b8.json` records the full commit and tree ids, all 878 test paths with their Git blob ids, the six exact policy-reader inputs with source text and blob ids, and the browser-spec existence entries. The source was captured with read-only `git ls-tree -r` and `git show` commands. The B24 verdict suite checks the manifest's SHA256 (`857de056bf70e1a69f7c05d2362e24be8106cdcb862a680499455b3ffd60bbb9`), validates each archived text against its Git blob hash, and recomputes the dated CI counts through the injected reader. A planted manifest edit fails the digest check. These hashes detect changes and record Git provenance; they do not authenticate a contributor.

The previous test incorrectly recounted the current checkout when checking a statement explicitly dated to that earlier commit. Adding regression tests therefore made the historical statement appear false. The test now checks the snapshot for that dated statement. Current CI admission and other current-inventory gates continue to inspect current code.

A separate read-only census of this working checkout on 2026-10-11 measured 883 Vitest files, 307 selected by no CI job, and the unchanged 73/64 security-suite counts. This records the checkout at the time of measurement; subsequent tests or workflow edits require another current census. It is not evidence of a completed test run or a CI run.

The sanctioned B17 control generator and B24 accessible-name generator were rerun after the UI state fixes. They reported 628 classified controls on 63 surfaces, zero unmatched controls, 168 in-scope controls with zero unnamed controls and zero structural problems, and 102 out-of-scope unnamed controls. The existing no-new-unnamed-control ratchet remained enabled. The command palette's query handler now resets both query and selection, so its observed `setQuery,setIndex` handler is registered under the existing view-draft classification. The B24 same-line button test derives both collision groups from the AST scan instead of pinning obsolete source line numbers.

The generated files remain byte-gated against their current source render. Historical B24 report text and historical counts are preserved; this addendum records the later corrections and measurements.

Both sanctioned generators then ran twice on the final UI sources, each with exit 0 and the same output SHA256 hashes in both rounds:

| Output | SHA256 |
| --- | --- |
| B17 control inventory CSV | `44cf41924473c8d93d0030d6ffc5e72261e06b129a2709943a874fcbf73ea7ab` |
| B17 control inventory summary | `282bb33313f2fd62ff200b39bcaeea4f6faee762967bfaa880ccf65629046eb4` |
| B24 accessible-name census CSV | `8ecb293216d2c98ff6b0a5d44744d2ad92fc393aa223a1205b2781515855d142` |
| B24 accessible-name census summary | `8b2e2a9f8e44e9c24875b9722034d1a738d594e1ad2770aa5b65ef0f293433c6` |

The executable accessibility citation table's C36-C39 and C58-C60 anchors were refreshed to the actual source lines after the UI and test edits. A dated note in that table distinguishes this citation maintenance from the historical behavior and measurements it describes.
