/**
 * POST /api/pcb/export/gerbers (PCB Stage 14; [B16.0.2 §G] protected +
 * truthfully attributed).
 *
 * THIS IS A CLIENT-WORKING-COPY ENGINEERING PROTOTYPE EXPORT — NOT a verified
 * manufacturing release and unsuitable as deterministic release evidence.
 * The server-authoritative, admin-only verified release is `/api/pcb/release`
 * (it reloads its own immutable durable source; a browser board can never be
 * release authority). This route:
 *  - requires authenticated project membership + an engineering role
 *    (pcb_editor | reviewer | project_admin) + same-origin CSRF, through the
 *    shared authorization boundary BEFORE the body is read or kicad-cli runs;
 *  - reads its (large) body through the bounded total-settlement reader;
 *  - derives EVERY human/project attribution label from the trusted request
 *    context — `body.actor` / `body.projectIdentity` are REFUSED (400), a
 *    browser can never mint who did it or which project it was;
 *  - labels the archive, README, manifest, and response headers as an
 *    unverified engineering export; `releaseMode: "verified"` is refused
 *    (409) — only `engineering` is producible here.
 *
 * Body:  { board, netlist?, fabPresetId, drcPresetId?, releaseMode: "engineering", waiverReason, boardName?, engine?, action? }
 * 200:   application/zip — the explicitly-labelled engineering package
 * 409:   { error: 'readiness-gate-failed', readiness } | { error: 'authoritative-release-source-required' }
 * 400:   { error: 'bad-request', message }
 * 500:   { error: 'kicad-cli-missing' | 'kicad-cli-failed', stderr? }
 */

import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import { netlistFromBoard } from "@/app/lib/pcb/kicad/write-pcb";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import type { DrcPresetId } from "@/app/lib/pcb/drc/types";
import { FAB_PRESETS } from "@/app/lib/pcb/fab/presets";
import { buildFabBundle } from "@/app/lib/pcb/fab/build-bundle";
import { KicadCliError } from "@/app/lib/pcb/fab/types";
import { compileNativeFabPackage } from "@/app/lib/pcb/fab/native/compiler";
import { NativeFabBlockedError } from "@/app/lib/pcb/fab/native/types";
import { evaluatePcbFabricationReadiness } from "@/app/lib/pcb/readiness/evaluate";
import { createReleaseWaiver } from "@/app/lib/pcb/readiness/waiver";
import { ManufacturingReleaseBlockedError } from "@/app/lib/pcb/readiness/release";
import type { ReleaseDisposition, ReleaseWaiver } from "@/app/lib/pcb/readiness/types";
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
export const maxDuration = 300; // three kicad-cli invocations at 60 s each, worst case

/** A whole PcbBoard + netlist travels in the body. */
const MAX_BODY_BYTES = 16_000_000;
const BODY_DEADLINE_MS = 60_000;

/** Body keys that would mint attribution/authority — refused outright. */
export const ENGINEERING_EXPORT_FORBIDDEN_BODY_KEYS = ["actor", "projectIdentity", "actorId", "role", "tenantId", "projectId", "branchId", "principalId"] as const;

export const ENGINEERING_EXPORT_NOTICE =
  "ENGINEERING PROTOTYPE EXPORT of a client working copy - NOT a verified manufacturing release; unsuitable as deterministic release evidence. Verified release is produced only by the server-authoritative release flow.";

function isBoardLike(x: unknown): x is PcbBoard {
  if (typeof x !== "object" || x === null) return false;
  const b = x as Record<string, unknown>;
  return (
    Array.isArray(b.nets) &&
    Array.isArray(b.footprints) &&
    Array.isArray(b.tracks) &&
    Array.isArray(b.vias) &&
    Array.isArray(b.zones) &&
    (b.stackup === 2 || b.stackup === 4) &&
    typeof b.outline === "object" &&
    b.outline !== null
  );
}

function isNetlistLike(x: unknown): x is PcbNetlist {
  if (typeof x !== "object" || x === null) return false;
  const n = x as Record<string, unknown>;
  return Array.isArray(n.components) && Array.isArray(n.nets);
}

function bad(message: string): Response {
  return Response.json({ error: "bad-request", message }, { status: 400 });
}

/** The ONLY source of human/project attribution: the trusted request context. */
export function engineeringExportAttribution(context: TrustedRequestContext): { actor: string; projectIdentity: string } {
  return {
    actor: `${context.actor.actorKind}:${context.principalId}`,
    projectIdentity: `${context.tenantId}/${context.projectId}/${context.branchId}`,
  };
}

