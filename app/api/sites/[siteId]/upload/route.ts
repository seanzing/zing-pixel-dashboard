import { NextRequest, NextResponse } from "next/server";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(
  request: NextRequest,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;
  const token = process.env.GITHUB_TOKEN!;
  const repo = process.env.GITHUB_SITES_REPO!;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `File type "${file.type}" not allowed. Use JPEG, PNG, WebP, GIF, or SVG.` },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File exceeds 10MB limit" },
      { status: 400 }
    );
  }

  // Sanitize filename: lowercase, replace spaces with hyphens
  const raw = file.name.toLowerCase().replace(/\s+/g, "-");
  const filename = raw.replace(/[^a-z0-9._-]/g, "");
  if (!filename) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const path = `${siteId}/${filename}`;
  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };

  // Check if file already exists (need SHA to update)
  let sha: string | undefined;
  const getRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}`,
    { headers }
  );
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
  }

  // Read file bytes and encode as base64
  const arrayBuffer = await file.arrayBuffer();
  const base64Content = Buffer.from(arrayBuffer).toString("base64");

  // Upload to GitHub
  const body: Record<string, string> = {
    message: `asset(${siteId}): upload ${filename}`,
    content: base64Content,
  };
  if (sha) body.sha = sha;

  const putRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}`,
    { method: "PUT", headers, body: JSON.stringify(body) }
  );

  if (!putRes.ok) {
    const text = await putRes.text();
    return NextResponse.json(
      { error: `GitHub upload failed: ${putRes.status} ${text}` },
      { status: 502 }
    );
  }

  const url = `https://raw.githubusercontent.com/${repo}/main/${siteId}/${filename}`;

  return NextResponse.json({ success: true, filename, url });
}
