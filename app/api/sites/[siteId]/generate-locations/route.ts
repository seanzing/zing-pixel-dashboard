import { NextRequest } from "next/server";
import * as cheerio from "cheerio";
import * as path from "node:path";
import * as fs from "node:fs";

const GITHUB_API = "https://api.github.com";
const REPO       = process.env.GITHUB_SITES_REPO!;
const TOKEN      = process.env.GITHUB_TOKEN!;
const NOMINATIM  = "https://nominatim.openstreetmap.org";

// ── GitHub ────────────────────────────────────────────────────────────────────
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
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${filePath}: ${res.status}`);
  const data = await res.json();
  return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
}

async function putFile(filePath: string, content: string, message: string, sha?: string) {
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
  };
  if (sha) body.sha = sha;
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${filePath}`, {
    method: "PUT", headers: ghHeaders(), body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub PUT ${filePath}: ${res.status} — ${(err as { message?: string }).message || ""}`);
  }
}

// ── Geo ───────────────────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocode(city: string, state: string) {
  const url = `${NOMINATIM}/search?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&country=US&format=json&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": "ZING-Pixel/1.0" } });
  const data = await res.json();
  if (!data.length) throw new Error(`Could not geocode "${city}, ${state}"`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

interface CityRecord { name: string; state: string; lat: number; lng: number; pop: number }

function loadCities(): CityRecord[] {
  const citiesPath = path.join(process.cwd(), "data", "us-cities.json");
  return JSON.parse(fs.readFileSync(citiesPath, "utf8"));
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function locationSlug(city: string, state: string) {
  return `${slugify(city)}-${state.toLowerCase()}`;
}

// ── HTML transform ────────────────────────────────────────────────────────────
function transformHtml(
  html: string,
  siteId: string,
  targetCity: string,
  targetState: string,
  baseCity: string,
  baseState: string
): string {
  const $ = cheerio.load(html, { xmlMode: false });

  // Inject <base href="/"> so relative HTML attr paths (src="./logo.jpg") resolve from root
  if (!$("base").length) {
    $("head").prepend('<base href="/">');
  } else {
    $("base").attr("href", "/");
  }

  // Rewrite relative url() refs in <style> blocks — <base> doesn't affect CSS
  // e.g. url('./hero.jpg') → url('/hero.jpg'), url('hero.jpg') → url('/hero.jpg')
  $("style").each((_, el) => {
    const original = $(el).html() ?? "";
    const fixed = original.replace(
      /url\(\s*['"]?((?!https?:\/\/|data:|\/|#)[^'")]+)['"]?\s*\)/g,
      (_match: string, p1: string) => `url('/${p1.replace(/^\.\//, "")}')`
    );
    if (fixed !== original) $(el).html(fixed);
  });

  // Rewrite relative url() in inline style= attributes too
  $("[style]").each((_, el) => {
    const original = $(el).attr("style") ?? "";
    const fixed = original.replace(
      /url\(\s*['"]?((?!https?:\/\/|data:|\/|#)[^'")]+)['"]?\s*\)/g,
      (_match: string, p1: string) => `url('/${p1.replace(/^\.\//, "")}')`
    );
    if (fixed !== original) $(el).attr("style", fixed);
  });

  const cityState = `${targetCity}, ${targetState}`;
  const slug = locationSlug(targetCity, targetState);
  const cityPattern = new RegExp(`${baseCity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},?\\s*${baseState}`, "ig");

  // Title
  const oldTitle = $("title").text().trim();
  const newTitle = cityPattern.test(oldTitle)
    ? oldTitle.replace(cityPattern, cityState)
    : (() => { const parts = oldTitle.split("|").map(s => s.trim()); return `${parts[0]} in ${cityState} | ${parts[parts.length - 1]}`; })();
  $("title").text(newTitle);

  // Meta description
  const oldDesc = $('meta[name="description"]').attr("content") || "";
  const newDesc = cityPattern.test(oldDesc)
    ? oldDesc.replace(cityPattern, cityState)
    : `${oldDesc.slice(0, 120)} Serving ${cityState}.`.trim();
  $('meta[name="description"]').attr("content", newDesc.slice(0, 160));

  // Canonical
  const canonicalPath = `/${siteId}/locations/${slug}/`;
  if ($('link[rel="canonical"]').length) {
    $('link[rel="canonical"]').attr("href", canonicalPath);
  } else {
    $("head").append(`<link rel="canonical" href="${canonicalPath}">`);
  }

  // H1 — swap city if present, otherwise leave tagline intact
  const $h1 = $("h1").first();
  if ($h1.length && cityPattern.test($h1.text())) {
    $h1.html(($h1.html() ?? "").replace(cityPattern, cityState));
  }

  // JSON-LD areaServed
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const schema = JSON.parse($(el).html() ?? "{}");
      if ("areaServed" in schema || schema["@type"]) schema.areaServed = cityState;
      $(el).html(JSON.stringify(schema, null, 2));
    } catch { /* skip malformed */ }
  });

  // Location badge in hero (non-intrusive)
  const $hero = $(".hero, section.hero, #hero").first();
  if ($hero.length && !$hero.text().includes(targetCity)) {
    const badge = `<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.9);font-size:13px;font-weight:600;padding:5px 13px;border-radius:100px;margin-bottom:16px;">📍 Serving ${cityState}</div>`;
    $hero.find("h1").first().before(badge);
  }

  return $.html();
}