// [B16.0.13] canonical wrapper — authenticated membership + engineering role +
// CSRF + the bounded read run inside the wrapper BEFORE the callback, so no
// kicad-cli process can run until every boundary succeeds; attribution is
// derived from the wrapper's trusted context only.
export const POST = authenticatedJsonRoute({ maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_DEADLINE_MS }, async ({ context, body: rawBody }): Promise<Response> => {
  const attribution = engineeringExportAttribution(context);

  const body = rawBody as {
    board?: unknown;
    netlist?: unknown;
    fabPresetId?: unknown;
    drcPresetId?: unknown;
    overrideDrcFail?: unknown;
    boardName?: unknown;
    engine?: unknown;
    action?: unknown;
    releaseMode?: unknown;
    waiverReason?: unknown;
  };
  for (const key of ENGINEERING_EXPORT_FORBIDDEN_BODY_KEYS) {
    if (key in body) return bad(`body.${key} is not accepted: attribution is derived from the authenticated session, never from the request body`);
  }

  if (!isBoardLike(body.board)) return bad("body.board must be a PcbBoard");
  if (body.netlist !== undefined && !isNetlistLike(body.netlist)) {
    return bad("body.netlist must be a PcbNetlist");
  }
  const fabPreset = FAB_PRESETS.find((p) => p.id === body.fabPresetId);
  if (!fabPreset) return bad(`unknown fabPresetId ${JSON.stringify(body.fabPresetId)}`);
  if (body.overrideDrcFail !== undefined) return bad("overrideDrcFail is retired; use releaseMode='engineering' with a reasoned revision-bound override");
  const engine = body.engine ?? "kicad";
  if (engine !== "kicad" && engine !== "native-beta") return bad("engine must be kicad or native-beta");
  const action = body.action ?? "package";
  if (action !== "package" && action !== "preflight") return bad("action must be package or preflight");
  const releaseMode = body.releaseMode ?? "verified";
  if (releaseMode !== "verified" && releaseMode !== "engineering") return bad("releaseMode must be verified or engineering");
  if (releaseMode === "engineering" && (typeof body.waiverReason !== "string" || body.waiverReason.trim().length < 8)) {
    return bad("engineering release requires a waiverReason of at least 8 characters");
  }

  // DRC preset: explicit request wins, else the fab preset's soft link.
  let drcPreset;
  try {
    drcPreset = getPreset(
      (typeof body.drcPresetId === "string" ? body.drcPresetId : fabPreset.drcPresetId) as DrcPresetId,
    );
  } catch {
    return bad(`unknown drcPresetId ${JSON.stringify(body.drcPresetId)}`);
  }

  const board = body.board;
  const providedNetlist = isNetlistLike(body.netlist) ? body.netlist : undefined;
  const schematicIntentAvailable = providedNetlist !== undefined;
  const netlist: PcbNetlist = providedNetlist ?? netlistFromBoard(board);
  const boardName = typeof body.boardName === "string" ? body.boardName : "sirkit-board";
  const exporter = engine === "native-beta" ? "sirkit-native" as const : "kicad-assisted" as const;
  const initialReadiness = evaluatePcbFabricationReadiness({
    board,
    netlist: schematicIntentAvailable ? netlist : undefined,
    fabPreset,
    drcPreset,
    exporter,
  });
  const waivers: ReleaseWaiver[] = [];
  const disposition: ReleaseDisposition = releaseMode === "engineering" ? "engineering_prototype_export" : "verified_manufacturing_release";
  const waivableCheckCodes = initialReadiness.checks.filter((check) => check.state !== "pass" && check.waivableForEngineeringExport).map((check) => check.code);
  if (releaseMode === "engineering" && waivableCheckCodes.length > 0) waivers.push(createReleaseWaiver({
    checkCodes: waivableCheckCodes,
    diagnosticCodes: [...initialReadiness.blockers, ...initialReadiness.unknowns].map((item) => item.code),
    componentIds: [...initialReadiness.blockers, ...initialReadiness.unknowns].flatMap((item) => item.componentIds ?? []),
    netStableIds: [...initialReadiness.blockers, ...initialReadiness.unknowns].flatMap((item) => item.netStableIds ?? []),
    objectIds: [...initialReadiness.blockers, ...initialReadiness.unknowns].flatMap((item) => item.objectIds ?? []),
    reason: String(body.waiverReason),
    // [B16.0.2 §G] the waiver's actor is the VERIFIED session principal.
    actor: attribution.actor,
    designRevision: initialReadiness.designRevision,
    manufacturingProfileId: fabPreset.id,
    manufacturingProfileVersion: fabPreset.version,
  }));
  if (action === "preflight") return Response.json({
    engineeringExportNotice: ENGINEERING_EXPORT_NOTICE,
    readiness: evaluatePcbFabricationReadiness({
      board,
      netlist: schematicIntentAvailable ? netlist : undefined,
      fabPreset,
      drcPreset,
      exporter,
      waivers,
    }),
  }, { headers: { "Cache-Control": "no-store", "X-Sirkit-Engineering-Export": "not-verified-release" } });

  // MFG01: a browser-supplied board is never verified release authority. The
  // authoritative release function reloads its immutable server source twice;
  // this legacy endpoint remains available only for explicitly-labelled,
  // revision-waived engineering artifacts.
  if (releaseMode === "verified") return Response.json({
    error: "authoritative-release-source-required",
    message: "Verified release requires the MFG01 server-authoritative source loader (/api/pcb/release); a browser PcbBoard cannot publish manufacturing authority. This route produces only explicitly-labelled engineering prototype exports.",
    readiness: initialReadiness,
  }, { status: 409, headers: { "Cache-Control": "no-store" } });

  const legacyHeaders = {
    "Cache-Control": "no-store",
    "X-Sirkit-Engineering-Export": "not-verified-release",
    "X-Sirkit-Export-Notice": ENGINEERING_EXPORT_NOTICE,
    "X-Sirkit-Export-Attribution-Source": "trusted-request-context",
  } as const;

  try {
    if (engine === "native-beta") {
      const result = await compileNativeFabPackage({
        board,
        netlist,
        fabPreset,
        drcPreset,
        boardName,
        schematicIntentAvailable,
        releaseDisposition: disposition,
        waivers,
        projectIdentity: attribution.projectIdentity,
        actor: attribution.actor,
      });
      return new Response(Buffer.from(result.zipBytes), {
        status: 200,
        headers: {
          ...legacyHeaders,
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${result.filename}"`,
          "X-Sirkit-Native-Signoff": result.manifest.signoff,
          "X-Sirkit-Readiness-Report": result.readiness.reportId,
          "X-Sirkit-Release-Disposition": result.releaseManifest.disposition,
          "X-Sirkit-Package-SHA256": result.packageSha256,
          "X-Sirkit-Bundle-Stats": JSON.stringify({
            files: result.files.length,
            totalBytes: result.zipBytes.byteLength,
            drcErrors: 0,
            drcWarnings: result.manifest.diagnostics.warnings,
            elapsedMs: result.stages.reduce((sum, stage) => sum + stage.elapsedMs, 0),
          }),
        },
      });
    }
    const result = await buildFabBundle({
      board,
      netlist,
      fabPreset,
      drcPreset,
      boardName,
      schematicIntentAvailable,
      releaseDisposition: disposition,
      waivers,
      projectIdentity: attribution.projectIdentity,
      actor: attribution.actor,
    });
    return new Response(Buffer.from(result.zipBytes), {
      status: 200,
      headers: {
        ...legacyHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "X-Sirkit-Readiness-Report": result.readiness.reportId,
        "X-Sirkit-Release-Disposition": result.releaseManifest.disposition,
        "X-Sirkit-Bundle-Stats": JSON.stringify({
          files: result.stats.gerberFiles.length + result.stats.drillFiles.length + result.stats.posFiles.length + 2,
          totalBytes: result.stats.totalBytes,
          drcErrors: result.stats.drcErrors,
          drcWarnings: result.stats.drcWarnings,
          elapsedMs: result.stats.elapsedMs,
        }),
      },
    });
  } catch (e) {
    if (e instanceof ManufacturingReleaseBlockedError) {
      return Response.json(
        { error: "readiness-gate-failed", code: e.code, message: e.message, readiness: e.report },
        { status: 409 },
      );
    }
    if (e instanceof NativeFabBlockedError) {
      return Response.json(
        { error: "native-preflight-failed", message: e.message, diagnostics: e.diagnostics },
        { status: 400 },
      );
    }
    if (e instanceof KicadCliError) {
      return Response.json(
        {
          error: e.kind === "cli-missing" ? "kicad-cli-missing" : "kicad-cli-failed",
          message: e.message,
          stderr: e.stderr.slice(-4000) || undefined,
        },
        { status: 500 },
      );
    }
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: "export-failed", message }, { status: 500 });
  }
});
