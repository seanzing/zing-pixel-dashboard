import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { siteId: string; filename: string } }
) {
  const { data: { user } } = await createServerSupabaseClient().auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Validate filename — prevent path traversal
  if (!params.filename || params.filename.includes('/') || params.filename.includes('..')) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage
    .from("site-images")
    .remove([`${params.siteId}/${params.filename}`]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
