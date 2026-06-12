import Anthropic from "@anthropic-ai/sdk";
import type { LogicalNetlist } from "@/lib/schematic-types";
import { THEORY_SYSTEM_PROMPT, THEORY_SUBMIT_SCHEMATIC_TOOL } from "@/app/lib/prompts";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: Request) {
  const { prompt } = await req.json();
  if (!prompt || typeof prompt !== "string") {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2048,
      system: THEORY_SYSTEM_PROMPT,
      tools: [THEORY_SUBMIT_SCHEMATIC_TOOL],
      tool_choice: { type: "tool", name: "submit_schematic" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use" || toolUse.name !== "submit_schematic") {
    return Response.json({ error: "no schematic returned" }, { status: 500 });
  }

  const netlist = toolUse.input as LogicalNetlist;
  return Response.json(netlist);
}
