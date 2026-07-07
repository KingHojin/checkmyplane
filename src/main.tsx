import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bell, ChevronDown, ChevronUp, Globe2, History, Pause, Pencil, Play, Plane, RefreshCw, Search, Trash2 } from "lucide-react";
import "./styles.css";

type SearchMode = "exact" | "month_range";

type DeactivatedReason = "expired" | "too_many_errors" | null;

type FlightAlert = {
  id: string;
  label: string | null;
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string | null;
  search_mode?: SearchMode;
  departure_months?: string[] | null;
  trip_length_days?: number | null;
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
  consecutive_error_count: number;
  last_error: string | null;
  deactivated_reason: DeactivatedReason;
};

type PriceCheck = {
  id: string;
  checked_at: string;
  lowest_price_krw: number | null;
  carrier: string | null;
  error: string | null;
};

type CheckAlertResult = {
  status: "expired" | "checked" | "no_offer" | "notified" | "suppressed_recent_notification" | "error";
  lowest?: number | null;
  error?: string;
};

type EditForm = {
  label: string;
  targetPriceKrw: string;
  checkIntervalMinutes: string;
  notifyCooldownMinutes: string;
  email: string;
};

type AlertBanner = { kind: "info" | "error"; text: string };

type Offer = {
  price: number;
  currency: string;
  carrier: string;
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
};

type DestinationPreset = {
  code: string;
  city: string;
  label: string;
  note: string;
  targetPriceKrw: string;
};

const DESTINATION_PRESETS: DestinationPreset[] = [
  { code: "NCE", city: "니스/모나코", label: "인천-니스/모나코 왕복", note: "모나코 관문", targetPriceKrw: "1200000" },
  { code: "MXP", city: "밀라노", label: "인천-밀라노 왕복", note: "북이탈리아", targetPriceKrw: "1100000" },
  { code: "CDG", city: "파리", label: "인천-파리 왕복", note: "프랑스", targetPriceKrw: "1100000" },
  { code: "FCO", city: "로마", label: "인천-로마 왕복", note: "이탈리아", targetPriceKrw: "1150000" },
  { code: "BCN", city: "바르셀로나", label: "인천-바르셀로나 왕복", note: "스페인", targetPriceKrw: "1150000" },
  { code: "LHR", city: "런던", label: "인천-런던 왕복", note: "영국", targetPriceKrw: "1200000" },
  { code: "HNL", city: "하와이", label: "인천-호놀룰루 왕복", note: "휴양", targetPriceKrw: "900000" },
  { code: "JFK", city: "뉴욕", label: "인천-뉴욕 왕복", note: "미국 동부", targetPriceKrw: "1300000" },
  { code: "LAX", city: "로스앤젤레스", label: "인천-LA 왕복", note: "미국 서부", targetPriceKrw: "1000000" },
  { code: "NRT", city: "도쿄", label: "인천-도쿄 왕복", note: "일본", targetPriceKrw: "250000" },
  { code: "KIX", city: "오사카", label: "인천-오사카 왕복", note: "일본", targetPriceKrw: "220000" },
  { code: "DAD", city: "다낭", label: "인천-다낭 왕복", note: "베트남", targetPriceKrw: "350000" },
  { code: "BKK", city: "방콕", label: "인천-방콕 왕복", note: "태국", targetPriceKrw: "400000" },
  { code: "SIN", city: "싱가포르", label: "인천-싱가포르 왕복", note: "동남아 허브", targetPriceKrw: "450000" },
  { code: "SYD", city: "시드니", label: "인천-시드니 왕복", note: "호주", targetPriceKrw: "950000" },
];

const today = new Date();
const defaultDepart = new Date(today.getTime() + 1000 * 60 * 60 * 24 * 60).toISOString().slice(0, 10);
const defaultReturn = new Date(today.getTime() + 1000 * 60 * 60 * 24 * 67).toISOString().slice(0, 10);
const defaultMonth = defaultDepart.slice(0, 7);

const CHECK_INTERVAL_OPTIONS: Array<[string, string]> = [
  ["5", "5분 - 공격형"],
  ["10", "10분 - 임박 여행"],
  ["30", "30분 - 추천"],
  ["60", "1시간"],
  ["180", "3시간"],
  ["360", "6시간"],
];

const NOTIFY_COOLDOWN_OPTIONS: Array<[string, string]> = [
  ["0", "매번 알림"],
  ["60", "1시간에 1번"],
  ["360", "6시간에 1번 - 추천"],
  ["1440", "하루 1번"],
];

