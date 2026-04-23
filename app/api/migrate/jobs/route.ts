import { NextResponse } from "next/server";
import { workerFetch, WORKER_URL } from "@/lib/migration";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!WORKER_URL) {
    return NextResponse.json([], { status: 200 });
  }
  try {
    const res = await workerFetch("/jobs");
    if (!res.ok) {
      return NextResponse.json([], { status: 200 });
    }
    const data = await res.json();
    return NextResponse.json(Array.isArray(data) ? data : [], {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
