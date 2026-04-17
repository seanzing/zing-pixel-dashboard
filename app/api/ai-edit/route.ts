import { NextResponse } from "next/server";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { processAiEdit } from "@/lib/ai";
import { getFile, StaleShaError } from "@/lib/github";

export async function POST(request: Request) {
  const { siteId, message, chatHistory, page = "index.html" } = await request.json();

  if (!siteId || !message) {
    return NextResponse.json(
      { error: "Missing siteId or message" },
      { status: 400 }
    );
  }

  const file = await getFile(`${siteId}/${page}`);
  if (!file) {
    return NextResponse.json(
      { error: "Site files not found in GitHub" },
      { status: 404 }
    );
  }

  const currentHtml = file.content;
  const supabase = createServiceRoleClient();
  const userClient = createServerSupabaseClient();
  const { data: { user } } = await userClient.auth.getUser();
  const deployedBy = user?.email ?? "unknown";

  try {
    const result = await processAiEdit(currentHtml, message, chatHistory ?? []);

    // Save chat messages (scoped to page) — edit is local until user deploys
    await supabase.from("chat_messages").insert([
      { site_id: siteId, page, role: "user", content: message },
      { site_id: siteId, page, role: "assistant", content: result.changes },
    ]);

    // Update site timestamp
    await supabase
      .from("sites")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", siteId);

    // Return updated HTML — client holds it locally until user clicks Deploy
    return NextResponse.json({
      changes: result.changes,
      html: result.html,
    });
  } catch (err) {
    if (err instanceof StaleShaError) {
      return NextResponse.json({ error: err.message, conflict: true }, { status: 409 });
    }
    const errorMessage = err instanceof Error ? err.message : "AI edit failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
