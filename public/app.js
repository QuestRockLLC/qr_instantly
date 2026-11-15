function pct(n) {
  return (n * 100).toFixed(1) + "%";
}
function fmt(n) {
  return Number(n || 0).toLocaleString();
}

function render(data) {
  const t = data.totals;
  const prod = data.inboxes.filter((i) => i.production);
  const warm = data.inboxes.filter((i) => !i.production);
  const sending = prod.filter((i) => i.sent7 > 0).length;
  const maxSent = Math.max(1, ...prod.map((i) => i.sent7));

  const campRows = data.campaigns
    .map(
      (c) =>
        `<tr><td>${c.name.replace("QuestRock HELOC Pilot | ", "")}</td><td>${fmt(c.leads)}</td><td>${fmt(c.emailsSent)}</td><td>${fmt(c.openCount)}</td><td>${fmt(c.clickCount)}</td><td>${fmt(c.replies)}</td><td>${fmt(c.bounced)}</td></tr>`
    )
    .join("");

  const recSource =
    data.meta.recommendationsSource === "gpt"
      ? ' <span class="sub">· GPT (' + (data.meta.recommendationsModel || "gpt-4o-mini") + ")</span>"
      : data.meta.recommendationsSource === "paused"
        ? ' <span class="sub">· resumes Monday</span>'
        : ' <span class="sub">· rules</span>';

  const recs = data.recommendations
    .map((r) => `<div class="rec ${r.tone}"><h3>${r.title}</h3><p>${r.body}</p></div>`)
    .join("");

  const bars = prod
    .slice()
    .sort((a, b) => a.email.localeCompare(b.email))
    .map((i) => {
      const h = Math.max(6, (i.sent7 / maxSent) * 72);
      return `<span class="bar${i.sent7 ? "" : " zero"}" style="height:${h}px" title="${i.email}: ${i.sent7}"></span>`;
    })
    .join("");

  const inboxRows = prod
    .slice()
    .sort((a, b) => b.sent7 - a.sent7 || a.email.localeCompare(b.email))
    .map(
      (i) =>
        `<tr><td>${i.email}</td><td>${i.campaign.replace("QuestRock HELOC Pilot | ", "")}</td><td>${i.dailyLimit}</td><td>${i.todaySent}</td><td>${i.sent7}</td><td>${i.remainingToday}</td></tr>`
    )
    .join("");

  const warmRows = warm
    .map((i) => `<tr><td>${i.email}</td><td>${i.status}</td><td>${i.dailyLimit}</td><td>${i.sent7}</td></tr>`)
    .join("");

  document.getElementById("app").className = "wrap";
  document.getElementById("app").innerHTML = `
    <header class="top">
      <div>
        <div class="kicker">QuestRock HELOC · Instantly</div>
        <h1>Daily sending board</h1>
        <div class="sub">${data.meta.productionInboxes} production · ${data.meta.warmupInboxes} warmup · ${data.meta.weekdayLabel} ${data.meta.timezone}</div>
      </div>
      <div class="sub" style="text-align:right">Updated ${new Date(data.meta.generatedAt).toLocaleString("en-US", { timeZone: "America/Detroit" })} ET</div>
    </header>
    <section class="kpis">
      <div class="kpi"><span>Sent today</span><b>${fmt(t.todaySent)}</b><em>of ${fmt(t.capacityToday)}</em></div>
      <div class="kpi"><span>Last 7 days</span><b>${fmt(t.sent7)}</b><em>${sending}/${prod.length} inboxes</em></div>
      <div class="kpi"><span>Open rate</span><b>${pct(t.openRate)}</b><em>${fmt(t.opens)} opens</em></div>
      <div class="kpi"><span>Click rate</span><b>${pct(t.clickRate)}</b><em>${fmt(t.clicks)} clicks</em></div>
      <div class="kpi"><span>Replies</span><b>${fmt(t.replies)}</b><em>${pct(t.bounceRate)} bounce</em></div>
      <div class="kpi"><span>Queue</span><b>${fmt(t.leads)}</b><em>6 campaigns</em></div>
    </section>
    <div class="grid">
      <div class="card"><h2>Six campaigns</h2><table><thead><tr><th>Campaign</th><th>Leads</th><th>Sent</th><th>Open</th><th>Click</th><th>Reply</th><th>Bounce</th></tr></thead><tbody>${campRows}</tbody></table></div>
      <div class="card"><h2>Recommendations${recSource}</h2>${recs}</div>
    </div>
    <div class="card" style="margin-top:16px"><h2>36 production inboxes</h2><div class="bars">${bars}</div>
    <div style="overflow-x:auto;margin-top:12px"><table><thead><tr><th>Inbox</th><th>Campaign</th><th>Limit</th><th>Today</th><th>7d</th><th>Left</th></tr></thead><tbody>${inboxRows}</tbody></table></div></div>
    <div class="card" style="margin-top:16px"><h2>15 warmup inboxes</h2><table><thead><tr><th>Inbox</th><th>Status</th><th>Limit</th><th>7d sent</th></tr></thead><tbody>${warmRows}</tbody></table></div>
  `;
}

let secs = 0;
const tick = setInterval(() => {
  const el = document.getElementById("secs");
  if (el) el.textContent = String(++secs);
}, 1000);

const params = new URLSearchParams(location.search);
const token = params.get("token") || "";
const q = token ? "?token=" + encodeURIComponent(token) : "";

const ctrl = new AbortController();
const kill = setTimeout(() => ctrl.abort(), 120000);

fetch("/api/report" + q, { signal: ctrl.signal })
  .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
  .then(({ ok, j }) => {
    if (!ok) throw new Error(j.error || "API error");
    clearInterval(tick);
    render(j);
  })
  .catch((e) => {
    clearInterval(tick);
    document.getElementById("app").className = "error";
    document.getElementById("app").innerHTML =
      "<h1>Could not load Instantly</h1><p>" +
      (e.name === "AbortError" ? "Timed out — try Refresh." : e.message) +
      '</p><button type="button" onclick="location.reload()">Retry</button>';
  })
  .finally(() => clearTimeout(kill));