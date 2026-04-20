import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFile } from "@/lib/github";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function extractFromHtml(html: string): Promise<Record<string, string>> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 512,
    system:
      "Extract business info from HTML. Return ONLY valid JSON with keys: business_name, phone, email, address, hours, hero_headline, hero_subheadline, cta_text. For address, if it appears split across a <br> tag, store it as two lines separated by a newline character. Use null for missing fields. Values must exactly match what appears in the HTML.",
    messages: [{ role: "user", content: `Extract business info:\n\n${html.slice(0, 40000)}` }],
  });
  const raw = (response.content[0] as { text: string }).text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}") + 1;
  const parsed = JSON.parse(raw.slice(start, end));
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null)) as Record<string, string>;
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-pixel-secret");
  if (secret !== process.env.PIXEL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, business_name, owner_email, phone, address, preview_url, live_url } = body;

  if (!id || !business_name || !owner_email) {
    return NextResponse.json(
      { error: "Missing required fields: id, business_name, owner_email" },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();

  const { data: site, error } = await supabase
    .from("sites")
    .upsert(
      {
        id,
        business_name,
        owner_email,
        phone: phone || null,
        address: address || null,
        preview_url: preview_url || null,
        live_url: live_url || null,
        status: live_url ? "live" : "preview",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Auto-extract structured fields from the HTML so they're ready for editing
  try {
    const file = await getFile(`${id}/index.html`);
    if (file) {
      const extracted = await extractFromHtml(file.content);
      if (Object.keys(extracted).length > 0) {
        await supabase.from("sites").update(extracted).eq("id", id);
      }
    }
  } catch {
    // Non-fatal — site is registered, extraction can be retried via Sync from site
  }

  return NextResponse.json({ success: true, site });
}
