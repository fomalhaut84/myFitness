# M14 Phase 3 QOL: 주간 목표 경계 + 식단 세부 항목 표시

> Status: **draft (승인 대기)**
> 이슈 번호: TBD (승인 후 gh issue create)
> 관련 마일스톤: M14 Phase 3 (Phase 2 완료 = v2.24.0 이후 후속 개선)

## 배경

Phase 2 (v2.21 ~ v2.24) 로 자연어 · 사진 · 오픈식약처 기반 식단 추정이 완성됐고, `targetWeeklyKm` 도 M12 (v2.22) 에서 도입됨. 실사용 과정에서 두 가지 불편이 드러남.

1. **주간 러닝 목표 진행도가 "오늘 기준 rolling 7/28일"** — 매주 월요일에 "이번 주 얼마나 뛰었나" 리셋되어야 하는데, 오늘 계산 순간부터 정확히 -7일/-28일이 되어 항상 rolling. 심리적으로 "주 마감" 체감 없음.
2. **식단 카드가 total kcal + total P/C/F 만 표시** — 예: "점심: 비빔밥, 계란국" 기록하면 `estimatedKcal=750, P=25 C=110 F=15` 로 합계만 보임. AI estimator 는 이미 item 별 (비빔밥 550/20/95/12, 계란국 200/5/15/3) 을 산출하지만 DB 저장 시 버림. 나중에 조정·복기 시 어떤 메뉴가 얼마씩인지 확인 불가.

두 항목을 한 스펙으로 묶어 처리한다 (범위 겹치진 않지만 QOL 성격 + 개별 릴리즈로 나눌 만큼 크지 않음).

---

## Part A: 주간 러닝 목표 — Mon~Sun 주 경계 마감

### 목적

`targetWeeklyKm` 진행도를 **KST Mon 00:00 ~ Sun 24:00** 주 단위로 마감. AI 프롬프트 · MCP · UI 어디든 "이번 주 진행" 은 이번 주 월요일부터 지금까지의 누적 거리로, "완료된 주 평균" 은 마감된 지난 4주 (지난주 포함, 오늘이 속한 주는 제외) 총 거리 / 4 로 계산.

### 요구사항

- [ ] `src/lib/personal-goals.ts` `recentWeeklyKm` 을 두 개념으로 분리
  - [ ] `currentWeekKm()` — 이번 주 월요일 00:00 KST ~ now 총 러닝 거리 (km)
  - [ ] `completedWeeksAvgKm(weeks=4)` — 오늘이 속한 주 제외, 완료된 지난 N주 (기본 4주) 총 러닝 거리 / N
- [ ] `PersonalGoalsProgress.targetWeeklyKm` 에 `currentWeekKm` 필드 추가
  - [ ] 기존 `current` (rolling avg) 는 `completedWeeksAvg` 로 rename
  - [ ] `progressPct` 는 `currentWeekKm / target` 기준으로 재정의 (이번 주 진행률)
- [ ] `formatGoalsForPrompt` 문구 갱신
  - [ ] `이번 주 XX km / 목표 YY km (진행 ZZ%) · 완료된 최근 4주 avg WW km`
- [ ] `startOfWeekKST(date)` 헬퍼를 `src/lib/format.ts` (또는 신설 `src/lib/date.ts`) 로 이동해 재사용
  - [ ] 기존 `src/app/lifestyle/page.tsx:15`, `src/app/activities/page.tsx:15` 도 이 헬퍼 사용하도록 리팩터
  - [ ] KST 기준 (UTC 서버 실행 대비 KST midnight instant 로 정확히 산출)
- [ ] MCP `read_personal_goals` 도 새 필드 반영
- [ ] Web dashboard/lifestyle 페이지에 "이번 주 러닝 진행" 카드 (선택) — 이미 lifestyle 에 이번 주 vs 지난 주 요약 있음. 목표가 설정된 경우 progress bar 추가

### 기술 설계

**KST 주 경계 계산:**
```
todayKST() 로 KST midnight 을 얻고, Date.getUTCDay() 로 요일 (0=일, 1=월…6=토) 산출.
diffToMonday = day === 0 ? 6 : day - 1   // 일요일은 6일 전 월요일
startOfWeekKST = todayKST() - diffToMonday * DAY_MS
endOfWeekKST   = startOfWeekKST + 7 * DAY_MS  // exclusive
```

**Completed weeks:**
```
completedWeeksEnd = startOfWeekKST   // 이번 주 시작 = 지난 주 마감
completedWeeksStart = completedWeeksEnd - weeks * 7 * DAY_MS
prisma.activity.findMany({
  where: { activityType: "running", startTime: { gte: completedWeeksStart, lt: completedWeeksEnd } }
})
```

**Current week:**
```
prisma.activity.findMany({
  where: { activityType: "running", startTime: { gte: startOfWeekKST, lt: endOfWeekKST } }
})
```

### 마이그레이션 없음

DB 변경 없음. 순수 로직 · 프롬프트 문구 개편.

---

## Part B: 식단 카드 · 개별 항목 (item) 세부 노출

### 목적

FoodLog 이 이미 보유한 개별 항목 정보 (estimator 산출) 를 저장해 UI 에서 접힘/펼침으로 노출. "비빔밥 + 계란국" 이면 카드 안에 두 개 sub-row 로 각각 kcal · P · C · F 표시.

### 요구사항