function formatKRW(value?: number | null) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatApiError(error: any) {
  const message = error?.message || "요청 실패";
  if (message.includes("Unauthorized")) {
    return "관리 비밀번호가 틀렸거나 입력되지 않았습니다. Cloudflare/Netlify 환경변수 APP_PASSWORD와 같은 값을 입력하세요.";
  }
  return message;
}

function buildPresetOptions(): Array<[string, string]> {
  return [
    ["CUSTOM", "직접 입력"],
    ...DESTINATION_PRESETS.map((preset): [string, string] => [preset.code, `${preset.city} (${preset.code}) · ${preset.note}`]),
  ];
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "확인 전";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "확인 전";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}일 전`;
  return date.toLocaleDateString("ko-KR");
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function getAlertStatus(alert: FlightAlert): { label: string; tone: "green" | "amber" | "gray" | "red" } {
  if (alert.deactivated_reason === "expired") return { label: "만료", tone: "gray" };
  if (alert.deactivated_reason === "too_many_errors") return { label: "오류로 정지", tone: "red" };
  if (!alert.is_active) return { label: "일시정지", tone: "gray" };
  if (alert.consecutive_error_count > 0) return { label: "오류", tone: "amber" };
  return { label: "활성", tone: "green" };
}

function describeCheckResult(result?: CheckAlertResult | null): AlertBanner {
  if (!result) return { kind: "info", text: "확인 완료" };
  switch (result.status) {
    case "expired":
      return { kind: "info", text: "여행일이 지나 알림이 만료 처리되었습니다." };
    case "checked":
      return { kind: "info", text: `확인 완료: 최저가 ${formatKRW(result.lowest)}` };
    case "no_offer":
      return { kind: "info", text: "조회 가능한 항공권이 없습니다." };
    case "notified":
      return { kind: "info", text: `목표가 도달, 알림 발송됨 (최저가 ${formatKRW(result.lowest)})` };
    case "suppressed_recent_notification":
      return { kind: "info", text: `목표가 도달했지만 중복 알림 제한으로 이번엔 발송하지 않았습니다 (최저가 ${formatKRW(result.lowest)})` };
    case "error":
      return { kind: "error", text: result.error || "확인 중 오류가 발생했습니다." };
    default:
      return { kind: "info", text: "확인 완료" };
  }
}

async function api<T>(path: string, options: RequestInit = {}, password: string): Promise<T> {
  const res = await fetch(`/.netlify/functions/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-app-password": password,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `API failed: ${res.status}`);
  return data as T;
}

