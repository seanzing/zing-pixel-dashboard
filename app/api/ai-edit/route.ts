import { NextResponse } from "next/server";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { processAiEdit } from "@/lib/ai";
import { getFile, writeFile, StaleShaError } from "@/lib/github";

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

    // Write updated HTML to GitHub — commit triggers Cloudflare deploy via Actions
    const commitMsg = `edit(${siteId}/${page}): ${result.changes.slice(0, 72)}`;
    const commitSha = await writeFile(
      `${siteId}/${page}`,
      result.html,
      commitMsg,
      file.sha
    );

    // Save chat messages (scoped to page)
    await supabase.from("chat_messages").insert([
      { site_id: siteId, page, role: "user", content: message },
      { site_id: siteId, page, role: "assistant", content: result.changes },
    ]);

    // Update site timestamp
    await supabase
      .from("sites")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", siteId);

    // Log the edit (includes commit SHA for full audit trail)
    await supabase.from("edit_log").insert({
      site_id: siteId,
      user_email: deployedBy,
      action: "ai_edit",
      summary: message.slice(0, 200),
      commit_sha: commitSha,
      commit_message: commitMsg.slice(0, 255),
    }).then(() => {});

    return NextResponse.json({
      changes: result.changes,
      html: result.html,
      previewUrl: `https://${siteId}.pages.dev`,
    });
  } catch (err) {
    if (err instanceof StaleShaError) {
      return NextResponse.json({ error: err.message, conflict: true }, { status: 409 });
    }
    const errorMessage = err instanceof Error ? err.message : "AI edit failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
