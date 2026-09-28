# [후속 #365] 서버 로컬 TZ 날짜 라벨 잔여 정리 — 봇 · fetcher 날짜 직렬화 · 포맷 헬퍼 · TZ 고정

- **작성일**: 2026-09-28
- **타입**: fix (bug · P2)
- **이슈**: #365 (#364 사전 리뷰 잔여 · 감사 2026-09-17 A1 · #393 이후 잔여)
- **브랜치**: `fix/365-1` (dev → dev)
- **의존**: #364 (MCP 계열 처리) · #393 (페이지 인라인 처리) · #445 (`MonthlyHeatmap`)

## 1. 배경 (2026-09-28 실코드 재검증)

`getFullYear()/getHours()` 조합과 `timeZone` 없는 `toLocaleDateString()` 은 호스트 TZ 가 Asia/Seoul 일 때만 맞다. PM2 세 앱 어디에도 `TZ` 가 없어 호스트 설정에 암묵 의존한다. 잔여 지점 (이슈 댓글 2026-09-18 기준, 전부 유효):

| 지점 | 영향 |
|---|---|
| `src/bot/commands/sleep.ts` · `weight.ts` · `run.ts` — `toLocaleDateString("ko-KR")` timeZone 없음 | 텔레그램에서 직접 읽는 날짜 (UTC 호스트면 아침 러닝 · 수면 날짜가 하루 앞) |
| `src/lib/garmin/fetchers/sleep.ts` · `heart-rate.ts` — `client.getSleepData(date)` · `getHeartRate(date)` | 라이브러리 `toDateString` 이 `getTimezoneOffset()` 으로 **로컬 TZ** 문자열화. KST 자정 instant 를 넘기므로 UTC 호스트면 **하루 전 날짜를 요청** → 심박 · 수면이 하루 어긋나 저장 (감사 A1). daily-summary 는 이미 `formatDate` 문자열로 `client.get` 직접 호출 |
| `src/lib/format.ts` `formatDateLocal` · `formatRelativeDate` · `formatDateTime` | 로컬 getter. `formatDateLocal` 은 대시보드 · 심박 페이지가 DB 의 KST 자정 `date` 에 쓴다 → UTC 호스트면 전날 라벨 |
| `src/components/dashboard/RecentActivities.tsx` | `"use client"` 없는 서버 컴포넌트가 로컬 getter 로 "오늘/어제" 판정 (`formatRelativeDate` 와 중복 구현) |
| `src/app/lifestyle/page.tsx` 수면 `getHours()` · `src/app/nutrition/page.tsx` `setDate` | 취침 · 기상 시각이 서버 TZ / 서버 로컬 일 산술 (KST · UTC 는 DST 없어 결과는 같지만 패턴 정리) |
| `src/app/api/dashboard/route.ts` `toISOString().split("T")[0]` | UTC 절단. 호출자 없음 (dead code) |
| `ecosystem.config.js` | 세 앱 `TZ` 미고정 — 위 전부의 근본 방어 |
| `scripts/verify-mcp-date-labels.ts` | 소스 스캔이 `src/mcp/**` 만 본다 |

## 2. 목표

1. 위 지점을 전부 KST 명시로 바꾼다 — 호스트 TZ 가 무엇이든 같은 결과.
2. PM2 세 앱에 `TZ: 'Asia/Seoul'` 고정 (이중 방어).
3. 소스 스캔을 `src/app` · `src/bot` · `src/components` · `src/lib` 로 확장해 재유입을 막는다 (`"use client"` 파일은 브라우저 TZ 라 제외).

## 3. 요구사항

- [x] F1 `src/lib/garmin/daily-endpoints.ts` (순수 URL + 얇은 fetch): `dailySleepUrl(date)` · `dailyHeartRateUrl(date)` 가 `formatDate` (= `ymdKST`) 문자열을 붙인다. `fetchDailySleep` · `fetchDailyHeartRate` 는 `client.get` 직접. fetcher 3곳 교체 (sleep 1 · heart-rate 2).
- [x] F2 `src/lib/format.ts`: `formatDateLocal` → `ymdKST` (이름 유지 · 주석 갱신) · `formatRelativeDate(iso, now?)` · `formatDateTime` 을 KST 로 (`ymdKST` + `formatEpochKST`). `formatDateKST(date, options)` 추가 (`toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", ...options })`).
- [x] F3 봇 3곳 → `formatDateKST`. `RecentActivities` → `formatRelativeDate` (중복 제거). `lifestyle` 수면 시각 → `hourOfDayKST` (`utils.ts` 신규). `nutrition` `eightDaysAgo` → instant 산술. `api/dashboard` → `ymdKST`.
- [x] F4 `ecosystem.config.js` 세 앱 env 에 `TZ: 'Asia/Seoul'`.
- [x] F5 `verify-mcp-date-labels.ts`: 절단 스캔을 4개 디렉터리로 확장 (allowlist: `open-meteo.ts` API 파라미터 · training-plan route 의 UTC 왕복 검증) + `toLocale*String(` 에 `timeZone` 없는 호출 스캔 (`"use client"` 파일 제외).
- [x] F6 회귀 테스트 (vitest): `daily-endpoints.test.ts` (KST 경계 instant → 날짜) · `format-kst.test.ts` (`formatDateLocal` · `formatRelativeDate` · `formatDateTime` · `formatDateKST` 의 KST 경계) · `hourOfDayKST`.
- [x] F7 스펙 364 §6 표에 처리 표기.

