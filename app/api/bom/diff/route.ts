/**
 * GET /api/bom/diff
 *
 * ?from=<snapshotId>&to=<snapshotId|"current">&projectKey=<key>
 *   &state=<base64 SchematicState>&pricingChoice=<choice>
 *
 * Compares two snapshots and returns the significant supply-chain changes. When
 * `to === "current"`, a live (unpersisted) snapshot is built from `state`.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { bomSnapshots, type BomSnapshotRecord } from "@/app/lib/db/schema";
import { buildBomRows, isSchematicState, normalizeChoice } from "@/app/lib/bom-builder";
import {
  diffSnapshots,
  rowToSnapshotRow,
  type BomSnapshot,
  type BomSnapshotMeta,
} from "@/app/lib/snapshots";

export const runtime = "nodejs";

function recordToSnapshot(rec: BomSnapshotRecord): BomSnapshot {
  return {
    id: rec.id,
    projectKey: rec.projectKey,
    label: rec.label,
    takenAt: rec.takenAt,
    rows: rec.snapshotData,
    meta: rec.bomMeta,
  };
}

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const fromId = params.get("from")?.trim() ?? "";
  const to = params.get("to")?.trim() ?? "";
  if (fromId === "" || to === "") {
    return Response.json({ ok: false, error: "`from` and `to` are required." }, { status: 400 });
  }

  try {
    const db = getDb();
    const [fromRec] = await db.select().from(bomSnapshots).where(eq(bomSnapshots.id, fromId)).limit(1);
    if (!fromRec) {
      return Response.json({ ok: false, error: "`from` snapshot not found." }, { status: 404 });
    }
    const fromSnap = recordToSnapshot(fromRec);

    let toSnap: BomSnapshot;
    let toId = to;
    if (to === "current") {
      const stateParam = params.get("state");
      if (!stateParam) {
        return Response.json(
          { ok: false, error: "`state` is required when `to=current`." },
          { status: 400 },
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(stateParam, "base64").toString("utf8"));
      } catch {
        return Response.json({ ok: false, error: "`state` is not valid base64 JSON." }, { status: 400 });
      }
      if (!isSchematicState(parsed)) {
        return Response.json({ ok: false, error: "Decoded `state` is invalid." }, { status: 400 });
      }
      const result = await buildBomRows(parsed, normalizeChoice(params.get("pricingChoice")));
      const rows = result.rows.filter((r) => r.partId).map(rowToSnapshotRow);
      const costValue = result.estimatedProjectCost.value;
      const meta: BomSnapshotMeta = {
        totalRows: rows.length,
        totalCostCents: costValue === null ? null : Math.round(costValue * 100),
        currency: result.estimatedProjectCost.currency,
        designRiskScore: result.riskSummary.overallScore,
      };
      toSnap = {
        id: "current",
        projectKey: fromSnap.projectKey,
        label: null,
        takenAt: new Date(),
        rows,
        meta,
      };
    } else {
      const [toRec] = await db.select().from(bomSnapshots).where(eq(bomSnapshots.id, to)).limit(1);
      if (!toRec) {
        return Response.json({ ok: false, error: "`to` snapshot not found." }, { status: 404 });
      }
      toSnap = recordToSnapshot(toRec);
      toId = toRec.id;
    }

    const changes = diffSnapshots(fromSnap, toSnap);
    return Response.json({ ok: true, from: fromSnap.id, to: toId, changes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
