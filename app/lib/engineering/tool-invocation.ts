/**
 * B05/B05.1 — provider-neutral READ-ONLY tool invocation service.
 *
 * Discovery is advisory; THIS layer is the authorization boundary. Every
 * invocation re-resolves the descriptor, reruns deterministic discovery over
 * a fresh caller-assembled context, rechecks role/capability/scope/authority/
 * revision/lineage, validates the FULL resource bundle (every envelope
 * digest, scope, uniqueness, freshness, dependency digests, canonical
 * compatibility, manifest digest), resolves only allowlisted read bindings,
 * hands the binding a SCOPED view of exactly its declared resources,
 * validates input and output, executes under a deadline with cancellation,
 * re-verifies every consumed resource AFTER execution, and records a
 * redacted trace naming the consumed resources. A caller-supplied discovery
 * digest is recorded for observability and grants NOTHING.
 *
 * Verification is truthful (B05.1): canonical-only reads report
 * `canonical-revision-verified`; reads that consumed auxiliary authority
 * report `composite-resources-verified` and succeed ONLY when every
 * consumed resource re-verified. The old blanket `revision-verified` state
 * no longer exists.
 *
 * No mutation, proposal, release, provider, chat, MCP, or agent execution
 * exists in this module. Errors are redacted: no stack traces, no upstream
 * bodies, no secrets.
 */

import { canonicalJson, engineeringDigest } from "./stable";
import { discoverTools, type DiscoveryContext } from "./tool-discovery";
import {
  ACTIVATED_READ_BINDINGS,
  consumedRef,
  resolveReadBinding,
  type ActivatedReadBinding,
  type ReadBindingResources,
} from "./tool-bindings-readonly";
import {
  consumedManifest,
  validateReadResourceBundle,
  type ReadAuthorityResourceEnvelope,
  type ReadResourceBundle,
  type ReadResourceKind,
  type ResourceFailure,
  type ResourceFailureCode,
  type ResourceManifestEntry,
} from "./resource-envelopes";
import { computeProjectRevision } from "./revision";
import type { ToolRegistry } from "./tool-registry";
import {
  assertSafeJsonValue,
  DEFAULT_INPUT_LIMITS,
  DEFAULT_OUTPUT_LIMITS,
  isWellFormedId,
  validateAgainstSchema,
} from "./tool-io-validation";
import type { EngineeringCapability, ProjectRole } from "./types";

// ─── Request ─────────────────────────────────────────────────────────────────

export interface ReadInvocationRequest {
  invocationId: string;
  toolId: string;
  toolVersion?: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  actorId: string;
  actorRole: ProjectRole;
  grantedCapabilities: readonly EngineeringCapability[];
  channel: DiscoveryContext["channel"];
  /** The revision the caller pins this read to — results verify against it. */
  canonicalRevisionDigest: string;
  lineageId?: string;
  authoritySource: string;
  currentEditor: string;
  selectedObjectRefs?: readonly unknown[];
  args: Record<string, unknown>;
  /** Advisory only — recorded in the trace, NEVER treated as authorization. */
  discoveryDigest?: string;
  timeoutMs?: number;
  cancellation?: AbortSignal;
  traceId: string;
  requestTimestamp: number;
}

// ─── Results ─────────────────────────────────────────────────────────────────

export const READ_FAILURE_STATUSES = [
  "not_registered", "not_discoverable", "not_callable", "unauthorized",
  "scope_mismatch", "stale_revision", "invalid_input", "invalid_output",
  "authority_unavailable", "timeout", "cancelled", "implementation_failed",
  // B05.1 resource-provenance failures — never collapsed into the above.
  "missing_resource", "corrupt_resource", "stale_resource", "foreign_resource",
  "incompatible_resource_revision", "manifest_mismatch", "dependency_mismatch",
  "duplicate_resource",
  // B09.2 — authority-status enforcement (explicit, never collapsed).
  "resource_unverified", "resource_unavailable",
] as const;
export type ReadFailureStatus = (typeof READ_FAILURE_STATUSES)[number];

