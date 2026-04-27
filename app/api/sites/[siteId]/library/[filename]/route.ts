import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { siteId: string; filename: string } }
) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage
    .from("site-images")
    .remove([`${params.siteId}/${params.filename}`]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
