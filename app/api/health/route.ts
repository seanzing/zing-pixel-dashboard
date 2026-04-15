import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = createServiceRoleClient();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [sitesRes, deploymentsRes, editLogRes] = await Promise.all([
      supabase.from("sites").select("id, business_name, status, updated_at, preview_url, live_url"),
      supabase
        .from("deployments")
        .select("id, site_id, type, status, deployed_at, deployed_by")
        .gte("deployed_at", thirtyDaysAgo)
        .order("deployed_at", { ascending: false }),
      supabase
        .from("edit_log")
        .select("id, site_id, user_email, action, created_at")
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const sites = sitesRes.data ?? [];
    const deployments = deploymentsRes.data ?? [];
    const edits = editLogRes.data ?? [];

    // Site counts by status
    const statusCounts = sites.reduce((acc: Record<string, number>, s: { status: string }) => {
      acc[s.status] = (acc[s.status] ?? 0) + 1;
      return acc;
    }, {});

    // Deployment health (last 30 days)
    const depSuccess = deployments.filter((d: { status: string }) => d.status === "success").length;
    const depFailed = deployments.filter((d: { status: string }) => d.status === "failed").length;
    const depTotal = deployments.length;

    // Sites with no deploy in 30 days
    const deployedSiteIds = new Set(deployments.map((d: { site_id: string }) => d.site_id));
    const liveSites = sites.filter((s: { status: string }) => s.status === "live");
    const staleLiveSites = liveSites.filter((s: { id: string }) => !deployedSiteIds.has(s.id));

    // Most active sites (by edit count)
    const editsBySite = edits.reduce((acc: Record<string, number>, e: { site_id: string }) => {
      acc[e.site_id] = (acc[e.site_id] ?? 0) + 1;
      return acc;
    }, {});
    type SiteRow = { id: string; business_name: string; status: string; updated_at: string };
    const siteMap = Object.fromEntries((sites as SiteRow[]).map((s) => [s.id, s.business_name]));
    const topEdited = Object.entries(editsBySite)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([id, count]) => ({ id, business_name: siteMap[id] ?? id, edits: count }));

    // Sites still on preview (no live URL)
    const previewOnlySites = (sites as SiteRow[])
      .filter((s) => s.status === "preview")
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 10);

    // Recent deployments
    type DeployRow = { id: string; site_id: string; type: string; status: string; deployed_at: string; deployed_by: string | null };
    const recentDeploys = (deployments as DeployRow[]).slice(0, 10).map((d) => ({
      ...d,
      business_name: siteMap[d.site_id] ?? d.site_id,
    }));

    return NextResponse.json({
      statusCounts,
      totalSites: sites.length,
      deployments: {
        total: depTotal,
        success: depSuccess,
        failed: depFailed,
        successRate: depTotal > 0 ? Math.round((depSuccess / depTotal) * 100) : null,
      },
      staleLiveSites: (staleLiveSites as SiteRow[]).slice(0, 10).map((s) => ({
        id: s.id,
        business_name: s.business_name,
        updated_at: s.updated_at,
      })),
      topEdited,
      previewOnlySites: previewOnlySites.map((s) => ({
        id: s.id,
        business_name: s.business_name,
        updated_at: s.updated_at,
      })),
      recentDeploys,
      editCount30d: edits.length,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
