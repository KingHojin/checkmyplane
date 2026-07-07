# CheckMyPlane

원하는 출발/도착 공항 조합으로 항공권 가격을 조회하고, 목표가 이하가 되면 이메일 알림을 보내는 항공권 가격 감시 MVP입니다.

기본은 인천(ICN) 출발이지만, 출발/도착 공항은 IATA 3자리 코드로 직접 바꿀 수 있습니다. 예: `ICN → NCE`, `ICN → MXP`, `ICN → HNL`, `ICN → JFK`.

## 기능

- 전세계 목적지 검색: 모나코/니스, 밀라노, 파리, 로마, 런던, 하와이, 뉴욕, LA, 일본, 동남아 등 빠른 목적지 프리셋
- 직접 공항 코드 입력: 출발/도착 공항을 IATA 3자리 코드로 자유 입력
- 일별 검색: 특정 출발일/귀국일 기준 가격 조회
- 여러 월별 검색: `2026-09, 2026-10, 2026-11`처럼 여러 출발 월을 넣고 최저가 날짜 조합 검색
- 월별 검색 시 여행 기간(박)을 지정하면 `출발일 + 여행기간`으로 귀국일 자동 계산
- 목표가 알림 저장
- 스케줄러 기반 반복 확인
- 알림별 감시 주기: 5분 / 10분 / 30분 / 1시간 / 3시간 / 6시간
- 중복 알림 제한: 매번 / 1시간 / 6시간 / 하루
- Supabase에 가격 체크 기록 저장

## APP_PASSWORD란?

`APP_PASSWORD`는 사이트 관리자용 비밀번호입니다.

프론트 화면의 “관리 비밀번호” 입력값과 서버/배포 환경변수 `APP_PASSWORD` 값이 같아야 검색, 알림 조회, 알림 저장, 삭제 API를 사용할 수 있습니다.

즉, 사이트를 공개해도 아무나 API를 쓰거나 알림을 저장하지 못하게 막는 간단한 잠금장치입니다.

예시:

```bash
APP_PASSWORD=내가정한긴비밀번호
```

주의:

- 실제 이메일 비밀번호가 아닙니다.
- Gmail 앱 비밀번호도 아닙니다.
- 사용자가 직접 정하는 사이트 관리용 암호입니다.
- GitHub에 `.env` 파일이나 실제 비밀번호를 커밋하면 안 됩니다.

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
pnpm install
cp .env.example .env
pnpm run dev
```

npm을 쓸 수도 있지만, Cloudflare Pages에서는 Node 22 + pnpm 조합을 권장합니다.

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
pnpm run typecheck
pnpm run build
```

## 배포

### Cloudflare Pages / Workers

권장 설정:

```text
NODE_VERSION=22.16.0
PNPM_VERSION=10.11.1
SKIP_DEPENDENCY_INSTALL=true
```

Build command:

```bash
pnpm install --frozen-lockfile && pnpm run build
```

Build output directory:

```text
dist
```

### Netlify

Netlify에 프로젝트를 연결하고 위 환경변수를 등록하세요. Scheduled Function은 published deploy에서 동작합니다.
