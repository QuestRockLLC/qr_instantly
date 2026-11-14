import { NextResponse } from "next/server";
import { loadReport } from "../../../lib/instantly.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

let cache = { at: 0, data: null };
const TTL_MS = 45_000;

export async function GET(req) {
  const token = process.env.REPORT_TOKEN;
  const enforce = token && process.env.NODE_ENV === "production";
  if (enforce) {
    const got = req.nextUrl.searchParams.get("token") || req.headers.get("x-report-token");
    if (got !== token) {
      return NextResponse.json(
        { error: "unauthorized — open this page with ?token=… or set NEXT_PUBLIC_REPORT_TOKEN" },
        { status: 401 }
      );
    }
  }
  try {
    if (cache.data && Date.now() - cache.at < TTL_MS) {
      return NextResponse.json({ ...cache.data, meta: { ...cache.data.meta, cached: true } }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const data = await loadReport();
    cache = { at: Date.now(), data };
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
