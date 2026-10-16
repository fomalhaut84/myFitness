# [feat] 복약정보 — 처방약 · 영양제 · 장기/단기 복용 기간 · 검진 추이 연결

- **작성일**: 2026-10-16
- **타입**: feat
- **이슈**: #544
- **브랜치**: `feat/544-1` (dev → dev)
- **마일스톤**: M18 건강 기록 (검진 · 복약) — 3/4
- **선행**: #527 (검진 이력 · 항목 카탈로그 · 항목 추이) · #532 (결과지 가져오기)
- **개인정보**: 저장소 public. **실제 복용 약 · 영양제 이름 · 용량 · 기간 · 목적은 이 문서 · 이슈 · 코드 · fixture · 커밋 어디에도 옮기지 않는다.** 아래 예시는 전부 가상 (실재 제품명을 쓰지 않는다).

## 1. 배경

검진 수치 변화는 그 사이에 먹은 약 · 영양제와 함께 봐야 해석된다 (예: 지질 약 시작 뒤 LDL 변화, 검진 직전 항생제와 간 수치). 무엇을 언제부터 언제까지 먹었는지 기록하고, 검진 항목 추이에서 그 기간을 보이게 한다. M18-4 에서 AI 어드바이저 맥락으로 쓴다.

## 2. 결정 (2026-10-16 사용자 승인)

1. **범위**: 처방약 + 영양제. **목록 · 기간 관리만** — 매일 복용 체크는 하지 않는다.
2. **복용 형태 구분** (사용자 제안): `long_term` 장기 복용 (혈압약 · 매일 먹는 영양제 — 종료일 없음 = 복용 중) / `short_term` 단기 복용 (감기약 · 항생제 — **종료일 필수**, 폼에서 "N일분" → 시작일 + N − 1). 필요 시 오래 먹는 약은 장기 + 횟수 "필요 시".
3. **한 행 = 한 복용 기간**. 끊었다 다시 먹으면 새 행 ("다시 시작" 으로 복사). 기간 계산이 단순하고 이력이 남는다.
4. **검진 연결**: 장기 복용은 사용자가 지정한 **관련 검진 항목** 기준으로, 단기 복용은 관련 항목 지정과 무관하게 **검진일 앞 14일 안에 먹었으면** 항목 추이 이력 표에 배지. 차트 음영은 하지 않는다 (x 축이 회차 순서라 기간을 정확히 그릴 수 없다).
5. 입력 기본값: 처방약 → 단기, 영양제 → 장기 (바꿀 수 있다).
6. 화면은 `/medical` 안 **검진 · 복약 탭**. 사이드바 "건강 기록" 그대로.

## 3. 요구사항

### 스키마 (migration 1 · 수동 SQL 경로 — `prisma-drift-fix`)
- [ ] S1 `Medication`
  - `id` · `name String` (약 · 제품명) · `kind String` (`prescription` | `supplement` · CHECK) · `regimen String` (`long_term` | `short_term` · CHECK)
  - `ingredient String?` (성분 — 같은 성분 제품 묶기) · `dose String?` · `frequency String?` (원문 그대로)
  - `startDate DateTime` (KST 자정 instant) · `endDate DateTime?` (null = 복용 중)
  - `purpose String?` · `prescriber String?` · `note String?`
  - `relatedItems String[]` (검진 항목 code — 카탈로그 또는 `custom:`)
  - `createdAt` · `updatedAt` · `@@index([startDate])`
  - CHECK: `endDate IS NULL OR endDate >= startDate` · `regimen <> 'short_term' OR endDate IS NOT NULL`

