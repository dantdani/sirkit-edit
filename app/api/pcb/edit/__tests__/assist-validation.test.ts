/**
 * Stage 17 Phase D gate: the assist endpoint returns VALIDATED commands only.
 * Claude is mocked (same seam as the Stage 10 from-brief test). Covers: valid
 * emission, ask_user pass-through, query_items round-trip, malformed output
 * (retry then 422), and the client-side discard gate — a structurally valid
 * command referencing a missing id is rejected by compileEdits and the board
 * stays untouched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  injectAuthorizedPrincipal,
  injectIdentity,
  resetInjectedIdentity,
} from "@/app/lib/auth/test-support";

const createMock = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import { POST } from "@/app/api/pcb/edit/assist/route";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
import { buildDigest, buildItemIndex } from "@/app/lib/pcb/edit/digest";
import { compileEdits } from "@/app/lib/pcb/edit/apply";
import { previewEdits } from "@/app/lib/pcb/edit/preview";
import { createHistory } from "@/app/lib/pcb/history";
import { mmToNm } from "@/app/lib/pcb/units";

function toolUse(name: string, input: unknown, id = "tu_1") {
  return {
    content: [{ type: "tool_use", id, name, input }],
    stop_reason: "tool_use",
    model: "claude-test",
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

// B16.0.1: identity is SERVER-DERIVED via authorizeRequest — the request must
// carry a same-origin Origin header (automatic CSRF for non-GET methods) and a
// project SELECTOR header (never authority; membership is looked up
// server-side against the injected principal).
function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/pcb/edit/assist", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        "x-sirkit-project-id": "project-1",
      },
      body: JSON.stringify(body),
    }),
  );
}

const board = buildRoutedDemo();
const gndTracks = board.tracks.filter(
  (t) => t.netId === board.nets.find((n) => n.name === "GND")?.id,
);
const BODY = {
  provider: "anthropic",
  instruction: "make all GND traces 0.5 mm",
  digest: buildDigest(board, []),
  items: buildItemIndex(board),
};

// B16.0.1: inject an authenticated project member with an EDITORS role
// (membership "editor" → pcb_editor) so the happy-path tests pass the
// server-derived policy for POST /api/pcb/edit/assist; individual tests
// override this to exercise the unauthenticated / role-denied refusals.
beforeEach(() => {
  createMock.mockReset();
  injectAuthorizedPrincipal({ userId: "assist-tester", projectId: "project-1", role: "editor" });
});
afterEach(() => resetInjectedIdentity());

describe("POST /api/pcb/edit/assist", () => {
  it("valid emission → { commands, explanation }", async () => {
    createMock.mockResolvedValueOnce(
      toolUse("emit_edits", {
        commands: [
          { op: "set-track-width", ids: gndTracks.map((t) => t.id), widthNm: 500_000 },
        ],
        explanation: "Set every GND trace to 0.5 mm.",
      }),
    );
    const res = await post(BODY);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commands).toHaveLength(1);
    expect(body.commands[0].op).toBe("set-track-width");
    expect(body.commands[0].widthNm).toBe(500_000);
    expect(body.explanation).toContain("0.5 mm");
  });

  it("ambiguity → { commands: [], question }", async () => {
    createMock.mockResolvedValueOnce(
      toolUse("ask_user", { question: "Which capacitor did you mean — C3 or C30?" }),
    );
    const body = await (await post(BODY)).json();
    expect(body.commands).toEqual([]);
    expect(body.question).toContain("C3");
  });

  it("query_items round-trips against the client-sent index", async () => {
    createMock
      .mockResolvedValueOnce(toolUse("query_items", { kind: "track", net: "GND" }))
      .mockImplementationOnce(async (params: { messages: { content: unknown }[] }) => {
        // The tool_result the route built must contain the GND track rows.
        const last = params.messages[params.messages.length - 1] as {
          content: { type: string; content: string }[];
        };
        const payload = JSON.parse(last.content[0].content) as { total: number };
        expect(payload.total).toBe(gndTracks.length);
        return toolUse("emit_edits", {
          commands: [{ op: "set-track-width", ids: gndTracks.map((t) => t.id), widthNm: 500_000 }],
          explanation: "Widened GND.",
        });
      });
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("malformed commands → one is_error retry, then 422", async () => {
    createMock
      .mockResolvedValueOnce(toolUse("emit_edits", { commands: [{ op: "explode" }], explanation: "x" }))
      .mockResolvedValueOnce(toolUse("emit_edits", { commands: [{ op: "explode" }], explanation: "x" }));
    const res = await post(BODY);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("unknown op");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("footprint deletes are rejected server-side", async () => {
    createMock
      .mockResolvedValueOnce(
        toolUse("emit_edits", {
          commands: [{ op: "delete-items", refs: [{ kind: "footprint", id: "u1" }] }],
          explanation: "x",
        }),
      )
      .mockResolvedValueOnce(
        toolUse("emit_edits", {
          commands: [{ op: "delete-items", refs: [{ kind: "footprint", id: "u1" }] }],
          explanation: "x",
        }),
      );
    const res = await post(BODY);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("footprints cannot be deleted");
  });

  it("400 on a malformed body", async () => {
    // B16.0.1: assert the ERROR TEXT too, so this 400 is proven to come from
    // the route's body validator and not from an authorization refusal.
    const missingInstruction = await post({ digest: {} });
    expect(missingInstruction.status).toBe(400);
    expect((await missingInstruction.json()).error).toContain("instruction");
    const missingDigest = await post({ instruction: "x" });
    expect(missingDigest.status).toBe(400);
    expect((await missingDigest.json()).error).toContain("digest");
  });

  // B16.0.1: the assist endpoint is a provider-credit route behind the
  // server-derived authorization perimeter — unauthenticated callers get 401
  // and non-editor members get 403 BEFORE any provider call is made.
  it("401 for an unauthenticated caller — no provider credit spent", async () => {
    injectIdentity(null);
    const res = await post(BODY);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("AUTH_UNAUTHENTICATED");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("403 for a viewer-role member — no provider credit spent", async () => {
    injectAuthorizedPrincipal({ userId: "assist-viewer", projectId: "project-1", role: "viewer" });
    const res = await post(BODY);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("AUTH_ROLE_DENIED");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("403 for a member of a DIFFERENT project — membership is checked against the selector", async () => {
    injectAuthorizedPrincipal({ userId: "assist-foreign", projectId: "other-project", role: "editor" });
    const res = await post(BODY); // selector requests project-1
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("AUTH_NO_ACTIVE_MEMBERSHIP");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("client gate: a hallucinated id passes the server but is discarded by compileEdits — board untouched", async () => {
    // Structurally valid, but 'ghost-track' does not exist on the board.
    createMock.mockResolvedValueOnce(
      toolUse("emit_edits", {
        commands: [{ op: "set-track-width", ids: ["ghost-track"], widthNm: 500_000 }],
        explanation: "x",
      }),
    );
    const res = await post(BODY);
    expect(res.status).toBe(200); // server can't know the live board…
    const { commands } = await res.json();

    // …so the CLIENT re-validates and discards, never patches.
    const compiled = compileEdits(board, commands);
    expect(compiled.errors).toEqual(["No track ghost-track on this board."]);
    const preview = previewEdits(board, commands);
    expect(preview.errors.length).toBeGreaterThan(0);

    const history = createHistory(board);
    const { applyEdits } = await import("@/app/lib/pcb/edit/apply");
    const result = applyEdits(history, commands);
    expect(result.ok).toBe(false);
    expect(history.canUndo).toBe(false); // board untouched
  });

  it("example: 'align these vertically' emits a valid align command", async () => {
    createMock.mockResolvedValueOnce(
      toolUse("emit_edits", {
        commands: [
          {
            op: "align",
            refs: [
              { kind: "via", id: "rd-v1" },
              { kind: "via", id: "rd-v2" },
            ],
            mode: "centerH",
          },
        ],
        explanation: "Aligned the selected vias on a vertical line.",
      }),
    );
    const res = await post(BODY);
    const { commands } = await res.json();
    expect(commands[0].op).toBe("align");
    // And the client gate accepts it against the live board.
    expect(compileEdits(board, commands).errors).toEqual([]);
    // 0.5 mm width example converts correctly through the whole chain too.
    expect(mmToNm(0.5)).toBe(500_000);
  });
});
