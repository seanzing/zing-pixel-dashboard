import { NextResponse } from "next/server";
import { writeFile } from "@/lib/github";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";

const GH_TOKEN = process.env.GITHUB_TOKEN!;
const REPO = process.env.GITHUB_SITES_REPO!;

export async function POST(
  req: Request,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;
  const { sha, page = "index.html" } = await req.json();

  if (!sha) {
    return NextResponse.json({ error: "Missing sha" }, { status: 400 });
  }

  // Fetch the file content at that commit
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(`${siteId}/${page}`)}?ref=${sha}`,
    {
      headers: {
        Authorization: `token ${GH_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch version" }, { status: 502 });
  }

  const data = await res.json();
  const html = Buffer.from(data.content, "base64").toString("utf-8");

  // Write back as a new commit (triggers deploy)
  const commitSha = await writeFile(
    `${siteId}/${page}`,
    html,
    `revert: restore ${siteId}/${page} to ${sha.slice(0, 7)}`
  );

  // Get user for attribution
  let deployedBy = "manual";
  try {
    const authClient = await createServerSupabaseClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (user?.email) deployedBy = user.email;
  } catch { /* non-fatal */ }

  // Log the rollback as a deployment
  const supabase = createServiceRoleClient();
  await supabase.from("deployments").insert({
    site_id: siteId,
    type: "rollback",
    url: null,
    deployed_by: deployedBy,
    commit_sha: commitSha,
  });

  return NextResponse.json({ success: true, commitSha });
}
