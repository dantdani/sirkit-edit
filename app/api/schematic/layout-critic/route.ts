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
 * Body:     { state: SchematicState; image: string (data URL: png/jpeg/webp); sheetId?: string }
 *           [PR-J4, 2026-10-23] J.3 item 5 / OD-258 item 5: a project with sheets names the LEAF sheet to tidy (the page sends the active
 *           sheet); the manifest, the image and the `<schematic_state>` context are that sheet's ([PR-J4 integration, 2026-10-23] C-TIDY-3:
 *           the admitted input shrinks with the sheet) while the part read covers the WHOLE project (C-TIDY-1: the proof needs every pin);
 *           the re-layout is merged back onto the whole project with every component re-identified by reference designator
 *           (app/lib/schematic/sheet-tidy.ts) and proven to keep the project connectivity; the response returns the WHOLE project state
 *           plus `sheetId`. Refusals before the model call (422, nothing sent, nothing changed): SHEETS_TIDY_SHEET_REQUIRED (no sheet named),
 *           SHEETS_TIDY_SHEET_UNKNOWN, SHEETS_TIDY_BLOCKS_PENDING (a sheet with child blocks), SHEETS_TIDY_THEORY_PENDING (a sheet holding a
 *           Theory symbol, C-TIDY-4) - each before the part read -, SHEETS_TIDY_PARTS_UNRESOLVED (a catalog record missing: after the one
 *           part read, before the call; C-TIDY-2). Refusal after the model call (422, the critique was requested and billed, nothing applied):
 *           SHEETS_TIDY_NOT_EQUIVALENT (the re-laid sheet would change a connection or drop a port's label: original kept). A document
 *           without sheets is tidied exactly as before (same request, same response bytes).
 * Response: { ok: true; applied: boolean; state: SchematicState;
 *             critique: { groups: Group[]; summary: string };
 *             validation: { ok: boolean; violations: number };
 *             spreadRefDes: string[] }
 *      or:  { ok: false; error: string }   ([PR-L6 spend, 2026-10-19] SPEND-3: or 413 { ok: false; code: "POST_APPLY_INPUT_BOUND_EXCEEDED"; pass: "tidy"; inputBound; ceiling; error } - the exact request's input bound is above the post-apply ceiling, nothing was sent and nothing truncated: app/lib/llm/post-apply-admission.ts) (SPEND-3-A2/A4: or 413 { ok: false; code: "POST_APPLY_INPUT_UNBOUNDED"; pass; reason: "image_allowance_undocumented" | "bound_disproven"; ceiling; error } - the input cannot be bounded: an image at a serving model with no documented cap, or an earlier reported input above its bound latched the admission closed until restart)
 */

import { LAYOUT_CRITIC_SYSTEM_PROMPT, LAYOUT_CRITIC_TOOL } from "@/app/lib/prompts";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { llmRouter } from "@/app/lib/llm/router";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request"; import { generateWithinPostApplyBound, postApplyRefusalResponse } from "@/app/lib/llm/post-apply-admission"; // [PR-L6 spend, 2026-10-19] SPEND-3, on this line so no line moves
import { getFullPartsByIds } from "@/app/lib/parts-search";
import {
  componentBodyBox,
  autoLayoutBuildValidated,
  nearestNeighborGaps,
  evaluateRespacing,
} from "@/lib/build-auto-layout";
import { schematicToBuildNetlist } from "@/lib/schematic-to-netlist"; import { sheetErrors, validateSheetHierarchy, sheetOf } from "@/app/lib/schematic/sheets"; import { sheetTidyContext, tidySheet, tidySheetRefusal } from "@/app/lib/schematic/sheet-tidy"; import { compareCodePoints } from "@/app/lib/stable-compare"; // [PR-J1 integration, 2026-10-22] on this line so no line moves; [PR-J4, 2026-10-23] + the per-sheet tidy (OD-258 item 5); [PR-J4 integration, 2026-10-23] + the sheet's critic context (C-TIDY-3) and the stable sort of the pre-call part check (C-TIDY-2)
import type { CachedPart } from "@/app/lib/parts-cache";
import type { SchematicState } from "@/lib/schematic-types";

export const runtime = "nodejs";

// How much EXTRA courtyard clearance (px) a flagged component earns, by severity.
// Grid snap is 20px, so these are ~1–3.5 grid steps of additional breathing room.
const SPREAD_PX: Record<string, number> = { low: 24, medium: 44, high: 70 };

type Group = { refDes: string[]; reason: string; severity: string }; /** [PR-J, 2026-10-22] J2 / OD-255 item 6: was the SHEETS_TIDY_PENDING sentence; [PR-J4, 2026-10-23] retired - a project with sheets is tidied one leaf sheet at a time (tidySheetRefusal names what is still refused) */ const NO_STORE = { "Cache-Control": "no-store" } as const;

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

// [B16.0.10] canonical wrapper — authorization -> CSRF -> media -> bounded body
// (16 MB / 45 s) run inside the wrapper; the callback receives the parsed body
// only and cannot reach the raw request.
export const POST = authenticatedJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }, async ({ body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as { state?: SchematicState; image?: unknown; provider?: unknown; sheetId?: unknown };

  const state = body.state;
  const provider = requestedProvider(body.provider);
  const kicad = state?.kicadComponents ?? [];
  if (!state || kicad.length === 0) {
    return Response.json(
      { ok: false, error: "Layout critic needs a Build-mode schematic with catalog parts" },
      { status: 400 },
    );
  } const sheetError = sheetErrors(validateSheetHierarchy(state))[0]; if (sheetError) return Response.json({ ok: false, code: "SHEET_HIERARCHY_INVALID", error: `The schematic's sheet structure has an error (${sheetError.code}: ${sheetError.message}), so it cannot be tidied. Nothing was sent and nothing changed.` }, { status: 422, headers: NO_STORE }); // [PR-J1 integration, 2026-10-22] J1-CONS-7: a document whose sheet references are broken is refused before the part read and the model call (it would otherwise be billed, then fail)
  // [PR-J4, 2026-10-23] J.3 item 5 / OD-258 item 5 (was [PR-J, 2026-10-22] J2's SHEETS_TIDY_PENDING refusal of every project with sheets):
  // a project with sheets is tidied ONE named leaf sheet at a time - the manifest, the image and the re-layout are that sheet's, the
  // result is merged back onto the whole project; a missing / unknown sheet or a sheet with child blocks is refused before any read or call
  const tidyRefusal = tidySheetRefusal(state, body.sheetId); if (tidyRefusal) return Response.json({ ok: false, code: tidyRefusal.code, error: tidyRefusal.message }, { status: 422, headers: NO_STORE });
  const sheetId: string | null = state.sheets === undefined ? null : (body.sheetId as string);
  const scoped = sheetId === null ? kicad : kicad.filter((inst) => sheetOf(inst) === sheetId); // a document without sheets: every instance, exactly as before

  const image = parseDataUrl(body.image);
  if (!image) {
    return Response.json(
      { ok: false, error: "Missing or unsupported 'image' (expected a png/jpeg/webp data URL)" },
      { status: 400 },
    );
  }

  // Load real part geometry (server-side) so the manifest boxes and the re-layout
  // both use the same source of truth as the original generation.
  const partIds = [...new Set(kicad.map((c) => c.partId))]; // [PR-J4 integration, 2026-10-23] review C-TIDY-1: the WHOLE project's parts (exactly the pre-J4 flat read) - the sheeted proof below needs every pin, else a lost cross-sheet link is invisible to it; the manifest stays the sheet's
  const loaded = await getFullPartsByIds(partIds);
  const parts = new Map<string, CachedPart>(loaded.map((p) => [p.id, p] as const));
  if (sheetId !== null) { const unresolved = [...new Set(kicad.filter((inst) => !parts.has(inst.partId)).map((inst) => inst.refDes))].sort(compareCodePoints); if (unresolved.length > 0) return Response.json({ ok: false, code: "SHEETS_TIDY_PARTS_UNRESOLVED", error: `The catalog record of ${unresolved.join(", ")} is not loaded, so the re-layout cannot be proven to keep every connection. Nothing was sent and nothing changed.` }, { status: 422, headers: NO_STORE }); } // [PR-J4 integration, 2026-10-23] review C-TIDY-2: the sheeted path refuses a missing record BEFORE the model call (tidySheet would refuse the same after the billed call); the single-sheet path is byte-identical
  // Ground-truth manifest: every placed component the model is allowed to name (the tidied sheet's, [PR-J4] above).
  const manifest = scoped
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
    response = await generateWithinPostApplyBound("tidy", llmRouter, { // [PR-L6 spend, 2026-10-19] SPEND-3: the post-apply input admission - this exact request's bound (an image at the ROUTER's serving model, A3) against the ceiling, BEFORE the provider is called; after it, the reported input against that bound (A2)
      provider, maxProviderRetries: 0, // [PR-L6 integration, 2026-10-19] SPEND-1/3: an automatic post-approval pass is ONE billed attempt (no SDK resend)
      maxTokens: 1536,
      system: LAYOUT_CRITIC_SYSTEM_PROMPT,
      tools: [LAYOUT_CRITIC_TOOL],
      toolChoice: { name: "report_layout_issues" },
      schematicState: sheetId === null ? state : sheetTidyContext(state, sheetId), // [PR-J4 integration, 2026-10-23] review C-TIDY-3: a sheeted request's `<schematic_state>` is the tidied sheet's entities with the sheet tree (the admitted input shrinks with the sheet, as the manifest and image do); the single-sheet request is byte-identical
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
    return postApplyRefusalResponse(error) ?? providerErrorResponse(error, provider); // [PR-L6 spend, 2026-10-19] an admission refusal answers its typed 413 (no provider call was made); any other error is the provider's, as before
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
      ...(sheetId !== null ? { sheetId } : {}), // [PR-J4, 2026-10-23] the tidied sheet (absent for a document without sheets: bytes unchanged)
    });
  }

  // [PR-J4, 2026-10-23] a project with sheets: ONE leaf sheet re-laid out from its own logical netlist and merged back onto the whole
  // project with every component re-identified by reference designator (ids and authority fields kept), proven to keep the project
  // connectivity (else 422 SHEETS_TIDY_NOT_EQUIVALENT, nothing applied); the improved / regressed gates run over that sheet's instances
  if (sheetId !== null) {
    let tidied: ReturnType<typeof tidySheet>;
    try { tidied = tidySheet(state, sheetId, parts, { spread }); }
    catch (error) { return Response.json({ ok: false, code: "SHEET_HIERARCHY_INVALID", error: `The project's connectivity has an error (${error instanceof Error ? error.message : String(error)}), so the sheet cannot be tidied. Nothing changed.` }, { status: 422, headers: NO_STORE }); }
    if (!tidied.ok) return Response.json({ ok: false, code: tidied.code, error: tidied.message, critique: { groups, summary }, spreadRefDes }, { status: 422, headers: NO_STORE });
    const sheetBeforeGaps = nearestNeighborGaps(scoped, parts);
    const sheetAfterGaps = nearestNeighborGaps(tidied.instances, parts);
    const sheetRespacing = evaluateRespacing(sheetBeforeGaps, sheetAfterGaps, spreadRefDes);
    const sheetApplied = tidied.validation.ok && sheetRespacing.improved && sheetRespacing.regressed.length === 0;
    return Response.json({
      ok: true,
      applied: sheetApplied,
      state: sheetApplied ? tidied.state : state,
      sheetId,
      critique: { groups, summary },
      validation: { ok: tidied.validation.ok, violations: tidied.validation.violations.length },
      spreadRefDes,
      regressedRefDes: sheetRespacing.regressed,
      improved: sheetRespacing.improved,
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
});
