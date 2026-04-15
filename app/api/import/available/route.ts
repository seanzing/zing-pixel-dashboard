import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { listRootDirectories } from "@/lib/github";

export async function GET() {
  try {
    const [githubDirs, supabase] = await Promise.all([
      listRootDirectories(),
      Promise.resolve(createServiceRoleClient()),
    ]);

    const { data: sites } = await supabase.from("sites").select("id");
    const existingIds = new Set((sites ?? []).map((s: { id: string }) => s.id));

    const available = githubDirs.filter((dir) => !existingIds.has(dir));

    return NextResponse.json({ available, total: githubDirs.length, registered: existingIds.size });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