export type ReadVerificationState = "canonical-revision-verified" | "composite-resources-verified";

export interface ReadInvocationSuccess {
  status: "succeeded";
  toolId: string;
  toolVersion: string;
  invocationId: string;
  traceId: string;
  projectId: string;
  branchId: string;
  sourceRevisionDigest: string;
  lineageId?: string;
  authoritySource: string;
  bindingId: string;
  bindingVersion: string;
  inputDigest: string;
  outputDigest: string;
  /** Every resource the binding consumed: ids, kinds, versions, digests. */
  consumedResources: ResourceManifestEntry[];
  resourceManifestDigest: string;
  startedAt: number;
  completedAt: number;
  verification: ReadVerificationState;
  warnings: string[];
  output: Record<string, unknown>;
}

export interface ReadInvocationFailure {
  status: ReadFailureStatus;
  toolId: string;
  toolVersion?: string;
  invocationId: string;
  traceId: string;
  /** Redacted, controlled diagnostics — never stacks or upstream bodies. */
  diagnostics: string[];
}

export type ReadInvocationResult = ReadInvocationSuccess | ReadInvocationFailure;

// ─── Trace ───────────────────────────────────────────────────────────────────

export interface ReadInvocationTrace {
  schema: "sirkit.read-invocation-trace.v2";
  traceId: string;
  invocationId: string;
  toolId: string;
  toolVersion?: string;
  descriptorDigest?: string;
  registryDigest: string;
  discoveryDigest?: string;
  callerSuppliedDiscoveryDigest?: string;
  actorId: string;
  actorRole: ProjectRole;
  capabilityDecision: string;
  projectId: string;
  branchId: string;
  sourceRevisionDigest: string;
  lineageId?: string;
  authoritySource: string;
  bindingId?: string;
  bindingVersion?: string;
  inputDigest?: string;
  outputDigest?: string;
  /** Digests and identities only — never resource contents. */
  resourceManifestDigest?: string;
  consumedResources?: Array<{ resourceId: string; kind: string; sourceVersion: string; contentDigest: string }>;
  status: ReadInvocationResult["status"];
  startedAt: number;
  completedAt: number;
  diagnostics: string[];
  verification: ReadVerificationState | "not-verified";
}

// ─── Service ─────────────────────────────────────────────────────────────────

export interface ReadInvocationServiceOptions {
  bindings?: readonly ActivatedReadBinding[];
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  maxOutputBytes?: number;
  maxTraces?: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

function dominantResourceFailure(failures: ResourceFailure[]): ResourceFailureCode {
  // Deterministic priority: corruption > manifest > duplicates > foreign >
  // incompatibility > dependency > stale > missing.
  const priority: ResourceFailureCode[] = ["corrupt_resource", "manifest_mismatch", "duplicate_resource", "foreign_resource", "incompatible_resource_revision", "dependency_mismatch", "stale_resource", "missing_resource"];
  for (const code of priority) if (failures.some((failure) => failure.code === code)) return code;
  return "corrupt_resource";
}

export class ReadToolInvocationService {
  private readonly bindings: readonly ActivatedReadBinding[];
  private readonly now: () => number;
  private readonly maxOutputBytes: number;
  private readonly maxTraces: number;
  private readonly traceLog: ReadInvocationTrace[] = [];

  constructor(private readonly registry: ToolRegistry, options?: ReadInvocationServiceOptions) {
    this.bindings = options?.bindings ?? ACTIVATED_READ_BINDINGS;
    this.now = options?.now ?? (() => Date.now());
    this.maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.maxTraces = options?.maxTraces ?? 500;
  }

  traces(): readonly ReadInvocationTrace[] {
    return this.traceLog;
  }

