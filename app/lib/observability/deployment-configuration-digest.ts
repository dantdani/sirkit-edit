/**
 * [B24-C2] OD-199, OD-208: the one place the attribution document reads A1's deployment configuration digest from. The record itself
 * (`app/lib/deployment/configuration.ts`) digests the provider registry among its inputs, so importing it would pull the provider
 * directory into the chat route's closure, which the B19-D chat-closure tripwire and b23-a-tier3-vocabulary case 7 forbid. Instead
 * `instrumentation.ts` builds the record once at start-up (under the nodejs runtime, after the fixture clock) and PUBLISHES its digest
 * here, on a `globalThis` slot (`Symbol.for`, the fixture container's and C1's precedent: the instrumentation bundle and the route
 * bundles need not share module instances). The attribution runtime reads the published digest; when none was published (a test
 * process, or a start-up that could not build the record) the document carries `null` and the closed diagnostic
 * `deployment_configuration_unavailable` - one place, never both (OD-231 (j): the call records carry no digest).
 *
 * Only a value of the engineering-digest form is published; anything else is refused (false) and leaves the slot as it was. Pure: no
 * import at all.
 */
const SLOT = Symbol.for("sirkit.b24-c2.deployment-configuration-digest");
/** `engineeringDigest`'s form: `eng1-` + 16 hex characters. */
export const DEPLOYMENT_CONFIGURATION_DIGEST_RULE = /^eng1-[0-9a-f]{16}$/;

type Slot = Record<symbol, unknown>;
const slot = (): Slot => globalThis as unknown as Slot;

/** Publish A1's record digest for the attribution documents of this process; false (and nothing published) for a value outside the rule. */
export function publishDeploymentConfigurationDigest(digest: unknown): boolean {
  if (typeof digest !== "string" || !DEPLOYMENT_CONFIGURATION_DIGEST_RULE.test(digest)) return false;
  slot()[SLOT] = digest;
  return true;
}
/** The published digest, or null when none was published in this process. */
export function publishedDeploymentConfigurationDigest(): string | null {
  const value = slot()[SLOT];
  return typeof value === "string" && DEPLOYMENT_CONFIGURATION_DIGEST_RULE.test(value) ? value : null;
}
/** Tests only: forget the published digest. */
export function withdrawDeploymentConfigurationDigest(): void {
  delete slot()[SLOT];
}
