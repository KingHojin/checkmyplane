import type { Config } from "@netlify/functions";
import { FlightAlert, getSupabaseAdmin, jsonResponse, processAlert } from "./_shared";

// price_checks 이력이 무한정 쌓이지 않도록 보존 기간이 지난 행을 정리합니다.
// 정리 실패가 실행 자체를 막지 않도록 항상 무시합니다.
async function cleanupOldPriceChecks(supabase: ReturnType<typeof getSupabaseAdmin>) {
  try {
    const retentionDays = Math.max(1, Number(process.env.PRICE_CHECK_RETENTION_DAYS || 30));
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("price_checks").delete().lt("checked_at", cutoff);
    if (error) console.warn("Failed to clean up old price_checks:", error.message);
  } catch (error) {
    console.warn("Failed to clean up old price_checks:", error);
  }
}

export default async () => {
  const supabase = getSupabaseAdmin();
  const maxAlertsPerRun = Math.max(1, Number(process.env.MAX_ALERTS_PER_RUN || 10));

  // 가장 오래 전에 확인한 알림(한 번도 확인하지 않은 알림 포함)부터 우선 처리합니다.
  const { data, error } = await supabase
    .from("flight_alerts")
    .select("*")
    .eq("is_active", true)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(maxAlertsPerRun);

  if (error) return jsonResponse({ error: error.message }, 500);

  const alerts = (data || []) as FlightAlert[];
  const results = [];
  for (const alert of alerts) {
    results.push(await processAlert(alert));
  }

  await cleanupOldPriceChecks(supabase);

  return jsonResponse({ checked: alerts.length, results });
};

// Netlify published deploy에서 UTC 기준 5분마다 실행.
// 각 알림별 실제 조회 간격은 flight_alerts.check_interval_minutes로 조절합니다.
export const config: Config = {
  schedule: "*/5 * * * *",
};
