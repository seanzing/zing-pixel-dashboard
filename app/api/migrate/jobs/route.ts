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
      const text = await res.text().catch(() => "");
      return NextResponse.json({ _debug: true, workerStatus: res.status, body: text, workerUrl: WORKER_URL }, { status: 200 });
    }
    const data = await res.json();
    return NextResponse.json(Array.isArray(data) ? data : [], {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err: any) {
    return NextResponse.json({ _debug: true, error: err?.message || String(err), workerUrl: WORKER_URL }, { status: 200 });
  }
}
