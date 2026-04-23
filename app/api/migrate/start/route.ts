import { NextResponse } from "next/server";
import { workerFetch } from "@/lib/migration";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  const res = await workerFetch("/jobs", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }
  return NextResponse.json(data);
}
