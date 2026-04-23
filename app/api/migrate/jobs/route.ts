import { NextResponse } from "next/server";
import { workerFetch, WORKER_URL } from "@/lib/migration";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!WORKER_URL) {
    return NextResponse.json({ _debug: "no WORKER_URL" }, { status: 200 });
  }
  try {
    const res = await workerFetch("/jobs");
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { _debug: "not ok", status: res.status, body: text, url: WORKER_URL },
        { status: 200 }
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { _debug: "parse fail", text: text.slice(0, 500), url: WORKER_URL },
        { status: 200 }
      );
    }
    return NextResponse.json(Array.isArray(data) ? data : [], {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { _debug: "catch", error: err?.message || String(err), url: WORKER_URL },
      { status: 200 }
    );
  }
}
