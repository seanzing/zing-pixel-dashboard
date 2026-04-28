import { NextRequest, NextResponse } from "next/server";
import { getFile, writeFile, StaleShaError } from "@/lib/github";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { cfPagesDeploy } from "@/lib/cf-pages-deploy";

// POST — commit local HTML to GitHub and trigger Cloudflare Pages deploy
export async function POST(req: NextRequest, { params }: { params: { siteId: string } }) {
  const { html, page = "index.html", commitMessage } = await req.json() as {
    html: string;
    page?: string;
    commitMessage?: string;
  };

  if (!html) return NextResponse.json({ error: "html required" }, { status: 400 });

  // Validate page path — prevent traversal
  if (!page || page.includes('..') || !/^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*\.html$/.test(page)) {
    return NextResponse.json({ error: "Invalid page path" }, { status: 400 });
  }

  // Auth check — reject unauthenticated requests
  const { data: { user } } = await createServerSupabaseClient().auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deployedBy = user.email ?? "unknown";

  // Get current file SHA (required for GitHub update)
  const file = await getFile(`${params.siteId}/${page}`);
  if (!file) return NextResponse.json({ error: "Page not found in GitHub" }, { status: 404 });

  const msg = commitMessage ?? `deploy(${params.siteId}/${page}): publish edits`;

  let commitSha: string;
  try {
    commitSha = await writeFile(`${params.siteId}/${page}`, html, msg, file.sha);
  } catch (err) {
    if (err instanceof StaleShaError) {
      return NextResponse.json({ error: err.message, conflict: true }, { status: 409 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const supabase = createServiceRoleClient();

  // Log as a deployment
  await supabase.from("deployments").insert({
    site_id: params.siteId,
    type: "production",
    url: `https://${params.siteId}.pages.dev`,
    deployed_by: deployedBy,
    commit_sha: commitSha,
  });

  // Log to edit log
  await supabase.from("edit_log").insert({
    site_id: params.siteId,
    user_email: deployedBy,
    action: "deploy",
    summary: `Deployed ${page}`,
    commit_sha: commitSha,
    commit_message: msg.slice(0, 255),
  }).then(() => {});

  // Fire CF Pages direct deploy in the background (non-blocking).
  // This runs in parallel with the GitHub Actions deploy triggered by the git commit.
  // Whichever finishes first wins. CF direct deploy is typically 15-30s faster.
  cfPagesDeploy(params.siteId, [{ page, content: html }]).then((result) => {
    if (result.ok) {
      console.log(`[cf-deploy] ${params.siteId}/${page} → ${result.url}`);
    } else {
      console.warn(`[cf-deploy] ${params.siteId}/${page} failed: ${result.error}`);
    }
  }).catch((err) => console.error('[cf-deploy] unhandled:', err));

  return NextResponse.json({ ok: true, commitSha });
}
