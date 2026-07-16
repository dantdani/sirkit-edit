/**
 * POST /api/schematic/layout-critic
 *
 * Layer-2 LAYOUT critic (advisory, vision-grounded, deterministically applied).
 *
 * The client renders the current schematic to a PNG and posts it together with
 * the live `SchematicState`. We send the image PLUS a ground-truth manifest
 * (every component's refDes / role / bounding box) to the selected vision model, which flags
 * GROUPS of refDes whose PLACEMENT reads as too crowded — it never proposes
 * coordinates. We then VERIFY the flagged refDes against the manifest, turn each
 * into extra courtyard clearance, invert the state to its netlist, and re-run the
 * VALIDATED auto-layout with those spread hints. The new layout is only applied
 * if it stays electrically valid (connectivity is reproduced) — otherwise the
 * original state is returned untouched.
 *
 * "Vision proposes crowded regions, deterministic geometry disposes the moves."
 *
 * Body:     { state: SchematicState; image: string (data URL: png/jpeg/webp) }
 * Response: { ok: true; applied: boolean; state: SchematicState;
 *             critique: { groups: Group[]; summary: string };
 *             validation: { ok: boolean; violations: number };
 *             spreadRefDes: string[] }
 *      or:  { ok: false; error: string }
 */

import { LAYOUT_CRITIC_SYSTEM_PROMPT, LAYOUT_CRITIC_TOOL } from "@/app/lib/prompts";
import { llmRouter } from "@/app/lib/llm/router";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import { getFullPartsByIds } from "@/app/lib/parts-search";
import {
  componentBodyBox,
  autoLayoutBuildValidated,
  nearestNeighborGaps,
  evaluateRespacing,
} from "@/lib/build-auto-layout";
import { schematicToBuildNetlist } from "@/lib/schematic-to-netlist";
import type { CachedPart } from "@/app/lib/parts-cache";
import type { SchematicState } from "@/lib/schematic-types";

export const runtime = "nodejs";

// How much EXTRA courtyard clearance (px) a flagged component earns, by severity.
// Grid snap is 20px, so these are ~1–3.5 grid steps of additional breathing room.
const SPREAD_PX: Record<string, number> = { low: 24, medium: 44, high: 70 };

type Group = { refDes: string[]; reason: string; severity: string };

const SUPPORTED_IMAGE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Validate and split a supported image data URL. */
function parseDataUrl(
  url: unknown,
): { media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string } | null {
  if (typeof url !== "string") return null;
  // toDataURL emits a single line (no newlines), so the default dot is fine.
  const m = /^data:([^;,]+);base64,(.+)$/.exec(url);
  if (!m) return null;
  const media = m[1].toLowerCase();
  if (!SUPPORTED_IMAGE.has(media)) return null;
  return { media_type: media as "image/png", data: m[2] };
}