### 로직 (순수 · `src/lib/medication/`)
- [ ] L1 zod 입력 검증 — 날짜 `YYYY-MM-DD` · 종료 ≥ 시작 · 단기는 종료일 필수 · 미래 시작일 거부 · 문자열 길이 · `relatedItems` ≤ 20 · 항목 code 형식 (카탈로그 또는 `custom:`)
- [ ] L2 `endFromDays(start, days)` — "N일분" → 시작일 + N − 1 (1 ≤ N ≤ 365)
- [ ] L3 `medicationStatus(med, today)` — `active` (시작 ≤ 오늘 · 종료 없음 또는 ≥ 오늘) / `ended` / `scheduled` (시작이 오늘 뒤 — 입력은 막지만 표시 방어)
- [ ] L4 `medsForCheckup(meds, itemCode, checkupDate)` — 장기: `relatedItems` 에 itemCode 가 있고 검진일이 기간 안 / 단기: 기간이 [검진일 − 14, 검진일] 과 겹침 (관련 항목 무관)
- [ ] L5 `medsForItem(meds, itemCode)` — 항목 추이 다이얼로그 목록 (관련 항목 지정한 약 · 기간 순)
- [ ] L6 타임라인 좌표 — 연 단위 축 · 장기 막대 (복용 중은 오늘까지) · 단기 점 · 검진 회차 점

### API (`src/app/api/medications/`)
- [ ] A1 `GET /api/medications` (전체 · 시작일 내림차순) · `POST`
- [ ] A2 `PUT` · `DELETE /api/medications/[id]` · `POST /api/medications/[id]/end` (오늘 종료 · 이미 종료 · 오늘 이전 시작만)
- [ ] A3 `GET /api/checkups/items/[code]` 응답에 `medications` (L4 · L5 결과) 추가
- [ ] A4 try-catch + `{ error }` · 로그에 약 이름 · 용량 등 입력값을 남기지 않는다 (검진 `describeError` 원칙)

### 화면
- [ ] U1 `/medical` 상단 탭 **검진 · 복약** (`?tab=meds`) — 검진 탭은 지금 화면 그대로
- [ ] U2 복약 탭: **복용 중** (장기 · 진행 중 단기) 카드 → **타임라인** (연 단위 · 장기 막대 · 단기 점 · 검진 회차 점) → **지난 복약** (연도별 · 단기는 간단한 줄)
- [ ] U3 추가 · 수정 폼 (`/medical/meds/new` · `/medical/meds/[id]/edit`): 종류 · 복용 형태 (종류에 따라 기본값) · 이름 · 성분 · 용량 · 횟수 · 시작일 · 종료일 또는 "N일분" (단기) · 목적 · 처방처 · 메모 · 관련 검진 항목 (카탈로그 검색 select · 여러 개)
- [ ] U4 카드 동작: **복용 종료 (오늘)** · **다시 시작** (복사해 새 행 · 시작일 오늘) · 수정 · 삭제 (2단계 버튼)
- [ ] U5 항목 추이 다이얼로그: 차트 아래 "관련 복약" 목록 (기간 · 복용 중 표시) + 이력 표 검진일마다 그때 먹던 약 배지 (L4)
- [ ] U6 다크 테마 · 모바일 반응형

### 테스트 (vitest · **가상 값만**)
- [ ] T1 zod — 단기 종료일 필수 · 종료 < 시작 · 미래 시작 · 항목 code 형식 · 길이
- [ ] T2 `endFromDays` — 1일 · 월말 · 범위 밖
- [ ] T3 `medicationStatus` — 경계 (종료일 = 오늘)
- [ ] T4 `medsForCheckup` — 장기 관련 항목 일치/불일치 · 기간 밖 · 단기 14일 경계 (−14 · −15 · 당일 · 검진 뒤 시작)
- [ ] T5 타임라인 좌표 — 복용 중 막대가 오늘까지 · 축 범위

## 4. 기술 설계 메모
- 날짜는 `parseDateOnlyKST` / `ymdKST` (검진과 같은 규칙).
- `relatedItems` 는 code 만 저장 — 라벨은 카탈로그 (`getCheckupItem`) 또는 검진 결과의 원문 이름에서.
- 항목 추이 API 는 이미 있는 `getItemTrend` 에 약 조회를 붙인다 (한 요청).
- 사이드바 · 기존 검진 화면은 탭 추가 외 변경 없음.

## 5. 디자인
UI 기능 → workflow 4단계. 복약 탭 (복용 중 · 타임라인 · 지난 복약) · 폼 · 항목 추이 연결 시안 → `docs/designs/544-medication/`. 시안 데이터는 가상 (실재 제품명 금지).

## 6. 제외
- 처방전 · 약봉투 사진 추출 · 매일 복용 체크 · 복용 알림
- 약물 상호작용 · 의료 해석
- 텔레그램 봇 입력
- AI · MCP 연동 (M18-4)
