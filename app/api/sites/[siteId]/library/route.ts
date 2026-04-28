import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: { siteId: string } }
) {
  const { data: { user } } = await createServerSupabaseClient().auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  const { data: { user: postUser } } = await createServerSupabaseClient().auth.getUser();
  if (!postUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  // Validate filename extension matches an allowed image type
  const allowedExts = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];
  const ext = "." + filename.split(".").pop();
  if (!allowedExts.includes(ext)) {
    return NextResponse.json({ error: "Invalid file extension" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const buf = await file.arrayBuffer();

  // Verify magic bytes to ensure file content matches claimed type (skip SVG — text-based)
  if (!filename.endsWith(".svg")) {
    const bytes = new Uint8Array(buf.slice(0, 12));
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
    const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
    const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (!isPng && !isJpeg && !isGif && !isWebp) {
      return NextResponse.json({ error: "File content does not match an allowed image format" }, { status: 400 });
    }
  }

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