export async function POST(req: Request): Promise<Response> {
  let body: { state?: SchematicState; image?: unknown; provider?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const state = body.state;
  const provider = requestedProvider(body.provider);
  const kicad = state?.kicadComponents ?? [];
  if (!state || kicad.length === 0) {
    return Response.json(
      { ok: false, error: "Layout critic needs a Build-mode schematic with catalog parts" },
      { status: 400 },
    );
  }

  const image = parseDataUrl(body.image);
  if (!image) {
    return Response.json(
      { ok: false, error: "Missing or unsupported 'image' (expected a png/jpeg/webp data URL)" },
      { status: 400 },
    );
  }

  // Load real part geometry (server-side) so the manifest boxes and the re-layout
  // both use the same source of truth as the original generation.
  const partIds = [...new Set(kicad.map((c) => c.partId))];
  const loaded = await getFullPartsByIds(partIds);
  const parts = new Map<string, CachedPart>(loaded.map((p) => [p.id, p] as const));

  // Ground-truth manifest: every placed component the model is allowed to name.
  const manifest = kicad
    .map((inst) => {
      const part = parts.get(inst.partId);
      if (!part) return null;
      const b = componentBodyBox(inst, part);
      return {
        refDes: inst.refDes,
        role: part.mainCategory ?? "",
        value: inst.value ?? "",
        box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
  const knownRefDes = new Set(manifest.map((m) => m.refDes));

  let response;
  try {
    response = await llmRouter.generate({
      provider,
      maxTokens: 1536,
      system: LAYOUT_CRITIC_SYSTEM_PROMPT,
      tools: [LAYOUT_CRITIC_TOOL],
      toolChoice: { name: "report_layout_issues" },
      schematicState: state,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", dataUrl: body.image as string, detail: "high" },
            {
              type: "text",
              text:
                "Rendered schematic above. Manifest of all components (refDes, role, value, " +
                "bounding box in drawing coordinates):\n" +
                JSON.stringify(manifest) +
                "\n\nFlag only genuinely crowded groups via report_layout_issues.",
            },
          ],
        },
      ],
    });
  } catch (error) {
    return providerErrorResponse(error, provider);
  }

  const toolUse = response.toolCalls.find((call) => call.name === "report_layout_issues");
  if (!toolUse) {
    return Response.json({ ok: false, error: "no layout critique returned" }, { status: 500 });
  }

  const raw = toolUse.input as { groups?: unknown; summary?: unknown };
  const rawGroups = Array.isArray(raw.groups) ? (raw.groups as Group[]) : [];
  const summary = typeof raw.summary === "string" ? raw.summary : "";

  // VERIFY: keep only refDes that actually exist; drop hallucinated names. Build
  // the spread map = max extra clearance any group assigned to each component.
  const spread: Record<string, number> = {};
  const groups: Group[] = [];
  for (const g of rawGroups) {
    const refs = Array.isArray(g?.refDes) ? g.refDes.filter((r) => knownRefDes.has(r)) : [];
    if (refs.length === 0) continue;
    const extra = SPREAD_PX[g.severity] ?? SPREAD_PX.medium;
    for (const r of refs) spread[r] = Math.max(spread[r] ?? 0, extra);
    groups.push({ refDes: refs, reason: typeof g.reason === "string" ? g.reason : "", severity: g.severity });
  }
  const spreadRefDes = Object.keys(spread);

  // Nothing actionable → return the original state unchanged.
  if (spreadRefDes.length === 0) {
    return Response.json({
      ok: true,
      applied: false,
      state,
      critique: { groups, summary },
      validation: { ok: true, violations: 0 },
      spreadRefDes,
    });
  }

  // Re-layout the SAME circuit (inverted from the current geometry) with the
  // crowded components granted extra clearance. The validated layout reproduces
  // the original connectivity; we only apply it if that holds.
  const netlist = schematicToBuildNetlist(state, parts);
  const { state: newState, validation } = autoLayoutBuildValidated(netlist, parts, 3, { spread });

  // Regression guard: the re-layout reshuffles ALL components, so confirm it
  // actually gave the flagged parts more room WITHOUT squeezing any previously-
  // comfortable part below the comfort gap (i.e. without moving the crowding
  // elsewhere). Compare nearest-neighbour spacing before vs after.
  const beforeGaps = nearestNeighborGaps(kicad, parts);
  const afterGaps = nearestNeighborGaps(newState.kicadComponents ?? [], parts);
  const { improved, regressed } = evaluateRespacing(beforeGaps, afterGaps, spreadRefDes);

  const sameCount = (newState.kicadComponents?.length ?? 0) === kicad.length;
  const applied = validation.ok && sameCount && improved && regressed.length === 0;

  return Response.json({
    ok: true,
    applied,
    state: applied ? newState : state,
    critique: { groups, summary },
    validation: { ok: validation.ok, violations: validation.violations.length },
    spreadRefDes,
    regressedRefDes: regressed,
    improved,
  });
}
