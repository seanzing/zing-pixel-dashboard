import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

const DEMOS_LIST_URL = "https://yourwebsiteexample.com/api/pixel-import/list";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";

    const [demoRes, supabase] = await Promise.all([
      fetch(DEMOS_LIST_URL, { next: { revalidate: 0 } } as RequestInit),
      Promise.resolve(createServiceRoleClient()),
    ]);

    if (!demoRes.ok) throw new Error("Demo catalog unreachable");
    const { sites: allSites, total }: { sites: string[]; total: number } = await demoRes.json();

    const { data: registered } = await supabase.from("sites").select("id");
    const registeredIds = new Set((registered ?? []).map((s: { id: string }) => s.id));

    let available = allSites.filter((id) => !registeredIds.has(id));

    // Client-side search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      available = available.filter((id) => id.toLowerCase().includes(q));
    }

    return NextResponse.json({
      available: available.slice(0, 200), // cap at 200 for UI perf
      totalAvailable: available.length,
      totalInCatalog: total,
      registered: registeredIds.size,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
