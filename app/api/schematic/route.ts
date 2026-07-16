import type { LogicalNetlist } from "@/lib/schematic-types";
import { llmRouter } from "@/app/lib/llm/router";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import { THEORY_SYSTEM_PROMPT, THEORY_SUBMIT_SCHEMATIC_TOOL } from "@/app/lib/prompts";

export async function POST(req: Request) {
  const { prompt, provider: requested } = await req.json();
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
    return Response.json({ error: "no schematic returned" }, { status: 500 });
  }

  const netlist = toolUse.input as unknown as LogicalNetlist;
  return Response.json(netlist);
}
