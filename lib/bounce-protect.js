/**
 * Instantly Bounce Protect (-2): blocklist bounced/typo leads and resume campaign.
 * Safe to re-run; skips emails already on the workspace blocklist.
 */

const BASE = "https://api.instantly.ai/api/v2";

const STATUS_LABEL = {
  "-2": "bounce_protect",
  2: "paused",
  1: "active",
};

const BAD_EMAIL = [
  /\.cm$/i,
  /\.con$/i,
  /\.cmo$/i,
  /@gmail\.co$/i,
  /@yahoo\.co$/i,
  /gmial\.com/i,
  /gmai\.com/i,
  /yaho\.com/i,
  /\.ne$/i,
  /hotnail/i,
  /outlok/i,
];

async function api(path, { method = "GET", body, query } = {}) {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) throw new Error("INSTANTLY_API_KEY is not set");
  const url = new URL(BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, data };
}

async function paginateBlocklist() {
  const blocked = new Set();
  let cursor;
  for (let i = 0; i < 50; i++) {
    const q = { limit: 100 };
    if (cursor) q.starting_after = cursor;
    const { data, status } = await api("/block-lists-entries", { query: q });
    if (status !== 200) break;
    for (const it of data.items || []) {
      const v = String(it.bl_value || "").trim().toLowerCase();
      if (v) blocked.add(v);
    }
    cursor = data.next_starting_after;
    if (!cursor) break;
  }
  return blocked;
}

async function listCampaignLeads(campaignId, { status } = {}) {
  const items = [];
  let cursor;
  for (let i = 0; i < 80; i++) {
    const body = { campaign: campaignId, limit: 100, in_campaign: true };
    if (status != null) body.status = status;
    if (cursor) body.starting_after = cursor;
    const { data, status: http } = await api("/leads/list", { method: "POST", body });
    if (http !== 200) break;
    const chunk = data.items || [];
    items.push(...chunk);
    cursor = data.next_starting_after;
    if (!cursor || !chunk.length) break;
    await new Promise((r) => setTimeout(r, 70));
  }
  return items;
}

function isRiskyEmail(email) {
  const em = String(email || "").trim().toLowerCase();
  if (!em.includes("@")) return false;
  return BAD_EMAIL.some((rx) => rx.test(em));
}

/**
 * @param {{ campaigns: Array<{ id: string, name: string, status: number }> }} helocCampaigns
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function remediateBounceProtect(helocCampaigns, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const paused = helocCampaigns.filter((c) => c.status === -2);
  if (!paused.length && !opts.forceScan) {
    return { ran: false, reason: "no_bounce_protect_pause" };
  }

  const blocked = await paginateBlocklist();
  const toBlock = new Set();
  const perCampaign = {};

  for (const c of helocCampaigns) {
    const bounced = await listCampaignLeads(c.id, { status: -1 });
    perCampaign[c.name] = { bounced: bounced.length };
    for (const ld of bounced) {
      const em = String(ld.email || "").trim().toLowerCase();
      if (em && !blocked.has(em)) toBlock.add(em);
    }
    if (c.status === -2 || opts.forceScan) {
      const active = await listCampaignLeads(c.id, { status: 1 });
      for (const ld of active) {
        const em = String(ld.email || "").trim().toLowerCase();
        if (em && isRiskyEmail(em) && !blocked.has(em)) toBlock.add(em);
      }
    }
  }

  const added = [];
  const activateResults = [];

  if (!dryRun) {
    for (const em of [...toBlock].sort()) {
      const r = await api("/block-lists-entries", { method: "POST", body: { bl_value: em } });
      if (r.ok) added.push(em);
      await new Promise((r) => setTimeout(r, 85));
    }
    for (const c of paused) {
      const r = await api(`/campaigns/${c.id}/activate`, { method: "POST" });
      const verify = await api(`/campaigns/${c.id}`);
      activateResults.push({
        name: c.name,
        activate_http: r.status,
        status_after: verify.data?.status,
        status_label: STATUS_LABEL[verify.data?.status] || String(verify.data?.status),
      });
    }
  }

  return {
    ran: true,
    dryRun,
    paused_campaigns: paused.map((c) => c.name),
    per_campaign_bounced: perCampaign,
    blocklist_candidates: toBlock.size,
    blocklist_added: added.length,
    activated: activateResults,
    at: new Date().toISOString(),
  };
}