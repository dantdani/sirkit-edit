import { createSupplierOfferObservation, createSupplierSourcingSnapshot, normalizeProcurementCost } from "@/app/lib/component-selection/sourcing";
import type { QuantityProfile, SupplierOfferObservation, SupplierSourcingSnapshot } from "@/app/lib/component-selection/types";
import { object, scopedJson } from "../_scope";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const parsed = await scopedJson(request); if (!parsed.ok) return parsed.response; const { body } = parsed;
  try {
    if (body.operation === "normalize") { if (!object(body.snapshot) || !object(body.observation) || !object(body.quantityProfile)) return Response.json({ ok: false, error: "snapshot, observation, and quantityProfile are required" }, { status: 400 }); const snapshot = createSupplierSourcingSnapshot(body.snapshot as unknown as Omit<SupplierSourcingSnapshot, "snapshotId" | "deterministicDigest"> & { snapshotId?: string }); const observation = createSupplierOfferObservation(body.observation as unknown as Omit<SupplierOfferObservation, "offerObservationId" | "deterministicDigest"> & { offerObservationId?: string }); if (observation.snapshotId !== snapshot.snapshotId) return Response.json({ ok: false, error: "offer/snapshot scope mismatch" }, { status: 422 }); return Response.json({ ok: true, snapshot, observation, cost: normalizeProcurementCost({ observation, snapshot, quantityProfile: body.quantityProfile as unknown as QuantityProfile, now: typeof body.now === "string" ? body.now : new Date().toISOString(), maximumPriceAgeDays: Number.isSafeInteger(body.maximumPriceAgeDays) ? body.maximumPriceAgeDays as number : 7 }) }, { headers: { "Cache-Control": "no-store" } }); }
    return Response.json({ ok: false, error: "approved server-side sourcing provider acquisition is not configured; no live observation was invented" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } });
  } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 }); }
}
