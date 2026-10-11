/**
 * [B24-B3] The request the opt-in `assist-live` suite sends (D24-18, D24-19; OD-209), in one place so `b24-b3-live-suite-honesty` can
 * prove offline - the model router mocked - that it reaches the model once, on Anthropic. Test-only (not a test file; no vitest import).
 *
 * At 4738aa3 the suite posted a content type alone: the canonical wrapper refused it 400 `AUTH_PROJECT_SELECTOR_REQUIRED` before any
 * model call (the local-development principal is supplied, `identity-provider.ts:52-62`; the selector is not,
 * `trusted-request-context.ts:87-91`), and the route sends a request with no `provider` to OpenAI (`app/lib/llm/request.ts:3-5`). This
 * request carries the selector headers and the origin, as `b16-0-13-tranche-parity.test.ts` sends them, and `provider: "anthropic"`;
 * the caller injects `ASSIST_LIVE_PRINCIPAL` (an editor of the selected project) and resets the identity after each case.
 */
import type { SelectionRef } from "@/app/lib/pcb/edit/commands";
import { buildDigest, buildItemIndex } from "@/app/lib/pcb/edit/digest";
import type { PcbBoard } from "@/app/lib/pcb/types";

export const ASSIST_LIVE_PROVIDER = "anthropic" as const;
export const ASSIST_LIVE_SCOPE = Object.freeze({ tenantId: "local", projectId: "assist-live-project", branchId: "main" });
/** The editor the suite injects (b16-0-13-tranche-parity.test.ts:57's shape). */
export const ASSIST_LIVE_PRINCIPAL = Object.freeze({ userId: "assist-live-editor", tenantId: ASSIST_LIVE_SCOPE.tenantId, projectId: ASSIST_LIVE_SCOPE.projectId, role: "editor" as const });
const SELECTOR = { "x-sirkit-tenant-id": ASSIST_LIVE_SCOPE.tenantId, "x-sirkit-project-id": ASSIST_LIVE_SCOPE.projectId, "x-sirkit-branch-id": ASSIST_LIVE_SCOPE.branchId };

/** The assist route's body: the instruction, the board digest and item index, and the provider. */
export function assistLivePayload(board: PcbBoard, instruction: string, selection: SelectionRef[] = []): Record<string, unknown> {
  return { instruction, digest: buildDigest(board, selection, { presetId: "jlcpcb-2l" }), items: buildItemIndex(board), provider: ASSIST_LIVE_PROVIDER };
}

/** The POST the suite sends: same origin, the project selector, JSON. */
export function assistLiveRequest(board: PcbBoard, instruction: string, selection: SelectionRef[] = []): Request {
  return new Request("http://localhost/api/pcb/edit/assist", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", ...SELECTOR },
    body: JSON.stringify(assistLivePayload(board, instruction, selection)),
  });
}