  async invoke(request: ReadInvocationRequest, context: DiscoveryContext, bundle: ReadResourceBundle): Promise<ReadInvocationResult> {
    const startedAt = this.now();
    const partialTrace = {
      schema: "sirkit.read-invocation-trace.v2" as const,
      traceId: request.traceId,
      invocationId: request.invocationId,
      toolId: request.toolId,
      toolVersion: request.toolVersion,
      registryDigest: this.registry.digest(),
      callerSuppliedDiscoveryDigest: request.discoveryDigest,
      actorId: request.actorId,
      actorRole: request.actorRole,
      capabilityDecision: "denied",
      projectId: request.projectId,
      branchId: request.branchId,
      sourceRevisionDigest: request.canonicalRevisionDigest,
      lineageId: request.lineageId,
      authoritySource: request.authoritySource,
      startedAt,
    };
    const fail = (status: ReadFailureStatus, diagnostics: string[], extra?: Partial<ReadInvocationTrace>): ReadInvocationFailure => {
      const redacted = diagnostics.map((item) => item.slice(0, 500));
      this.record({
        ...partialTrace, ...extra,
        status, diagnostics: redacted, completedAt: this.now(), verification: "not-verified",
      });
      return { status, toolId: request.toolId, toolVersion: request.toolVersion, invocationId: request.invocationId, traceId: request.traceId, diagnostics: redacted };
    };

    // 0. Structural gate on untrusted identifiers.
    for (const [name, value] of [["invocationId", request.invocationId], ["traceId", request.traceId], ["projectId", request.projectId], ["branchId", request.branchId], ["tenantId", request.tenantId], ["actorId", request.actorId]] as const) {
      if (!isWellFormedId(value)) return fail("invalid_input", [`${name} is not a well-formed identifier`]);
    }

    // 1. Resolve the exact descriptor/version.
    const descriptor = this.registry.get(request.toolId, request.toolVersion);
    if (!descriptor) return fail("not_registered", [`No registered tool ${request.toolId}${request.toolVersion ? `@${request.toolVersion}` : ""}.`]);

    // 2-4. Rerun deterministic discovery over the FRESH context; the tool must
    // be included NOW. A caller-supplied discovery digest is never authority.
    const discovery = discoverTools(this.registry, context);
    const discovered = discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version);
    if (!discovered) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not included in current discovery";
      return fail("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`], { discoveryDigest: discovery.digest });
    }

    // 5. Role + capability recheck (defense in depth beyond discovery).
    if (!descriptor.requiredRoles.includes(request.actorRole)) {
      return fail("unauthorized", [`Role ${request.actorRole} is not permitted for ${descriptor.toolId}.`], { discoveryDigest: discovery.digest });
    }
    if (!request.grantedCapabilities.includes(descriptor.requiredCapability)) {
      return fail("unauthorized", [`Capability ${descriptor.requiredCapability} is not granted.`], { discoveryDigest: discovery.digest });
    }

    // 6. Tenant/project/branch scope — request, context, and bundle agree.
    const state = bundle.canonicalState.content;
    const scopeAligned =
      request.tenantId === context.tenantId && request.projectId === context.projectId && request.branchId === context.branchId &&
      request.tenantId === state.tenantId && request.projectId === state.projectId && request.branchId === state.branchId &&
      request.actorId === context.actorId && request.actorRole === context.actorRole;
    if (!scopeAligned) return fail("scope_mismatch", ["Request, context, and resources disagree on tenant/project/branch/actor."], { discoveryDigest: discovery.digest });

    // 6b. B05.1: full bundle integrity BEFORE authorization completes —
    // envelope structure/digests, scope, uniqueness, freshness, dependency
    // digests, canonical compatibility, and the manifest digest.
    const bundleFailures = validateReadResourceBundle(bundle, { tenantId: request.tenantId, projectId: request.projectId, branchId: request.branchId });
    if (bundleFailures.length > 0) {
      const code = dominantResourceFailure(bundleFailures);
      return fail(code, bundleFailures.map((failure) => `${failure.code}${failure.resourceId ? `:${failure.resourceId}` : ""} — ${failure.detail}`).sort(), { discoveryDigest: discovery.digest, resourceManifestDigest: bundle.manifestDigest });
    }

