import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  addCustomDomain,
  getCustomDomains,
  removeCustomDomain,
  createCfZone,
  getZoneDnsRecords,
  addZoneDnsRecord,
  updateZoneDnsRecord,
  getZoneStatus,
  deleteCfZone,
} from "@/lib/cloudflare";

function extractApex(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

function isZingSubdomain(domain: string): boolean {
  return domain.toLowerCase().endsWith(".zingsite.com");
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── GET — Check domain / zone status ────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;
  const supabase = createServiceRoleClient();

  // Read build_payload for zone info
  const { data: site } = await supabase
    .from("sites")
    .select("build_payload, live_url, status")
    .eq("id", siteId)
    .single();

  const zoneId = site?.build_payload?.cf_zone_id as string | undefined;
  const apexDomain = site?.build_payload?.apex_domain as string | undefined;

  // Custom domain path — check zone status
  if (zoneId && apexDomain) {
    try {
      const zoneInfo = await getZoneStatus(zoneId);

      if (zoneInfo.status === "active" && site?.status !== "live") {
        await supabase
          .from("sites")
          .update({
            live_url: `https://www.${apexDomain}`,
            status: "live",
            updated_at: new Date().toISOString(),
          })
          .eq("id", siteId);
      }

      return NextResponse.json({
        type: "custom",
        status: zoneInfo.status === "active" ? "active" : "pending_nameservers",
        zoneId,
        apexDomain,
        nameservers: zoneInfo.nameServers,
        liveUrl: zoneInfo.status === "active" ? `https://www.${apexDomain}` : undefined,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Zone check failed" },
        { status: 502 }
      );
    }
  }

  // ZING subdomain path — check CF Pages custom domains
  const result = await getCustomDomains(siteId);
  if (!result.success) {
    return NextResponse.json({ error: result.errors?.[0]?.message ?? "CF API error" }, { status: 502 });
  }

  const domains = (result.result ?? []) as Array<{
    name: string;
    status: string;
    verification_data?: { cname_target?: string };
  }>;

  if (domains.length > 0) {
    const d = domains[0];
    return NextResponse.json({
      type: "zing",
      status: d.status === "active" ? "active" : "pending",
      domain: d.name,
      liveUrl: d.status === "active" ? `https://${d.name}` : undefined,
      verification_data: d.verification_data,
    });
  }

  return NextResponse.json({ type: "none", status: "idle" });
}

// ─── POST — Set up domain (two modes) ────────────────────────────────────────

export async function POST(
  req: Request,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;
  const { domain } = await req.json();

  if (!domain || typeof domain !== "string") {
    return NextResponse.json({ error: "Missing domain" }, { status: 400 });
  }

  const cleaned = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");

  // Validate domain format
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(cleaned)) {
    return NextResponse.json({ error: "Invalid domain format" }, { status: 400 });
  }

  // ── Mode A: ZING subdomain ──
  if (isZingSubdomain(cleaned)) {
    const result = await addCustomDomain(siteId, cleaned);
    if (!result.success) {
      return NextResponse.json(
        { error: result.errors?.[0]?.message ?? "Failed to add domain" },
        { status: 400 }
      );
    }

    const domainData = result.result as { name: string; status: string };

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

    return NextResponse.json({
      type: "zing",
      status: domainData.status === "active" ? "active" : "pending",
      domain: domainData.name,
      liveUrl: domainData.status === "active" ? `https://${cleaned}` : undefined,
    });
  }

  // ── Mode B: Custom domain — create CF zone ──
  const apexDomain = extractApex(cleaned);

  try {
    // 1. Create zone (handles "already exists" gracefully)
    const zone = await createCfZone(apexDomain);

    // 2. Wait for DNS import scan to complete
    await delay(2000);

    // 3. Fetch imported DNS records
    const importedRecords = await getZoneDnsRecords(zone.zoneId);

    // 4. Add or update www CNAME → siteId.pages.dev
    const wwwName = `www.${apexDomain}`;
    const existingWww = importedRecords.find(
      (r) => r.type === "CNAME" && r.name === wwwName
    );

    if (existingWww) {
      await updateZoneDnsRecord(zone.zoneId, existingWww.id, {
        type: "CNAME",
        name: "www",
        content: `${siteId}.pages.dev`,
        ttl: 1, // auto
        proxied: false,
      });
    } else {
      await addZoneDnsRecord(zone.zoneId, {
        type: "CNAME",
        name: "www",
        content: `${siteId}.pages.dev`,
        ttl: 1,
        proxied: false,
      });
    }

    // 5. Also add the Pages custom domain so CF Pages knows about it
    await addCustomDomain(siteId, wwwName);

    // 6. Store zoneId + apexDomain in build_payload
    const supabase = createServiceRoleClient();
    const { data: site } = await supabase
      .from("sites")
      .select("build_payload, business_name")
      .eq("id", siteId)
      .single();

    const currentPayload = (site?.build_payload as Record<string, unknown>) ?? {};
    await supabase
      .from("sites")
      .update({
        build_payload: {
          ...currentPayload,
          cf_zone_id: zone.zoneId,
          apex_domain: apexDomain,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", siteId);

    // Re-fetch records after adding our CNAME
    const finalRecords = await getZoneDnsRecords(zone.zoneId);

    return NextResponse.json({
      type: "custom",
      zoneId: zone.zoneId,
      nameservers: zone.nameservers,
      importedRecords: finalRecords,
      status: "pending_nameservers",
      apexDomain,
      wwwDomain: wwwName,
      businessName: site?.business_name ?? "",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Zone creation failed";
    const status = msg.includes("rate limit") ? 429 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// ─── DELETE — Remove domain / zone ───────────────────────────────────────────

export async function DELETE(
  req: Request,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;
  const { domain } = await req.json();
  const supabase = createServiceRoleClient();

  // Check if this is a custom domain with a zone
  const { data: site } = await supabase
    .from("sites")
    .select("build_payload")
    .eq("id", siteId)
    .single();

  const zoneId = site?.build_payload?.cf_zone_id as string | undefined;

  if (zoneId) {
    // Custom domain path — delete the zone
    try {
      await deleteCfZone(zoneId);
    } catch {
      // Zone may already be deleted — continue cleanup
    }

    // Remove zone info from build_payload
    const currentPayload = (site?.build_payload as Record<string, unknown>) ?? {};
    const { cf_zone_id: _z, apex_domain: _a, ...rest } = currentPayload;
    await supabase
      .from("sites")
      .update({
        build_payload: Object.keys(rest).length > 0 ? rest : null,
        live_url: null,
        status: "preview",
        updated_at: new Date().toISOString(),
      })
      .eq("id", siteId);
  } else if (domain) {
    // ZING subdomain path — remove CF Pages custom domain
    await removeCustomDomain(siteId, domain);
    await supabase
      .from("sites")
      .update({ live_url: null, status: "preview", updated_at: new Date().toISOString() })
      .eq("id", siteId);
  }

  return NextResponse.json({ success: true });
}
