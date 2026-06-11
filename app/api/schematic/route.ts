import Anthropic from "@anthropic-ai/sdk";
import type { LogicalNetlist } from "@/lib/schematic-types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are sirkit's schematic generator. The user describes an analog or simple-digital circuit; you respond with a structured schematic by calling the submit_schematic tool.

Rules:
- Use only these component types: resistor, capacitor, inductor, voltage-source, current-source, diode, ground.
- Pin names per type:
  - resistor, capacitor, inductor: "left", "right"
  - diode: "anode" (the triangle side), "cathode" (the bar side)
  - voltage-source, current-source: "+", "-"
  - ground: "pin"
- Component ids follow EE conventions: R1, R2 for resistors; C1, C2 for capacitors; L1 for inductors; V1, V2 for voltage sources; I1 for current sources; D1 / LED1 for diodes; GND1, GND2 for grounds.
- Connection strings are "componentId.pinName" exactly.
- Don't include x/y coordinates; the frontend handles layout.
- "value" examples: "10k" for 10 kΩ resistor, "100n" for 100 nF cap, "9V" for 9 volt source, "1N4148" or "Red LED" for a diode, "" for ground.
- "explanation" is one short paragraph describing the topology and design choices in plain English.
- Topology must be electrically valid: every voltage source's + and - must be reachable from at least one path. Ground is reference; connect at least one node to ground.

Examples:

Example 1 — "An LED in series with a 470 ohm resistor powered by a 9V battery":
{
  "components": [
    { "id": "V1",   "type": "voltage-source", "value": "9V" },
    { "id": "R1",   "type": "resistor",       "value": "470" },
    { "id": "LED1", "type": "diode",          "value": "Red LED" },
    { "id": "GND1", "type": "ground",         "value": "" }
  ],
  "connections": [
    { "from": "V1.+",         "to": "R1.left" },
    { "from": "R1.right",     "to": "LED1.anode" },
    { "from": "LED1.cathode", "to": "GND1.pin" },
    { "from": "V1.-",         "to": "GND1.pin" }
  ],
  "explanation": "Series circuit: 9V source through a 470Ω current-limiting resistor and a red LED to ground."
}

Example 2 — "A passive RC low-pass filter, 1 kHz cutoff, 10k resistor":
{
  "components": [
    { "id": "V1",   "type": "voltage-source", "value": "1V" },
    { "id": "R1",   "type": "resistor",       "value": "10k" },
    { "id": "C1",   "type": "capacitor",      "value": "16n" },
    { "id": "GND1", "type": "ground",         "value": "" }
  ],
  "connections": [
    { "from": "V1.+",     "to": "R1.left" },
    { "from": "R1.right", "to": "C1.left" },
    { "from": "C1.right", "to": "GND1.pin" },
    { "from": "V1.-",     "to": "GND1.pin" }
  ],
  "explanation": "First-order RC low-pass filter; cutoff ≈ 1/(2π·R·C). With 10kΩ and 16nF the cutoff is ~995 Hz."
}

Always call submit_schematic exactly once. Don't add narration outside the tool call.`;

const SUBMIT_SCHEMATIC_TOOL: Anthropic.Tool = {
  name: "submit_schematic",
  description: "Submit the designed schematic as a logical netlist.",
  input_schema: {
    type: "object",
    properties: {
      components: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: {
              type: "string",
              enum: [
                "resistor",
                "capacitor",
                "inductor",
                "voltage-source",
                "current-source",
                "diode",
                "ground",
              ],
            },
            value: { type: "string" },
          },
          required: ["id", "type", "value"],
        },
      },
      connections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
          },
          required: ["from", "to"],
        },
      },
      explanation: { type: "string" },
    },
    required: ["components", "connections", "explanation"],
  },
};

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
      system: SYSTEM_PROMPT,
      tools: [SUBMIT_SCHEMATIC_TOOL],
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
