import { EMBEDDED_LOW_VOLTAGE_PROFILE_V1 } from "@/app/lib/requirements/capability";
import { publicRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.8] canonical wrapper — static capability catalog (public policy row).
export const GET = publicRoute(undefined, () =>
  Response.json({ profiles: [EMBEDDED_LOW_VOLTAGE_PROFILE_V1] }, { headers: { "Cache-Control": "public, max-age=300" } }));
