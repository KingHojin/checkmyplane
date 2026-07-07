import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export type SearchMode = "exact" | "month_range";

export type FlightAlert = {
  id: string;
  label: string | null;
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string | null;
  search_mode: SearchMode;
  departure_months: string[] | null;
  trip_length_days: number | null;
  adults: number;
  currency: string;
  target_price_krw: number;
  email: string;
  is_active: boolean;
  last_price_krw: number | null;
  last_checked_at: string | null;
  last_notified_at: string | null;
  check_interval_minutes: number;
  notify_cooldown_minutes: number;
  consecutive_error_count: number;
  last_error: string | null;
  deactivated_reason: string | null;
  created_at: string;
};

export type NormalizedOffer = {
  price: number;
  currency: string;
  carrier: string;
  validatingAirlineCodes: string[];
  departureDate: string;
  returnDate: string | null;
  itineraries: Array<{
    duration: string;
    segments: Array<{
      departure: string;
      arrival: string;
      departureAt: string;
      arrivalAt: string;
      carrierCode: string;
      number: string;
    }>;
  }>;
  raw: unknown;
};

export type MonthlySearchResult = {
  scannedDates: number;
  months: string[];
  tripLengthDays: number;
  offers: NormalizedOffer[];
};

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-app-password",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function handleOptions(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}

export function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function assertAppPassword(req: Request) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return;
  const actual = req.headers.get("x-app-password");
  if (actual !== expected) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
}

export function getSupabaseAdmin() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

export function getResend() {
  return new Resend(requireEnv("RESEND_API_KEY"));
}

// 모듈 레벨에 토큰을 캐시해서 같은 함수 인스턴스 내 반복 호출(월별 40회 검색 등)에서
// 매번 새 토큰을 발급받지 않도록 합니다. expires_in 60초 전에 미리 만료 처리합니다.
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAmadeusToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  const baseUrl = process.env.AMADEUS_BASE_URL || "https://test.api.amadeus.com";
  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", requireEnv("AMADEUS_CLIENT_ID"));
  form.set("client_secret", requireEnv("AMADEUS_CLIENT_SECRET"));

  const res = await fetch(`${baseUrl}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Amadeus token failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Amadeus token response missing access_token");

  const expiresInMs = Math.max(0, Number(data.expires_in || 1800) * 1000 - 60_000);
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + expiresInMs };
  return data.access_token;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(res: Response): number | null {
  const header = res.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

// Amadeus 검색 요청은 429(rate limit)/5xx에서 최대 3회, 지수 백오프(0.5s/1s/2s)로 재시도합니다.
// Retry-After 헤더가 있으면 그 값을 우선합니다. 그 외 4xx는 즉시 실패시킵니다.
async function fetchAmadeusWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  const backoffMs = [500, 1000, 2000];
  let lastRes: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetch(url, options);
    if (res.ok) return res;

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === maxRetries) return res;

    lastRes = res;
    const retryAfterMs = parseRetryAfterMs(res);
    const waitMs = retryAfterMs ?? backoffMs[attempt] ?? backoffMs[backoffMs.length - 1];
    await sleep(waitMs);
  }

  // 이론상 도달하지 않지만 타입 안전을 위해 마지막 응답을 반환합니다.
  return lastRes as Response;
}

export function normalizeMonthList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  const months = raw.map((item) => String(item).trim()).filter(Boolean);
  for (const month of months) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Invalid month: ${month}. Use YYYY-MM.`);
  }
  return Array.from(new Set(months)).sort();
}

function toDateText(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateText(date);
}

