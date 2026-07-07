import { assertAppPassword, getSupabaseAdmin, handleOptions, jsonResponse } from "./_shared";

// 알림 하나의 가격 확인 이력을 조회합니다. raw_offer는 용량이 커서 응답에 포함하지 않습니다.
export default async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    assertAppPassword(req);
    if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

    const url = new URL(req.url);
    const alertId = url.searchParams.get("alertId");
    if (!alertId) throw new Error("Missing alertId");

    const rawLimit = Number(url.searchParams.get("limit") || 50);
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? Math.round(rawLimit) : 50, 200));

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("price_checks")
      .select("id, checked_at, lowest_price_krw, carrier, error")
      .eq("alert_id", alertId)
      .order("checked_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    return jsonResponse({ checks: data || [] });
  } catch (error: any) {
    return jsonResponse({ error: error.message || "Unknown error" }, error.status || 500);
  }
};
