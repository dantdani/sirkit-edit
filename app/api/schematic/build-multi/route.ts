/**
 * POST /api/schematic/build-multi
 *
 * Multi-agent Build-mode generation:
 *   1. Planner (architect) decomposes the request into subsystem blocks + the
 *      shared net contract between them.
 *   2. Complexity gate: ≤1 block → just run the normal single build loop.
 *   3. Otherwise, design every block IN PARALLEL via the shared build loop, each
 *      scoped to its block + the shared-net names.
 *   4. Deterministically merge the partial netlists (de-collide refDes; nets join
 *      by shared label name).
 *
 * Returns the same shape as /api/schematic/build, so the client lays it out,
 * validates, and reviews it through the existing path.
 *
 * Body:     { prompt: string }
 * Response: { ok: true; netlist: BuildLogicalNetlist; explanation: string }
 *      or:  { ok: false; error: string }
 */

import Anthropic from "@anthropic-ai/sdk";
import { runBuildToolLoop } from "@/app/lib/build-loop";
import { mergeBuildNetlists } from "@/app/lib/merge-netlists";
import {
  BUILD_SYSTEM_PROMPT,
  BUILD_SUBSYSTEM_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
  PLAN_TOOL,
} from "@/app/lib/prompts";

export const runtime = "nodejs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const PLANNER_MODEL = "claude-sonnet-4-6";

type Block = { name: string; brief: string; sharedNets: string[] };

async function plan(prompt: string): Promise<{ blocks: Block[]; rationale: string }> {
  const res = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 2048,
    system: PLAN_SYSTEM_PROMPT,
    tools: [PLAN_TOOL],
    tool_choice: { type: "tool", name: "submit_plan" },
    messages: [{ role: "user", content: prompt }],
  });
  const tool = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_plan",
  );
  const raw = (tool?.input ?? {}) as { blocks?: unknown; rationale?: unknown };
  const blocks: Block[] = Array.isArray(raw.blocks)
    ? (raw.blocks as Record<string, unknown>[])
        .filter((b) => typeof b?.name === "string" && typeof b?.brief === "string")
        .map((b) => ({
          name: b.name as string,
          brief: b.brief as string,
          sharedNets: Array.isArray(b.sharedNets) ? (b.sharedNets as string[]) : [],
        }))
    : [];
  return { blocks, rationale: typeof raw.rationale === "string" ? raw.rationale : "" };
}

export async function POST(req: Request): Promise<Response> {
  let prompt: unknown;
  try {
    ({ prompt } = (await req.json()) as { prompt?: unknown });
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return Response.json({ ok: false, error: "prompt is required" }, { status: 400 });
  }
  const userPrompt = prompt;

  // 1. Plan. On any planner failure, fall back to the single loop.
  let blocks: Block[] = [];
  let rationale = "";
  try {
    ({ blocks, rationale } = await plan(userPrompt));
  } catch (err) {
    console.warn("[build-multi] planner failed; falling back to single loop:", err);
  }

  // 2. Complexity gate — simple circuit (or no plan) → normal single build loop.
  if (blocks.length <= 1) {
    const result = await runBuildToolLoop({ systemPrompt: BUILD_SYSTEM_PROMPT, userMessage: userPrompt });
    if (result.ok) return Response.json({ ok: true, netlist: result.netlist, explanation: result.explanation });
    return Response.json({ ok: false, error: result.error }, { status: result.status });
  }

  // 3. Design every block in parallel, each scoped to its brief + shared nets.
  const designed = await Promise.all(
    blocks.map(async (block) => {
      const userMessage =
        `Block: ${block.name}\n\n${block.brief}\n\n` +
        `SHARED BOARD NETS (connect to these by exact-name labels): ${block.sharedNets.join(", ") || "(none)"}`;
      const result = await runBuildToolLoop({
        systemPrompt: BUILD_SUBSYSTEM_SYSTEM_PROMPT,
        userMessage,
      });
      return { name: block.name, result };
    }),
  );

  const ok = designed.filter((d) => d.result.ok) as {
    name: string;
    result: Extract<(typeof designed)[number]["result"], { ok: true }>;
  }[];
  const failed = designed.filter((d) => !d.result.ok).map((d) => d.name);

  if (ok.length === 0) {
    return Response.json(
      { ok: false, error: `All ${blocks.length} subsystem blocks failed to design.` },
      { status: 500 },
    );
  }

  // 4. Deterministic merge (refDes de-collision; nets join by shared label name).
  const { netlist, notes } = mergeBuildNetlists(
    ok.map((d) => ({ name: d.name, netlist: d.result.netlist })),
  );

  const explanation =
    `Designed as ${ok.length} subsystem block(s)${rationale ? ` — ${rationale}` : ""}.\n\n` +
    netlist.explanation +
    (failed.length > 0 ? `\n\nNote: ${failed.length} block(s) failed and were omitted: ${failed.join(", ")}.` : "") +
    (notes.length > 0 ? `\n\nMerge: ${notes.join("; ")}.` : "");

  return Response.json({ ok: true, netlist: { ...netlist, explanation }, explanation });
}