## 4. 기술 설계

- `formatDateLocal` 을 KST 로 바꾸는 근거: 호출자 (대시보드 · 심박 페이지) 는 DB 의 KST 자정 instant 를 넘긴다. `user-profile.ts` 의 `birthDate` · `targetDate` (이슈 제외 항목) 는 `parseLocalDate` 가 **서버 로컬 자정**으로 쓰는데 — KST 호스트면 KST 자정 → KST 읽기 같은 날, UTC 호스트면 UTC 자정 = KST 09:00 → 같은 날. **KST 읽기는 두 경우 모두 안전**하고, 로컬 읽기는 "KST 로 쓰고 UTC 로 읽는" 경우에만 깨진다. 따라서 제외 항목도 함께 좋아진다.
- `formatRelativeDate(iso, now = new Date())` — `now` 주입으로 테스트 가능. 날짜 차이는 두 KST ymd 를 UTC 자정으로 파싱해 뺀다 (DST 없음).
- `hourOfDayKST(d)` = KST 시 + 분/60 (Intl `hour` · `minute` · `hourCycle: "h23"`).
- 라이브러리 반환 타입은 `Awaited<ReturnType<GarminConnect["getSleepData"]>>` 로 재사용 — 타입 import 추가 없음.
- `TZ` 고정의 배포 영향: 호스트가 이미 KST 라 값 변화 없음. `pm2 restart` 만으로 반영 (`ecosystem.config.js` 재로드는 `pm2 startOrReload ecosystem.config.js` 필요 — 배포 후 확인).

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/garmin/daily-endpoints.ts` (+ `__tests__/daily-endpoints.test.ts`) | 신규 |
| `src/lib/garmin/fetchers/sleep.ts` · `heart-rate.ts` | `fetchDailySleep` · `fetchDailyHeartRate` |
| `src/lib/format.ts` (+ `src/lib/__tests__/format-kst.test.ts`) | KST 화 · `formatDateKST` |
| `src/lib/garmin/utils.ts` (+ `__tests__/kst-utils.test.ts`) | `hourOfDayKST` |
| `src/bot/commands/sleep.ts` · `weight.ts` · `run.ts` | 라벨 |
| `src/components/dashboard/RecentActivities.tsx` · `src/app/lifestyle/page.tsx` · `src/app/nutrition/page.tsx` · `src/app/api/dashboard/route.ts` | KST 헬퍼 |
| `ecosystem.config.js` | TZ |
| `scripts/verify-mcp-date-labels.ts` | 스캔 확장 |
| `docs/specs/364-mcp-date-label-off-by-one.md` | §6 처리 표기 |

## 6. 테스트 계획

§3 F6 + 4종 검증 (verify 스캔 확장이 dev 의 잔여 0 을 증명). 배포 후: `pm2 env <id>` 로 `TZ` 확인 · 다음 06:00 싱크 뒤 수면 · 심박 날짜가 그대로 (KST 호스트라 변화 없음이 정상) · 텔레그램 `/sleep` `/weight` `/run` 날짜.

## 7. 제외 사항

- `"use client"` 컴포넌트의 로컬 getter (브라우저 TZ = 사용자 TZ · 단일 사용자 KST) — 스캔에서 제외.
- `setDate(getDate() − n)` 일 산술 (KST · UTC 는 DST 없어 결과 동일) — 이번엔 지적된 `nutrition` 만 정리. 나머지는 스캔 대상 아님.
- `open-meteo.ts` `toIsoDate` (외부 API 날짜 파라미터가 UTC 절단) — 기상 보강의 날짜 경계는 별도 판단 (allowlist 근거 명시).
- `RecentActivities` 가 공용 `formatRelativeDate` 를 쓰면서 2~6일 전은 "N일 전" 으로 (이전엔 M월 D일) — `ActivityCard` 와 같은 표기로 통일.
- `api/dashboard` 라우트 삭제 — 호출자 없음이지만 삭제는 별도 정리 이슈. 여기서는 절단만 고친다.