// ── Locations index page ───────────────────────────────────────────────────────
function buildIndex(
  siteId: string,
  bizName: string,
  baseCity: string,
  baseState: string,
  cities: Array<{ name: string; state: string; slug: string }>
) {
  const rows = cities.map(c =>
    `<a href="/locations/${c.slug}/" class="loc-item"><span class="loc-name">${c.name}</span><span class="loc-state">${c.state}</span><span>→</span></a>`
  ).join("\n");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Service Areas | ${bizName}</title>
<meta name="description" content="${bizName} serves ${baseCity}, ${baseState} and surrounding communities.">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Plus Jakarta Sans',sans-serif;background:#f8fafc;color:#111827;padding:48px 24px}.container{max-width:760px;margin:0 auto}.back{font-size:13px;color:#6b7280;margin-bottom:32px;display:inline-flex;gap:6px;text-decoration:none}.back:hover{color:#111827}h1{font-size:32px;font-weight:800;letter-spacing:-.5px;margin-bottom:8px}.sub{font-size:16px;color:#6b7280;margin-bottom:36px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}.loc-item{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px;text-decoration:none;color:#111827;transition:all .15s}.loc-item:hover{border-color:#1a4d8f;color:#1a4d8f}.loc-name{font-weight:600;font-size:14px}.loc-state{font-size:12px;color:#9ca3af}</style></head>
<body><div class="container"><a href="/" class="back">← Back to ${bizName}</a><h1>Areas We Serve</h1>
<p class="sub">Based in ${baseCity}, ${baseState} — serving ${cities.length} communities.</p>
<div class="grid">${rows}</div></div></body></html>`;
}

// ── SSE helper ────────────────────────────────────────────────────────────────
function sse(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(new TextEncoder().encode(payload));
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: { params: { siteId: string } }) {
  const { siteId } = params;
  const body = await req.json();
  const { city, state, count = 50, radius = 100 } = body as {
    city: string; state: string; count?: number; radius?: number;
  };

  if (!city || !state) {
    return new Response(JSON.stringify({ error: "city and state required" }), { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => sse(controller, event, data);

      try {
        // 1. Fetch base HTML
        send("progress", { message: "Fetching site HTML from GitHub..." });
        const baseFile = await getFile(`${siteId}/index.html`);
        if (!baseFile) throw new Error(`${siteId}/index.html not found in GitHub`);
        const titleMatch = baseFile.content.match(/<title[^>]*>([^<]+)<\/title>/i);
        const bizName = titleMatch ? titleMatch[1].split("|")[0].trim() : siteId;
        send("progress", { message: `Site loaded: ${bizName}` });

        // 2. Geocode
        send("progress", { message: `Geocoding ${city}, ${state}...` });
        const { lat, lng } = await geocode(city, state);
        send("progress", { message: `Located at ${lat.toFixed(4)}, ${lng.toFixed(4)}` });

        // 3. Find cities
        send("progress", { message: "Selecting nearby cities..." });
        const allCities = loadCities();
        const BASE_STATE = state.toUpperCase();
        const seen = new Set([slugify(city)]);
        const MIN_POP = 5000;

        let candidates = allCities
          .map(c => ({ ...c, distKm: haversineKm(lat, lng, c.lat, c.lng) }))
          .filter(c => c.distKm <= radius && c.pop >= MIN_POP && !seen.has(slugify(c.name)));

        if (candidates.length < count) {
          candidates = allCities
            .map(c => ({ ...c, distKm: haversineKm(lat, lng, c.lat, c.lng) }))
            .filter(c => c.distKm <= radius && c.pop >= 1000 && !seen.has(slugify(c.name)));
        }

        const maxLogPop = Math.log(Math.max(...candidates.map(c => c.pop), 2));
        const scored = candidates
          .map(c => ({
            name: c.name,
            state: c.state || BASE_STATE,
            slug: locationSlug(c.name, c.state || BASE_STATE),
            distKm: c.distKm,
            pop: c.pop,
            score: 0.6 * (Math.log(Math.max(c.pop, 2)) / maxLogPop) + 0.4 * (1 - c.distKm / radius),
          }))
          .sort((a, b) => b.score - a.score)
          .filter(c => { if (seen.has(slugify(c.name))) return false; seen.add(slugify(c.name)); return true; })
          .slice(0, count);

        send("progress", { message: `Found ${scored.length} cities. Starting generation...` });
        send("cities", { cities: scored.map(c => ({ label: `${c.name}, ${c.state}`, slug: c.slug })) });

        // 4. Generate + push pages
        const pushed: typeof scored = [];
        const failed: Array<{ name: string; error: string }> = [];

        for (let i = 0; i < scored.length; i++) {
          const city2 = scored[i];
          try {
            const transformed = transformHtml(baseFile.content, siteId, city2.name, city2.state, city, state.toUpperCase());
            const filePath = `${siteId}/locations/${city2.slug}/index.html`;
            const existing = await getFile(filePath);
            await new Promise(r => setTimeout(r, 150));
            await putFile(filePath, transformed, `feat(locations): ${city2.name}, ${city2.state} for ${siteId}`, existing?.sha);
            await new Promise(r => setTimeout(r, 250));
            pushed.push(city2);
            send("page", { index: i + 1, total: scored.length, city: `${city2.name}, ${city2.state}`, status: "ok" });
          } catch (err) {
            failed.push({ name: city2.name, error: (err as Error).message });
            send("page", { index: i + 1, total: scored.length, city: `${city2.name}, ${city2.state}`, status: "error" });
          }
        }

        // 5. Locations index
        send("progress", { message: "Writing locations index page..." });
        const indexHtml = buildIndex(siteId, bizName, city, state.toUpperCase(), pushed.map(c => ({ name: c.name, state: c.state, slug: c.slug })));
        const indexPath = `${siteId}/locations/index.html`;
        const existingIndex = await getFile(indexPath);
        await putFile(indexPath, indexHtml, `feat(locations): service areas index for ${siteId}`, existingIndex?.sha);

        send("done", {
          pushed: pushed.length,
          failed: failed.length,
          indexUrl: `https://${siteId}.pages.dev/locations/`,
          errors: failed,
        });
      } catch (err) {
        send("error", { message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
