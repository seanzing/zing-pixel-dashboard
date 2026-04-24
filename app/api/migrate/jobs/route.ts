import { NextResponse } from "next/server";
import { workerFetch, WORKER_URL } from "@/lib/migration";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Fetch all migration-related sites updated in the last 24h from Supabase
// This is the source of truth for final job status
async function getSupabaseSites() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("sites")
    .select("id, business_name, status, preview_url, created_at, updated_at")
    .or("status.in.(migrating,migration-error),preview_url.like.%.pages.dev%")
    .gte("updated_at", since)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function GET() {
  const [workerJobs, sbSites] = await Promise.all([
    WORKER_URL
      ? workerFetch("/jobs").then((r) => (r.ok ? r.json() : [])).catch(() => [])
      : Promise.resolve([]),
    getSupabaseSites().catch(() => []),
  ]);

  const workerArr: any[] = Array.isArray(workerJobs) ? workerJobs : [];

  // Build a slug → supabase record map for quick lookup
  const sbMap = new Map<string, any>();
  for (const s of sbSites) sbMap.set(s.id, s);

  // Process worker jobs — override status with Supabase truth when definitive
  const processedWorker = workerArr.map((j: any) => {
    const sb = sbMap.get(j.slug);
    if (!sb) return j;

    // If Supabase says draft/live, job is done — override stale worker "running"
    if ((sb.status === "draft" || sb.status === "live") && j.status === "running") {
      return {
        ...j,
        status: "done",
        result: j.result ?? { siteId: j.slug, previewUrl: sb.preview_url, pagesWritten: 0, assetsDownloaded: 0 },
      };
    }
    // If Supabase says migration-error, mark as error
    if (sb.status === "migration-error" && j.status === "running") {
      return { ...j, status: "error", error: "Migration failed" };
    }
    return j;
  });

  // Add Supabase-only jobs (not in worker — e.g. survived a restart)
  const workerSlugs = new Set(processedWorker.map((j: any) => j.slug));
  const sbOnlyJobs = sbSites
    .filter((s: any) => !workerSlugs.has(s.id))
    .map((s: any) => ({
      id: `sb-${s.id}`,
      url: "",
      slug: s.id,
      name: s.business_name,
      status:
        s.status === "migrating" ? "running" :
        s.status === "migration-error" ? "error" :
        (s.status === "draft" || s.status === "live") ? "done" : "done",
      createdAt: s.created_at,
      startedAt: s.created_at,
      finishedAt: s.status !== "migrating" ? s.updated_at : null,
      error: s.status === "migration-error" ? "Migration failed" : null,
      result: s.preview_url ? { siteId: s.id, previewUrl: s.preview_url, pagesWritten: 0, assetsDownloaded: 0 } : null,
      _fromSupabase: true,
    }));

  const merged = [...processedWorker, ...sbOnlyJobs];

  return NextResponse.json(merged, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
