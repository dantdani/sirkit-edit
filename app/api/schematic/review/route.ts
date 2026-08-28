/**
 * POST /api/schematic/review
 *
 * Layer-2 design review (advisory, non-blocking). The client sends the
 * deterministic netlist summary (components + nets + floating pins) computed by
 * lib/netlist-review.ts; the selected brain reviews electrical sensibility and returns
 * findings via a forced report_findings tool call. We then CROSS-CHECK any
 * finding that asserts a pin is unconnected against the ground-truth floating
 * list and drop fully-contradicted findings (the verification step that keeps
 * the LLM from hallucinating disconnections).
 *
 * Body:     ReviewInput  (see lib/netlist-review.ts)
 * Response: { ok: true; findings: Finding[]; summary: string; dropped: number }
 *      or:  { ok: false; error: string }
 */

import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { llmRouter } from "@/app/lib/llm/router";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import { REVIEW_SYSTEM_PROMPT, REVIEW_TOOL } from "@/app/lib/prompts";

export const runtime = "nodejs";

type Finding = {
  severity: "error" | "warning" | "info";
  category: string;
  title: string;
  detail: string;
  refs: string[];
  unconnectedClaim?: string[];
};

// [B16.0.10] canonical wrapper — authorization -> CSRF -> media -> bounded body
// (16 MB / 45 s) run inside the wrapper; the callback receives the parsed body
// only and cannot reach the raw request.
export const POST = authenticatedJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }, async ({ body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as { components?: unknown; nets?: unknown; floatingPins?: unknown; provider?: unknown };

  const components = Array.isArray(body.components) ? body.components : [];
  const provider = requestedProvider(body.provider);
  const nets = Array.isArray(body.nets) ? body.nets : [];
  const floatingPins = Array.isArray(body.floatingPins) ? (body.floatingPins as string[]) : [];
  if (components.length === 0) {
    return Response.json({ ok: false, error: "no components to review" }, { status: 400 });
  }

  let response;
  try {
    response = await llmRouter.generate({
      provider,
      maxTokens: 2048,
      system: REVIEW_SYSTEM_PROMPT,
      tools: [REVIEW_TOOL],
      toolChoice: { name: "report_findings" },
      schematicState: { components, nets, floatingPins },
      messages: [{ role: "user", content: JSON.stringify({ components, nets, floatingPins }) }],
    });
  } catch (error) {
    return providerErrorResponse(error, provider);
  }

  const toolUse = response.toolCalls.find((call) => call.name === "report_findings");
  if (!toolUse) {
    return Response.json({ ok: false, error: "no review returned" }, { status: 500 });
  }

  const raw = toolUse.input as { findings?: unknown; summary?: unknown };
  const rawFindings = Array.isArray(raw.findings) ? (raw.findings as Finding[]) : [];
  const summary = typeof raw.summary === "string" ? raw.summary : "";

  // Verification: a finding whose unconnectedClaim names pins that are ALL
  // actually connected (not in the ground-truth floating set) is contradicted by
  // the netlist — drop it.
  const floating = new Set(floatingPins);
  let dropped = 0;
  const findings = rawFindings.filter((f) => {
    if (!f || typeof f.title !== "string") return false;
    const claims = Array.isArray(f.unconnectedClaim) ? f.unconnectedClaim : [];
    if (claims.length > 0 && claims.every((p) => !floating.has(p))) {
      dropped++;
      return false;
    }
    return true;
  });

  return Response.json({ ok: true, findings, summary, dropped });
});
