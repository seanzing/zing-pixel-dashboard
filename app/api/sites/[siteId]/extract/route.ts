import { NextResponse } from "next/server";
import { getFile } from "@/lib/github";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET(
  _request: Request,
  { params }: { params: { siteId: string } }
) {
  const { siteId } = params;

  const file = await getFile(`${siteId}/index.html`);
  if (!file) {
    return NextResponse.json({ error: "Site HTML not found" }, { status: 404 });
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 512,
    system:
      "You extract structured business information from HTML. Return ONLY valid JSON (no markdown) with these exact keys: business_name, phone, email, address, hours, hero_headline, hero_subheadline, cta_text. Use null for any field you cannot find. Keep values exactly as they appear in the HTML.",
    messages: [
      {
        role: "user",
        content: `Extract the business info from this HTML:\n\n${file.content}`,
      },
    ],
  });

  const raw = (response.content[0] as { text: string }).text.trim();
  const jsonStr = raw.startsWith("{") ? raw : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);

  try {
    const extracted = JSON.parse(jsonStr);
    return NextResponse.json({ extracted });
  } catch {
    return NextResponse.json({ error: "Failed to parse extraction" }, { status: 500 });
  }
}
