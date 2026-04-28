import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { addCfPagesCustomDomain, getCfPagesCustomDomainStatus, removeCfPagesCustomDomain } from "@/lib/cloudflare";
import { createEntriSession, getEntriSessionStatus } from "@/lib/entri";

function normalizeDomain(input: string): { apexDomain: string; wwwDomain: string } {
  let d = input.toLowerCase().trim();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/\/.*$/, "");
  d = d.replace(/^www\./, "");
  return { apexDomain: d, wwwDomain: `www.${d}` };
}

async function requireAuth() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return user;
}

// POST — Start Go Live process
export async function POST(
  req: Request,
  { params }: { params: { siteId: string } }
) {
  const user = await requireAuth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { siteId } = params;
  const { domain, mode } = await req.json();

  if (!domain) return NextResponse.json({ error: "Missing domain" }, { status: 400 });
  if (!mode || !["entri", "manual"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode — must be 'entri' or 'manual'" }, { status: 400 });
  }

  const { apexDomain, wwwDomain } = normalizeDomain(domain);
  const supabase = createServiceRoleClient();

  // Register www domain with CF Pages
  let cfStatus = "initializing";
  try {
    const cfResult = await addCfPagesCustomDomain(siteId, wwwDomain);
    cfStatus = cfResult.status;

    // Fast-path: .zingsite.com domains go live immediately
    if (apexDomain.endsWith(".zingsite.com")) {
      await supabase.from("sites").update({
        live_url: `https://${wwwDomain}`,
        status: "live",
        updated_at: new Date().toISOString(),
      }).eq("id", siteId);
      return NextResponse.json({
        type: "immediate",
        domain: wwwDomain,
        apexDomain,
        cfStatus: "active",
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "CF Pages domain registration failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Read current build_payload, merge new fields
  const { data: site } = await supabase.from("sites").select("build_payload").eq("id", siteId).single();
  const currentPayload = site?.build_payload ?? {};
  const publishingFields = {
    publishing_domain: wwwDomain,
    publishing_apex: apexDomain,
    publishing_mode: mode,
    publishing_started_at: new Date().toISOString(),
  };

  if (mode === "entri") {
    // Create Entri session
    const entriSession = await createEntriSession(apexDomain, [
      { type: "CNAME", host: "www", value: `${siteId}.pages.dev` },
    ]);

    const updatedPayload = { ...currentPayload, ...publishingFields, entri_session_id: entriSession.sessionId };
    await supabase.from("sites").update({
      build_payload: updatedPayload,
      updated_at: new Date().toISOString(),
    }).eq("id", siteId);

    return NextResponse.json({
      type: "entri",
      domain: wwwDomain,
      apexDomain,
      entri: { sessionId: entriSession.sessionId, connectUrl: entriSession.connectUrl },
      cfStatus,
    });
  }

  // Manual mode
  const updatedPayload = { ...currentPayload, ...publishingFields };
  await supabase.from("sites").update({
    build_payload: updatedPayload,
    updated_at: new Date().toISOString(),
  }).eq("id", siteId);

  const records = {
    www: {
      type: "CNAME",
      host: "www",
      value: `${siteId}.pages.dev`,
      ttl: "Auto",
      proxied: false,
      note: "Do NOT enable Cloudflare proxy (orange cloud) if your domain is on Cloudflare",
    },
    apex: {
      type: "URL Redirect",
      host: "@",
      value: `https://www.${apexDomain}`,
      note: "Redirect @ (apex/root) to www. Most registrars call this 'URL Redirect', 'Forwarding', or 'ALIAS'. Squarespace: Settings → Domains → DNS Settings → add CNAME record. Cloudflare: CNAME @ proxied (flattening). GoDaddy: Forwarding. Namecheap: URL Redirect.",
    },
  };

  return NextResponse.json({
    type: "manual",
    domain: wwwDomain,
    apexDomain,
    records,
    cfStatus,
  });
}

// GET — Check activation status
export async function GET(
  _req: Request,
  { params }: { params: { siteId: string } }
) {
  const user = await requireAuth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { siteId } = params;
  const supabase = createServiceRoleClient();

  const { data: site } = await supabase.from("sites").select("build_payload, status, live_url").eq("id", siteId).single();
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  const payload = site.build_payload ?? {};
  const publishingDomain = payload.publishing_domain;
  const publishingMode = payload.publishing_mode;

  if (!publishingDomain) {
    // Check if already live via old flow
    if (site.status === "live" && site.live_url) {
      return NextResponse.json({ status: "active", liveUrl: site.live_url });
    }
    return NextResponse.json({ status: "none" });
  }

  // Check CF Pages domain status
  let cfStatus = "unknown";
  try {
    const cfResult = await getCfPagesCustomDomainStatus(siteId, publishingDomain);
    cfStatus = cfResult?.status ?? "unknown";
  } catch {
    cfStatus = "error";
  }

  // If active, mark live
  if (cfStatus === "active") {
    await supabase.from("sites").update({
      status: "live",
      live_url: `https://${publishingDomain}`,
      updated_at: new Date().toISOString(),
    }).eq("id", siteId);
    return NextResponse.json({ status: "active", liveUrl: `https://${publishingDomain}` });
  }

  // If entri mode, also check Entri session status
  let entriStatus = null;
  if (publishingMode === "entri" && payload.entri_session_id) {
    try {
      entriStatus = await getEntriSessionStatus(payload.entri_session_id);
    } catch {
      entriStatus = { status: "pending" };
    }
  }

  return NextResponse.json({
    status: cfStatus,
    mode: publishingMode,
    domain: publishingDomain,
    apexDomain: payload.publishing_apex,
    entriStatus,
  });
}

// DELETE — Remove domain
export async function DELETE(
  _req: Request,
  { params }: { params: { siteId: string } }
) {
  const user = await requireAuth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { siteId } = params;
  const supabase = createServiceRoleClient();

  const { data: site } = await supabase.from("sites").select("build_payload").eq("id", siteId).single();
  const payload = site?.build_payload ?? {};
  const publishingDomain = payload.publishing_domain;

  if (publishingDomain) {
    try {
      await removeCfPagesCustomDomain(siteId, publishingDomain);
    } catch {
      // Best effort removal
    }
  }

  // Clear publishing fields from build_payload
  const { publishing_domain, publishing_apex, publishing_mode, publishing_started_at, entri_session_id, ...rest } = payload;
  void publishing_domain; void publishing_apex; void publishing_mode; void publishing_started_at; void entri_session_id;

  await supabase.from("sites").update({
    build_payload: Object.keys(rest).length > 0 ? rest : null,
    status: "preview",
    live_url: null,
    updated_at: new Date().toISOString(),
  }).eq("id", siteId);

  return NextResponse.json({ ok: true });
}
