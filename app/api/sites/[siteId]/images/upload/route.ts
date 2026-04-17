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

async function getFile(path: string) {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${path}`, { headers: ghHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
}

async function putRaw(path: string, base64Content: string, message: string, sha?: string) {
  const body: Record<string, string> = { message, content: base64Content };
  if (sha) body.sha = sha;
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub PUT ${path}: ${(err as { message?: string }).message || res.status}`);
  }
  return res.json();
}

// POST — upload a replacement image and update the HTML src at the given index
export async function POST(req: NextRequest, { params }: { params: { siteId: string } }) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const page = (formData.get("page") as string) ?? "index.html";
  const rawSrc = (formData.get("rawSrc") as string) ?? ""; // original URL to replace everywhere in HTML

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!rawSrc) return NextResponse.json({ error: "rawSrc required" }, { status: 400 });

  // Validate image type
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type. Use JPEG, PNG, GIF, WebP, or SVG." }, { status: 400 });
  }

  // Convert file to base64
  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  // Sanitize filename and upload to GitHub
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
  const imagePath = `${params.siteId}/${safeName}`;

  // Check if this filename already exists (for sha update)
  const existing = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${imagePath}`, { headers: ghHeaders() });
  const existingData = existing.ok ? await existing.json() : null;

  await putRaw(
    imagePath,
    base64,
    `upload(${params.siteId}): replace image ${safeName}`,
    existingData?.sha
  );

  const newSrc = `/${safeName}`;

  // Update the HTML — replace ALL occurrences of rawSrc with newSrc
  // This handles: img src, CSS background-image in style attrs, style blocks — everything
  const htmlFile = await getFile(`${params.siteId}/${page}`);
  if (!htmlFile) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  // Escape the rawSrc for use in a regex
  const escaped = rawSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const updatedHtml = htmlFile.content.replace(new RegExp(escaped, "g"), newSrc);

  if (updatedHtml === htmlFile.content) {
    return NextResponse.json({ error: `Could not find "${rawSrc}" in page HTML` }, { status: 400 });
  }

  // Save updated HTML
  const result = await putRaw(
    `${params.siteId}/${page}`,
    Buffer.from(updatedHtml).toString("base64"),
    `upload(${params.siteId}): replace ${rawSrc} → ${safeName}`,
    htmlFile.sha
  );

  return NextResponse.json({
    ok: true,
    newSrc,
    imagePath,
    commitSha: result.commit?.sha,
    html: updatedHtml,
  });
}
