import { NextRequest, NextResponse } from "next/server";
import { getFile } from "@/lib/github";

// GET — return raw HTML for a page (for interactive preview)
export async function GET(req: NextRequest, { params }: { params: { siteId: string } }) {
  const page = req.nextUrl.searchParams.get("page") ?? "index.html";
  const file = await getFile(`${params.siteId}/${page}`);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ html: file.content, sha: file.sha });
}
