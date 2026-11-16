import { NextResponse } from "next/server";
import { remediateBounceProtect } from "../../../lib/bounce-protect.js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function helocCampaigns() {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) throw new Error("INSTANTLY_API_KEY is not set");
  const items = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const url = new URL("https://api.instantly.ai/api/v2/campaigns");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("starting_after", cursor);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
    });
    const data = await res.json();
    items.push(...(data.items || []));
    cursor = data.next_starting_after;
    if (!cursor) break;
  }
  return items
    .filter((c) => String(c.name || "").includes("HELOC"))
    .map((c) => ({ id: c.id, name: c.name, status: c.status }));
}

export async function POST(req) {
  const token = process.env.REPORT_TOKEN;
  if (token && process.env.NODE_ENV === "production") {
    const got = req.nextUrl.searchParams.get("token") || req.headers.get("x-report-token");
    if (got !== token) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
    const campaigns = await helocCampaigns();
    const result = await remediateBounceProtect(campaigns, { dryRun, forceScan: true });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}