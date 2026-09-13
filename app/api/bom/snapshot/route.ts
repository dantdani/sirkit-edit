/**
 * /api/bom/snapshot — [B16.0.2 §B] project-owned BOM snapshots.
 *
 * POST  { state, label?, pricingChoice }  → create a snapshot OWNED by the
 *       caller's trusted project scope (server-derived; the body may carry
 *       NO projectKey / tenant / project / branch / actor claim — refused).
 * GET                                      → list the caller's project's
 *       recent snapshots (trusted scope predicate; legacy unowned rows are
 *       quarantined and never listed).
 */

import { buildBomRows, isSchematicState, normalizeChoice } from "@/app/lib/bom-builder";
import { bomFailure } from "../_failure"; // [B19-B I2] a failure is reported, never repeated
import { rowToSnapshotRow, type BomSnapshotMeta } from "@/app/lib/snapshots";
import { resolveBomRepository } from "@/app/lib/bom/snapshot-repository";
import { authenticatedJsonRoute, authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { BOM_FORBIDDEN_BODY_KEYS, bomOwnershipScope } from "../_scope";

export const runtime = "nodejs";

/** A whole SchematicState travels in the body. */
const MAX_BODY_BYTES = 8_000_000;
const BODY_DEADLINE_MS = 30_000;

// [B16.0.11] canonical wrapper — authorization -> CSRF -> media -> bounded body
// run inside the wrapper; ownership scope is projected from the TRUSTED context
// only; the callback cannot reach the raw request.
export const POST = authenticatedJsonRoute({ maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_DEADLINE_MS }, async ({ context, body }): Promise<Response> => {
  const scope = bomOwnershipScope(context);
  for (const key of BOM_FORBIDDEN_BODY_KEYS) {
    if (key in body) return Response.json({ ok: false, code: "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN", error: `\`${key}\` is server-derived and may not be supplied.` }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!isSchematicState(body.state)) {
    return Response.json({ ok: false, error: "Body must include a `state`." }, { status: 400 });
  }
  const label = typeof body.label === "string" && body.label.trim() !== "" ? body.label.trim().slice(0, 200) : null;

  try {
    const result = await buildBomRows(body.state, normalizeChoice(body.pricingChoice), { live: true }); // [B19-B I2] authenticated: live pricing granted
    const snapshotRows = result.rows.filter((r) => r.partId).map(rowToSnapshotRow);
    const costValue = result.estimatedProjectCost.value;
    const meta: BomSnapshotMeta = {
      totalRows: snapshotRows.length,
      totalCostCents: costValue === null ? null : Math.round(costValue * 100),
      currency: result.estimatedProjectCost.currency,
      designRiskScore: result.riskSummary.overallScore,
    };
    const created = await resolveBomRepository().createSnapshot(scope, { label, rows: snapshotRows, meta });
    return Response.json({ ok: true, id: created.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return bomFailure("api/bom/snapshot", err);
  }
});

export const GET = authenticatedRoute({}, async ({ context }): Promise<Response> => {
  const scope = bomOwnershipScope(context);
  try {
    const rows = await resolveBomRepository().listSnapshots(scope, 20);
    const snapshots = rows.map((r) => ({
      id: r.id,
      label: r.label,
      takenAt: r.takenAt,
      rowCount: r.bomMeta.totalRows,
      totalCostCents: r.bomMeta.totalCostCents,
      currency: r.bomMeta.currency,
      designRiskScore: r.bomMeta.designRiskScore,
    }));
    return Response.json({ ok: true, snapshots }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return bomFailure("api/bom/snapshot", err);
  }
});