    // 7. Authority availability.
    const authorityOk = descriptor.requiredAuthority.includes("none") ||
      (descriptor.requiredAuthority.some((source) => source === bundle.canonicalState.authoritySource) &&
        request.authoritySource === bundle.canonicalState.authoritySource);
    if (!authorityOk) return fail("authority_unavailable", [`Authority ${request.authoritySource} is not available for ${descriptor.toolId}.`], { discoveryDigest: discovery.digest });

    // 8. Pinned revision must equal the supplied snapshot's ACTUAL revision.
    const actualRevision = computeProjectRevision(state).canonicalStateDigest;
    if (request.canonicalRevisionDigest !== actualRevision || context.currentRevisionDigest !== actualRevision) {
      return fail("stale_revision", ["Pinned revision does not match the supplied engineering snapshot."], { discoveryDigest: discovery.digest });
    }

    // 9. Lineage when required.
    if (descriptor.requiresLineage && (!request.lineageId || request.lineageId !== context.lineageId)) {
      return fail("scope_mismatch", ["Lineage id is required and must match the current context."], { discoveryDigest: discovery.digest });
    }

    // 10-11. Strictly read-class with B05-allowed side effects.
    if (descriptor.operationClass !== "read") {
      return fail("not_callable", [`B05 invokes read tools only; ${descriptor.operationClass} is not executable here.`], { discoveryDigest: discovery.digest });
    }
    if (descriptor.sideEffects !== "none" && descriptor.sideEffects !== "derived-cache") {
      return fail("not_callable", [`Side-effect class ${descriptor.sideEffects} is not permitted in the read invocation layer.`], { discoveryDigest: discovery.digest });
    }

    // 12. Explicit allowlisted binding + declared-resource availability.
    const resolution = resolveReadBinding(descriptor, this.bindings);
    if (resolution.state !== "resolved") return fail("not_callable", [resolution.reason], { discoveryDigest: discovery.digest });
    const binding = resolution.binding;
    const available = new Map<ReadResourceKind, ReadAuthorityResourceEnvelope>();
    available.set("canonical-state", bundle.canonicalState);
    for (const envelope of bundle.auxiliary) available.set(envelope.kind, envelope);
    const missing = binding.requiredResources.filter((kind) => !available.has(kind));
    if (missing.length > 0) {
      return fail("missing_resource", missing.map((kind) => `required resource kind ${kind} is not present in the bundle`).sort(), { discoveryDigest: discovery.digest, bindingId: binding.bindingId, bindingVersion: binding.bindingVersion, resourceManifestDigest: bundle.manifestDigest });
    }
    // B09.2 — ONLY verified authority may be consumed. Unverified and
    // unavailable resources refuse with explicit structured codes; the
    // envelope digest + manifest already pin authorityStatus, so a
    // post-seal downgrade is caught as corrupt/manifest mismatch above.
    const consumedAuthorityKinds = [
      ...binding.requiredResources,
      ...(binding.optionalResources ?? []).filter((kind) => available.has(kind)),
    ];
    for (const kind of consumedAuthorityKinds) {
      const status = available.get(kind)!.authorityStatus;
      if (status === "unavailable") {
        return fail("resource_unavailable", [`resource kind ${kind} is marked unavailable by its producer`], { discoveryDigest: discovery.digest, bindingId: binding.bindingId, bindingVersion: binding.bindingVersion, resourceManifestDigest: bundle.manifestDigest });
      }
      if (status !== "verified") {
        return fail("resource_unverified", [`resource kind ${kind} carries unverified authority and may not be consumed`], { discoveryDigest: discovery.digest, bindingId: binding.bindingId, bindingVersion: binding.bindingVersion, resourceManifestDigest: bundle.manifestDigest });
      }
    }

