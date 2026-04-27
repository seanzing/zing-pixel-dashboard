import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: { siteId: string } }
) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.storage
    .from("site-images")
    .list(params.siteId, { limit: 200, sortBy: { column: "created_at", order: "desc" } });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const images = (data ?? []).map((f: { name: string; metadata?: { size?: number } }) => ({
    name: f.name,
    url: supabase.storage.from("site-images").getPublicUrl(`${params.siteId}/${f.name}`).data.publicUrl,
    size: f.metadata?.size ?? 0,
  }));

  return NextResponse.json({ images });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { siteId: string } }
) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  }

  const filename = file.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");

  const supabase = createServiceRoleClient();
  const buf = await file.arrayBuffer();
  const { error } = await supabase.storage
    .from("site-images")
    .upload(`${params.siteId}/${filename}`, buf, {
      contentType: file.type,
      upsert: true,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const url = supabase.storage.from("site-images").getPublicUrl(`${params.siteId}/${filename}`).data.publicUrl;

  return NextResponse.json({ url, name: filename });
}