function App() {
  const [password, setPassword] = useState(() => localStorage.getItem("flight-alert-password") || "");
  const [routePreset, setRoutePreset] = useState("CUSTOM");
  const [form, setForm] = useState({
    label: "인천-전세계 항공권 가격 알림",
    origin: "ICN",
    destination: "NCE",
    searchMode: "exact" as SearchMode,
    departureDate: defaultDepart,
    returnDate: defaultReturn,
    departureMonths: defaultMonth,
    tripLengthDays: "7",
    adults: "1",
    targetPriceKrw: "1200000",
    checkIntervalMinutes: "30",
    notifyCooldownMinutes: "360",
    email: "",
  });
  const [offers, setOffers] = useState<Offer[]>([]);
  const [alerts, setAlerts] = useState<FlightAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [monthlyScanInfo, setMonthlyScanInfo] = useState<string | null>(null);

  const [alertBusy, setAlertBusy] = useState<Record<string, "toggle" | "check" | "save" | "delete" | undefined>>({});
  const [alertBanners, setAlertBanners] = useState<Record<string, AlertBanner | undefined>>({});
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<Record<string, PriceCheck[]>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});

  const hasPassword = useMemo(() => password.trim().length > 0, [password]);
  const selectedPreset = useMemo(() => DESTINATION_PRESETS.find((preset) => preset.code === routePreset), [routePreset]);

  useEffect(() => {
    if (!hasPassword) return;
    localStorage.setItem("flight-alert-password", password);
    loadAlerts().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPassword, password]);

  function applyPreset(code: string) {
    setRoutePreset(code);
    const preset = DESTINATION_PRESETS.find((item) => item.code === code);
    if (!preset) return;
    setForm((current) => ({
      ...current,
      origin: current.origin || "ICN",
      destination: preset.code,
      label: preset.label,
      targetPriceKrw: preset.targetPriceKrw,
    }));
  }

  function buildPayload() {
    return {
      label: form.label,
      origin: form.origin,
      destination: form.destination,
      searchMode: form.searchMode,
      departureDate: form.departureDate,
      returnDate: form.returnDate || null,
      departureMonths: form.departureMonths,
      tripLengthDays: Number(form.tripLengthDays),
      adults: Number(form.adults),
      targetPriceKrw: Number(form.targetPriceKrw),
      checkIntervalMinutes: Number(form.checkIntervalMinutes),
      notifyCooldownMinutes: Number(form.notifyCooldownMinutes),
      email: form.email,
      currency: "KRW",
    };
  }

  async function loadAlerts() {
    if (!hasPassword) {
      setMessage("저장된 알림을 보려면 관리 비밀번호를 입력하세요.");
      return;
    }
    const data = await api<{ alerts: FlightAlert[] }>("alerts", { method: "GET" }, password);
    setAlerts(data.alerts || []);
  }

  async function searchFlights() {
    setLoading(true);
    setMessage("");
    setMonthlyScanInfo(null);
    try {
      const data = await api<{ offers: Offer[]; scannedDates?: number; months?: string[]; tripLengthDays?: number; searchMode?: SearchMode }>(
        "search-flights",
        { method: "POST", body: JSON.stringify(buildPayload()) },
        password,
      );
      setOffers(data.offers || []);
      if (data.searchMode === "month_range") {
        setMonthlyScanInfo(`${data.months?.join(", ")} / ${data.tripLengthDays}박 일정 / ${data.scannedDates}개 출발일 스캔`);
      }
      setMessage(data.offers?.length ? "가격 조회 완료" : "조회 결과가 없습니다. 날짜/공항 코드를 바꿔보세요.");
    } catch (error: any) {
      setMessage(formatApiError(error));
    } finally {
      setLoading(false);
    }
  }

  async function createAlert() {
    if (!hasPassword) {
      setMessage("알림 저장은 관리 비밀번호를 입력한 뒤 가능합니다.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await api("alerts", { method: "POST", body: JSON.stringify(buildPayload()) }, password);
      setMessage("알림 저장 완료. 스케줄러가 알림별 설정 주기에 맞춰 가격을 확인합니다.");
      await loadAlerts();
    } catch (error: any) {
      setMessage(formatApiError(error));
    } finally {
      setLoading(false);
    }
  }

  async function deleteAlert(id: string) {
    if (!hasPassword) {
      setMessage("알림 삭제는 관리 비밀번호를 입력한 뒤 가능합니다.");
      return;
    }
    setAlertBusy((prev) => ({ ...prev, [id]: "delete" }));
    setAlertBanners((prev) => ({ ...prev, [id]: undefined }));
    try {
      await api(`alerts?id=${encodeURIComponent(id)}`, { method: "DELETE" }, password);
      setMessage("알림 삭제 완료");
      await loadAlerts();
    } catch (error: any) {
      setAlertBanners((prev) => ({ ...prev, [id]: { kind: "error", text: formatApiError(error) } }));
    } finally {
      setAlertBusy((prev) => ({ ...prev, [id]: undefined }));
    }
  }

  async function toggleActive(alert: FlightAlert) {
    if (!hasPassword) return;
    setAlertBusy((prev) => ({ ...prev, [alert.id]: "toggle" }));
    setAlertBanners((prev) => ({ ...prev, [alert.id]: undefined }));
    try {
      await api("alerts", { method: "PATCH", body: JSON.stringify({ id: alert.id, isActive: !alert.is_active }) }, password);
      await loadAlerts();
    } catch (error: any) {
      setAlertBanners((prev) => ({ ...prev, [alert.id]: { kind: "error", text: formatApiError(error) } }));
    } finally {
      setAlertBusy((prev) => ({ ...prev, [alert.id]: undefined }));
    }
  }

  async function checkNow(alert: FlightAlert) {
    if (!hasPassword) return;
    setAlertBusy((prev) => ({ ...prev, [alert.id]: "check" }));
    setAlertBanners((prev) => ({ ...prev, [alert.id]: undefined }));
    try {
      const data = await api<{ result: CheckAlertResult }>("check-alert", { method: "POST", body: JSON.stringify({ id: alert.id }) }, password);
      setAlertBanners((prev) => ({ ...prev, [alert.id]: describeCheckResult(data.result) }));
      await loadAlerts();
      if (historyOpenId === alert.id) await loadHistory(alert.id, true);
    } catch (error: any) {
      setAlertBanners((prev) => ({ ...prev, [alert.id]: { kind: "error", text: formatApiError(error) } }));
    } finally {
      setAlertBusy((prev) => ({ ...prev, [alert.id]: undefined }));
    }
  }

  function startEdit(alert: FlightAlert) {
    setEditingAlertId(alert.id);
    setAlertBanners((prev) => ({ ...prev, [alert.id]: undefined }));
    setEditForm({
      label: alert.label || "",
      targetPriceKrw: String(alert.target_price_krw),
      checkIntervalMinutes: String(alert.check_interval_minutes || 30),
      notifyCooldownMinutes: String(alert.notify_cooldown_minutes || 360),
      email: alert.email || "",
    });
  }

  function cancelEdit() {
    setEditingAlertId(null);
    setEditForm(null);
  }

  async function saveEdit(id: string) {
    if (!hasPassword || !editForm) return;
    setAlertBusy((prev) => ({ ...prev, [id]: "save" }));
    setAlertBanners((prev) => ({ ...prev, [id]: undefined }));
    try {
      await api(
        "alerts",
        {
          method: "PATCH",
          body: JSON.stringify({
            id,
            label: editForm.label,
            targetPriceKrw: Number(editForm.targetPriceKrw),
            checkIntervalMinutes: Number(editForm.checkIntervalMinutes),
            notifyCooldownMinutes: Number(editForm.notifyCooldownMinutes),
            email: editForm.email,
          }),
        },
        password,
      );
      setEditingAlertId(null);
      setEditForm(null);
      await loadAlerts();
    } catch (error: any) {
      setAlertBanners((prev) => ({ ...prev, [id]: { kind: "error", text: formatApiError(error) } }));
    } finally {
      setAlertBusy((prev) => ({ ...prev, [id]: undefined }));
    }
  }

  async function loadHistory(id: string, silent = false) {
    if (!silent) setHistoryLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const data = await api<{ checks: PriceCheck[] }>(`price-history?alertId=${encodeURIComponent(id)}&limit=50`, { method: "GET" }, password);
      setHistoryData((prev) => ({ ...prev, [id]: data.checks || [] }));
    } catch (error: any) {
      setAlertBanners((prev) => ({ ...prev, [id]: { kind: "error", text: formatApiError(error) } }));
    } finally {
      setHistoryLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function toggleHistory(alert: FlightAlert) {
    if (historyOpenId === alert.id) {
      setHistoryOpenId(null);
      return;
    }
    setHistoryOpenId(alert.id);
    if (!historyData[alert.id]) await loadHistory(alert.id);
  }

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">CheckMyPlane</p>
          <h1>전세계 항공권 가격 검색 & 목표가 알림</h1>
          <p className="sub">모나코뿐 아니라 밀라노, 하와이, 일본, 동남아, 미국, 유럽 등 원하는 IATA 공항 코드로 항공권을 검색하고 목표가 이하 알림을 저장합니다.</p>
        </div>
        <Globe2 className="heroIcon" size={64} />
      </section>

      <section className="card gridTwo">
        <div>
          <label>관리 비밀번호</label>
          <input type="password" placeholder="APP_PASSWORD" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="hint">검색 버튼은 비밀번호 없이도 누를 수 있습니다. 배포 환경에 APP_PASSWORD가 설정돼 있으면 같은 값을 입력해야 API가 통과합니다.</p>
        </div>
        <div className="routeBox">
          <b>현재 검색 경로</b>
          <span>{form.origin || "ICN"} → {form.destination || "도착 공항"}{selectedPreset ? ` · ${selectedPreset.city}` : ""}</span>
          <small>공항 코드는 ICN, NCE, MXP, HNL처럼 3자리 IATA 코드를 사용합니다.</small>
        </div>
      </section>

      <section className="card">
        <div className="sectionTitle"><Plane /><h2>빠른 목적지</h2></div>
        <div className="presetGrid">
          {DESTINATION_PRESETS.map((preset) => (
            <button
              key={preset.code}
              className={routePreset === preset.code ? "presetButton active" : "presetButton"}
              type="button"
              onClick={() => applyPreset(preset.code)}
            >
              <b>{preset.city}</b>
              <span>{preset.code} · 목표 {Number(preset.targetPriceKrw).toLocaleString("ko-KR")}원</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="sectionTitle"><Search /><h2>검색 / 알림 조건</h2></div>
        <div className="modeTabs">
          <button className={form.searchMode === "exact" ? "tab active" : "tab"} onClick={() => setForm({ ...form, searchMode: "exact" })}>일별 검색</button>
          <button className={form.searchMode === "month_range" ? "tab active" : "tab"} onClick={() => setForm({ ...form, searchMode: "month_range" })}>여러 월별 검색</button>
        </div>

        <div className="formGrid">
          <SelectField label="빠른 목적지 선택" value={routePreset} onChange={applyPreset} options={buildPresetOptions()} />
          <Field label="알림 이름" value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
          <Field label="출발 공항" value={form.origin} onChange={(v) => { setRoutePreset("CUSTOM"); setForm({ ...form, origin: v.toUpperCase() }); }} />
          <Field label="도착 공항" value={form.destination} onChange={(v) => { setRoutePreset("CUSTOM"); setForm({ ...form, destination: v.toUpperCase() }); }} />
          {form.searchMode === "exact" ? (
            <>
              <Field label="출발일" type="date" value={form.departureDate} onChange={(v) => setForm({ ...form, departureDate: v })} />
              <Field label="귀국일" type="date" value={form.returnDate} onChange={(v) => setForm({ ...form, returnDate: v })} />
            </>
          ) : (
            <>
              <Field label="출발 월들" type="text" value={form.departureMonths} onChange={(v) => setForm({ ...form, departureMonths: v })} />
              <Field label="여행 기간(박)" type="number" value={form.tripLengthDays} onChange={(v) => setForm({ ...form, tripLengthDays: v })} />
            </>
          )}
          <Field label="인원" type="number" value={form.adults} onChange={(v) => setForm({ ...form, adults: v })} />
          <Field label="목표가(KRW)" type="number" value={form.targetPriceKrw} onChange={(v) => setForm({ ...form, targetPriceKrw: v })} />
          <SelectField label="감시 주기" value={form.checkIntervalMinutes} onChange={(v) => setForm({ ...form, checkIntervalMinutes: v })} options={CHECK_INTERVAL_OPTIONS} />
          <SelectField label="중복 알림 제한" value={form.notifyCooldownMinutes} onChange={(v) => setForm({ ...form, notifyCooldownMinutes: v })} options={NOTIFY_COOLDOWN_OPTIONS} />
          <Field label="알림 이메일" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        </div>
        {form.searchMode === "month_range" && (
          <p className="hint">월별 검색은 예: <b>2026-09, 2026-10, 2026-11</b> 처럼 입력합니다. API 과금 방지를 위해 기본 최대 40개 출발일을 균등 스캔합니다.</p>
        )}
        <p className="hint">직접 입력하려면 출발/도착 공항에 IATA 3자리 코드를 넣으면 됩니다. 예: ICN → MXP, ICN → HNL, ICN → JFK.</p>
        <div className="actions">
          <button disabled={loading} onClick={searchFlights}>지금 가격 조회</button>
          <button className="secondary" disabled={!hasPassword || loading} onClick={createAlert}><Bell size={16} /> 목표가 알림 저장</button>
        </div>
        {message && <p className="message">{message}</p>}
      </section>

      <section className="card">
        <h2>현재 조회 결과</h2>
        {monthlyScanInfo && <p className="hint">월별 검색: {monthlyScanInfo}</p>}
        <div className="offerList">
          {offers.map((offer, idx) => (
            <article className="offer" key={`${offer.departureDate}-${offer.price}-${idx}`}>
              <div>
                <p className="price">{formatKRW(offer.price)}</p>
                <p className="muted">{offer.departureDate}{offer.returnDate ? ` ~ ${offer.returnDate}` : ""}</p>
                <p className="muted">항공사 코드: {offer.carrier || "-"}</p>
              </div>
              <div className="segments">
                {offer.itineraries.map((it, i) => (
                  <div key={i}>
                    <b>{i === 0 ? "가는 편" : "오는 편"}</b>
                    {it.segments.map((seg, j) => (
                      <p key={j}>{seg.departure} → {seg.arrival} · {seg.departureAt} · {seg.carrierCode}{seg.number}</p>
                    ))}
                  </div>
                ))}
              </div>
            </article>
          ))}
          {!offers.length && <p className="muted">아직 조회 결과가 없습니다.</p>}
        </div>
      </section>

      <section className="card">
        <div className="sectionTitle spread"><h2>저장된 알림</h2><button className="tiny" disabled={!hasPassword || loading} onClick={loadAlerts}>새로고침</button></div>
        <div className="alertList">
          {alerts.map((alert) => {
            const mode = alert.search_mode === "month_range" ? `월별 ${alert.departure_months?.join(", ")} · ${alert.trip_length_days || 7}박` : `${alert.departure_date}${alert.return_date ? ` ~ ${alert.return_date}` : ""}`;
            const status = getAlertStatus(alert);
            const busy = alertBusy[alert.id];
            const isEditing = editingAlertId === alert.id;
            const banner = alertBanners[alert.id];
            const isHistoryOpen = historyOpenId === alert.id;
            return (
              <article className="alert" key={alert.id}>
                <div className="alertHeader">
                  <div className="alertHeaderLeft">
                    <span className={`badge badge-${status.tone}`}>{status.label}</span>
                    {alert.consecutive_error_count > 0 && (
                      <span className="errorCount" title={alert.last_error || undefined}>
                        오류 {alert.consecutive_error_count}회{alert.last_error ? ` · ${truncate(alert.last_error, 40)}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="alertHeaderRight">
                    <span className="muted">마지막 확인 {formatRelativeTime(alert.last_checked_at)}</span>
                    {alert.last_notified_at && <span className="muted">마지막 알림 {formatRelativeTime(alert.last_notified_at)}</span>}
                  </div>
                </div>

                {isEditing && editForm ? (
                  <div className="editForm">
                    <Field label="알림 이름" value={editForm.label} onChange={(v) => setEditForm((f) => (f ? { ...f, label: v } : f))} />
                    <Field label="목표가(KRW)" type="number" value={editForm.targetPriceKrw} onChange={(v) => setEditForm((f) => (f ? { ...f, targetPriceKrw: v } : f))} />
                    <Field label="알림 이메일" type="email" value={editForm.email} onChange={(v) => setEditForm((f) => (f ? { ...f, email: v } : f))} />
                    <SelectField label="감시 주기" value={editForm.checkIntervalMinutes} onChange={(v) => setEditForm((f) => (f ? { ...f, checkIntervalMinutes: v } : f))} options={CHECK_INTERVAL_OPTIONS} />
                    <SelectField label="중복 알림 제한" value={editForm.notifyCooldownMinutes} onChange={(v) => setEditForm((f) => (f ? { ...f, notifyCooldownMinutes: v } : f))} options={NOTIFY_COOLDOWN_OPTIONS} />
                    <div className="actions">
                      <button disabled={busy === "save"} onClick={() => saveEdit(alert.id)}>저장</button>
                      <button className="secondary" disabled={!!busy} onClick={cancelEdit}>취소</button>
                    </div>
                  </div>
                ) : (
                  <div className="alertBody">
                    <div>
                      <b>{alert.label || "가격 알림"}</b>
                      <p>{alert.origin} → {alert.destination} · {mode}</p>
                      <p className="muted">목표가 {formatKRW(alert.target_price_krw)} / 마지막 조회가 {formatKRW(alert.last_price_krw)}</p>
                      <p className="muted">감시 주기 {alert.check_interval_minutes || 30}분 / 중복 알림 제한 {alert.notify_cooldown_minutes || 360}분</p>
                    </div>
                    <div className="alertActions">
                      <button className="tiny secondary" disabled={!hasPassword || !!busy} onClick={() => toggleActive(alert)}>
                        {alert.is_active ? <Pause size={14} /> : <Play size={14} />} {alert.is_active ? "일시정지" : "재개"}
                      </button>
                      <button className="tiny secondary" disabled={!hasPassword || !!busy} onClick={() => checkNow(alert)}>
                        <RefreshCw size={14} /> {busy === "check" ? "확인 중..." : "지금 확인"}
                      </button>
                      <button className="tiny secondary" disabled={!hasPassword || !!busy} onClick={() => startEdit(alert)}>
                        <Pencil size={14} /> 수정
                      </button>
                      <button className="tiny secondary" disabled={!hasPassword || !!busy} onClick={() => toggleHistory(alert)}>
                        <History size={14} /> 이력 {isHistoryOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <button className="iconButton" disabled={!hasPassword || !!busy} onClick={() => deleteAlert(alert.id)} aria-label="delete alert"><Trash2 size={18} /></button>
                    </div>
                  </div>
                )}

                {banner && <p className={banner.kind === "error" ? "alertBanner error" : "alertBanner"}>{banner.text}</p>}

                {isHistoryOpen && (
                  <HistoryPanel alert={alert} checks={historyData[alert.id] || []} loading={!!historyLoading[alert.id]} />
                )}
              </article>
            );
          })}
          {!alerts.length && <p className="muted">저장된 알림이 없습니다.</p>}
        </div>
      </section>
    </main>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]>; }) {
  return <div><label>{label}</label><select value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}</select></div>;
}

function HistoryPanel({ alert, checks, loading }: { alert: FlightAlert; checks: PriceCheck[]; loading: boolean }) {
  if (loading) return <div className="historyPanel"><p className="muted">이력을 불러오는 중...</p></div>;
  if (!checks.length) return <div className="historyPanel"><p className="muted">아직 확인 이력이 없습니다.</p></div>;

  const chronological = [...checks].reverse();
  const prices = chronological.map((c) => c.lowest_price_krw).filter((p): p is number => p != null);
  const lowest = prices.length ? Math.min(...prices) : null;
  const highest = prices.length ? Math.max(...prices) : null;
  const latest = checks[0];
  const recent = checks.slice(0, 10);

  return (
    <div className="historyPanel">
      <div className="historyStats">
        <div><span>최저</span><b>{formatKRW(lowest)}</b></div>
        <div><span>최고</span><b>{formatKRW(highest)}</b></div>
        <div><span>최근</span><b>{formatKRW(latest?.lowest_price_krw)}</b></div>
      </div>
      <Sparkline checks={chronological} targetPriceKrw={alert.target_price_krw} />
      <ul className="historyList">
        {recent.map((c) => (
          <li key={c.id}>
            <span>{formatDateTime(c.checked_at)}</span>
            <span>{formatKRW(c.lowest_price_krw)}</span>
            <span>{c.carrier || "-"}</span>
            {c.error && <span className="historyError" title={c.error}>{truncate(c.error, 60)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sparkline({ checks, targetPriceKrw }: { checks: PriceCheck[]; targetPriceKrw: number }) {
  const width = 640;
  const height = 160;
  const padding = 28;
  const n = checks.length;
  const xFor = (i: number) => (n <= 1 ? width / 2 : padding + (i / (n - 1)) * (width - padding * 2));

  const valid = checks
    .map((c, i) => ({ i, price: c.lowest_price_krw }))
    .filter((p): p is { i: number; price: number } => p.price != null);

  if (!valid.length) {
    return <p className="muted">가격 데이터가 없어 그래프를 표시할 수 없습니다.</p>;
  }

  const prices = valid.map((p) => p.price);
  let min = Math.min(...prices);
  let max = Math.max(...prices);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const yFor = (price: number) => height - padding - ((price - min) / (max - min)) * (height - padding * 2);
  const points = valid.map((p) => `${xFor(p.i).toFixed(1)},${yFor(p.price).toFixed(1)}`).join(" ");
  const showTarget = targetPriceKrw >= min && targetPriceKrw <= max;
  const targetY = yFor(targetPriceKrw);

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="가격 추이 그래프">
      <text x={4} y={padding - 8} className="sparklineLabel">{formatKRW(max)}</text>
      <text x={4} y={height - padding + 16} className="sparklineLabel">{formatKRW(min)}</text>
      {showTarget && (
        <>
          <line x1={padding} y1={targetY} x2={width - padding} y2={targetY} className="targetLine" />
          <text x={width - padding} y={targetY - 4} textAnchor="end" className="sparklineLabel targetLabel">목표 {formatKRW(targetPriceKrw)}</text>
        </>
      )}
      <polyline points={points} className="sparklineLine" fill="none" />
      {valid.map((p) => (
        <circle key={p.i} cx={xFor(p.i)} cy={yFor(p.price)} r={2.5} className="sparklineDot" />
      ))}
    </svg>
  );
}

function Field(props: { label: string; value: string; onChange: (value: string) => void; type?: string; }) {
  return <div><label>{props.label}</label><input type={props.type || "text"} value={props.value} onChange={(e) => props.onChange(e.target.value)} /></div>;
}

createRoot(document.getElementById("root")!).render(<App />);
