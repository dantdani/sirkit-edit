import { cancelRun, getRun } from "@/app/lib/spice/server/job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const run = getRun(id);
  return run ? Response.json({ ok: true, run }) : Response.json({ ok: false, error: "Run not found" }, { status: 404 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return cancelRun(id)
    ? Response.json({ ok: true, run: getRun(id) })
    : Response.json({ ok: false, error: "Run is missing or already finished" }, { status: 409 });
}
