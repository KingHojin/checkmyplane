import { assertAppPassword, getSupabaseAdmin, handleOptions, jsonResponse, normalizeMonthList } from "./_shared";

function normalizeDate(value: unknown) {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Invalid date. Use YYYY-MM-DD.");
  return text;
}

function normalizeIata(value: unknown, fallback: string) {
  const text = String(value || fallback).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(text)) throw new Error(`Invalid IATA code: ${text}`);
  return text;
}

function normalizeInterval(value: unknown) {
  const allowed = [5, 10, 30, 60, 180, 360];
  const minutes = Number(value || 30);
  if (!allowed.includes(minutes)) throw new Error("Invalid check interval");
  return minutes;
}

function normalizeCooldown(value: unknown) {
  const minutes = Number(value ?? 360);
  if (!Number.isFinite(minutes) || minutes < 0) throw new Error("Invalid notification cooldown");
  return Math.round(minutes);
}

export default async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    assertAppPassword(req);
    const supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("flight_alerts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return jsonResponse({ alerts: data || [] });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const targetPrice = Number(body.targetPriceKrw || body.target_price_krw);
      if (!Number.isFinite(targetPrice) || targetPrice <= 0) throw new Error("Invalid target price");
      const email = String(body.email || "").trim();
      if (!email.includes("@")) throw new Error("Invalid email");

      const searchMode = body.searchMode || body.search_mode || "exact";
      const departureMonths = searchMode === "month_range" ? normalizeMonthList(body.departureMonths || body.departure_months) : null;
      if (searchMode === "month_range" && !departureMonths?.length) throw new Error("Select at least one departure month.");
      const tripLengthDays = searchMode === "month_range" ? Math.max(1, Math.round(Number(body.tripLengthDays || body.trip_length_days || 7))) : null;

      const insert = {
        label: String(body.label || "인천-니스/모나코 가격 알림").trim(),
        origin: normalizeIata(body.origin, "ICN"),
        destination: normalizeIata(body.destination, "NCE"),
        departure_date: searchMode === "month_range" ? `${departureMonths![0]}-01` : normalizeDate(body.departureDate || body.departure_date),
        return_date: searchMode === "month_range" ? null : (body.returnDate || body.return_date ? normalizeDate(body.returnDate || body.return_date) : null),
        search_mode: searchMode,
        departure_months: departureMonths,
        trip_length_days: tripLengthDays,
        adults: Math.max(1, Number(body.adults || 1)),
        currency: String(body.currency || "KRW").trim().toUpperCase(),
        target_price_krw: Math.round(targetPrice),
        email,
        check_interval_minutes: normalizeInterval(body.checkIntervalMinutes || body.check_interval_minutes),
        notify_cooldown_minutes: normalizeCooldown(body.notifyCooldownMinutes || body.notify_cooldown_minutes),
        is_active: true,
      };

      const { data, error } = await supabase.from("flight_alerts").insert(insert).select("*").single();
      if (error) throw error;
      return jsonResponse({ alert: data }, 201);
    }

    if (req.method === "DELETE") {
      const id = new URL(req.url).searchParams.get("id");
      if (!id) throw new Error("Missing id");
      const { error } = await supabase.from("flight_alerts").delete().eq("id", id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error: any) {
    return jsonResponse({ error: error.message || "Unknown error" }, error.status || 500);
  }
};
