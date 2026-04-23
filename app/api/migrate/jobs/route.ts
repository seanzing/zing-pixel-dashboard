import { NextResponse } from "next/server";
import { workerFetch } from "@/lib/migration";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await workerFetch("/jobs");
  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }
  return NextResponse.json(data);
}
