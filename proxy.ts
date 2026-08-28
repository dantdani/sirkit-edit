/**
 * B16.0 — Next.js proxy (the renamed middleware in current Next) that keeps
 * the Supabase Auth session fresh via the official SSR `updateSession`
 * helper. Runs on every matched request; token rotation writes fresh cookies
 * so client and server stay in sync.
 *
 * This is production auth wiring; in local_dev / tests the resolver uses the
 * fixed local principal / injected fakes and this proxy simply passes through
 * when Supabase is not configured.
 */

import { type NextRequest } from "next/server";
import { updateSession } from "@/app/lib/auth/supabase-server";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // All paths except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
