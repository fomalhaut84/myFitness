# M14 Phase 4 QOL: 체중 sync 오늘 누락 + 네비 라벨 + 식단 히스토리

> Status: **draft (승인 대기)**
> 이슈 번호: TBD (승인 후 gh issue create × 3)
> 관련 마일스톤: M14 Phase 4 (v2.25.0 이후 실사용 피드백 반영)

## 배경

v2.25.0 배포 후 실사용에서 세 가지 개선 요청 확인:

1. **체중 동기화가 오늘 입력된 체중을 안 가져옴** — cron/수동 sync 시 오늘 아침 Garmin 앱에서 잰 체중이 DB 에 반영 안 됨.
2. **네비게이션 "매크로" 라벨 부적절** — `/nutrition` 페이지는 오늘 식단 리스트가 주 컨텐츠인데 라벨이 "매크로" 라 사용자 관점에서 어긋남.
3. **식단은 오늘만 보임** — 과거 식단 조회 불가. 리뷰/복기 시 답답.

세 항목 모두 독립적인 변경이지만 QOL 성격 · 릴리즈 사이클을 나누기 어렵지 않은 규모라 한 스펙에서 3 이슈로 관리.

---

## Part A: 체중 sync 오늘 누락 fix

### 목적

Garmin Connect API `weight-service/weight/dateRange` 호출 시 오늘 측정된 체중이 응답에 포함되도록 endDate 처리 재정비. cron(06:00) · 수동 sync 어느 경로든 정합.

### 원인 가설

- `src/lib/cron.ts:38-40` — `startDate: daysAgoKST(2), endDate: todayKST()` 로 sync 호출
- `src/lib/garmin/fetchers/body-composition.ts:29-30` — `formatDate(startDate)` / `formatDate(endDate)` 로 `YYYY-MM-DD` 문자열화. `formatDate` = `ymdKST` (KST 날짜).
- Garmin API 가 `endDate` 를 그 날짜의 자정 (KST 또는 UTC) **exclusive** 로 해석하면 오늘 아침 측정이 응답에서 누락. inclusive 라 해도 API 가 UTC 기준으로 해석하면 KST 오늘 오전 측정 (UTC 어제) 만 포함, 오후 이후 KST 오늘 측정 (UTC 오늘) 은 UTC 오늘 endDate 인지 여부에 따라 걸림.

### 요구사항

- [ ] `body-composition.ts` 실제 Garmin API 응답 관찰 (scripts/inspect-garmin-weight.ts 신설) — 오늘/어제 각각 endDate 값 바꿔 요청해서 오늘 entry 포함 여부 확인
- [ ] 원인 확정 후 fix:
  - **가정 A** (endDate exclusive): `endDate` 를 하루 뒤로 넘김 (내일 date) — `syncBodyComposition` 내부에서 `endDate + 1일` 로 API 호출, 또는 caller 가 넘김
  - **가정 B** (UTC 해석): endDate 를 KST 오늘 24:00 = UTC 15:00 = 다음 UTC date 로 계산해서 넘김
- [ ] 저장 시점 방어: `entryDate > Date.now()` (미래 방어) 는 유지 — API 가 미래 date 를 리턴하는 경우는 없다고 판단하되 코드 방어 유지
- [ ] 수동 sync UI 트리거 시에도 동일 fix 반영 (`/api/sync` route 로직)
- [ ] `daysAgoKST(2)` 대신 `daysAgoKST(3)` 으로 window 넓혀 backfill margin 확보 (upsert 이라 중복 저장 없음)

### 검증 계획

- [ ] 로컬: 오늘 Garmin 앱에서 체중 입력 → sync 트리거 → `BodyComposition` row `date = 오늘 KST 자정 instant` 확인
- [ ] cron: 다음 tick (내일 06:00) 로그에서 `[body-composition] synced: N` 이 오늘 데이터 포함되는지 확인
- [ ] scripts/inspect-garmin-weight.ts — 다양한 endDate 로 응답 셈 검증

---

## Part B: 네비게이션 라벨 rename ("매크로" → "영양" or 대안)

### 목적

사이드바에서 `/nutrition` 페이지 링크 라벨을 페이지 성격에 맞게 조정. "매크로" 는 M14 Phase 2 P/C/F 도입 시점의 명칭인데, 지금은 오늘 식단 리스트가 주 컨텐츠라 사용자 관점 어긋남.

### 요구사항

- [ ] `src/components/layout/Sidebar.tsx:80` `label: "매크로"` → **`"영양"`**
- [ ] 아이콘 유지 (도넛 SVG)
- [ ] 페이지 헤더 문구도 함께 정합 (`nutrition-client.tsx` 상단 h1 등)
- [ ] 이 라벨을 참조하는 다른 위치 grep 후 함께 갱신 (문서 links, breadcrumb 등)

### 스코프 밖

