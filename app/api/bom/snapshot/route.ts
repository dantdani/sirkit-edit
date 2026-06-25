/**
 * /api/bom/snapshot
 *
 * POST  { state, projectKey, label?, pricingChoice }  → create a snapshot
 * GET   ?projectKey=...                               → list recent snapshots
 */

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { bomSnapshots, type NewBomSnapshot } from "@/app/lib/db/schema";
import { buildBomRows, isSchematicState, normalizeChoice } from "@/app/lib/bom-builder";
import { rowToSnapshotRow, type BomSnapshotMeta } from "@/app/lib/snapshots";

export const runtime = "nodejs";

type PostBody = {
  state?: unknown;
  projectKey?: unknown;
  label?: unknown;
  pricingChoice?: unknown;
};

export async function POST(req: Request): Promise<Response> {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isSchematicState(body.state)) {
    return Response.json({ ok: false, error: "Body must include a `state`." }, { status: 400 });
  }
  const projectKey = typeof body.projectKey === "string" ? body.projectKey.trim() : "";
  if (projectKey === "") {
    return Response.json({ ok: false, error: "`projectKey` is required." }, { status: 400 });
  }
  const label = typeof body.label === "string" && body.label.trim() !== "" ? body.label.trim() : null;

  try {
    const result = await buildBomRows(body.state, normalizeChoice(body.pricingChoice));
    const snapshotRows = result.rows.filter((r) => r.partId).map(rowToSnapshotRow);
    const costValue = result.estimatedProjectCost.value;
    const meta: BomSnapshotMeta = {
      totalRows: snapshotRows.length,
      totalCostCents: costValue === null ? null : Math.round(costValue * 100),
      currency: result.estimatedProjectCost.currency,
      designRiskScore: result.riskSummary.overallScore,
    };

    const insert: NewBomSnapshot = { projectKey, label, snapshotData: snapshotRows, bomMeta: meta };
    const [created] = await getDb().insert(bomSnapshots).values(insert).returning({ id: bomSnapshots.id });
    return Response.json({ ok: true, id: created.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  const projectKey = new URL(req.url).searchParams.get("projectKey")?.trim() ?? "";
  if (projectKey === "") {
    return Response.json({ ok: false, error: "`projectKey` is required." }, { status: 400 });
  }
  try {
    const rows = await getDb()
      .select({
        id: bomSnapshots.id,
        label: bomSnapshots.label,
        takenAt: bomSnapshots.takenAt,
        bomMeta: bomSnapshots.bomMeta,
      })
      .from(bomSnapshots)
      .where(eq(bomSnapshots.projectKey, projectKey))
      .orderBy(desc(bomSnapshots.takenAt))
      .limit(20);

    const snapshots = rows.map((r) => ({
      id: r.id,
      label: r.label,
      takenAt: r.takenAt,
      rowCount: r.bomMeta.totalRows,
      totalCostCents: r.bomMeta.totalCostCents,
      currency: r.bomMeta.currency,
      designRiskScore: r.bomMeta.designRiskScore,
    }));
    return Response.json({ ok: true, snapshots });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
