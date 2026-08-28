"use client";

/**
 * B16.0 — the visible local-development identity banner.
 *
 * When the app is running under local-development identity (NOT production
 * authentication), this banner is always visible so no one mistakes the
 * fixed local principal for a real authenticated session. It renders nothing
 * in production.
 *
 * [B16.0.2 §H] the mode is the SERVER's resolved auth mode (the same
 * `resolveAuthMode` authority the request resolver uses), passed down by the
 * server layout — NOT the public env var. `NEXT_PUBLIC_SIRKIT_AUTH_MODE` alone
 * can never contradict `NODE_ENV=production`: a production runtime resolves
 * `production` regardless of that variable, so the banner can neither claim
 * local development in production nor hide it in local development. The
 * value carries no identity and no secret.
 */

export const LOCAL_DEV_BANNER_TEXT = "LOCAL DEVELOPMENT IDENTITY — NOT PRODUCTION AUTHENTICATION";

/** Visible unless the SERVER-resolved auth mode is exactly "production". An
 *  unknown/missing value is shown as local development (truthful default:
 *  never silently hide the warning). */
export function localDevBannerVisible(serverAuthMode: string | undefined): boolean {
  return (serverAuthMode ?? "").trim().toLowerCase() !== "production";
}

export function LocalDevIdentityBanner({ authMode }: { authMode?: string } = {}) {
  if (!localDevBannerVisible(authMode)) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="local-dev-identity-banner"
      className="w-full bg-amber-500 text-black text-[11px] font-semibold tracking-wide text-center py-0.5 px-2"
    >
      {LOCAL_DEV_BANNER_TEXT}
    </div>
  );
}
