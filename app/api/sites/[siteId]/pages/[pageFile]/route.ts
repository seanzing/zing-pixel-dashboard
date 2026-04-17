import { NextRequest, NextResponse } from "next/server";

const GITHUB_API = "https://api.github.com";
const REPO = process.env.GITHUB_SITES_REPO!;
const TOKEN = process.env.GITHUB_TOKEN!;

function ghHeaders() {
  return {
    Authorization: `token ${TOKEN}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "ZING-Pixel/1.0",
  };
}

// DELETE — remove a page (blocked on index.html)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { siteId: string; pageFile: string } }
) {
  const { siteId, pageFile } = params;

  if (pageFile === "index.html") {
    return NextResponse.json({ error: "Cannot delete the home page" }, { status: 400 });
  }

  if (!pageFile.endsWith(".html")) {
    return NextResponse.json({ error: "Invalid page filename" }, { status: 400 });
  }

  // Get current SHA for the file
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${siteId}/${pageFile}`, {
    headers: ghHeaders(),
  });
  if (res.status === 404) return NextResponse.json({ error: "Page not found" }, { status: 404 });
  if (!res.ok) return NextResponse.json({ error: "GitHub error" }, { status: 500 });
  const data = await res.json();

  // Delete via GitHub API
  const deleteRes = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${siteId}/${pageFile}`, {
    method: "DELETE",
    headers: ghHeaders(),
    body: JSON.stringify({
      message: `feat(pages): delete ${pageFile} from ${siteId}`,
      sha: data.sha,
    }),
  });

  if (!deleteRes.ok) {
    const err = await deleteRes.json().catch(() => ({}));
    return NextResponse.json({ error: (err as { message?: string }).message || "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: pageFile });
}
