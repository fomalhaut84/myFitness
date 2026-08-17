# /nutrition 디자인 노트 (#299)

## 컨셉 — "Runner's Diagnostic Panel"

기존 앱의 데이터-우선 다크 톤을 유지하되, 매크로 페이지에는 **실험실 계측기** 느낌을 부여.
숫자는 mono 폰트로 계측기처럼, 위험도는 색 하나로 단호하게. MFP 처럼 숫자만 나열하지 않고
러너에게 **행동으로 이어지는 진단** 을 준다.

## 팔레트 (기존 CSS 변수 유지 + 추가)

| 역할 | 값 |
|---|---|
| 배경 / 카드 | `#0a0a0a` / `#161616` (기존) |
| 강조 (안전 / 단백질) | `#22c55e` (기존 --accent) |
| 탄수화물 | `#38bdf8` (신규) — 시원한 시안 |
| 지방 | `#fbbf24` (신규) — 따뜻한 앰버 |
| 경고 medium | `#f59e0b` (앰버) |
| 경고 high | `#dc2626` (레드) |

세 매크로 색은 명도 차이로 도넛 · 리스트 카드 · 트렌드 점 모두에서 즉시 구분 가능.

## 폰트

- 본문: 시스템 sans (Geist 대체 · SF Pro Text)
- **수치 · 라벨 (kcal · g · %): SF Mono / Menlo** — `tabular-nums` 로 자릿수 정렬.
  → 라벨과 데이터의 시각 계층을 명확히 분리 (라벨은 조용, 수치는 강함).

## 정보 계층 (스크롤 순서, 모바일 상단부터)

1. **헤더** — `M14 · 매크로` 소캡션 + `Nutrition` 타이틀. 기간 (7일 창) 우측.
2. **미측정 알림** — 조건부. 잔잔한 앰버 점 + backfill 배지. 압박하지 않음.
3. **근손실 위험 배너** — 조건부. **HIGH 면 대각선 텍스처 + 붉은 링 그림자** 로 강하게 존재감. score / reasons / recommendations 3층. 접기 가능.
4. **매크로 도넛** — 도넛 중앙에 총 kcal 을 계측기 스타일로. 오른쪽 리스트에 g · g/kg · 퍼센트. 7일/오늘 토글.
5. **단백질 트렌드** — 7일 라인. 목표선 (1.6 g/kg) 점선 초록. 미달 일자 점 붉은색 강조. 하단 요약 3칸.
6. **오늘 식단 리스트** — 항목 카드. 시간·mealType 소캡션 + 설명 본문 + P/C/F g 3열. 미측정 항목은 배경 대각 텍스처 + "부분 미측정" 배지.

## 차별화 포인트

- **도넛 센터 계측기** — 총 kcal 을 도넛 안에 크게. "얼마 먹었는지 한 눈"
- **트렌드 점의 색 변화** — 목표 미달 점만 붉게. 시각적 스캔으로 즉시 판단.
- **HIGH 배너의 대각선 텍스처** — CSS `repeating-linear-gradient` 로 노란-검정 위험 스트라이프 대신 subtle 붉은 대각선 (경고지만 요란하지 않음). 미측정 카드도 같은 텍스처로 "확정 안된" 뉘앙스 통일.
- **그리드 라인 배경** — 페이지 전체에 24px 라인 그리드 (opacity 0.02). 실험 기록지 느낌.
- **caret ▸ 권장사항** — 리스트 대신 화살표 캐럿으로 "실행할 것" 강조.

## 반응형

- 프로토타입은 mobile-first (max-w-md). 데스크톱에선 중앙 정렬.
- 도넛 grid: `[minmax(0,180px) 1fr]` — 좁으면 최대 180px 유지, 옆 리스트가 flex.
- 트렌드 차트: `w-full h-[180px]` — height 고정, width 반응.
- 리스트 카드는 세로 스택 — 데스크톱에서도 그대로 (가독성 우선).

## 접근성 · 다크만 지원

- 다크 테마만 (앱 기본). 프로토타입에서도 light 모드 지원 안 함.
- 색맹 대응: 매크로 3색은 명도 차이 (green mid → cyan light → yellow bright). 라벨 · % 도 함께 표시해 색만으로 구분 강요하지 않음.
- 위험 배너는 색+아이콘(pulse dot)+텍스트(HIGH/MEDIUM/LOW)+점수 로 4중 인코딩.

## 구현 매핑

프로토타입 → 실제 컴포넌트:

| 프로토타입 섹션 | React 컴포넌트 (예정) |
|---|---|
| `AppHeader` | `src/app/nutrition/page.tsx` |
| `PartialWarning` | `src/components/nutrition/BackfillNotice.tsx` |
| `RiskBanner` | `src/components/nutrition/MuscleLossBanner.tsx` |
| `MacroDonut` | `src/components/nutrition/MacroDonut.tsx` |
| `ProteinTrend` | `src/components/nutrition/ProteinTrend.tsx` |
| `FoodList` / `FoodItem` | `src/components/nutrition/NutritionFoodList.tsx` (기존 lifestyle 리스트 확장) |

## 열려있는 결정 (구현 단계에서 확정)

- `/nutrition` 상단 nav 진입점 위치 (기존 navigation 컴포넌트 검토 필요)
- 미측정 재추정 버튼 → 실제 backfill API 트리거할지, 안내만 할지
- 도넛 뷰 토글 (7일/오늘) 을 shipping 에 넣을지 (7일만 우선?)
- 트렌드 차트 기간 확장 (14일/30일 옵션)
