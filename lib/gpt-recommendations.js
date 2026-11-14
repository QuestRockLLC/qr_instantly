/**
 * GPT recommendations — same stack as Call Tracker (OPENAI_API_KEY + OPENAI_MODEL).
 * No borrower emails or PII in the model input; aggregates only.
 */

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "heloc_instantly_daily_recommendations",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        recommendations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              tone: { type: "string", enum: ["ok", "warn", "info"] },
              title: { type: "string" },
              body: { type: "string" },
            },
            required: ["tone", "title", "body"],
          },
        },
      },
      required: ["recommendations"],
    },
  },
};

function summarizeForGpt(payload) {
  const prod = payload.inboxes.filter((i) => i.production);
  const idle = prod.filter((i) => i.sent7 === 0).length;
  const sending = prod.filter((i) => i.sent7 > 0).length;
  return {
    meta: payload.meta,
    totals: payload.totals,
    campaign_summary: payload.campaigns.map((c) => ({
      name: c.name,
      leads: c.leads,
      emailsSent: c.emailsSent,
      openCount: c.openCount,
      clickCount: c.clickCount,
      replies: c.replies,
      bounced: c.bounced,
      inboxes: c.inboxes,
    })),
    inbox_utilization: {
      production_count: prod.length,
      warmup_count: payload.inboxes.length - prod.length,
      sending_last_7d: sending,
      idle_last_7d: idle,
      avg_sent7_among_senders:
        sending > 0 ? Math.round(prod.filter((i) => i.sent7 > 0).reduce((s, i) => s + i.sent7, 0) / sending) : 0,
      daily_limit_per_inbox: prod[0]?.dailyLimit ?? 30,
    },
    rule_based_hints: payload.recommendations?.map((r) => r.title) ?? [],
  };
}

const SYSTEM = `You are QuestRock's HELOC Instantly email operations advisor (same role family as Call Tracker AI).
You advise loan officers and ops — never quote rates to borrowers. Be direct and actionable.
Focus on: inbox utilization, warmup vs production separation, deliverability, follow-up capacity, open/click signal quality, and Monday–Friday America/Detroit send windows.
Do not invent metrics not in the JSON. Output 3–6 recommendations, prioritized.`;

export async function enhanceRecommendationsWithGpt(payload, ruleBased) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    return { recommendations: ruleBased, source: "rules", model: null };
  }

  const user = JSON.stringify(summarizeForGpt({ ...payload, recommendations: ruleBased }), null, 2);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_completion_tokens: 2000,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Given this Instantly HELOC snapshot, produce operational recommendations. Rule-based hints are optional context only.\n\n${user}`,
          },
        ],
        response_format: RESPONSE_FORMAT,
      }),
      signal: AbortSignal.timeout(45000),
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { recommendations: ruleBased, source: "rules", model, error: "openai_non_json" };
    }

    if (!response.ok) {
      return {
        recommendations: ruleBased,
        source: "rules",
        model,
        error: data?.error?.message || "openai_error",
      };
    }

    const content = data?.choices?.[0]?.message?.content;
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { recommendations: ruleBased, source: "rules", model, error: "parse" };
    }

    const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
    if (recs.length < 2) {
      return { recommendations: ruleBased, source: "rules", model };
    }

    const cleaned = recs
      .filter((r) => r?.title && r?.body)
      .slice(0, 8)
      .map((r) => ({
        tone: ["ok", "warn", "info"].includes(r.tone) ? r.tone : "info",
        title: String(r.title).slice(0, 200),
        body: String(r.body).slice(0, 1200),
      }));

    return { recommendations: cleaned.length ? cleaned : ruleBased, source: "gpt", model };
  } catch (err) {
    return { recommendations: ruleBased, source: "rules", model, error: String(err.message || err) };
  }
}