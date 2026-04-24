import { NextResponse } from "next/server";
import { workerFetch, WORKER_URL } from "@/lib/migration";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Fetch active/recent jobs from Supabase (status = migrating or migration-error, last 24h)
async function getSupabaseJobs() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("sites")
    .select("id, business_name, status, preview_url, created_at, updated_at")
    .in("status", ["migrating", "migration-error"])
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  return (data ?? []).map((s) => ({
    id: `sb-${s.id}`,           // prefix so it doesn't clash with worker UUIDs
    url: "",
    slug: s.id,
    name: s.business_name,
    status: s.status === "migrating" ? "running" : "error",
    createdAt: s.created_at,
    startedAt: s.created_at,
    finishedAt: null,
    error: s.status === "migration-error" ? "Migration failed" : null,
    result: null,
    _fromSupabase: true,
  }));
}

export async function GET() {
  // Fetch from worker and Supabase in parallel
  const [workerJobs, sbJobs] = await Promise.all([
    WORKER_URL
      ? workerFetch("/jobs")
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [] as unknown[])
      : Promise.resolve([] as unknown[]),
    getSupabaseJobs().catch(() => []),
  ]);

  const workerArr = Array.isArray(workerJobs) ? workerJobs : [];
  const sbArr = Array.isArray(sbJobs) ? sbJobs : [];

  // Merge: worker is authoritative; only add Supabase jobs not already in worker list
  const workerSlugs = new Set(workerArr.map((j: any) => j.slug));
  const merged = [
    ...workerArr,
    ...sbArr.filter((j: any) => !workerSlugs.has(j.slug)),
  ];

  return NextResponse.json(merged, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
