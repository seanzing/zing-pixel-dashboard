import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

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

async function getFile(filePath: string) {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${filePath}`, { headers: ghHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
}

async function putFile(filePath: string, content: string, message: string, sha: string) {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${filePath}`, {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify({ message, content: Buffer.from(content).toString("base64"), sha }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub PUT failed: ${(err as { message?: string }).message || res.status}`);
  }
  return res.json();
}

// GET — list all images with their src + alt text
export async function GET(_req: NextRequest, { params }: { params: { siteId: string } }) {
  const file = await getFile(`${params.siteId}/index.html`);
  if (!file) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  const $ = cheerio.load(file.content);

  // Derive base URL for thumbnail previews
  const images: Array<{ index: number; src: string; alt: string; previewUrl: string; context: string }> = [];

  $("img").each((i, el) => {
    const src = $(el).attr("src") ?? "";
    const alt = $(el).attr("alt") ?? "";
    // Build a preview URL from the CF Pages deployment
    const previewUrl = src.startsWith("/")
      ? `https://${params.siteId}.pages.dev${src}`
      : src.startsWith("http")
      ? src
      : `https://${params.siteId}.pages.dev/${src}`;

    // Context: nearest heading or section class for display
    const section = $(el).closest("[class]").attr("class")?.split(" ")[0] ?? "";
    const nearestHeading = $(el).closest("section, div").find("h1, h2, h3").first().text().trim().slice(0, 40);
    const context = nearestHeading || section || `Image ${i + 1}`;

    images.push({ index: i, src, alt, previewUrl, context });
  });

  return NextResponse.json({ images, total: images.length, sha: file.sha });
}

// PATCH — update alt text for one or more images by index
export async function PATCH(req: NextRequest, { params }: { params: { siteId: string } }) {
  const { updates, sha } = await req.json() as {
    updates: Array<{ index: number; alt: string }>;
    sha: string;
  };

  const file = await getFile(`${params.siteId}/index.html`);
  if (!file) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  const $ = cheerio.load(file.content, { xmlMode: false });
  const $imgs = $("img").toArray();

  for (const { index, alt } of updates) {
    if ($imgs[index]) {
      $($imgs[index]).attr("alt", alt);
    }
  }

  const updated = $.html();
  const filePath = `${params.siteId}/index.html`;
  const result = await putFile(filePath, updated, `images(${params.siteId}): update alt text (${updates.length} images)`, sha ?? file.sha);

  return NextResponse.json({ ok: true, sha: result.content?.sha });
}
