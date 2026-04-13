import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFile, writeFile } from "@/lib/github";

export async function GET(
  _request: Request,
  { params }: { params: { siteId: string } }
) {
  const supabase = createServiceRoleClient();
  const { siteId } = params;

  const { data: site } = await supabase
    .from("sites")
    .select("*")
    .eq("id", siteId)
    .single();

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const { data: deployments } = await supabase
    .from("deployments")
    .select("*")
    .eq("site_id", siteId)
    .order("deployed_at", { ascending: false })
    .limit(5);

  const { data: chatMessages } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("site_id", siteId)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    site,
    deployments: deployments ?? [],
    chatMessages: chatMessages ?? [],
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { siteId: string } }
) {
  const supabase = createServiceRoleClient();
  const { siteId } = params;
  const body = await request.json();

  // Get current site for comparison
  const { data: currentSite } = await supabase
    .from("sites")
    .select("*")
    .eq("id", siteId)
    .single();

  if (!currentSite) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // Update Supabase
  const updateFields: Record<string, string> = {};
  const fieldKeys = [
    "business_name",
    "phone",
    "email",
    "address",
    "hours",
    "hero_headline",
    "hero_subheadline",
    "cta_text",
    "status",
  ];

  for (const key of fieldKeys) {
    if (body[key] !== undefined) {
      updateFields[key] = body[key];
    }
  }

  updateFields.updated_at = new Date().toISOString();

  const { data: site, error } = await supabase
    .from("sites")
    .update(updateFields)
    .eq("id", siteId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Apply changes to HTML file via GitHub
  const file = await getFile(`${siteId}/index.html`);
  let updatedHtml: string | null = null;
  if (file) {
    let html = file.content;

    // Phone replacement
    if (body.phone && currentSite.phone && body.phone !== currentSite.phone) {
      const oldPhoneDigits = currentSite.phone.replace(/\D/g, "");
      const newPhoneDigits = body.phone.replace(/\D/g, "");
      html = html.replaceAll(currentSite.phone, body.phone);
      if (oldPhoneDigits.length >= 10) {
        html = html.replaceAll(
          `tel:${oldPhoneDigits}`,
          `tel:${newPhoneDigits}`
        );
        html = html.replaceAll(
          `tel:+1${oldPhoneDigits}`,
          `tel:+1${newPhoneDigits}`
        );
      }
    }

    // Email replacement
    if (body.email && currentSite.email && body.email !== currentSite.email) {
      html = html.replaceAll(
        `mailto:${currentSite.email}`,
        `mailto:${body.email}`
      );
      html = html.replaceAll(currentSite.email, body.email);
    }

    // Business name replacement
    if (
      body.business_name &&
      currentSite.business_name &&
      body.business_name !== currentSite.business_name
    ) {
      html = html.replaceAll(currentSite.business_name, body.business_name);
    }

    // Address replacement
    if (
      body.address &&
      currentSite.address &&
      body.address !== currentSite.address
    ) {
      html = html.replaceAll(currentSite.address, body.address);
    }

    updatedHtml = html;

    // Write updated HTML to GitHub — commit triggers Cloudflare deploy via Actions
    try {
      await writeFile(
        `${siteId}/index.html`,
        html,
        `update(${siteId}): structured fields`,
        file.sha
      );
    } catch {
      // GitHub write failed — non-critical for save
    }
  }

  return NextResponse.json({ site, html: updatedHtml });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { siteId: string } }
) {
  const supabase = createServiceRoleClient();
  const { siteId } = params;

  await supabase.from("chat_messages").delete().eq("site_id", siteId);
  await supabase.from("deployments").delete().eq("site_id", siteId);
  await supabase.from("sites").delete().eq("id", siteId);

  return NextResponse.json({ success: true });
}
