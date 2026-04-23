import { NextResponse } from "next/server";
import { workerFetch, WORKER_URL } from "@/lib/migration";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!WORKER_URL) {
      return NextResponse.json({ _debug: "MIGRATION_WORKER_URL not set" }, { status: 500 });
    }
    const res = await workerFetch("/jobs");
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ _debug: `Worker ${res.status}`, _body: text, _url: WORKER_URL }, { status: res.status });
    }
    const data = JSON.parse(text);
    // If worker returned empty but health shows jobs, surface the raw text for debugging
    return NextResponse.json({ _debug: { workerUrl: WORKER_URL, status: res.status, rawLength: text.length }, data }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ _debug: "catch", error: msg, _url: WORKER_URL }, { status: 500 });
  }
}
