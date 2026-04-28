import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

// POST /api/entri/webhook
// Entri fires this webhook when DNS is configured by the customer.
// TODO: Verify webhook authenticity via signature header once Entri provides docs
export async function POST(req: NextRequest) {
  const body = await req.json();
  const domain = body.domain ?? body.hostname ?? body.host;
  const sessionId = body.sessionId ?? body.session_id ?? body.id;
  const status = body.status ?? body.event;

  if (!domain || status !== "completed") {
    return NextResponse.json({ ok: true }); // Acknowledge non-completion events
  }

  const supabase = createServiceRoleClient();

  // Find the site with this domain in build_payload
  const { data: sites } = await supabase
    .from("sites")
    .select("id, build_payload")
    .eq("status", "preview");

  const site = sites?.find((s: { id: string; build_payload: Record<string, unknown> | null }) =>
    s.build_payload?.publishing_domain === domain ||
    s.build_payload?.publishing_domain === `www.${domain}` ||
    s.build_payload?.entri_session_id === sessionId
  );

  if (!site) {
    console.warn(`[entri webhook] No site found for domain: ${domain}, sessionId: ${sessionId}`);
    return NextResponse.json({ ok: true });
  }

  const publishingDomain = (site.build_payload as Record<string, string>)?.publishing_domain ?? domain;

  // Mark live
  await supabase.from("sites").update({
    status: "live",
    live_url: `https://${publishingDomain}`,
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", site.id);

  console.log(`[entri webhook] Site ${site.id} marked live at ${publishingDomain}`);
  return NextResponse.json({ ok: true });
}