    // 13. Validate arguments (structure + schema). Tool arguments never carry
    // resource contents — resources arrive ONLY through verified envelopes.
    const safety = assertSafeJsonValue(request.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return fail("invalid_input", safety, { discoveryDigest: discovery.digest });
    const schemaErrors = validateAgainstSchema(request.args, descriptor.inputSchema, "args");
    if (schemaErrors.length > 0) return fail("invalid_input", schemaErrors, { discoveryDigest: discovery.digest });
    const inputDigest = engineeringDigest({ tool: descriptor.toolId, version: descriptor.version, args: request.args });

    // Scoped resource view: EXACTLY the declared kinds, nothing else.
    const consumedKinds: ReadResourceKind[] = [
      ...binding.requiredResources,
      ...(binding.optionalResources ?? []).filter((kind) => available.has(kind)),
    ];
    const scoped = buildScopedResources(bundle, consumedKinds);
    const consumed = consumedManifest(bundle, consumedKinds);
    const consumedDigestsBefore = consumed.map((entry) => entry.contentDigest).join("|");
    const traceExtra = {
      discoveryDigest: discovery.digest,
      bindingId: binding.bindingId,
      bindingVersion: binding.bindingVersion,
      inputDigest,
      resourceManifestDigest: bundle.manifestDigest,
      consumedResources: consumed.map((entry) => ({ resourceId: entry.resourceId, kind: entry.kind, sourceVersion: entry.sourceVersion, contentDigest: entry.contentDigest })),
    };

    // 14. Invoke under deadline + cancellation.
    if (request.cancellation?.aborted) {
      return fail("cancelled", ["Invocation was cancelled before execution."], traceExtra);
    }
    const timeoutMs = Math.min(request.timeoutMs ?? descriptor.timeoutMs, descriptor.timeoutMs);
    let output: unknown;
    try {
      output = await invokeWithDeadline(binding, request.args, scoped, timeoutMs, request.cancellation);
    } catch (error) {
      if (error instanceof InvocationTimeoutError) return fail("timeout", [`Binding exceeded ${timeoutMs}ms.`], traceExtra);
      if (error instanceof InvocationCancelledError) return fail("cancelled", ["Invocation was cancelled."], traceExtra);
      // Redaction: class name only — no messages, stacks, or upstream bodies.
      const name = error instanceof Error ? error.name : "UnknownError";
      return fail("implementation_failed", [`IMPLEMENTATION_ERROR:${name} (details redacted).`], traceExtra);
    }

    // 15. Validate output (structure, schema, bounded size).
    const outputSafety = assertSafeJsonValue(output, DEFAULT_OUTPUT_LIMITS, "output");
    const outputSchemaErrors = outputSafety.length > 0 ? [] : validateAgainstSchema(output, descriptor.outputSchema, "output");
    const outputBytes = outputSafety.length > 0 ? 0 : canonicalJson(output).length;
    if (outputSafety.length > 0 || outputSchemaErrors.length > 0 || outputBytes > this.maxOutputBytes) {
      const diagnostics = [...outputSafety, ...outputSchemaErrors, ...(outputBytes > this.maxOutputBytes ? [`output exceeds ${this.maxOutputBytes} canonical bytes`] : [])];
      return fail("invalid_output", diagnostics, traceExtra);
    }

    // 16. B05.1 post-invocation verification: EVERY consumed resource must be
    // unchanged — canonical revision, per-resource content digests, and the
    // bundle manifest digest are all recomputed. Partial verification is
    // never reported as full verification.
    if (computeProjectRevision(bundle.canonicalState.content).canonicalStateDigest !== actualRevision) {
      return fail("stale_revision", ["Canonical state changed during invocation; result discarded."], traceExtra);
    }
    const postFailures = validateReadResourceBundle(bundle, { tenantId: request.tenantId, projectId: request.projectId, branchId: request.branchId });
    const postConsumed = consumedManifest(bundle, consumedKinds).map((entry) => entry.contentDigest).join("|");
    if (postFailures.length > 0 || postConsumed !== consumedDigestsBefore) {
      return fail("stale_resource", ["A consumed resource changed during invocation; result discarded."], traceExtra);
    }
    const verification: ReadVerificationState = consumedKinds.length > 1 ? "composite-resources-verified" : "canonical-revision-verified";

    const outputDigest = engineeringDigest({ tool: descriptor.toolId, version: descriptor.version, output });
    const completedAt = this.now();
    // 17. Redacted trace with consumed-resource identities (never contents).
    this.record({
      ...partialTrace,
      ...traceExtra,
      descriptorDigest: engineeringDigest(descriptor),
      capabilityDecision: `granted:${descriptor.requiredCapability}`,
      outputDigest,
      status: "succeeded",
      completedAt,
      diagnostics: [],
      verification,
    });
    return {
      status: "succeeded",
      toolId: descriptor.toolId,
      toolVersion: descriptor.version,
      invocationId: request.invocationId,
      traceId: request.traceId,
      projectId: request.projectId,
      branchId: request.branchId,
      sourceRevisionDigest: actualRevision,
      ...(request.lineageId ? { lineageId: request.lineageId } : {}),
      authoritySource: request.authoritySource,
      bindingId: binding.bindingId,
      bindingVersion: binding.bindingVersion,
      inputDigest,
      outputDigest,
      consumedResources: consumed,
      resourceManifestDigest: bundle.manifestDigest,
      startedAt,
      completedAt,
      verification,
      warnings: [],
      output: output as Record<string, unknown>,
    };
  }

