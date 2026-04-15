import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

const GITHUB_API = "https://api.github.com";
const REPO = process.env.GITHUB_SITES_REPO!;
const TOKEN = process.env.GITHUB_TOKEN!;

function ghHeaders() {
  return {
    Authorization: `token ${TOKEN}`,
    Accept: "application/vnd.github.v3+json",
  };
}

export async function GET(
  _request: Request,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;

  // Get site's CF Pages subdomain from Supabase
  const supabase = createServiceRoleClient();
  const { data: site } = await supabase
    .from("sites")
    .select("preview_url, live_url")
    .eq("id", siteId)
    .single();

  // Derive stable CF Pages base URL
  // preview_url may be a hash URL like https://abc123.mooreroofing.pages.dev
  // The stable production URL is https://{siteId}.pages.dev
  const pagesBase = site?.live_url?.replace(/\/$/, "") ||
    `https://${siteId}.pages.dev`;

  // List locations directory from GitHub
  const res = await fetch(
    `${GITHUB_API}/repos/${REPO}/contents/${siteId}/locations`,
    { headers: ghHeaders() }
  );

  if (res.status === 404) {
    return NextResponse.json({ locations: [], pagesBase });
  }
  if (!res.ok) {
    return NextResponse.json({ error: "GitHub error" }, { status: 500 });
  }

  const entries: Array<{ name: string; type: string }> = await res.json();

  // Each directory under locations/ is a city slug
  const locationDirs = entries.filter((e) => e.type === "dir" && e.name !== "index.html");

  const locations = locationDirs.map((dir) => {
    // Humanise slug: "jacksonville-fl" → "Jacksonville, FL"
    const parts = dir.name.split("-");
    const stateAbbr = parts[parts.length - 1].toUpperCase();
    const cityParts = parts.slice(0, -1);
    const cityName = cityParts
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");

    return {
      slug: dir.name,
      label: `${cityName}, ${stateAbbr}`,
      cityName,
      state: stateAbbr,
      url: `${pagesBase}/locations/${dir.name}/`,
    };
  }).sort((a, b) => a.label.localeCompare(b.label));

  // Check if index page exists
  const hasIndex = entries.some((e) => e.name === "index.html" || e.type === "dir");

  return NextResponse.json({
    locations,
    total: locations.length,
    indexUrl: locations.length > 0 ? `${pagesBase}/locations/` : null,
    pagesBase,
    hasIndex,
  });
}
