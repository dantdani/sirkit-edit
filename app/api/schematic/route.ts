import type { LogicalNetlist } from "@/lib/schematic-types";
import { llmRouter } from "@/app/lib/llm/router";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import { THEORY_SYSTEM_PROMPT, THEORY_SUBMIT_SCHEMATIC_TOOL } from "@/app/lib/prompts";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

/** [PR-C] The model's tool input is a schematic netlist only when it carries both
 *  arrays the client lays out; anything else is the model's own invalid output. */
function isNetlistShape(value: unknown): value is LogicalNetlist {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { components?: unknown; connections?: unknown };
  return Array.isArray(candidate.components) && Array.isArray(candidate.connections);
}

/** [PR-C] A named failure class for invalid model output: the client shows it and
 *  may retry, instead of reading a bare 500. The status stays 500 (historical). */
function invalidOutput(error: string): Response {
  return Response.json({ ok: false, code: "build_invalid_output", error, retryable: true }, { status: 500 });
}

// [B16.0.10] canonical wrapper — authorization -> CSRF -> media -> bounded body
// (16 MB / 45 s) run inside the wrapper; the callback receives the parsed body
// only and cannot reach the raw request.
export const POST = authenticatedJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }, async ({ body: rawBody }) => {
  const { prompt, provider: requested } = rawBody as { prompt?: unknown; provider?: unknown };
  const provider = requestedProvider(requested);
  if (!prompt || typeof prompt !== "string") {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }

  let response;
  try {
    response = await llmRouter.generate({
      provider,
      maxTokens: 2048,
      system: THEORY_SYSTEM_PROMPT,
      tools: [THEORY_SUBMIT_SCHEMATIC_TOOL],
      toolChoice: { name: "submit_schematic" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (error) {
    return providerErrorResponse(error, provider);
  }

  const toolUse = response.toolCalls.find((call) => call.name === "submit_schematic");
  if (!toolUse) {
    return invalidOutput("no schematic returned");
  }

  const netlist: unknown = toolUse.input;
  if (!isNetlistShape(netlist)) {
    return invalidOutput("the model's answer was not a schematic netlist (no components and connections arrays)");
  }
  // success body unchanged: the raw netlist, read as-is by the Theory client
  return Response.json(netlist);
});
