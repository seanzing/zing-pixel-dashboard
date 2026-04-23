import { WORKER_URL, MIGRATION_SECRET } from "@/lib/migration";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;

  const upstream = await fetch(`${WORKER_URL}/jobs/${jobId}/stream`, {
    headers: {
      "X-Migration-Secret": MIGRATION_SECRET,
    },
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: "Stream unavailable" }), {
      status: upstream.status || 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
