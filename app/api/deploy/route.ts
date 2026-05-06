import { NextResponse } from "next/server";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { getFile, writeFile } from "@/lib/github";

export async function POST(request: Request) {
  const { siteId, type } = await request.json();

  if (!siteId || !type) {
    return NextResponse.json(
      { error: "Missing siteId or type" },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();

  // Get the current user for attribution
  const userClient = createServerSupabaseClient();
  const { data: { user } } = await userClient.auth.getUser();
  const deployedBy = user?.email ?? "unknown";

  const { data: site } = await supabase
    .from("sites")
    .select("*")
    .eq("id", siteId)
    .single();

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  try {
    // Write a timestamp file to guarantee git diff sees a change and Actions triggers
    const metaPath = `${siteId}/_pixel.json`;
    const metaContent = JSON.stringify({ deployedAt: new Date().toISOString(), type }, null, 2);
    const existingMeta = await getFile(metaPath);
    const commitSha = await writeFile(
      metaPath,
      metaContent,
      `${type === "production" ? "deploy" : "preview"}(${siteId}): manual deploy`,
      existingMeta?.sha
    );

    const url = `https://${siteId}.pages.dev`;

    // If deploying to production, set status to live
    if (type === "production" && site.status === "preview") {
      await supabase
        .from("sites")
        .update({ status: "live", updated_at: new Date().toISOString() })
        .eq("id", siteId);
    }

    // Notify Atlas when site goes live
    if (type === "production") {
      const atlasWebhookUrl = process.env.ATLAS_WEBHOOK_URL;
      const atlasWebhookSecret = process.env.ATLAS_WEBHOOK_SECRET;

      // Get atlas_onboarding_id from site record
      const { data: siteRecord } = await supabase
        .from("sites")
        .select("atlas_onboarding_id")
        .eq("id", siteId)
        .single();

      if (atlasWebhookUrl && atlasWebhookSecret && siteRecord?.atlas_onboarding_id) {
        try {
          await fetch(`${atlasWebhookUrl}/api/webhooks/pixel`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-webhook-secret": atlasWebhookSecret,
            },
            body: JSON.stringify({
              event: "site_deployed_live",
              siteId,
              atlasOnboardingId: siteRecord.atlas_onboarding_id,
              liveUrl: `https://${siteId}.pages.dev`,
            }),
          });
        } catch {
          // Non-fatal — deploy still succeeds even if Atlas webhook fails
          console.error("Atlas webhook failed (non-fatal)");
        }
      }
    }

    // Save deployment record
    await supabase.from("deployments").insert({
      site_id: siteId,
      type,
      url,
      deployed_by: deployedBy,
    });

    // Update site URL
    const urlField = type === "production" ? "live_url" : "preview_url";
    await supabase
      .from("sites")
      .update({ [urlField]: url, updated_at: new Date().toISOString() })
      .eq("id", siteId);

    return NextResponse.json({
      url,
      commitSha,
      message: "Deploy triggered via GitHub commit. Cloudflare Pages will update in ~30s.",
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Deploy failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
