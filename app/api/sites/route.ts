import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createPagesProject } from "@/lib/cloudflare";
import { writeFile } from "@/lib/github";

const SEED_SITE = {
  id: "mooreroofing",
  business_name: "Moore Roofing & Designs Inc.",
  owner_email: "publishing@zing-work.com",
  phone: "(904) 376-5712",
  address: "752 Blanding Blvd Suite 100, Orange Park FL 32065",
  status: "preview",
  preview_url: "https://6b176ba9.mooreroofing.pages.dev",
};

export async function GET() {
  const supabase = createServiceRoleClient();

  let { data: sites } = await supabase
    .from("sites")
    .select("*")
    .order("updated_at", { ascending: false });

  // Seed if empty
  if (!sites || sites.length === 0) {
    await supabase.from("sites").insert(SEED_SITE);
    const { data } = await supabase
      .from("sites")
      .select("*")
      .order("updated_at", { ascending: false });
    sites = data;
  }

  return NextResponse.json({ sites: sites ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { id, business_name, owner_email, phone, address, atlasOnboardingId } = body;

  if (!id || !business_name || !owner_email) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();

  // Create in Supabase
  const { data: site, error } = await supabase
    .from("sites")
    .insert({
      id,
      business_name,
      owner_email,
      phone: phone || null,
      address: address || null,
      status: "preview",
      atlas_onboarding_id: atlasOnboardingId || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Register in forms service (optional)
  const formsUrl = process.env.FORMS_API_URL;
  if (formsUrl) {
    try {
      await fetch(`${formsUrl}/admin/sites/${id}`, { method: "POST" });
    } catch {
      // Non-critical — skip if forms service unavailable
    }
  }

  // Create CF Pages project
  try {
    await createPagesProject(id);
  } catch {
    // Non-critical — project may already exist
  }

  // Create starter index.html in GitHub
  try {
    const starterHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${business_name}</title>
</head>
<body>
  <h1>${business_name}</h1>
  <p>New site — start editing in Pixel.</p>
</body>
</html>`;
    await writeFile(`${id}/index.html`, starterHtml, `init: create starter page for ${id}`);
  } catch {
    // Non-critical — folder may already exist
  }

  return NextResponse.json({ site });
}
