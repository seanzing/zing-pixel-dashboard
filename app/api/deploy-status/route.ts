import { NextResponse } from "next/server";

const GITHUB_API = "https://api.github.com";
const REPO = process.env.GITHUB_SITES_REPO!;
const TOKEN = process.env.GITHUB_TOKEN!;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sha = searchParams.get("sha");

  if (!sha) {
    return NextResponse.json({ error: "Missing sha" }, { status: 400 });
  }

  // Find workflow runs triggered by this commit SHA
  const res = await fetch(
    `${GITHUB_API}/repos/${REPO}/actions/runs?head_sha=${sha}&per_page=1`,
    {
      headers: {
        Authorization: `token ${TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
      // Don't cache — we need fresh status each poll
      cache: "no-store",
    }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "GitHub API error" }, { status: 502 });
  }

  const data = await res.json();
  const run = data.workflow_runs?.[0];

  if (!run) {
    // Run not yet visible — still queuing
    return NextResponse.json({ status: "queued", conclusion: null });
  }

  return NextResponse.json({
    status: run.status,           // queued | in_progress | completed
    conclusion: run.conclusion,   // success | failure | null
    runUrl: run.html_url,
  });
}
