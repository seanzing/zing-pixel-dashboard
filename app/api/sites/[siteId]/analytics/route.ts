import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

const CF_ACCOUNT_ID = "1fdcfd4a514f6923736d60de83fd5d2a";
const CF_GQL = "https://api.cloudflare.com/client/v4/graphql";

async function cfQuery(token: string, query: string) {
  const res = await fetch(CF_GQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

function buildFilters(host: string, pathPrefix: string | null, start: string, end: string) {
  const filters: string[] = [
    `{datetime_geq: "${start}"}`,
    `{datetime_leq: "${end}"}`,
    `{requestHost: "${host}"}`,
  ];
  if (pathPrefix) {
    filters.push(`{requestPath_like: "${pathPrefix}%"}`);
  }
  return `AND: [${filters.join(", ")}]`;
}

export async function GET(
  _request: Request,
  { params }: { params: { siteId: string } }
) {
  const token = process.env.CF_ANALYTICS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "CF_ANALYTICS_TOKEN not configured" }, { status: 500 });
  }

  const supabase = createServiceRoleClient();
  const { data: site } = await supabase
    .from("sites")
    .select("id, preview_url, live_url")
    .eq("id", params.siteId)
    .single();

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // Determine the analytics host/path to query
  // Priority: live_url (custom domain) > preview_url (*.pages.dev) > demo path
  let host: string;
  let pathPrefix: string | null = null;

  if (site.live_url) {
    try {
      host = new URL(site.live_url).hostname;
    } catch {
      host = "yourwebsiteexample.com";
      pathPrefix = `/${params.siteId}/`;
    }
  } else if (site.preview_url) {
    try {
      host = new URL(site.preview_url).hostname;
    } catch {
      host = "yourwebsiteexample.com";
      pathPrefix = `/${params.siteId}/`;
    }
  } else {
    host = "yourwebsiteexample.com";
    pathPrefix = `/${params.siteId}/`;
  }

  const now = new Date();
  const end = now.toISOString().replace(/\.\d+Z$/, "Z");
  const start30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");

  const filterStr = buildFilters(host, pathPrefix, start30, end);

  // Run queries in parallel
  const [overviewRes, dailyRes, countryRes, referrerRes, deviceRes] = await Promise.all([
    // Overview totals
    cfQuery(
      token,
      `{ viewer { accounts(filter: {accountTag: "${CF_ACCOUNT_ID}"}) {
        rumPageloadEventsAdaptiveGroups(filter: { ${filterStr} }, limit: 1) {
          count sum { visits }
        }
      } } }`
    ),
    // Daily breakdown
    cfQuery(
      token,
      `{ viewer { accounts(filter: {accountTag: "${CF_ACCOUNT_ID}"}) {
        rumPageloadEventsAdaptiveGroups(filter: { ${filterStr} }, limit: 31, orderBy: [date_ASC]) {
          count sum { visits } dimensions { date }
        }
      } } }`
    ),
    // Top countries
    cfQuery(
      token,
      `{ viewer { accounts(filter: {accountTag: "${CF_ACCOUNT_ID}"}) {
        rumPageloadEventsAdaptiveGroups(filter: { ${filterStr} }, limit: 10, orderBy: [count_DESC]) {
          count dimensions { countryName }
        }
      } } }`
    ),
    // Top referrers
    cfQuery(
      token,
      `{ viewer { accounts(filter: {accountTag: "${CF_ACCOUNT_ID}"}) {
        rumPageloadEventsAdaptiveGroups(filter: { ${filterStr} }, limit: 10, orderBy: [count_DESC]) {
          count dimensions { refererHost }
        }
      } } }`
    ),
    // Device breakdown
    cfQuery(
      token,
      `{ viewer { accounts(filter: {accountTag: "${CF_ACCOUNT_ID}"}) {
        rumPageloadEventsAdaptiveGroups(filter: { ${filterStr} }, limit: 5, orderBy: [count_DESC]) {
          count dimensions { deviceType }
        }
      } } }`
    ),
  ]);

  const acct = (r: { data?: { viewer?: { accounts?: Array<{ rumPageloadEventsAdaptiveGroups: unknown[] }> } } }) =>
    r?.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? [];

  const overview = acct(overviewRes)[0] as { count: number; sum: { visits: number } } | undefined;
  const daily = acct(dailyRes) as Array<{ count: number; sum: { visits: number }; dimensions: { date: string } }>;
  const countries = (acct(countryRes) as Array<{ count: number; dimensions: { countryName: string } }>)
    .filter((r) => r.dimensions.countryName);
  const referrers = (acct(referrerRes) as Array<{ count: number; dimensions: { refererHost: string } }>)
    .filter((r) => r.dimensions.refererHost && r.dimensions.refererHost !== "");
  const devices = acct(deviceRes) as Array<{ count: number; dimensions: { deviceType: string } }>;

  return NextResponse.json({
    period: "30d",
    host,
    pathPrefix,
    pageviews: overview?.count ?? 0,
    visits: overview?.sum?.visits ?? 0,
    daily: daily.map((d) => ({ date: d.dimensions.date, pageviews: d.count, visits: d.sum.visits })),
    countries: countries.slice(0, 8).map((r) => ({ name: r.dimensions.countryName, count: r.count })),
    referrers: referrers.slice(0, 8).map((r) => ({ host: r.dimensions.refererHost, count: r.count })),
    devices: devices.map((r) => ({ type: r.dimensions.deviceType, count: r.count })),
  });
}
