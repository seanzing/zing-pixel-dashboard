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

// GET — extract SEO fields from HTML
export async function GET(_req: NextRequest, { params }: { params: { siteId: string } }) {
  const file = await getFile(`${params.siteId}/index.html`);
  if (!file) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  const $ = cheerio.load(file.content);

  const seo = {
    title: $("title").first().text().trim(),
    description: $('meta[name="description"]').attr("content") ?? "",
    canonical: $('link[rel="canonical"]').attr("href") ?? "",
    ogTitle: $('meta[property="og:title"]').attr("content") ?? "",
    ogDescription: $('meta[property="og:description"]').attr("content") ?? "",
    ogImage: $('meta[property="og:image"]').attr("content") ?? "",
    h1: $("h1").first().text().trim(),
  };

  return NextResponse.json({ seo, sha: file.sha });
}

// PATCH — write SEO fields back into HTML
export async function PATCH(req: NextRequest, { params }: { params: { siteId: string } }) {
  const { seo, sha } = await req.json() as {
    seo: { title?: string; description?: string; canonical?: string; ogTitle?: string; ogDescription?: string; ogImage?: string };
    sha: string;
  };

  const file = await getFile(`${params.siteId}/index.html`);
  if (!file) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  const $ = cheerio.load(file.content, { xmlMode: false });

  if (seo.title !== undefined) $("title").text(seo.title);

  if (seo.description !== undefined) {
    if ($('meta[name="description"]').length) {
      $('meta[name="description"]').attr("content", seo.description);
    } else {
      $("head").append(`<meta name="description" content="${seo.description}">`);
    }
  }

  if (seo.canonical !== undefined) {
    if ($('link[rel="canonical"]').length) {
      $('link[rel="canonical"]').attr("href", seo.canonical);
    } else {
      $("head").append(`<link rel="canonical" href="${seo.canonical}">`);
    }
  }

  if (seo.ogTitle !== undefined) {
    if ($('meta[property="og:title"]').length) $('meta[property="og:title"]').attr("content", seo.ogTitle);
    else $("head").append(`<meta property="og:title" content="${seo.ogTitle}">`);
  }

  if (seo.ogDescription !== undefined) {
    if ($('meta[property="og:description"]').length) $('meta[property="og:description"]').attr("content", seo.ogDescription);
    else $("head").append(`<meta property="og:description" content="${seo.ogDescription}">`);
  }

  if (seo.ogImage !== undefined) {
    if ($('meta[property="og:image"]').length) $('meta[property="og:image"]').attr("content", seo.ogImage);
    else $("head").append(`<meta property="og:image" content="${seo.ogImage}">`);
  }

  const updated = $.html();
  const filePath = `${params.siteId}/index.html`;
  const result = await putFile(filePath, updated, `seo(${params.siteId}): update meta tags`, sha ?? file.sha);

  return NextResponse.json({ ok: true, sha: result.content?.sha });
}
