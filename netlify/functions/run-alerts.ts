import type { Config } from "@netlify/functions";
import {
  buildOfferSummary,
  FlightAlert,
  formatKRW,
  getResend,
  getSupabaseAdmin,
  jsonResponse,
  searchFlightOffers,
  searchMonthlyFlightOffers,
} from "./_shared";

function shouldCheckNow(alert: FlightAlert) {
  if (!alert.last_checked_at) return true;
  const intervalMinutes = alert.check_interval_minutes || 30;
  const elapsed = Date.now() - new Date(alert.last_checked_at).getTime();
  return elapsed >= intervalMinutes * 60 * 1000;
}

async function getBestOffer(alert: FlightAlert) {
  if (alert.search_mode === "month_range") {
    const result = await searchMonthlyFlightOffers({
      origin: alert.origin,
      destination: alert.destination,
      months: alert.departure_months || [],
      tripLengthDays: alert.trip_length_days || 7,
      adults: alert.adults,
      currency: alert.currency || "KRW",
      maxPerDate: 1,
    });
    return { best: result.offers[0], scannedDates: result.scannedDates };
  }

  const offers = await searchFlightOffers({
    origin: alert.origin,
    destination: alert.destination,
    departureDate: alert.departure_date,
    returnDate: alert.return_date,
    adults: alert.adults,
    currency: alert.currency || "KRW",
    max: 10,
  });
  return { best: offers[0], scannedDates: 1 };
}

async function processAlert(alert: FlightAlert) {
  const supabase = getSupabaseAdmin();
  if (!shouldCheckNow(alert)) {
    return {
      id: alert.id,
      status: "skipped_interval",
      intervalMinutes: alert.check_interval_minutes || 30,
      lastCheckedAt: alert.last_checked_at,
    };
  }
  try {
    const { best, scannedDates } = await getBestOffer(alert);
    const lowest = best?.price ?? null;

    await supabase.from("price_checks").insert({
      alert_id: alert.id,
      lowest_price_krw: lowest,
      carrier: best?.carrier || null,
      raw_offer: best?.raw || null,
      error: null,
    });

    await supabase
      .from("flight_alerts")
      .update({ last_price_krw: lowest, last_checked_at: new Date().toISOString() })
      .eq("id", alert.id);

    if (!best || lowest == null) {
      return { id: alert.id, status: "no_offer", scannedDates };
    }

    const shouldNotify = lowest <= alert.target_price_krw;
    if (!shouldNotify) {
      return { id: alert.id, status: "checked", lowest, scannedDates };
    }

    const lastNotifiedAt = alert.last_notified_at ? new Date(alert.last_notified_at).getTime() : 0;
    const cooldownMs = (alert.notify_cooldown_minutes ?? 360) * 60 * 1000;
    if (cooldownMs > 0 && Date.now() - lastNotifiedAt < cooldownMs) {
      return { id: alert.id, status: "suppressed_recent_notification", lowest, cooldownMinutes: alert.notify_cooldown_minutes ?? 360 };
    }

    const resend = getResend();
    const from = process.env.RESEND_FROM || "Flight Alert <onboarding@resend.dev>";
    const subject = `항공권 목표가 도달: ${alert.origin}→${alert.destination} ${formatKRW(lowest)}`;
    const summary = buildOfferSummary(best);
    const modeLine = alert.search_mode === "month_range"
      ? `월별 탐색: ${(alert.departure_months || []).join(", ")} / 여행기간 ${alert.trip_length_days || 7}박 / 스캔 ${scannedDates}개 출발일`
      : `날짜 지정: ${alert.departure_date}${alert.return_date ? ` ~ ${alert.return_date}` : ""}`;

    await resend.emails.send({
      from,
      to: [alert.email],
      subject,
      html: `
        <h2>항공권 목표가 도달 ✈️</h2>
        <p><b>${alert.label || "가격 알림"}</b></p>
        <p>현재 최저가: <b>${formatKRW(lowest)}</b></p>
        <p>목표가: ${formatKRW(alert.target_price_krw)}</p>
        <p>경로: ${alert.origin} → ${alert.destination}</p>
        <p>${modeLine}</p>
        <pre style="white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:8px">${summary}</pre>
        <p style="color:#666">가격은 API 응답 기준이며 실제 결제 단계에서 변동될 수 있습니다.</p>
      `,
      text: `항공권 목표가 도달\n현재 최저가: ${formatKRW(lowest)}\n목표가: ${formatKRW(alert.target_price_krw)}\n${modeLine}\n${summary}`,
    });

    await supabase
      .from("flight_alerts")
      .update({ last_notified_at: new Date().toISOString() })
      .eq("id", alert.id);

    return { id: alert.id, status: "notified", lowest, scannedDates };
  } catch (error: any) {
    await supabase.from("price_checks").insert({
      alert_id: alert.id,
      lowest_price_krw: null,
      carrier: null,
      raw_offer: null,
      error: error.message || "Unknown error",
    });
    await supabase
      .from("flight_alerts")
      .update({ last_checked_at: new Date().toISOString() })
      .eq("id", alert.id);
    return { id: alert.id, status: "error", error: error.message || "Unknown error" };
  }
}

export default async () => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("flight_alerts")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) return jsonResponse({ error: error.message }, 500);

  const alerts = (data || []) as FlightAlert[];
  const results = [];
  for (const alert of alerts) {
    results.push(await processAlert(alert));
  }

  return jsonResponse({ checked: alerts.length, results });
};

// Netlify published deploy에서 UTC 기준 5분마다 실행.
// 각 알림별 실제 조회 간격은 flight_alerts.check_interval_minutes로 조절합니다.
export const config: Config = {
  schedule: "*/5 * * * *",
};
