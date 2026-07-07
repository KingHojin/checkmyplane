import { assertAppPassword, FlightAlert, getSupabaseAdmin, handleOptions, jsonResponse, processAlert } from "./_shared";

// 사용자가 대기하지 않고 즉시 가격을 확인하고 싶을 때 쓰는 수동 확인 API입니다.
// check_interval_minutes 게이트는 무시하지만, 중복 알림 방지(cooldown)는 그대로 지킵니다.
export default async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    assertAppPassword(req);
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const body = await req.json();
    const id = String(body.id || "").trim();
    if (!id) throw new Error("Missing id");

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("flight_alerts").select("*").eq("id", id).single();
    if (error) throw error;
    if (!data) throw Object.assign(new Error("Alert not found"), { status: 404 });

    const result = await processAlert(data as FlightAlert, { force: true });
    return jsonResponse({ result });
  } catch (error: any) {
    return jsonResponse({ error: error.message || "Unknown error" }, error.status || 500);
  }
};
