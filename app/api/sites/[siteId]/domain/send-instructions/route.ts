import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const AMY_CHANNEL_ID = "1489709501547417680";

export async function POST(
  req: Request,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;
  const { domain, nameservers } = await req.json();

  if (!domain || !nameservers?.length) {
    return NextResponse.json({ error: "Missing domain or nameservers" }, { status: 400 });
  }

  // Fetch business name from Supabase
  const supabase = createServiceRoleClient();
  const { data: site } = await supabase
    .from("sites")
    .select("business_name")
    .eq("id", siteId)
    .single();

  const businessName = site?.business_name ?? siteId;

  const message = [
    `📬 **Nameserver Instructions Ready — ${businessName}**`,
    `Domain: ${domain}`,
    `Customer should change nameservers to:`,
    ...nameservers.map((ns: string) => `  \`${ns}\``),
    ``,
    `Site will go live automatically once propagated (usually 1-4 hours).`,
  ].join("\n");

  // Try to send Discord notification
  if (DISCORD_WEBHOOK_URL) {
    try {
      await fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
      });
    } catch (e) {
      console.error("[send-instructions] Discord webhook failed:", e);
    }
  } else {
    // Log for visibility when webhook isn't configured
    console.log(`[send-instructions] Channel ${AMY_CHANNEL_ID}:\n${message}`);
  }

  return NextResponse.json({ ok: true, message });
}
