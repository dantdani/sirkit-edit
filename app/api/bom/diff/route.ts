/**
 * POST /api/bom/diff — [B16.0.2 §B] project-owned snapshot diff.
 *
 * Body: { from: <snapshotId>, to: <snapshotId> | "current", state?, pricingChoice? }
 *
 * Compares two snapshots OWNED by the caller's trusted project scope and
 * returns the significant supply-chain changes. When `to === "current"`, a
 * live (unpersisted) snapshot is built from `state`.
 *
 * This used to be a PUBLIC GET carrying the schematic state base64-encoded in
 * the query string and loading snapshots by raw id. It is now an
 * AUTHENTICATED, bounded JSON POST: design contents never enter URLs, browser
 * history, proxy logs, or analytics query strings, and every snapshot lookup
 * is bound to the trusted scope (a foreign/legacy id is a uniform 404).
 */

import { buildBomRows, isSchematicState, normalizeChoice } from "@/app/lib/bom-builder";
import { diffSnapshots, rowToSnapshotRow, type BomSnapshot, type BomSnapshotMeta } from "@/app/lib/snapshots";
import { resolveBomRepository, type BomSnapshotFull } from "@/app/lib/bom/snapshot-repository";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { BOM_FORBIDDEN_BODY_KEYS, bomNotFound, bomOwnershipScope } from "../_scope";

export const runtime = "nodejs";

/** A whole SchematicState may travel in the body (to=current). */
const MAX_BODY_BYTES = 8_000_000;
const BODY_DEADLINE_MS = 30_000;

function fullToSnapshot(rec: BomSnapshotFull): BomSnapshot {
  return { id: rec.id, projectKey: rec.projectKey, label: rec.label, takenAt: rec.takenAt, rows: rec.rows, meta: rec.bomMeta };
}

// [B16.0.11] canonical wrapper — authorization -> CSRF -> media -> bounded body
// run inside the wrapper; ownership scope is projected from the TRUSTED context
// only; the callback cannot reach the raw request.
export const POST = authenticatedJsonRoute({ maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_DEADLINE_MS }, async ({ context, body }): Promise<Response> => {
  const scope = bomOwnershipScope(context);
  for (const key of BOM_FORBIDDEN_BODY_KEYS) {
    if (key in body) return Response.json({ ok: false, code: "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN", error: `\`${key}\` is server-derived and may not be supplied.` }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const fromId = typeof body.from === "string" ? body.from.trim() : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (fromId === "" || to === "") {
    return Response.json({ ok: false, error: "`from` and `to` are required." }, { status: 400 });
  }

  try {
    const repo = resolveBomRepository();
    const fromRec = await repo.getSnapshot(scope, fromId);
    if (!fromRec) return bomNotFound("`from` snapshot");
    const fromSnap = fullToSnapshot(fromRec);

    let toSnap: BomSnapshot;
    let toId = to;
    if (to === "current") {
      if (!isSchematicState(body.state)) {
        return Response.json({ ok: false, error: "`state` is required (and must be a schematic state) when `to=current`." }, { status: 400 });
      }
      const result = await buildBomRows(body.state, normalizeChoice(body.pricingChoice));
      const rows = result.rows.filter((r) => r.partId).map(rowToSnapshotRow);
      const costValue = result.estimatedProjectCost.value;
      const meta: BomSnapshotMeta = {
        totalRows: rows.length,
        totalCostCents: costValue === null ? null : Math.round(costValue * 100),
        currency: result.estimatedProjectCost.currency,
        designRiskScore: result.riskSummary.overallScore,
      };
      toSnap = { id: "current", projectKey: fromSnap.projectKey, label: null, takenAt: new Date(), rows, meta };
    } else {
      const toRec = await repo.getSnapshot(scope, to);
      if (!toRec) return bomNotFound("`to` snapshot");
      toSnap = fullToSnapshot(toRec);
      toId = toRec.id;
    }

    const changes = diffSnapshots(fromSnap, toSnap);
    return Response.json({ ok: true, from: fromSnap.id, to: toId, changes }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
