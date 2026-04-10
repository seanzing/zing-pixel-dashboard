import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
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

  const { data: site } = await supabase
    .from("sites")
    .select("*")
    .eq("id", siteId)
    .single();

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  try {
    // Re-commit the current file to trigger a Cloudflare Pages deploy via GitHub Actions
    const file = await getFile(`${siteId}/index.html`);
    if (!file) {
      return NextResponse.json(
        { error: "Site files not found in GitHub" },
        { status: 404 }
      );
    }

    await writeFile(
      `${siteId}/index.html`,
      file.content,
      `${type === "production" ? "deploy" : "preview"}(${siteId}): manual deploy`,
      file.sha
    );

    const url = `https://${siteId}.pages.dev`;

    // If deploying to production, set status to live
    if (type === "production" && site.status === "preview") {
      await supabase
        .from("sites")
        .update({ status: "live", updated_at: new Date().toISOString() })
        .eq("id", siteId);
    }

    // Save deployment record
    await supabase.from("deployments").insert({
      site_id: siteId,
      type,
      url,
      deployed_by: "manual",
    });

    // Update site URL
    const urlField = type === "production" ? "live_url" : "preview_url";
    await supabase
      .from("sites")
      .update({ [urlField]: url, updated_at: new Date().toISOString() })
      .eq("id", siteId);

    return NextResponse.json({
      url,
      message: "Deploy triggered via GitHub commit. Cloudflare Pages will update in ~30s.",
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Deploy failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
