# Flight Price Alert MVP

인천(ICN) → 니스(NCE, 모나코 관문) 항공권 가격을 조회하고, 목표가 이하가 되면 이메일 알림을 보내는 Netlify + Supabase + Amadeus + Resend MVP입니다.

## 기능

- 일별 검색: 특정 출발일/귀국일 기준 가격 조회
- 여러 월별 검색: `2026-09, 2026-10, 2026-11`처럼 여러 출발 월을 넣고 최저가 날짜 조합 검색
- 월별 검색 시 여행 기간(박)을 지정하면 `출발일 + 여행기간`으로 귀국일 자동 계산
- 목표가 알림 저장
- Netlify Scheduled Functions로 5분마다 실행
- 알림별 감시 주기: 5분 / 10분 / 30분 / 1시간 / 3시간 / 6시간
- 중복 알림 제한: 매번 / 1시간 / 6시간 / 하루
- Supabase에 가격 체크 기록 저장

## 월별 검색 주의

월별 검색은 날짜가 많을수록 API 호출이 늘어납니다. 기본값은 `MONTHLY_SEARCH_MAX_DATES=40`이며, 여러 월을 입력하면 해당 월들의 출발일을 균등 샘플링해서 조회합니다.

예시:

```text
출발 월들: 2026-09, 2026-10, 2026-11
여행 기간: 7박
```

그러면 9~11월 중 일부 출발일을 스캔하고, 각 출발일의 귀국일은 출발일+7일로 계산합니다.

## 설치

```bash
npm install
cp .env.example .env
npm run dev
```

## 환경변수

```bash
AMADEUS_CLIENT_ID=
AMADEUS_CLIENT_SECRET=
AMADEUS_BASE_URL=https://test.api.amadeus.com

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

RESEND_API_KEY=
RESEND_FROM=Flight Alert <onboarding@resend.dev>

APP_PASSWORD=원하는관리자비밀번호
MONTHLY_SEARCH_MAX_DATES=40
```

## Supabase

`supabase/schema.sql`을 SQL editor에서 실행하세요. 기존 설치본도 같은 SQL을 다시 실행하면 월별 검색 컬럼이 추가됩니다.

## 빌드

```bash
npm run typecheck
npm run build
```

## 배포

Netlify에 프로젝트를 연결하고 위 환경변수를 등록하세요. Scheduled Function은 published deploy에서 동작합니다.