  private record(trace: ReadInvocationTrace): void {
    this.traceLog.push(trace);
    if (this.traceLog.length > this.maxTraces) this.traceLog.shift();
  }
}

// ─── Scoped resource construction ────────────────────────────────────────────

/** The consumed kinds for a binding against a bundle (required + present optionals). */
export function consumedKindsFor(binding: ActivatedReadBinding, bundle: ReadResourceBundle): ReadResourceKind[] {
  return [
    ...binding.requiredResources,
    ...(binding.optionalResources ?? []).filter((kind) => bundle.auxiliary.some((envelope) => envelope.kind === kind)),
  ];
}

export function buildScopedResources(bundle: ReadResourceBundle, kinds: readonly ReadResourceKind[]): ReadBindingResources {
  const byKind = new Map<ReadResourceKind, ReadAuthorityResourceEnvelope>();
  byKind.set("canonical-state", bundle.canonicalState);
  for (const envelope of bundle.auxiliary) byKind.set(envelope.kind, envelope);
  const scoped: ReadBindingResources = {
    canonicalState: bundle.canonicalState.content,
    canonicalRef: consumedRef(bundle.canonicalState),
  };
  for (const kind of kinds) {
    const envelope = byKind.get(kind);
    if (!envelope) continue;
    switch (kind) {
      case "canonical-state": break;
      case "selection-snapshot":
        scoped.selection = { refs: envelope.content as never, ref: consumedRef(envelope) };
        break;
      case "component-authority-records": {
        const content = envelope.content as { records: never[]; candidates?: never[] };
        scoped.componentAuthority = { records: content.records, candidates: content.candidates, ref: consumedRef(envelope) };
        break;
      }
      case "drc-rules":
        scoped.drcRules = { rules: envelope.content as never, ref: consumedRef(envelope) };
        break;
      case "fab-preset":
        scoped.fabPreset = { preset: envelope.content as never, ref: consumedRef(envelope) };
        break;
      case "drc-preset":
        scoped.drcPreset = { preset: envelope.content as never, ref: consumedRef(envelope) };
        break;
      case "netlist":
        scoped.netlist = { netlist: envelope.content as never, ref: consumedRef(envelope) };
        break;
    }
  }
  return scoped;
}

// ─── Deadline / cancellation ─────────────────────────────────────────────────

class InvocationTimeoutError extends Error { constructor() { super("INVOCATION_TIMEOUT"); this.name = "InvocationTimeoutError"; } }
class InvocationCancelledError extends Error { constructor() { super("INVOCATION_CANCELLED"); this.name = "InvocationCancelledError"; } }

async function invokeWithDeadline(
  binding: ActivatedReadBinding,
  args: Record<string, unknown>,
  resources: ReadBindingResources,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => binding.invoke(args, resources, signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new InvocationTimeoutError()), timeoutMs);
        if (signal) {
          onAbort = () => reject(new InvocationCancelledError());
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

// ─── Model-free replay (B05.1: bundle-pinned) ────────────────────────────────

export interface ReadReplayFixture {
  schema: "sirkit.read-replay-fixture.v2";
  toolId: string;
  toolVersion: string;
  bindingId: string;
  bindingVersion: string;
  args: Record<string, unknown>;
  /** Full pinned resource bundle (deterministic fixture content, no secrets). */
  bundle: ReadResourceBundle;
  expectedOutputDigest: string;
  expectedConsumedManifestDigest: string;
  expectedVerification: ReadVerificationState;
}

export type ReplayOutcome =
  | { state: "match"; outputDigest: string; consumedManifestDigest: string; verification: ReadVerificationState }
  | { state: "mismatch"; detail: string }
  | { state: "failed"; reason: string };

/** Rerun the allowlisted binding against the pinned fixture bundle and
 *  compare output digest, consumed-resource manifest digest, and
 *  verification state. Model-free: no providers, no service, no clock. */
export async function replayReadFixture(
  fixture: ReadReplayFixture,
  bindings: readonly ActivatedReadBinding[] = ACTIVATED_READ_BINDINGS,
): Promise<ReplayOutcome> {
  const binding = bindings.find((candidate) => candidate.bindingId === fixture.bindingId && candidate.toolId === fixture.toolId);
  if (!binding) return { state: "failed", reason: `no allowlisted binding ${fixture.bindingId}` };
  const scope = { tenantId: fixture.bundle.canonicalState.tenantId, projectId: fixture.bundle.canonicalState.projectId, branchId: fixture.bundle.canonicalState.branchId };
  const failures = validateReadResourceBundle(fixture.bundle, scope);
  if (failures.length > 0) {
    return { state: "failed", reason: `fixture bundle integrity failed: ${failures.map((failure) => failure.code).sort().join(", ")}` };
  }
  const consumedKinds = consumedKindsFor(binding, fixture.bundle);
  const scoped = buildScopedResources(fixture.bundle, consumedKinds);
  let output: unknown;
  try {
    output = await Promise.resolve(binding.invoke(structuredClone(fixture.args), scoped));
  } catch (error) {
    return { state: "failed", reason: `binding threw ${(error as Error).name ?? "Error"}` };
  }
  const outputDigest = engineeringDigest({ tool: fixture.toolId, version: fixture.toolVersion, output });
  const consumedManifestDigest = engineeringDigest({ schema: "sirkit.consumed-manifest.v1", consumed: consumedManifest(fixture.bundle, consumedKinds) });
  const verification: ReadVerificationState = consumedKinds.length > 1 ? "composite-resources-verified" : "canonical-revision-verified";
  if (outputDigest !== fixture.expectedOutputDigest) return { state: "mismatch", detail: "output digest changed" };
  if (consumedManifestDigest !== fixture.expectedConsumedManifestDigest) return { state: "mismatch", detail: "consumed-resource manifest digest changed" };
  if (verification !== fixture.expectedVerification) return { state: "mismatch", detail: "verification state changed" };
  return { state: "match", outputDigest, consumedManifestDigest, verification };
}
