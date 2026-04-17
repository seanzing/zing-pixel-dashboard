import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFile, writeFile } from "@/lib/github";

export async function GET(
  request: Request,
  { params }: { params: { siteId: string } }
) {
  const supabase = createServiceRoleClient();
  const { siteId } = params;
  const page = new URL(request.url).searchParams.get("page") ?? "index.html";

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
    .eq("page", page)
    .order("created_at", { ascending: true });

  const { data: editLog } = await supabase
    .from("edit_log")
    .select("id, action, summary, user_email, created_at")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    site,
    deployments: deployments ?? [],
    chatMessages: chatMessages ?? [],
    editLog: editLog ?? [],
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
    "owner_email",
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

    // Address replacement — try exact match first, then handle <br> split format
    if (body.address && currentSite.address && body.address !== currentSite.address) {
      if (html.includes(currentSite.address)) {
        html = html.replaceAll(currentSite.address, body.address);
      } else {
        // Address may be split across a <br> tag: "Street\nCity" → "Street<br>City"
        const [oldStreet, oldCity] = currentSite.address.split("\n");
        const [newStreet, newCity] = body.address.split("\n");
        if (oldStreet && oldCity) {
          const oldBr = `${oldStreet}<br>${oldCity}`;
          const newBr = `${newStreet}<br>${newCity ?? ""}`;
          html = html.replaceAll(oldBr, newBr);
          // Also try with <br/> variant
          html = html.replaceAll(`${oldStreet}<br/>${oldCity}`, newBr);
        }
      }
    }

    // Hero headline replacement
    if (body.hero_headline && currentSite.hero_headline && body.hero_headline !== currentSite.hero_headline) {
      html = html.replaceAll(currentSite.hero_headline, body.hero_headline);
    }

    // Hero subheadline replacement
    if (body.hero_subheadline && currentSite.hero_subheadline && body.hero_subheadline !== currentSite.hero_subheadline) {
      html = html.replaceAll(currentSite.hero_subheadline, body.hero_subheadline);
    }

    // CTA text replacement
    if (body.cta_text && currentSite.cta_text && body.cta_text !== currentSite.cta_text) {
      html = html.replaceAll(currentSite.cta_text, body.cta_text);
    }

    // Hours replacement
    if (body.hours && currentSite.hours && body.hours !== currentSite.hours) {
      html = html.replaceAll(currentSite.hours, body.hours);
    }

    updatedHtml = html;

    // Write updated HTML to GitHub — commit triggers Cloudflare deploy via Actions
    let fieldCommitSha: string | undefined;
    const fieldCommitMsg = `update(${siteId}): structured fields`;
    try {
      fieldCommitSha = await writeFile(
        `${siteId}/index.html`,
        html,
        fieldCommitMsg,
        file.sha
      );
    } catch {
      // GitHub write failed — non-critical for save
    }

    // Log the field save with commit SHA
    const changedFields = Object.keys(updateFields).filter(
      (k) => k !== "updated_at" && body[k] !== undefined && body[k] !== (currentSite as Record<string, unknown>)[k]
    );
    if (changedFields.length > 0) {
      await supabase.from("edit_log").insert({
        site_id: siteId,
        user_email: null,
        action: "field_save",
        summary: `Updated: ${changedFields.join(", ")}`,
        commit_sha: fieldCommitSha ?? null,
        commit_message: fieldCommitMsg,
      }).then(() => {});
    }
  }

  // Sync owner_email to forms service if it changed
  if (body.owner_email && body.owner_email !== currentSite.owner_email) {
    const formsUrl = process.env.FORMS_API_URL;
    if (formsUrl) {
      try {
        await fetch(`${formsUrl}/admin/sites/${siteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerEmail: body.owner_email }),
        });
      } catch { /* non-fatal */ }
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
