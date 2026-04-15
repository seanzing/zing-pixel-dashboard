import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFile } from "@/lib/github";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function extractFromHtml(html: string): Promise<Record<string, string>> {
  try {
    const response = await anthropic.messages.create({
      // Haiku — cheap, fast, sufficient for field extraction
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system:
        "Extract business info from HTML. Return ONLY valid JSON with keys: business_name, phone, email, address, hours, hero_headline, hero_subheadline, cta_text. Use null for missing fields. Values must exactly match what appears in the HTML.",
      messages: [
        { role: "user", content: `Extract business info:\n\n${html.slice(0, 30000)}` },
      ],
    });
    const raw = (response.content[0] as { text: string }).text.trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}") + 1;
    const parsed = JSON.parse(raw.slice(start, end));
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => v !== null && v !== "")
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  try {
    const { siteIds, ownerEmail } = await request.json() as {
      siteIds: string[];
      ownerEmail?: string;
    };

    if (!Array.isArray(siteIds) || siteIds.length === 0) {
      return NextResponse.json({ error: "siteIds array required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const results: Array<{ id: string; status: "imported" | "error"; business_name?: string; error?: string }> = [];

    for (const siteId of siteIds) {
      try {
        // Try GitHub first, then fall back to demo catalog
        let htmlContent: string | null = null;
        const githubFile = await getFile(`${siteId}/index.html`);
        if (githubFile) {
          htmlContent = githubFile.content;
        } else {
          // Fetch from demo server (yourwebsiteexample.com/{id}/)
          const demoRes = await fetch(`https://yourwebsiteexample.com/${siteId}/`, {
            headers: { Accept: "text/html" },
          });
          if (demoRes.ok) {
            htmlContent = await demoRes.text();
            // Push HTML to zing-sites GitHub repo so deploy pipeline can pick it up
            const { writeFile } = await import("@/lib/github");
            await writeFile(
              `${siteId}/index.html`,
              htmlContent,
              `import: add ${siteId} from demo catalog`
            );
          }
        }

        if (!htmlContent) {
          results.push({ id: siteId, status: "error", error: "HTML not found in GitHub or demo catalog" });
          continue;
        }

        // Swap the file reference for extraction
        const file = { content: htmlContent };

        // Extract business fields via Haiku
        const extracted = await extractFromHtml(file.content);
        const businessName = (extracted.business_name as string | undefined) ?? siteId;

        // Upsert into Supabase
        const { error } = await supabase.from("sites").upsert(
          {
            id: siteId,
            business_name: businessName,
            owner_email: ownerEmail ?? "publishing@zing-work.com",
            phone: extracted.phone ?? null,
            address: extracted.address ?? null,
            hours: extracted.hours ?? null,
            hero_headline: extracted.hero_headline ?? null,
            hero_subheadline: extracted.hero_subheadline ?? null,
            cta_text: extracted.cta_text ?? null,
            status: "preview",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );

        if (error) {
          results.push({ id: siteId, status: "error", error: error.message });
        } else {
          results.push({ id: siteId, status: "imported", business_name: businessName });
        }
      } catch (err) {
        results.push({ id: siteId, status: "error", error: String(err) });
      }
    }

    const imported = results.filter((r) => r.status === "imported").length;
    const errors = results.filter((r) => r.status === "error").length;

    return NextResponse.json({ results, imported, errors });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
