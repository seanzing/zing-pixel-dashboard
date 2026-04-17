import { NextRequest, NextResponse } from "next/server";
import { processAiEdit } from "@/lib/ai";

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

async function putFile(path: string, content: string, message: string, sha?: string) {
  const body: Record<string, string> = { message, content: Buffer.from(content).toString("base64") };
  if (sha) body.sha = sha;
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${path}`, {
    method: "PUT", headers: ghHeaders(), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status}`);
  return res.json();
}

function labelFromFilename(filename: string): string {
  if (filename === "index.html") return "Home";
  const base = filename.replace(/\.html$/, "");
  return base.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// GET — list all .html pages in site root (excluding locations/ subdirs)
export async function GET(_req: NextRequest, { params }: { params: { siteId: string } }) {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${params.siteId}`, { headers: ghHeaders() });
  if (!res.ok) return NextResponse.json({ error: "Site not found" }, { status: 404 });
  const entries: Array<{ name: string; type: string }> = await res.json();

  const pages = entries
    .filter(e => e.type === "file" && e.name.endsWith(".html"))
    .map(e => ({
      filename: e.name,
      label: labelFromFilename(e.name),
      isHome: e.name === "index.html",
      slug: e.name === "index.html" ? "/" : `/${e.name.replace(/\.html$/, "")}/`,
    }))
    .sort((a, b) => {
      if (a.isHome) return -1;
      if (b.isHome) return 1;
      return a.label.localeCompare(b.label);
    });

  return NextResponse.json({ pages });
}

// POST — create a new page
export async function POST(req: NextRequest, { params }: { params: { siteId: string } }) {
  const { name, slug, cloneFrom = "index.html", addToNav = false } = await req.json() as {
    name: string;
    slug: string;
    cloneFrom?: string;
    addToNav?: boolean;
  };

  if (!name || !slug) return NextResponse.json({ error: "name and slug required" }, { status: 400 });
  if (slug === "index") return NextResponse.json({ error: "Reserved slug" }, { status: 400 });

  const filename = `${slugify(slug)}.html`;
  const filePath = `${params.siteId}/${filename}`;

  // Check it doesn't already exist
  const existing = await getFile(filePath);
  if (existing) return NextResponse.json({ error: `${filename} already exists` }, { status: 409 });

  // Clone source file
  const source = await getFile(`${params.siteId}/${cloneFrom}`);
  if (!source) return NextResponse.json({ error: `Source page ${cloneFrom} not found` }, { status: 404 });

  // Run a quick AI edit on the cloned content to set appropriate page title/h1
  let newHtml = source.content;
  try {
    const result = await processAiEdit(source.content, 
      `This page was just created. Update the page title tag and h1 to say "${name}". Remove any location-specific hero badge. Keep all design, styles, nav, header, and footer exactly the same. Only change the page title, h1, and meta description to reflect this is the "${name}" page.`,
      []
    );
    newHtml = result.html;
  } catch { /* fall back to raw clone if AI fails */ }

  // Create the new file
  await putFile(filePath, newHtml, `feat(pages): create ${filename} for ${params.siteId}`);

  // Optionally add this page to the nav on ALL existing pages
  const navResults: Array<{ page: string; ok: boolean; error?: string }> = [];
  if (addToNav) {
    // Get all existing pages (excluding the new one)
    const listRes = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${params.siteId}`, { headers: ghHeaders() });
    const entries: Array<{ name: string; type: string }> = await listRes.json();
    const existingPages = entries
      .filter(e => e.type === "file" && e.name.endsWith(".html") && e.name !== filename)
      .map(e => e.name);

    for (const pageFile of existingPages) {
      try {
        const f = await getFile(`${params.siteId}/${pageFile}`);
        if (!f) continue;
        const result = await processAiEdit(
          f.content,
          `Add a "${name}" navigation link to the nav bar. The link should go to "/${slugify(slug)}/". Match the style of the other nav links exactly. Don't change anything else on the page.`,
          []
        );
        await putFile(
          `${params.siteId}/${pageFile}`,
          result.html,
          `feat(nav): add ${name} link to ${pageFile} for ${params.siteId}`,
          f.sha
        );
        navResults.push({ page: pageFile, ok: true });
        await new Promise(r => setTimeout(r, 300)); // avoid SHA conflicts
      } catch (err) {
        navResults.push({ page: pageFile, ok: false, error: (err as Error).message });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    filename,
    label: name,
    slug: `/${slugify(slug)}/`,
    navUpdates: navResults,
  });
}
