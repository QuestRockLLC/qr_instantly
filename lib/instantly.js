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

const CAMP_STATUS = {
  1: "active",
  2: "paused",
  3: "completed",
  "-2": "bounce_protect",
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
  const weekSent = (i) => Number(i.sentWeekToDate ?? i.sent7 ?? 0);
  const sending = assigned.filter((i) => weekSent(i) > 0);
  const idle = assigned.filter((i) => weekSent(i) === 0);
  const todaySent = assigned.reduce((s, i) => s + i.todaySent, 0);
  const inboxCap = assigned.reduce((s, i) => s + (Number(i.dailyLimit) || 0), 0);
  const campaignCap = campaigns.reduce((s, c) => s + (Number(c.dailyLimit) || 0), 0);
  const cap = campaignCap > 0 ? Math.min(campaignCap, inboxCap) : inboxCap;
  const windowLabel = meta.recommendationWindow
    ? `${meta.recommendationWindow.start} → ${meta.recommendationWindow.end}`
    : "this week (Mon–today)";

  if (idle.length) {
    recs.push({
      tone: "warn",
      title: `${idle.length} of ${assigned.length} production inboxes have not sent since Monday`,
      body: `Counts use weekday window ${windowLabel} (America/Detroit), not weekend days. Confirm each mailbox is on exactly one campaign, connected, and not paused. If boxes stay at 0 through a full weekday, check Instantly sending status per account.`,
    });
  }

  recs.push({
    tone: sending.length === assigned.length ? "ok" : "warn",
    title: `Utilization: ${sending.length}/${assigned.length} production inboxes sent ${windowLabel}`,
    body: `Effective weekday max is ${cap}/day — the lower of sum(campaign daily_limit)=${campaignCap} and inbox ceiling ${inboxCap} (${assigned[0]?.dailyLimit || 30}×${assigned.length}). Week-to-date sends ${assigned.reduce((s, i) => s + weekSent(i), 0)}. Raise each campaign's daily limit (not just mailbox limits) to use full inbox capacity.`,
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
    tone: todaySent === 0 ? "warn" : "info",
    title: `Today’s send vs capacity: ${todaySent} / ${cap}`,
    body: "Follow-ups count toward both inbox and campaign daily limits. If today is below effective cap with leads left, check campaign daily_limit vs per-mailbox limits before blaming pacing — do not attach warmup inboxes to fill the gap.",
  });

  const bouncePausedCamps = campaigns.filter((c) => c.status === -2 || c.statusLabel === "bounce_protect");
  if (bouncePausedCamps.length) {
    recs.push({
      tone: "warn",
      title: `${bouncePausedCamps.length} campaign(s) paused by Instantly Bounce Protect`,
      body: `Paused: ${bouncePausedCamps.map((c) => c.name.replace("QuestRock HELOC Pilot | ", "")).join(", ")}. Blocklist hard bounces, suppress typo domains, then POST /campaigns/{id}/activate. Keep disable_bounce_protect false.`,
    });
  }

  if (campaignCap > 0 && campaignCap < inboxCap) {
    recs.push({
      tone: todaySent >= campaignCap ? "ok" : "warn",
      title: `Campaign limits bind volume (${campaignCap}/day) below inbox max (${inboxCap}/day)`,
      body: `Six campaigns × ${campaigns[0]?.dailyLimit ?? 30} sends/day each = ${campaignCap} workspace max. Mailboxes can still show spare per-inbox capacity while campaigns are capped. To target 30 per inbox, set each campaign daily limit to ~6× inbox limit (e.g. 180 with 6 inboxes).`,
    });
  }

  return recs;
}

export async function loadReport() {
  const [accounts, campaignsRaw] = await Promise.all([paginate("/accounts"), paginate("/campaigns")]);
  const heloc = campaignsRaw.filter(isHeloc);
  let bounceRemediate = null;
  const bouncePaused = heloc.filter((c) => c.status === -2);
  if (bouncePaused.length && process.env.BOUNCE_AUTO_REMEDIATE !== "0") {
    const { remediateBounceProtect } = await import("./bounce-protect.js");
    bounceRemediate = await remediateBounceProtect(
      heloc.map((c) => ({ id: c.id, name: c.name, status: c.status }))
    );
    for (const c of bouncePaused) {
      const fresh = await api(`/campaigns/${c.id}`);
      if (fresh?.status != null) c.status = fresh.status;
    }
  }

  const campByEmail = {};
  for (const c of heloc) {
    for (const em of c.email_list || []) campByEmail[em] = c.name;
  }

  const emails = accounts.map((a) => a.email).filter(Boolean);
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7);
  /** @type {Array<{ email_account?: string, date?: string, sent?: number, bounced?: number, opened?: number, replies?: number, clicks?: number, contacted?: number }>} */
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
      statusLabel: CAMP_STATUS[c.status] || STATUS[c.status] || String(c.status),
      dailyLimit: Number(c.daily_limit) || 0,
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

  const {
    getDetroitCalendar,
    getWeekMondayYmd,
    shouldRunRecommendations,
    sumSentInRange,
    WEEKEND_RECOMMENDATIONS,
  } = await import("./recommendation-window.js");

  const detroit = getDetroitCalendar(end);
  const mondayYmd = getWeekMondayYmd(end);
  const weekEndYmd = detroit.ymd;

  for (const inbox of inboxes) {
    inbox.sentWeekToDate = sumSentInRange(daily, inbox.email, mondayYmd, weekEndYmd);
  }

  for (const camp of analytics) {
    camp.todaySent = inboxes
      .filter((i) => i.production && i.campaign === camp.name)
      .reduce((s, i) => s + (i.todaySent || 0), 0);
  }

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      timezone: "America/Detroit",
      weekday: detroit.weekday,
      weekdayLabel: detroit.weekdayLabel,
      recommendationWindow: { start: mondayYmd, end: weekEndYmd, timezone: "America/Detroit" },
      accounts: accounts.length,
      productionInboxes: inboxes.filter((i) => i.production).length,
      warmupInboxes: inboxes.filter((i) => !i.production).length,
      bounceRemediate,
    },
    inboxes,
    campaigns: analytics,
  };

  if (!shouldRunRecommendations(end)) {
    payload.recommendations = WEEKEND_RECOMMENDATIONS;
    payload.meta.recommendationsSource = "paused";
    payload.meta.recommendationsModel = null;
    payload.meta.recommendationsPausedReason = "weekend";
  } else {
    const ruleBased = buildRecommendations(payload);
    const { enhanceRecommendationsWithGpt } = await import("./gpt-recommendations.js");
    const enriched = await enhanceRecommendationsWithGpt(payload, ruleBased);
    payload.recommendations = enriched.recommendations;
    payload.meta.recommendationsSource = enriched.source;
    payload.meta.recommendationsModel = enriched.model || null;
    if (enriched.error) payload.meta.recommendationsGptError = enriched.error;
  }
  const production = inboxes.filter((i) => i.production);
  const capacityTodayInbox = production.reduce((s, i) => s + i.dailyLimit, 0);
  const capacityTodayCampaign = analytics.reduce((s, c) => s + (c.dailyLimit || 0), 0);
  const capacityTodayEffective =
    capacityTodayCampaign > 0
      ? Math.min(capacityTodayCampaign, capacityTodayInbox)
      : capacityTodayInbox;

  payload.totals = {
    todaySent: production.reduce((s, i) => s + i.todaySent, 0),
    sent7: production.reduce((s, i) => s + i.sent7, 0),
    capacityToday: capacityTodayEffective,
    capacityTodayInbox,
    capacityTodayCampaign,
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
