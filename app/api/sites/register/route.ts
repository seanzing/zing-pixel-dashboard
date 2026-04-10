import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const secret = request.headers.get("x-pixel-secret");
  if (secret !== process.env.PIXEL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, business_name, owner_email, phone, address, preview_url } = body;

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
        status: "preview",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, site });
}
