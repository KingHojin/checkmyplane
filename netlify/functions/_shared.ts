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
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

async function getAmadeusToken(): Promise<string> {
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

  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Amadeus token response missing access_token");
  return data.access_token;
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

  const res = await fetch(`${baseUrl}/v2/shopping/flight-offers?${params.toString()}`, {
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
