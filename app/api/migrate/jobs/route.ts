import { NextResponse } from "next/server";
import { workerFetch, WORKER_URL } from "@/lib/migration";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!WORKER_URL) {
      return NextResponse.json({ error: "MIGRATION_WORKER_URL not set", jobs: [] }, { status: 500 });
    }
    const res = await workerFetch("/jobs");
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: `Worker ${res.status}: ${text}`, jobs: [] }, { status: res.status });
    }
    const data = JSON.parse(text);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, jobs: [] }, { status: 500 });
  }
}
