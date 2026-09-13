/**
 * [B19-D I5c row 34, review] The one way a part's datasheet becomes a link in the UI.
 *
 * A datasheet comes from a KiCad library, a vendor response or a stored catalog row — never trusted markup. Only a link the
 * shared policy accepts (`safeHref(…, "document")`) is rendered, it opens in a new tab without a referrer or opener, and
 * anything else renders nothing at all.
 */
import type { ReactNode } from "react";
import { safeHref } from "@/app/lib/net/href-policy";

export function DatasheetLink({ href, className, children }: { href: unknown; className?: string; children: ReactNode }) {
  const safe = safeHref(href, "document");
  if (!safe) return null;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
