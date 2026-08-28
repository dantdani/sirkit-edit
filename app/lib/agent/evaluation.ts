/**
 * B11 — the versioned evaluation-case / evaluation-report contract and its
 * deterministic scorer.
 *
 * Every case is executed through the provider-free replay engine (real
 * registry, discovery, context-integrity boundary, gateway, normalized
 * loop; scripted adapter; trace recorder). No provider, database, or
 * network call happens anywhere in this module.
 */

import { engineeringDigest } from "../engineering/stable";
import { containsSecretShapedText, validateAgentRunTrace, type AgentRunTrace } from "./trace";
import { replayCapsule, ReplayCapsuleInvalidError, type ReplayCapsule, type ReplayOptions } from "./replay-capsule";

export const EVALUATION_CASE_SCHEMA = "sirkit.agent-evaluation-case.v1" as const;
export const EVALUATION_REPORT_SCHEMA = "sirkit.agent-evaluation-report.v1" as const;

export const EVALUATION_CATEGORIES = [
  "resource-withholding", "discovery", "tool-selection", "refusal",
  "provider-parity", "terminal-safety", "proposal-only", "failure-classification",
  "no-fallback", "redaction", "recorder-safety",
] as const;
export type EvaluationCategory = (typeof EVALUATION_CATEGORIES)[number];

/** A deterministic assertion over one replay outcome. */
export interface EvaluationCheck {
  id: string;
  /** Pure predicate over the replay result — no clocks, no randomness. */
  evaluate(input: { trace: AgentRunTrace; discoveredTools: string[]; failures: string[] }): { pass: boolean; detail: string };
}

export interface EvaluationCase {
  schema: typeof EVALUATION_CASE_SCHEMA;
  caseId: string;
  title: string;
  category: EvaluationCategory;
  capsule: ReplayCapsule;
  checks: EvaluationCheck[];
  /** Replay options (throwing sink, provider-failure factory, …). */
  options?: ReplayOptions;
}

export interface EvaluationCaseResult {
  caseId: string;
  title: string;
  category: EvaluationCategory;
  passed: boolean;
  checks: Array<{ id: string; pass: boolean; detail: string }>;
  discoveredTools: string[];
  terminal: { outcome: string; failureReason: string | null };
  traceDigest: string;
}

export interface EvaluationReport {
  schema: typeof EVALUATION_REPORT_SCHEMA;
  registryDigest: string;
  promptVersion: string;
  totals: { cases: number; passed: number; failed: number; checks: number; checksPassed: number };
  results: EvaluationCaseResult[];
  reportDigest: string;
}

/** Run one case deterministically. Replay expectations are scored as the
 *  implicit `replay-expectations` check so fixture drift is a failure. */
export async function runEvaluationCase(evaluationCase: EvaluationCase): Promise<EvaluationCaseResult> {
  // [B11.1] an invalid/secret-bearing capsule is refused BEFORE execution;
  // the suite scores it as a failed case instead of exploding, and the
  // structured classification never echoes capsule values.
  let outcome: Awaited<ReturnType<typeof replayCapsule>>;
  try {
    outcome = await replayCapsule(evaluationCase.capsule, evaluationCase.options);
  } catch (error) {
    const code = error instanceof ReplayCapsuleInvalidError ? error.code : "REPLAY_FAILED";
    const detail = error instanceof ReplayCapsuleInvalidError ? error.issues.slice(0, 3).join(" | ") : "replay failed";
    return {
      caseId: evaluationCase.caseId,
      title: evaluationCase.title,
      category: evaluationCase.category,
      passed: false,
      checks: [{ id: "capsule-validity", pass: false, detail: `${code}: ${detail}` }],
      discoveredTools: [],
      terminal: { outcome: "failed", failureReason: "internal_error" },
      traceDigest: "",
    };
  }
  const checks: Array<{ id: string; pass: boolean; detail: string }> = [{
    id: "replay-expectations",
    pass: outcome.ok,
    detail: outcome.ok ? "every pinned capsule expectation matched" : outcome.failures.slice(0, 3).join(" | "),
  }];
  for (const check of evaluationCase.checks) {
    const result = check.evaluate({ trace: outcome.trace, discoveredTools: outcome.discoveredTools, failures: outcome.failures });
    checks.push({ id: check.id, pass: result.pass, detail: result.detail });
  }
  return {
    caseId: evaluationCase.caseId,
    title: evaluationCase.title,
    category: evaluationCase.category,
    passed: checks.every((check) => check.pass),
    checks,
    discoveredTools: outcome.discoveredTools,
    terminal: { outcome: outcome.trace.terminal.outcome, failureReason: outcome.trace.terminal.failureReason },
    traceDigest: outcome.traceDigest,
  };
}

export async function runEvaluationSuite(cases: readonly EvaluationCase[]): Promise<EvaluationReport> {
  const results: EvaluationCaseResult[] = [];
  for (const evaluationCase of cases) results.push(await runEvaluationCase(evaluationCase));
  const checks = results.reduce((total, result) => total + result.checks.length, 0);
  const checksPassed = results.reduce((total, result) => total + result.checks.filter((check) => check.pass).length, 0);
  const body = {
    schema: EVALUATION_REPORT_SCHEMA,
    registryDigest: cases[0]?.capsule.registryDigest ?? "",
    promptVersion: cases[0]?.capsule.promptVersion ?? "",
    totals: {
      cases: results.length,
      passed: results.filter((result) => result.passed).length,
      failed: results.filter((result) => !result.passed).length,
      checks,
      checksPassed,
    },
    results,
  };
  return { ...body, reportDigest: engineeringDigest({ schema: "sirkit.agent-evaluation-report-digest.v1", body }) };
}

