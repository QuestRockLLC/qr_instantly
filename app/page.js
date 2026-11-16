"use client";

import { useEffect, useMemo, useState } from "react";

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

export default function Page() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setSecs((s) => s + 1), 1000);
    const publicToken = process.env.NEXT_PUBLIC_REPORT_TOKEN || "";
    const token = new URLSearchParams(window.location.search).get("token") || publicToken;
    const q = token ? `?token=${encodeURIComponent(token)}` : "";
    const ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), 90000);
    fetch("/api/report" + q, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.statusText);
        setData(j);
      })
      .catch((e) => {
        const msg = e.name === "AbortError" ? "Timed out talking to Instantly. Refresh once." : String(e.message || e);
        setErr(msg);
      })
      .finally(() => {
        clearTimeout(kill);
        clearInterval(tick);
      });
    return () => {
      clearTimeout(kill);
      clearInterval(tick);
      ctrl.abort();
    };
  }, []);

  const maxSent = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.inboxes.filter((i) => i.production).map((i) => i.sent7));
  }, [data]);

  if (err) {
    return (
      <div className="error wrap">
        <h1>Could not load Instantly</h1>
        <p>{err}</p>
        <p className="sub">Try http://localhost:3100 — the API key is server-side. Production needs ?token= if REPORT_TOKEN is set.</p>
        <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>
          Retry
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="loading">
        Pulling live Instantly workspace…
        <div className="sub" style={{ marginTop: 10 }}>
          {secs}s · Instantly is slow on first pull; this usually finishes under 15 seconds.
        </div>
      </div>
    );
  }

  const t = data.totals;
  const prod = data.inboxes.filter((i) => i.production);
  const warm = data.inboxes.filter((i) => !i.production);
  const sending = prod.filter((i) => i.sent7 > 0).length;

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <div className="kicker">QuestRock HELOC · Instantly</div>
          <h1>Daily sending board</h1>
          <div className="sub">
            {data.meta.productionInboxes} production inboxes · {data.meta.warmupInboxes} in warmup ·{" "}
            {data.meta.weekdayLabel} {data.meta.timezone}
          </div>
        </div>
        <div className="stamp">
          Snapshot
          <br />
          {new Date(data.meta.generatedAt).toLocaleString("en-US", { timeZone: "America/Detroit" })} ET
        </div>
      </header>

      <section className="kpis">
        <div className="kpi">
          <span>Sent today</span>
          <b>{fmt(t.todaySent)}</b>
          <em>
            of {fmt(t.capacityToday)} effective cap
            {t.capacityTodayInbox != null && t.capacityTodayInbox !== t.capacityToday
              ? ` · ${fmt(t.capacityTodayInbox)} inbox max`
              : ""}
          </em>
        </div>
        <div className="kpi">
          <span>Last 7 days</span>
          <b>{fmt(t.sent7)}</b>
          <em>{sending}/{prod.length} inboxes live</em>
        </div>
        <div className="kpi">
          <span>Open rate</span>
          <b>{pct(t.openRate)}</b>
          <em>{fmt(t.opens)} tracked opens</em>
        </div>
        <div className="kpi">
          <span>Click rate</span>
          <b>{pct(t.clickRate)}</b>
          <em>{fmt(t.clicks)} application clicks</em>
        </div>
        <div className="kpi">
          <span>Replies</span>
          <b>{fmt(t.replies)}</b>
          <em>{pct(t.bounceRate)} bounce</em>
        </div>
        <div className="kpi">
          <span>Queue</span>
          <b>{fmt(t.leads)}</b>
          <em>leads in 6 campaigns</em>
        </div>
      </section>

      <div className="grid">
        <div className="card">
          <h2>Six campaigns</h2>
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Camp cap</th>
                <th>Today</th>
                <th>Leads</th>
                <th>Sent</th>
                <th>Open</th>
                <th>Click</th>
                <th>Reply</th>
                <th>Bounce</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name.replace("QuestRock HELOC Pilot | ", "")}</td>
                  <td className={c.status === -2 || c.status === 2 ? "warn-txt" : ""}>
                    {c.statusLabel || c.status}
                  </td>
                  <td>{fmt(c.dailyLimit)}</td>
                  <td>
                    {fmt(c.todaySent ?? 0)}
                    {c.dailyLimit ? ` / ${fmt(c.dailyLimit)}` : ""}
                  </td>
                  <td>{fmt(c.leads)}</td>
                  <td>{fmt(c.emailsSent)}</td>
                  <td>{fmt(c.openCount)}</td>
                  <td>{fmt(c.clickCount)}</td>
                  <td>{fmt(c.replies)}</td>
                  <td>{fmt(c.bounced)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="legend" style={{ marginTop: 12 }}>
            Camp cap = Instantly campaign daily_limit (shared across that campaign&apos;s inboxes). Effective workspace max is the lower of
            sum(campaign caps) and sum(inbox limits). Open tracking can read 0 even when mail is delivered (image blocking).
          </p>
        </div>

        <div className="card">
          <h2>
            Recommendations{" "}
            <span className="sub">
              ·{" "}
              {data.meta.recommendationsSource === "gpt"
                ? `GPT (${data.meta.recommendationsModel || "gpt-4o-mini"})`
                : data.meta.recommendationsSource === "paused"
                  ? "resumes Monday"
                  : "rules"}
            </span>
          </h2>
          {data.recommendations.map((r) => (
            <div className={`rec ${r.tone}`} key={r.title}>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>36 production inboxes · last 7 days</h2>
        <div className="bars">
          {prod
            .slice()
            .sort((a, b) => a.email.localeCompare(b.email))
            .map((i) => (
              <div
                key={i.email}
                className={i.sent7 ? "bar" : "bar zero"}
                style={{ height: `${Math.max(6, (i.sent7 / maxSent) * 72)}px` }}
                title={`${i.email}: ${i.sent7}`}
              />
            ))}
        </div>
        <div className="legend">Each bar is one of 36 campaign mailboxes. Hollow bars have not sent in this window.</div>
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Inbox</th>
                <th>Campaign</th>
                <th>Limit</th>
                <th>Today</th>
                <th>7d sent</th>
                <th>Left today</th>
              </tr>
            </thead>
            <tbody>
              {prod
                .slice()
                .sort((a, b) => b.sent7 - a.sent7 || a.email.localeCompare(b.email))
                .map((i) => (
                  <tr key={i.email}>
                    <td>
                      <span className={`dot ${i.sent7 ? "ok" : "idle"}`} />
                      {i.email}
                    </td>
                    <td>{i.campaign.replace("QuestRock HELOC Pilot | ", "")}</td>
                    <td>{i.dailyLimit}</td>
                    <td>{i.todaySent}</td>
                    <td>{i.sent7}</td>
                    <td>{i.remainingToday}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>15 warmup inboxes — not on campaigns</h2>
        <table>
          <thead>
            <tr>
              <th>Inbox</th>
              <th>Status</th>
              <th>Limit</th>
              <th>7d campaign sent</th>
            </tr>
          </thead>
          <tbody>
            {warm
              .slice()
              .sort((a, b) => a.email.localeCompare(b.email))
              .map((i) => (
                <tr key={i.email}>
                  <td>
                    <span className="dot warn" />
                    {i.email}
                  </td>
                  <td>{i.status}</td>
                  <td>{i.dailyLimit}</td>
                  <td>{i.sent7}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <p className="foot">
        Live Instantly API · do not attach warmup mailboxes to HELOC campaigns until warmup is finished ·
        daily limits are not changed by this page.
      </p>
    </div>
  );
}
