const BASE = "https://api.instantly.ai/api/v2";
const UA = "Mozilla/5.0 (compatible; QuestRockDailyReport/1.0)";

const STATUS = {
  1: "active",
  2: "paused",
  3: "temp_paused",
  "-1": "connection_error",
  "-2": "soft_bounce_error",
  "-3": "sending_error",
};

async function api(path, { method = "GET", body, query } = {}) {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) throw new Error("INSTANTLY_API_KEY is not set");
  const url = new URL(BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
      else if (v != null) url.searchParams.set(k, String(v));
    }
  }
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": UA,
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
      });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text.slice(0, 400) };
      }
      if (!res.ok) throw new Error(`Instantly ${path} ${res.status}`);
      return data;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr || new Error(`Instantly ${path} failed`);
}

async function paginate(path) {
  const items = [];
  let cursor;
  for (let i = 0; i < 40; i++) {
    const data = await api(path, { query: { limit: 100, starting_after: cursor } });
    items.push(...(data.items || []));
    cursor = data.next_starting_after;
    if (!cursor) break;
  }
  return items;
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function isHeloc(c) {
  return String(c.name || "").includes("HELOC");
}

export function buildRecommendations(payload) {
  const recs = [];
  const { inboxes, campaigns, meta } = payload;
  const assigned = inboxes.filter((i) => i.campaign !== "(warmup / unassigned)");
  const warmup = inboxes.filter((i) => i.campaign === "(warmup / unassigned)");
  const sending = assigned.filter((i) => i.sent7 > 0);
  const idle = assigned.filter((i) => i.sent7 === 0);
  const todaySent = assigned.reduce((s, i) => s + i.todaySent, 0);
  const cap = assigned.reduce((s, i) => s + (Number(i.dailyLimit) || 0), 0);
  const weekend = meta.weekday === 0 || meta.weekday === 6;

  if (weekend) {
    recs.push({
      tone: "info",
      title: "Weekend — campaigns are off by design",
      body: "Schedules are Mon–Fri 09:00–17:00 America/Detroit. Zero sends today is expected. The 36 production inboxes should start distributing the 5.6k queue on the next weekday.",
    });
  }

  if (idle.length && !weekend) {
    recs.push({
      tone: "warn",
      title: `${idle.length} of ${assigned.length} production inboxes have not sent in 7 days`,
      body: "Confirm each mailbox is on exactly one campaign, connected, and not paused. After the 6+6 split, idle boxes should start as the queue rotates — if they stay at 0 after a full weekday, check Instantly sending status per account.",
    });
  } else if (idle.length && weekend) {
    recs.push({
      tone: "ok",
      title: `${idle.length} production inboxes show 0 last-7-day campaign sends`,
      body: "Most of these were assigned in the exclusive 6+6 split and have not had a weekday window since. Do not add warmup inboxes to campaigns to force activity.",
    });
  }

  recs.push({
    tone: sending.length === assigned.length ? "ok" : "warn",
    title: `Utilization: ${sending.length}/${assigned.length} production inboxes sent in the last 7 days`,
    body: `Configured campaign cap is ${cap} emails/day across 36 inboxes (limit ${assigned[0]?.dailyLimit || 30} each). Last 7 days sent ${assigned.reduce((s, i) => s + i.sent7, 0)} campaign emails. Theoretical weekday max is ${cap}.`,
  });

  if (warmup.length) {
    recs.push({
      tone: "ok",
      title: `Keep ${warmup.length} warmup inboxes off campaigns`,
      body: "The 15 new domains (equitygroup, equitysolutions, financialgroup, homefunding, mortgagegroup) are connected and healthy but correctly unassigned. Attach them only after warmup volume is established — usually 2–4 weeks — then split 5 HTML / 5 Text extra per sender, still exclusive.",
    });
  }

  const opens = campaigns.reduce((s, c) => s + (c.openCount || 0), 0);
  const clicks = campaigns.reduce((s, c) => s + (c.clickCount || 0), 0);
  const sent = campaigns.reduce((s, c) => s + (c.emailsSent || 0), 0);
  if (sent > 200 && opens === 0) {
    recs.push({
      tone: "warn",
      title: "Open tracking is reading 0 across all six campaigns",
      body: "This can be image blocking, not necessarily a dead campaign. Do not raise volume until a seed-inbox placement test (Gmail / Outlook / Yahoo) confirms primary vs promotions. Clicks are a more reliable signal once application links are hit.",
    });
  }
  if (clicks === 0 && sent > 200) {
    recs.push({
      tone: "info",
      title: "No tracked application-link clicks yet",
      body: "HTML vs Text split is live. Watch unique clicks next week as first-touch of the 1,459 Insellerate enrollments goes out Monday.",
    });
  }

  recs.push({
    tone: todaySent === 0 && !weekend ? "warn" : "info",
    title: `Today’s send vs capacity: ${todaySent} / ${cap}`,
    body: weekend
      ? "Capacity unused today because of the weekend schedule. Monday theoretical max ≈ 1,080 if all 36 hit a 30/day limit (follow-ups share that cap)."
      : "Follow-ups share the same per-inbox daily limit. If today is far below cap with remaining uncontacted leads, inspect campaign sending-status and account errors — do not attach warmup inboxes to fill the gap.",
  });

  return recs;
}

export async function loadReport() {
  const [accounts, campaignsRaw] = await Promise.all([paginate("/accounts"), paginate("/campaigns")]);
  const heloc = campaignsRaw.filter(isHeloc);
  const campByEmail = {};
  for (const c of heloc) {
    for (const em of c.email_list || []) campByEmail[em] = c.name;
  }

  const emails = accounts.map((a) => a.email).filter(Boolean);
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7);
  const daily = [];
  for (let i = 0; i < emails.length; i += 50) {
    const chunk = emails.slice(i, i + 50);
    const rows = await api("/accounts/analytics/daily", {
      query: { start_date: iso(start), end_date: iso(end), emails: chunk },
    });
    if (Array.isArray(rows)) daily.push(...rows);
  }

  const by = {};
  const todayS = iso(end);
  for (const row of daily) {
    const em = row.email_account;
    if (!em) continue;
    by[em] ||= { sent: 0, bounced: 0, opened: 0, replies: 0, clicks: 0, contacted: 0, today: 0 };
    for (const k of ["sent", "bounced", "opened", "replies", "clicks", "contacted"]) {
      by[em][k] += Number(row[k] || 0);
    }
    if (row.date === todayS) by[em].today += Number(row.sent || 0);
  }

  const inboxes = accounts.map((a) => {
    const em = a.email;
    const d = by[em] || {};
    const assigned = campByEmail[em];
    return {
      email: em,
      campaign: assigned || "(warmup / unassigned)",
      sender: em.split("@")[0],
      domain: em.split("@")[1] || "",
      status: STATUS[a.status] || String(a.status),
      dailyLimit: a.daily_limit || 0,
      todaySent: d.today || 0,
      sent7: d.sent || 0,
      opened7: d.opened || 0,
      clicks7: d.clicks || 0,
      bounced7: d.bounced || 0,
      replies7: d.replies || 0,
      remainingToday: Math.max(0, (a.daily_limit || 0) - (d.today || 0)),
      production: Boolean(assigned),
    };
  });

  const analytics = [];
  const analyticsRaw = await Promise.all(
    heloc.map((c) => api("/campaigns/analytics", { query: { id: c.id, ids: c.id } }).then((data) => ({ c, data })))
  );
  for (const { c, data } of analyticsRaw) {
    const row = Array.isArray(data) ? data[0] : data?.items?.[0] || data;
    analytics.push({
      id: c.id,
      name: c.name,
      status: c.status,
      inboxes: (c.email_list || []).length,
      leads: row.leads_count,
      contacted: row.contacted_count,
      emailsSent: row.emails_sent_count,
      openCount: row.open_count,
      openUnique: row.open_count_unique,
      clickCount: row.link_click_count,
      clickUnique: row.link_click_count_unique,
      replies: row.reply_count,
      repliesUnique: row.reply_count_unique,
      bounced: row.bounced_count,
      unsubscribed: row.unsubscribed_count,
      completed: row.completed_count,
    });
  }

  const detroitNow = new Date(end.toLocaleString("en-US", { timeZone: "America/Detroit" }));
  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      timezone: "America/Detroit",
      weekday: detroitNow.getDay(),
      weekdayLabel: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][detroitNow.getDay()],
      accounts: accounts.length,
      productionInboxes: inboxes.filter((i) => i.production).length,
      warmupInboxes: inboxes.filter((i) => !i.production).length,
    },
    inboxes,
    campaigns: analytics,
  };
  const ruleBased = buildRecommendations(payload);
  const { enhanceRecommendationsWithGpt } = await import("./gpt-recommendations.js");
  const enriched = await enhanceRecommendationsWithGpt(payload, ruleBased);
  payload.recommendations = enriched.recommendations;
  payload.meta.recommendationsSource = enriched.source;
  payload.meta.recommendationsModel = enriched.model || null;
  if (enriched.error) payload.meta.recommendationsGptError = enriched.error;
  payload.totals = {
    todaySent: inboxes.filter((i) => i.production).reduce((s, i) => s + i.todaySent, 0),
    sent7: inboxes.filter((i) => i.production).reduce((s, i) => s + i.sent7, 0),
    capacityToday: inboxes.filter((i) => i.production).reduce((s, i) => s + i.dailyLimit, 0),
    remainingToday: inboxes.filter((i) => i.production).reduce((s, i) => s + i.remainingToday, 0),
    emailsSent: analytics.reduce((s, c) => s + (c.emailsSent || 0), 0),
    opens: analytics.reduce((s, c) => s + (c.openCount || 0), 0),
    clicks: analytics.reduce((s, c) => s + (c.clickCount || 0), 0),
    replies: analytics.reduce((s, c) => s + (c.replies || 0), 0),
    bounced: analytics.reduce((s, c) => s + (c.bounced || 0), 0),
    leads: analytics.reduce((s, c) => s + (c.leads || 0), 0),
    openRate: 0,
    clickRate: 0,
    bounceRate: 0,
  };
  const sent = payload.totals.emailsSent || 0;
  payload.totals.openRate = sent ? payload.totals.opens / sent : 0;
  payload.totals.clickRate = sent ? payload.totals.clicks / sent : 0;
  payload.totals.bounceRate = sent ? payload.totals.bounced / sent : 0;
  return payload;
}
