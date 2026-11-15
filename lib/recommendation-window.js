const TZ = "America/Detroit";

/** @param {Date} [date] */
export function getDetroitCalendar(date = new Date()) {
  const local = new Date(date.toLocaleString("en-US", { timeZone: TZ }));
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const d = String(local.getDate()).padStart(2, "0");
  return {
    ymd: `${y}-${m}-${d}`,
    weekday: local.getDay(),
    weekdayLabel: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][local.getDay()],
  };
}

/** Mon–Fri only — no GPT / operational recommendations on weekends. */
export function shouldRunRecommendations(date = new Date()) {
  const { weekday } = getDetroitCalendar(date);
  return weekday >= 1 && weekday <= 5;
}

/** Monday 00:00 calendar (Detroit) of the week containing `date`. */
export function getWeekMondayYmd(date = new Date()) {
  const local = new Date(date.toLocaleString("en-US", { timeZone: TZ }));
  const day = local.getDay();
  const toMonday = day === 0 ? -6 : 1 - day;
  local.setDate(local.getDate() + toMonday);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const d = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * @param {Array<{ email_account?: string, date?: string, sent?: number }>} dailyRows
 */
export function sumSentInRange(dailyRows, email, startYmd, endYmd) {
  let total = 0;
  for (const row of dailyRows) {
    if (row.email_account !== email) continue;
    const day = row.date;
    if (!day || day < startYmd || day > endYmd) continue;
    total += Number(row.sent || 0);
  }
  return total;
}

export const WEEKEND_RECOMMENDATIONS = [
  {
    tone: "info",
    title: "Recommendations resume Monday",
    body: "GPT and operational advice run Monday–Friday using weekday send data from the current week (Monday through today, America/Detroit). Campaigns are off Saturday–Sunday by design. KPIs above stay live.",
  },
];