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
  const imgIndexStr = formData.get("imgIndex") as string | null;
  const imgIndex = imgIndexStr !== null ? parseInt(imgIndexStr, 10) : -1;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (imgIndex < 0) return NextResponse.json({ error: "imgIndex required" }, { status: 400 });

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

  // Update the HTML to replace the src at imgIndex
  const htmlFile = await getFile(`${params.siteId}/${page}`);
  if (!htmlFile) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  // Simple regex-based src replacement at the nth img tag
  let imgCount = 0;
  let updatedHtml = htmlFile.content.replace(/<img([^>]*?)>/gi, (match: string, attrs: string) => {
    if (imgCount === imgIndex) {
      imgCount++;
      // Replace src attribute, preserving all other attrs
      return match.replace(/src\s*=\s*["'][^"']*["']/i, `src="${newSrc}"`);
    }
    imgCount++;
    return match;
  });

  // If regex didn't match (e.g. self-closing <img ... />), handle that too
  if (imgCount === 0) {
    return NextResponse.json({ error: "No images found in HTML" }, { status: 400 });
  }

  // Save updated HTML
  const result = await putRaw(
    `${params.siteId}/${page}`,
    Buffer.from(updatedHtml).toString("base64"),
    `upload(${params.siteId}): set img[${imgIndex}] src to ${safeName}`,
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