- URL `/nutrition` 은 유지 (외부 링크·북마크 안전)
- 도메인 표현 ("매크로" 는 P/C/F 그래프 카드 제목에서는 여전히 정확한 표현이라 유지)

---

## Part C: 식단 히스토리 조회

### 목적

`/nutrition` 페이지에서 과거 임의 날짜 식단 조회 가능. 리뷰·복기·정정 지원.

### 요구사항

- [ ] URL 쿼리 파라미터: `?date=YYYY-MM-DD` (기본은 오늘 KST). 파싱 실패/미래 date → 오늘로 리셋 + 400 안 냄 (silent fallback)
- [ ] 페이지 상단에 날짜 네비게이션 컨트롤
  - [ ] **← 이전 / 다음 →** 버튼 (하루 단위 이동)
  - [ ] 오늘 이후로는 이동 불가 (다음 버튼 비활성)
  - [ ] 중앙에 날짜 label ("2026-08-27 (수)" · 오늘이면 "오늘 · 2026-08-27") · 클릭 시 native `<input type="date">` 팝오버로 임의 date 선택
- [ ] 카드 · 리스트 데이터를 선택된 날짜 KST day 기준으로 fetch (기존 `kstDayRange` 를 `kstDayRangeFor(date)` 로 확장)
- [ ] 오늘이 아닌 날짜에서는:
  - [ ] `NutritionFoodList` 헤더 "오늘 식단" → "YYYY-MM-DD 식단" 로 라벨 변경
  - [ ] 리스트 하단 "봇 · 웹 어느 쪽으로 입력해도 자동 추정" 문구 유지
  - [ ] "부분 미측정" 뱃지 · "총합 정정됨" 뱃지 (v2.25.0) 동일 노출
- [ ] macros 트렌드/도넛/근손실 위험 (7일 aggregate) 은 **여전히 오늘 기준** 유지 (선택 날짜 기반 재계산은 후속 스코프). 도넛 헤더에 "최근 7일" 명시.
- [ ] 실서비스 배포 안전: 클라이언트 사이드 라우팅 (`?date=` 변경 시 서버 컴포넌트 refetch) — Next.js App Router `searchParams` 활용
- [ ] 로그 편집(kcal editor · description 편집) UX 는 선택된 date row 에도 동일 적용

### 기술 설계

**서버 컴포넌트 (`src/app/nutrition/page.tsx`):**
```ts
export default async function NutritionPage(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await props.searchParams;
  const selectedDate = parseSelectedDate(params.date); // Date | null → today
  const { start: dayStart, end: dayEnd } = kstDayRangeFor(selectedDate);
  const todayLogs = await prisma.foodLog.findMany({
    where: { date: { gte: dayStart, lt: dayEnd } },
    ...
  });
  ...
  <NutritionDateNav date={selectedDate} isToday={isToday(selectedDate)} />
  <NutritionFoodList items={foodItems} label={isToday(selectedDate) ? "오늘 식단" : `${formatKst(selectedDate)} 식단`} />
}
```

**클라이언트 네비 (`src/components/nutrition/NutritionDateNav.tsx` 신설):**
- prev / next / label + date picker
- URL 변경은 `useRouter().push('?date=YYYY-MM-DD')` — 서버 컴포넌트 자동 refetch

**date parsing:**
- `parseSelectedDate("2026-08-25")` → `new Date("2026-08-25T00:00:00+09:00")`
- invalid or 미래 → null → 오늘로 fallback
- URL clean-up 은 안 함 (invalid 라도 표시만 오늘, 사용자 URL 은 유지 · 새로고침 시 오늘 로 컴포넌트 처리)

### 스코프 밖

- 검색 (음식명 기준 조회) — 후속 이슈
- 주간/월간 캘린더 뷰 — 후속
- 도넛/트렌드/근손실 위험이 선택 날짜 기반 계산 — 후속 (지금은 오늘 기준 고정)
- Bot 명령으로 과거 날짜 열람 — 후속

---

## 이슈 분리

승인 시 3 이슈 별도 생성:
1. **fix**: 체중 sync 오늘 누락 (Part A)
2. **chore**: 네비게이션 라벨 rename (Part B)
3. **feature**: 식단 히스토리 조회 (Part C)

브랜치 별도 (`fix/<A>-1`, `chore/<B>-1`, `feat/<C>-1`). PR 각각. **릴리즈는 3건 완료 후 v2.26.0 minor bump 로 함께.**

## 릴리즈 노트 예정 (v2.26.0)

- **fix**: 체중 sync 오늘 데이터 누락 (endDate 계산 재정비, `daysAgoKST(3)` 로 window margin)
- **chore**: 네비 라벨 "매크로" → "영양"
- **feature**: `/nutrition?date=YYYY-MM-DD` 로 과거 식단 조회. 이전/다음 · 날짜 picker · 트렌드/도넛/위험 지표는 오늘 기준 유지
