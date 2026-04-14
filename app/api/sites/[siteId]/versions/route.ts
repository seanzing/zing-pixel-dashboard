import { NextResponse } from "next/server";

const GH_TOKEN = process.env.GITHUB_TOKEN!;
const REPO = process.env.GITHUB_SITES_REPO!;

export async function GET(
  _req: Request,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/commits?path=${encodeURIComponent(`${siteId}/index.html`)}&per_page=20`,
    {
      headers: {
        Authorization: `token ${GH_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch commit history" }, { status: 502 });
  }

  const commits = await res.json();

  const versions = (commits as Array<{
    sha: string;
    commit: { message: string; author: { name: string; date: string } };
  }>).map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.commit.author.name,
    date: c.commit.author.date,
  }));

  return NextResponse.json({ versions });
}
