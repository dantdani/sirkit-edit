import { EMBEDDED_LOW_VOLTAGE_PROFILE_V1 } from "@/app/lib/requirements/capability";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return Response.json({ profiles: [EMBEDDED_LOW_VOLTAGE_PROFILE_V1] }, { headers: { "Cache-Control": "public, max-age=300" } });
}

