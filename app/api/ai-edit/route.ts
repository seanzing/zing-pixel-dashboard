import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { processAiEdit } from "@/lib/ai";
import { deployToPages } from "@/lib/cloudflare";
import fs from "fs";
import path from "path";

const SITES_BASE_PATH = process.env.SITES_BASE_PATH!;

export async function POST(request: Request) {
  const { siteId, message, chatHistory } = await request.json();

  if (!siteId || !message) {
    return NextResponse.json(
      { error: "Missing siteId or message" },
      { status: 400 }
    );
  }

  const htmlPath = path.join(SITES_BASE_PATH, siteId, "index.html");

  if (!fs.existsSync(htmlPath)) {
    return NextResponse.json(
      { error: `HTML file not found at ${htmlPath}` },
      { status: 404 }
    );
  }

  const currentHtml = fs.readFileSync(htmlPath, "utf-8");
  const supabase = createServiceRoleClient();

  try {
    const result = await processAiEdit(currentHtml, message, chatHistory ?? []);

    // Write updated HTML
    fs.writeFileSync(htmlPath, result.html, "utf-8");

    // Save chat messages
    await supabase.from("chat_messages").insert([
      { site_id: siteId, role: "user", content: message },
      { site_id: siteId, role: "assistant", content: result.changes },
    ]);

    // Trigger preview deploy
    let previewUrl = "";
    try {
      previewUrl = await deployToPages(siteId);
      await supabase
        .from("deployments")
        .insert({ site_id: siteId, type: "preview", url: previewUrl, deployed_by: "ai-edit" });
      await supabase
        .from("sites")
        .update({ preview_url: previewUrl, updated_at: new Date().toISOString() })
        .eq("id", siteId);
    } catch {
      // Deploy failed — still return changes
    }

    return NextResponse.json({
      changes: result.changes,
      previewUrl,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "AI edit failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