export function enumerateDepartureDates(months: string[], limit: number) {
  const dates: string[] = [];
  for (const month of months) {
    const [year, monthNumber] = month.split("-").map(Number);
    const cursor = new Date(Date.UTC(year, monthNumber - 1, 1));
    while (cursor.getUTCFullYear() === year && cursor.getUTCMonth() === monthNumber - 1) {
      dates.push(toDateText(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const todayText = toDateText(new Date());
  const futureDates = dates.filter((date) => date >= todayText);
  if (futureDates.length <= limit) return futureDates;

  // API 과금을 막기 위해 너무 긴 월 범위는 균등 샘플링합니다.
  const sampled: string[] = [];
  const step = (futureDates.length - 1) / (limit - 1);
  for (let i = 0; i < limit; i += 1) {
    sampled.push(futureDates[Math.round(i * step)]);
  }
  return Array.from(new Set(sampled));
}

export async function searchFlightOffers(input: {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string | null;
  adults?: number;
  currency?: string;
  max?: number;
}): Promise<NormalizedOffer[]> {
  const baseUrl = process.env.AMADEUS_BASE_URL || "https://test.api.amadeus.com";
  const token = await getAmadeusToken();
  const params = new URLSearchParams();
  params.set("originLocationCode", input.origin.toUpperCase());
  params.set("destinationLocationCode", input.destination.toUpperCase());
  params.set("departureDate", input.departureDate);
  if (input.returnDate) params.set("returnDate", input.returnDate);
  params.set("adults", String(input.adults || 1));
  params.set("currencyCode", input.currency || "KRW");
  params.set("max", String(input.max || 10));
  params.set("nonStop", "false");

  const res = await fetchAmadeusWithRetry(`${baseUrl}/v2/shopping/flight-offers?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Amadeus search failed: ${res.status} ${text}`);
  }

  const payload = await res.json() as { data?: any[] };
  return (payload.data || [])
    .map((offer) => ({
      price: Math.round(Number(offer?.price?.grandTotal || offer?.price?.total || 0)),
      currency: offer?.price?.currency || input.currency || "KRW",
      carrier: Array.isArray(offer?.validatingAirlineCodes) ? offer.validatingAirlineCodes.join(",") : "UNKNOWN",
      validatingAirlineCodes: offer?.validatingAirlineCodes || [],
      departureDate: input.departureDate,
      returnDate: input.returnDate || null,
      itineraries: (offer?.itineraries || []).map((itinerary: any) => ({
        duration: itinerary?.duration || "",
        segments: (itinerary?.segments || []).map((segment: any) => ({
          departure: segment?.departure?.iataCode || "",
          arrival: segment?.arrival?.iataCode || "",
          departureAt: segment?.departure?.at || "",
          arrivalAt: segment?.arrival?.at || "",
          carrierCode: segment?.carrierCode || "",
          number: segment?.number || "",
        })),
      })),
      raw: offer,
    }))
    .filter((offer) => Number.isFinite(offer.price) && offer.price > 0)
    .sort((a, b) => a.price - b.price);
}

export async function searchMonthlyFlightOffers(input: {
  origin: string;
  destination: string;
  months: string[];
  tripLengthDays: number;
  adults?: number;
  currency?: string;
  maxPerDate?: number;
  maxSearches?: number;
}): Promise<MonthlySearchResult> {
  const months = normalizeMonthList(input.months);
  if (!months.length) throw new Error("Select at least one departure month.");
  const tripLengthDays = Math.max(1, Math.round(input.tripLengthDays || 7));
  const maxSearches = Math.max(1, Math.min(Number(input.maxSearches || process.env.MONTHLY_SEARCH_MAX_DATES || 40), 90));
  const departureDates = enumerateDepartureDates(months, maxSearches);
  const allOffers: NormalizedOffer[] = [];

  for (const departureDate of departureDates) {
    const returnDate = addDays(departureDate, tripLengthDays);
    try {
      const offers = await searchFlightOffers({
        origin: input.origin,
        destination: input.destination,
        departureDate,
        returnDate,
        adults: input.adults,
        currency: input.currency,
        max: input.maxPerDate || 3,
      });
      allOffers.push(...offers.slice(0, input.maxPerDate || 3));
    } catch (error) {
      // 월별 탐색은 일부 날짜 실패가 전체 실패가 되지 않게 넘깁니다.
      console.warn(`Monthly search skipped ${departureDate}:`, error);
    }
  }

  allOffers.sort((a, b) => a.price - b.price);
  return {
    scannedDates: departureDates.length,
    months,
    tripLengthDays,
    offers: allOffers.slice(0, 30),
  };
}

export function formatKRW(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export function buildOfferSummary(offer: NormalizedOffer) {
  const lines: string[] = [];
  lines.push(`날짜: ${offer.departureDate}${offer.returnDate ? ` ~ ${offer.returnDate}` : ""}`);
  for (const [idx, itinerary] of offer.itineraries.entries()) {
    const title = idx === 0 ? "가는 편" : "오는 편";
    const segments = itinerary.segments
      .map((seg) => `${seg.departure} → ${seg.arrival} ${seg.departureAt} (${seg.carrierCode}${seg.number})`)
      .join(" / ");
    lines.push(`${title}: ${segments}`);
  }
  return lines.join("\n");
}

// ── 알림 처리 로직 (스케줄러 run-alerts.ts와 수동 확인 check-alert.ts가 공유) ──

// 연속 오류가 이 횟수에 도달하면 알림을 자동으로 일시정지합니다.
export const CONSECUTIVE_ERROR_LIMIT = 10;

function shouldCheckNow(alert: FlightAlert) {
  if (!alert.last_checked_at) return true;
  const intervalMinutes = alert.check_interval_minutes || 30;
  const elapsed = Date.now() - new Date(alert.last_checked_at).getTime();
  return elapsed >= intervalMinutes * 60 * 1000;
}

function monthEntirelyPast(month: string, todayText: string): boolean {
  const [year, monthNumber] = month.split("-").map(Number);
  // Date.UTC(year, monthNumber, 1)은 0-indexed 월 계산 특성상 해당 월의 "다음 달" 1일이 됩니다.
  const firstDayOfNextMonth = toDateText(new Date(Date.UTC(year, monthNumber, 1)));
  return firstDayOfNextMonth <= todayText;
}

function isAlertExpired(alert: FlightAlert): boolean {
  const todayText = toDateText(new Date());
  if (alert.search_mode === "month_range") {
    const months = alert.departure_months || [];
    if (!months.length) return false;
    const latestMonth = [...months].sort().at(-1)!;
    return monthEntirelyPast(latestMonth, todayText);
  }
  return alert.departure_date < todayText;
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

export async function processAlert(alert: FlightAlert, options: { force?: boolean } = {}) {
  const supabase = getSupabaseAdmin();

  if (isAlertExpired(alert)) {
    await supabase
      .from("flight_alerts")
      .update({ is_active: false, deactivated_reason: "expired" })
      .eq("id", alert.id);
    return { id: alert.id, status: "expired" as const };
  }

  if (!options.force && !shouldCheckNow(alert)) {
    return {
      id: alert.id,
      status: "skipped_interval" as const,
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
      .update({
        last_price_krw: lowest,
        last_checked_at: new Date().toISOString(),
        consecutive_error_count: 0,
        last_error: null,
      })
      .eq("id", alert.id);

    if (!best || lowest == null) {
      return { id: alert.id, status: "no_offer" as const, scannedDates };
    }

    const shouldNotify = lowest <= alert.target_price_krw;
    if (!shouldNotify) {
      return { id: alert.id, status: "checked" as const, lowest, scannedDates };
    }

    const lastNotifiedAt = alert.last_notified_at ? new Date(alert.last_notified_at).getTime() : 0;
    const cooldownMs = (alert.notify_cooldown_minutes ?? 360) * 60 * 1000;
    if (cooldownMs > 0 && Date.now() - lastNotifiedAt < cooldownMs) {
      return {
        id: alert.id,
        status: "suppressed_recent_notification" as const,
        lowest,
        cooldownMinutes: alert.notify_cooldown_minutes ?? 360,
      };
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

    return { id: alert.id, status: "notified" as const, lowest, scannedDates };
  } catch (error: any) {
    const message = error?.message || "Unknown error";
    const nextErrorCount = (alert.consecutive_error_count || 0) + 1;
    const shouldDeactivate = nextErrorCount >= CONSECUTIVE_ERROR_LIMIT;

    await supabase.from("price_checks").insert({
      alert_id: alert.id,
      lowest_price_krw: null,
      carrier: null,
      raw_offer: null,
      error: message,
    });

    await supabase
      .from("flight_alerts")
      .update({
        last_checked_at: new Date().toISOString(),
        consecutive_error_count: nextErrorCount,
        last_error: message,
        ...(shouldDeactivate ? { is_active: false, deactivated_reason: "too_many_errors" } : {}),
      })
      .eq("id", alert.id);

    if (shouldDeactivate) {
      try {
        const resend = getResend();
        const from = process.env.RESEND_FROM || "Flight Alert <onboarding@resend.dev>";
        await resend.emails.send({
          from,
          to: [alert.email],
          subject: `항공권 알림 자동 정지 안내: ${alert.origin}→${alert.destination}`,
          html: `
            <h2>항공권 알림이 자동으로 일시정지되었습니다</h2>
            <p><b>${alert.label || "가격 알림"}</b></p>
            <p>경로: ${alert.origin} → ${alert.destination}</p>
            <p>연속 ${nextErrorCount}회 가격 조회에 실패하여 알림을 일시정지했습니다.</p>
            <p>마지막 오류: ${message}</p>
            <p style="color:#666">문제를 확인한 뒤 알림 설정에서 다시 활성화해주세요.</p>
          `,
          text: `항공권 알림이 자동으로 일시정지되었습니다\n경로: ${alert.origin} → ${alert.destination}\n연속 ${nextErrorCount}회 가격 조회에 실패하여 알림을 일시정지했습니다.\n마지막 오류: ${message}\n문제를 확인한 뒤 알림 설정에서 다시 활성화해주세요.`,
        });
      } catch (emailError) {
        // 정지 안내 메일 발송 실패가 전체 실행을 막으면 안 됩니다.
        console.warn("Failed to send pause notice email:", emailError);
      }
    }

    return {
      id: alert.id,
      status: "error" as const,
      error: message,
      consecutiveErrorCount: nextErrorCount,
      deactivated: shouldDeactivate,
    };
  }
}
