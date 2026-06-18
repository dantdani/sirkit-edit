/**
 * POST /api/schematic/review
 *
 * Layer-2 design review (advisory, non-blocking). The client sends the
 * deterministic netlist summary (components + nets + floating pins) computed by
 * lib/netlist-review.ts; Claude reviews electrical sensibility and returns
 * findings via a forced report_findings tool call. We then CROSS-CHECK any
 * finding that asserts a pin is unconnected against the ground-truth floating
 * list and drop fully-contradicted findings (the verification step that keeps
 * the LLM from hallucinating disconnections).
 *
 * Body:     ReviewInput  (see lib/netlist-review.ts)
 * Response: { ok: true; findings: Finding[]; summary: string; dropped: number }
 *      or:  { ok: false; error: string }
 */

import Anthropic from "@anthropic-ai/sdk";
import { REVIEW_SYSTEM_PROMPT, REVIEW_TOOL } from "@/app/lib/prompts";

export const runtime = "nodejs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";

type Finding = {
  severity: "error" | "warning" | "info";
  category: string;
  title: string;
  detail: string;
  refs: string[];
  unconnectedClaim?: string[];
};

export async function POST(req: Request): Promise<Response> {
  let body: { components?: unknown; nets?: unknown; floatingPins?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const components = Array.isArray(body.components) ? body.components : [];
  const nets = Array.isArray(body.nets) ? body.nets : [];
  const floatingPins = Array.isArray(body.floatingPins) ? (body.floatingPins as string[]) : [];
  if (components.length === 0) {
    return Response.json({ ok: false, error: "no components to review" }, { status: 400 });
  }

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: REVIEW_SYSTEM_PROMPT,
      tools: [REVIEW_TOOL],
      tool_choice: { type: "tool", name: "report_findings" },
      messages: [{ role: "user", content: JSON.stringify({ components, nets, floatingPins }) }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "report_findings",
  );
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
}