// ─── Reusable deterministic checks ──────────────────────────────────────────

export const checks = {
  toolsExactly(expected: readonly string[]): EvaluationCheck {
    return {
      id: `tools-exactly:${[...expected].sort().join(",") || "(none)"}`,
      evaluate: ({ discoveredTools }) => {
        const actual = [...discoveredTools].sort().join(",");
        const want = [...expected].sort().join(",");
        return { pass: actual === want, detail: actual === want ? "exact toolset" : `got [${actual}] want [${want}]` };
      },
    };
  },
  toolAbsent(toolId: string): EvaluationCheck {
    return {
      id: `tool-absent:${toolId}`,
      evaluate: ({ discoveredTools, trace }) => {
        const advertised = discoveredTools.includes(toolId);
        const invoked = trace.events.some((event) => event.kind === "tool_invocation" && event.toolId === toolId && event.outcomeClass !== "refused");
        return { pass: !advertised && !invoked, detail: advertised ? "advertised" : invoked ? "invoked" : "neither discoverable nor callable" };
      },
    };
  },
  outcomeStatus(toolId: string, expectedStatus: string): EvaluationCheck {
    return {
      id: `outcome:${toolId}=${expectedStatus}`,
      evaluate: ({ trace }) => {
        const event = trace.events.find((item) => item.kind === "tool_invocation" && item.toolId === toolId);
        const status = event && event.kind === "tool_invocation" ? event.status : "(no invocation)";
        return { pass: status === expectedStatus, detail: `status=${status}` };
      },
    };
  },
  terminalIs(outcome: string, failureReason: string | null): EvaluationCheck {
    return {
      id: `terminal:${outcome}${failureReason ? `/${failureReason}` : ""}`,
      evaluate: ({ trace }) => {
        const terminalEvents = trace.events.filter((event) => event.kind === "terminal");
        const matches = trace.terminal.outcome === outcome && trace.terminal.failureReason === failureReason;
        return {
          pass: matches && terminalEvents.length === 1,
          detail: `terminals=${terminalEvents.length} outcome=${trace.terminal.outcome} reason=${trace.terminal.failureReason ?? "null"}`,
        };
      },
    };
  },
  proposalOnly(): EvaluationCheck {
    return {
      id: "proposal-only-no-mutation",
      evaluate: ({ trace }) => {
        const invocations = trace.events.filter((event): event is Extract<typeof event, { kind: "tool_invocation" }> => event.kind === "tool_invocation");
        const mutating = invocations.filter((event) => !["read", "propose"].includes(event.operationClass));
        const sealed = invocations.filter((event) => event.outcomeClass === "proposal");
        return {
          pass: mutating.length === 0 && sealed.length <= 1,
          detail: `mutatingInvocations=${mutating.length} sealedProposals=${sealed.length}`,
        };
      },
    };
  },
  traceIsClean(): EvaluationCheck {
    return {
      id: "trace-schema-and-redaction",
      evaluate: ({ trace }) => {
        const issues = validateAgentRunTrace(trace);
        const serialized = JSON.stringify(trace);
        const secretShaped = containsSecretShapedText(serialized);
        // Provider continuation state / raw bodies can never appear.
        const leaks = ["continuation", "encrypted_content", "thinking", "raw_response", "stack"].filter((needle) => serialized.includes(needle));
        return {
          pass: issues.length === 0 && !secretShaped && leaks.length === 0,
          detail: issues.length > 0 ? `schema: ${issues[0]!}` : secretShaped ? "secret-shaped content" : leaks.length > 0 ? `leak: ${leaks.join(",")}` : "bounded, redacted, schema-exact",
        };
      },
    };
  },
  recorderDiagnostics(expected: readonly string[]): EvaluationCheck {
    return {
      id: `recorder-diagnostics:${[...expected].sort().join(",") || "(none)"}`,
      evaluate: ({ trace }) => {
        const actual = [...trace.recorderDiagnostics].sort().join(",");
        const want = [...expected].sort().join(",");
        return { pass: actual === want, detail: `diagnostics=[${actual}]` };
      },
    };
  },
  singleProviderNoFallback(provider: "openai" | "anthropic"): EvaluationCheck {
    return {
      id: `single-provider:${provider}`,
      evaluate: ({ trace }) => ({
        pass: trace.provider === provider,
        detail: `trace provider=${trace.provider} (a switch is a NEW run; the loop never retries on another provider)`,
      }),
    };
  },
};

/** Normalize a trace for cross-provider comparison: identities, clocks, and
 *  provider/model labels are stripped; structure and classifications stay. */
export function normalizeTraceForParity(trace: AgentRunTrace): unknown {
  return {
    scope: trace.scope,
    contextDigests: trace.contextDigests,
    events: trace.events.map((event) =>
      event.kind === "step"
        ? { kind: event.kind, inputTokens: event.inputTokens, outputTokens: event.outputTokens, toolCallCount: event.toolCallCount }
        : event.kind === "tool_invocation"
          ? { kind: event.kind, toolId: event.toolId, version: event.version, operationClass: event.operationClass, argsDigest: event.argsDigest, outcomeClass: event.outcomeClass, status: event.status, verification: event.verification, outputDigest: event.outputDigest }
          : event.kind === "terminal"
            ? { kind: event.kind, outcome: event.outcome, failureReason: event.failureReason }
            : { kind: event.kind },
    ),
    terminal: { outcome: trace.terminal.outcome, failureReason: trace.terminal.failureReason, steps: trace.terminal.steps, toolCalls: trace.terminal.toolCalls, usage: trace.terminal.usage },
    warnings: trace.warnings,
    recorderDiagnostics: trace.recorderDiagnostics,
  };
}
