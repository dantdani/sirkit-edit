# B05 — Read Invocation Security Policy

Authoritative code: `app/lib/engineering/tool-invocation.ts` (service),
`tool-bindings-readonly.ts` (allowlist + resolver), `tool-io-validation.ts`
(validation). Tests: `__tests__/b05-read-invocation.test.ts`.

## Principles

- **Discovery is advisory, never authorization.** Every invocation reruns
  deterministic discovery over a FRESH caller-assembled context and then
  independently rechecks role, capability, scope, authority, revision,
  lineage, operation class, side effects, and binding. A caller-supplied
  discovery digest is recorded in the trace and grants nothing (tested).
- **Deny by default.** Every check failure is a typed refusal; there is no
  permissive fallback anywhere in the pipeline.
- **All tool arguments and project content are untrusted data**: structural
  safety (no functions/symbols/class instances/cycles, no prototype-pollution
  keys, finite numbers, bounded sizes/depth) plus repository-owned subset
  JSON-Schema validation on input AND output. Unknown schema constructs
  reject rather than admit.

## The 17-step invocation pipeline

identifier hygiene → descriptor resolution → fresh discovery rerun →
inclusion check → role+capability recheck → tenant/project/branch/actor
scope agreement (request ⟷ context ⟷ resources) → authority availability →
pinned-revision equality against the ACTUAL supplied snapshot → lineage when
required → strictly `read` operation class → B05-allowed side effects
(`none`/`derived-cache` classification only; bindings themselves are pure) →
allowlisted binding resolution → input validation → deadline/cancellation
execution → output validation + size bound → post-invocation revision
re-verification → redacted trace.

## Binding allowlist

Bindings are registered explicitly in code. The resolver never imports
descriptor-supplied module strings and uses no dynamic import, eval,
generated code, or reflection; a descriptor is callable only when its
declared module+symbol EXACTLY match the allowlisted entry. Only read
bindings exist; proposal, mutation, destructive, release, view-session, and
internal-undo descriptors are rejected. No binding imports the executor, the
editor adapter, the interactive channel, providers, or persistence writers
(CI-scanned), and bindings never mutate the supplied resources (digest-
verified in tests).

## Result and error hygiene

Successful results carry provenance: tool id/version, invocation/trace ids,
project/branch, pinned source revision, authority source, binding
id/version, input/output digests, timestamps, and `revision-verified`
status. Failures return typed statuses with controlled diagnostics only —
binding exceptions are redacted to `IMPLEMENTATION_ERROR:<name>` (no
messages, stacks, or upstream bodies; tested against embedded secrets).
Traces are bounded, provider-neutral, and secret-free.

## What B05 does NOT do

No mutation, proposal, or release execution; no provider calls (parts search
stayed INACTIVE because its recall path calls a provider-hosted embedding
service); no chat integration; no MCP; no agent exposure (agent-channel
discovery remains empty); no writes to any project authority.