- [ ] `FoodLog` 스키마에 `items Json?` 추가 (nullable — 과거 데이터 · legacy write 는 null)
  - [ ] 저장 shape: `Array<{ name: string; kcal: number|null; proteinG: number|null; carbsG: number|null; fatG: number|null }>`
  - [ ] source (mfds/ai/vision) 도 각 item 이 아니라 top-level FoodLog 에 이미 별도 필드 없음 → item 자체엔 source 안 넣고 log 전체 notes/estimator 로 판별
- [ ] Prisma migration 수동 SQL (drift-fix 규칙) — `ALTER TABLE "FoodLog" ADD COLUMN "items" JSONB`
- [ ] 저장 경로 3곳 모두 items propagate
  - [ ] `POST /api/food` (JSON body) — estimator 반환 items 를 그대로 저장
  - [ ] `src/bot/commands/food.ts` — 동일
  - [ ] `src/bot/commands/food-photo.ts` (Vision) — Vision estimate items 저장
  - [ ] `src/lib/nutrition/backfill.ts` — 재추정 성공 시 items 반영
- [ ] 표시 경로
  - [ ] `src/components/nutrition/NutritionFoodList.tsx` FoodCard 하단에 `items` 있으면 아이템 리스트 sub-row (접기/펼치기 · 기본 접힘 · 카드 헤더 클릭 시 확장)
  - [ ] item row: `이름 · kcal · P/C/F g` — 미측정 필드는 `—`
  - [ ] `src/app/lifestyle/lifestyle-client.tsx` 오늘 식단 리스트도 동일 확장 (kcal 편집 UI 옆)
- [ ] MCP · AI 컨텍스트 (선택) — `weight-loss` / 리포트 tool 이 items 를 노출해 조언 세밀도 향상 (이번 스코프에서는 저장까지만, MCP 노출은 후속)

### 기술 설계

**Schema 변경:**
```prisma
model FoodLog {
  ...
  items         Json?   // Array<{name, kcal, proteinG, carbsG, fatG}> — estimator 산출 item 별 분해
  ...
}
```

**저장 시 검증:**
- `items` 는 estimator 반환값을 그대로 사용 (이미 sanity 검증 통과: 4·4·9 tolerance, per-item MAX_ITEM_KCAL 3000, per-item MAX_ITEM_GRAM 500)
- items sum vs top-level kcal 이 다르면 (예: 사용자가 kcal 수동 editor 로 정정) items 는 유지하되 UI 에 "총합 정정됨" 뱃지 표시

**UI 인터랙션:**
- 카드 우측에 `▾` 토글 아이콘 (items 있을 때만)
- 접힘 상태: 지금과 동일 (description + total)
- 펼침 상태: description 아래 아이템 리스트 (2-column: 이름 · kcal + 그 아래 P/C/F 라인)
- 모바일 대응: item row 는 세로 stack

**Migration 파일 위치:**
`prisma/migrations/<timestamp>_food_log_items/migration.sql`
```sql
ALTER TABLE "FoodLog" ADD COLUMN "items" JSONB;
```

### 하위호환

- `items IS NULL` = legacy 또는 estimator 실패 → UI 는 확장 토글 숨김, 지금과 동일 표시
- kcal editor 로 정정된 row 는 items 유지 · total 만 갱신

---

## 테스트 계획

### Part A

- Unit: `startOfWeekKST` — 월요일 00:00, 일요일 23:59, 자정 걸침 case
- Unit: `currentWeekKm` — 이번 주에 러닝 3건 있을 때 총합
- Unit: `completedWeeksAvgKm` — 지난 4주 중 이번 주 첫 러닝은 제외되는지
- Integration: `formatGoalsForPrompt` 출력에 "이번 주 X km / 목표 Y km" 포함
- Manual: KST 월요일 00:00 직후 프롬프트 확인 (진행률 0%)

### Part B

- Migration: 로컬 psql 로 ALTER 성공 · 재시작 후 prisma generate → typegen 정상
- API: `POST /api/food` 후 DB row `items` JSON 검증
- Bot: `/food` · `/food` (photo) 저장 후 `items` 확인
- Web: 오늘 식단 카드 클릭 → 펼침 → 개별 item 표시
- 하위호환: `items=null` 인 legacy row 는 카드가 지금처럼 표시되고 토글 없음

---

## 제외 사항

- ~~items 별 개별 삭제/편집~~ — 이번 스코프 아님. 카드 단위 삭제만 유지.
- ~~items 별 source (MFDS/AI/Vision) 표시~~ — 후속 이슈. 지금은 log 전체 source 유지.
- ~~MCP `weight-loss` items 노출~~ — 저장까지만.
- ~~주간 목표 미달 시 알림~~ — 후속 (autoAdjust · notifier).
- ~~월간 러닝 목표~~ — 요구 밖.

---

## 참고

- 기존 `src/app/lifestyle/page.tsx:15` `startOfWeek` 는 서버 로컬 TZ 기반 (UTC 서버라면 KST Mon 00:00 과 어긋남). Part A 리팩터 시 이것도 KST 기반으로 통일.
- `M14-phase2-3-macros.md` (P/C/F 도입), `M14-phase2-4-food-db.md` (MFDS estimator) 상의 items 산출 로직 재사용.
- 스크립트: `scripts/test-weekly-boundary.ts` (신규), `scripts/test-food-items-persistence.ts` (신규) 로 실서비스 DB 대신 sqlite/mock 으로 검증.
