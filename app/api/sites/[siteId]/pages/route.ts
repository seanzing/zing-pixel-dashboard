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

// Dirs to skip when scanning for subpages
const SKIP_DIRS = new Set(["assets", "locations", "images", ".github"]);

function labelFromFilename(filename: string): string {
  if (filename === "index.html") return "Home";
  // Handle "about/index.html" → use dir name "about"
  const base = filename.replace(/\/index\.html$/, "").replace(/\.html$/, "");
  return base.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type PageEntry = {
  filename: string;
  label: string;
  isHome: boolean;
  slug: string;
  isNav: boolean; // true = in main nav; false = internal/subpage (only present for migrated sites)
};

// GET — list all pages: flat .html files + subdirectory index.html files (migration output)
export async function GET(_req: NextRequest, { params }: { params: { siteId: string } }) {
  const [rootRes, reportRes] = await Promise.all([
    fetch(`${GITHUB_API}/repos/${REPO}/contents/${params.siteId}`, { headers: ghHeaders() }),
    fetch(`${GITHUB_API}/repos/${REPO}/contents/${params.siteId}/_migrate-report.json`, { headers: ghHeaders() }),
  ]);
  if (!rootRes.ok) return NextResponse.json({ error: "Site not found" }, { status: 404 });
  const entries: Array<{ name: string; type: string }> = await rootRes.json();

  // Read navSlugs from migration report (if it exists)
  let navSlugs: Set<string> | null = null;
  if (reportRes.ok) {
    try {
      const reportData = await reportRes.json();
      const raw = Buffer.from(reportData.content, "base64").toString("utf8");
      const report = JSON.parse(raw);
      if (Array.isArray(report.navSlugs)) navSlugs = new Set(report.navSlugs);
    } catch { /* no report or malformed — treat all as nav */ }
  }

  // 1. Flat .html files at root
  const flatPages: PageEntry[] = entries
    .filter(e => e.type === "file" && e.name.endsWith(".html"))
    .map(e => {
      const slug = e.name === "index.html" ? "/" : `/${e.name.replace(/\.html$/, "")}/`;
      const dirSlug = slug.replace(/^\/|\/$/g, ""); // "" for home, "about" for /about/
      return {
        filename: e.name,
        label: labelFromFilename(e.name),
        isHome: e.name === "index.html",
        slug,
        isNav: navSlugs ? navSlugs.has(dirSlug) : true,
      };
    });

  // 2. Subdirectory index.html files (migration output: about/index.html, gallery/index.html, etc.)
  const subdirs = entries.filter(e => e.type === "dir" && !SKIP_DIRS.has(e.name));
  const subdirPages: PageEntry[] = [];

  if (subdirs.length > 0) {
    const batches: typeof subdirs[] = [];
    for (let i = 0; i < subdirs.length; i += 10) batches.push(subdirs.slice(i, i + 10));

    for (const batch of batches) {
      const results = await Promise.all(batch.map(async dir => {
        const r = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${params.siteId}/${dir.name}`, { headers: ghHeaders() });
        if (!r.ok) return null;
        const sub: Array<{ name: string; type: string }> = await r.json();
        const hasIndex = sub.some(f => f.name === "index.html" && f.type === "file");
        if (!hasIndex) return null;
        return {
          filename: `${dir.name}/index.html`,
          label: labelFromFilename(`${dir.name}/index.html`),
          isHome: false,
          slug: `/${dir.name}/`,
          isNav: navSlugs ? navSlugs.has(dir.name) : true,
        };
      }));
      subdirPages.push(...results.filter(Boolean) as PageEntry[]);
    }
  }

  // Merge: prefer flat files, dedupe by slug
  const flatSlugs = new Set(flatPages.map(p => p.slug));
  const merged = [
    ...flatPages,
    ...subdirPages.filter(p => !flatSlugs.has(p.slug)),
  ].sort((a, b) => {
    if (a.isHome) return -1;
    if (b.isHome) return 1;
    // Nav pages first, then subpages
    if (a.isNav !== b.isNav) return a.isNav ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  const hasSubpages = merged.some(p => !p.isNav);
  return NextResponse.json({ pages: merged, hasSubpages });
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
