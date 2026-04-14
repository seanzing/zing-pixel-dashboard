import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { addCustomDomain, getCustomDomains, removeCustomDomain } from "@/lib/cloudflare";

// GET — fetch current custom domains + verification status for this site
export async function GET(
  _req: Request,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;
  const result = await getCustomDomains(siteId);

  if (!result.success) {
    return NextResponse.json({ error: result.errors?.[0]?.message ?? "CF API error" }, { status: 502 });
  }

  const domains = (result.result ?? []) as Array<{
    name: string;
    status: string;
    verification_data?: { cname_target?: string };
  }>;

  return NextResponse.json({ domains });
}

// POST — add a custom domain
export async function POST(
  req: Request,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;
  const { domain } = await req.json();

  if (!domain) {
    return NextResponse.json({ error: "Missing domain" }, { status: 400 });
  }

  const cleaned = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");

  const result = await addCustomDomain(siteId, cleaned);

  if (!result.success) {
    const msg = result.errors?.[0]?.message ?? "Failed to add domain";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const domainData = result.result as {
    name: string;
    status: string;
    verification_data?: { cname_target?: string };
  };

  // If already active, update Supabase immediately
  if (domainData.status === "active") {
    const supabase = createServiceRoleClient();
    await supabase
      .from("sites")
      .update({
        live_url: `https://${cleaned}`,
        status: "live",
        updated_at: new Date().toISOString(),
      })
      .eq("id", siteId);
  }

  return NextResponse.json({ domain: domainData });
}

// PATCH — called by frontend polling to check status and promote site when verified
export async function PATCH(
  req: Request,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;
  const { domain } = await req.json();

  const result = await getCustomDomains(siteId);
  if (!result.success) {
    return NextResponse.json({ error: "CF API error" }, { status: 502 });
  }

  const domains = (result.result ?? []) as Array<{ name: string; status: string }>;
  const match = domains.find((d) => d.name === domain);

  if (!match) {
    return NextResponse.json({ status: "not_found" });
  }

  // If now active, mark site as live in Supabase
  if (match.status === "active") {
    const supabase = createServiceRoleClient();
    await supabase
      .from("sites")
      .update({
        live_url: `https://${domain}`,
        status: "live",
        updated_at: new Date().toISOString(),
      })
      .eq("id", siteId);
  }

  return NextResponse.json({ status: match.status });
}

// DELETE — remove a custom domain
export async function DELETE(
  req: Request,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;
  const { domain } = await req.json();

  await removeCustomDomain(siteId, domain);

  // Revert site status to preview
  const supabase = createServiceRoleClient();
  await supabase
    .from("sites")
    .update({ live_url: null, status: "preview", updated_at: new Date().toISOString() })
    .eq("id", siteId);

  return NextResponse.json({ success: true });
}
