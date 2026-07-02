# 트레이닝 플랜 UI — 디자인 결정사항

## 컨셉

**"Coach's Ledger" — Athletic Editorial Dark**

러닝 매거진 스프레드 + 트레이닝 로그북 + 스톱워치 UI 의 결합. 개인 어드바이저지만 "코치가 넘긴 오늘의 노트" 같은 정보 밀도와 손맛을 냄. 일반적인 fitness 앱의 미끈한 카드 UI 를 피하고, **타이포그래피 우선 + 표(tabular) 데이터 강조** 로 정보 위계 명확화.

**차별화 포인트**: 큰 조판된 숫자 (거리·페이스), 섹션 번호 (01/02/03), 시간표 같은 4주 그리드, 트랙 안전색(safety orange) 액센트.

## 톤 & 언어

- 다크 테마 기본 (asphalt/track 표면 연상)
- 한국어 UI, 라벨은 UPPERCASE + tracking (영어 마이크로카피 병용)
- 데이터 정확성 강조 (레이스 결과 리포트 감성)

## 컬러 시스템 (가독성 리비전 반영)

| 역할 | HEX | 용도 |
|---|---|---|
| BG | `#0B0B0D` | 페이지 배경 (deep asphalt) |
| Panel | `#161618` | 카드 배경 |
| Panel border | `#2E2E33` | 카드 테두리 |
| Text hi | `#F5F1E8` | 주요 텍스트 (warm cream) |
| Text mid | `#D0CBBE` | 보조 텍스트 (**대비 상향**) |
| Text lo | `#9A9489` | 마이크로카피 (**대비 상향**) |
| Muted | `#3D3B36` | rest / dimmed |
| **Primary accent** | `#FF7A1A` | safety orange (**살짝 밝게**) |
| Completed | `#A5CB6E` | 완료 (moss, **살짝 밝게**) |
| Missed | `#B85E4F` | 누락 (**살짝 밝게**) |
| Z1 | `#6FAFEA` | recovery |
| Z2 | `#A5CB6E` | easy / long |
| Z3-4 | `#F5B324` | tempo |
| Z5 | `#FF7A1A` | interval |

Zone 별 색상은 **강도 그라디언트** (파랑→녹→노랑→오렌지). 사용자가 캘린더에서 한눈에 강도 분포 파악.

## 타이포그래피 (가독성 리비전 반영)

| 역할 | 폰트 | 무게 |
|---|---|---|
| Display (큰 조판된 숫자만) | **Big Shoulders Display** | 800 |
| 섹션 헤더 / 본문 / 라벨 | **Pretendard** | 500/600/700 |
| 데이터 (표) | **JetBrains Mono** | 500/600 |

**리비전 사유**: 초기 시안은 4개 폰트 패밀리 (Big Shoulders + Instrument Serif + Pretendard + JetBrains Mono) 를 혼용 → 시각 노이즈 + Instrument Serif 이탤릭이 rationale/kicker 에 쓰이면서 가독성 저하. 리비전에서:

- **Instrument Serif 제거**: 모든 rationale/kicker/subtitle/footer/archive 링크를 Pretendard 로 통일.
- **Big Shoulders 사용 축소**: 이제 "숫자만" 사용 (점수, 진행률 %, 거리, 섹션 번호). 텍스트 헤더는 Pretendard.
- **micro-label 사이즈 10→11px + tracking 0.14em→0.08em**: 소문자 강제 트래킹의 판독성 문제 완화.
- **rationale 사이즈 18px 이탤릭 세리프 → 16px Pretendard 500**: 이탤릭 세리프 대신 명료한 sans.
- **캘린더 셀 min-height 96→120px**: 정보 4개(타입/거리/페이스/매칭)가 눌리지 않도록 여유 확보. 타입명 폰트도 Big Shoulders 16px → Pretendard 14px 700 로 판독성 상승.

## 레이아웃

**세로 스크롤 세그먼트**:

```
┌────────────────────────────────────────────┐
│ HEADER (site nav + 브랜드 마크)             │
├────────────────────────────────────────────┤
│ 01 · TODAY                                 │
│  [ 큰 카드: base vs rec + rationale ]      │
│  [ 팩터 스트립: readiness | injury | plan ] │
├────────────────────────────────────────────┤
│ 02 · THIS BLOCK                            │
│  [ 진행률 바 ]                              │
│  [ 4주 × 요일 그리드 ]                      │
├────────────────────────────────────────────┤
│ 03 · REGENERATE                            │
│  [ 폼: freq / distance / date ]            │
├────────────────────────────────────────────┤
│ 04 · ARCHIVE                               │
│  [ 최신순 리스트 ]                          │
└────────────────────────────────────────────┘
```

**모바일**: 4주 그리드는 요일 세로 스택 → 주 단위 아코디언. 오늘 카드는 그대로 상단.

## 인터랙션 & 모션

- **Load-in**: 섹션별 staggered fade (100ms delay) — 매거진이 페이지를 펼치는 느낌
- **Grid cell hover**: 아래에서 얇은 오렌지 라인 slide-up + hover 시 실제 activity 정보 노출
- **Progress bar**: 로드 시 0 → 실제 % 로 애니메이션 (700ms ease-out)
- **오늘 셀**: 캘린더에서 오렌지 outline + 미묘한 grain 텍스처 강조

## 정보 위계

1. **Hero (오늘 workout)**: 페이지의 심장. 항상 상단, 가장 큰 타이포.
2. **4주 캘린더**: 자기 위치 확인용. 오늘이 항상 시각적 anchor.
3. **진행률**: 캘린더와 시각적으로 연결된 얇은 바 (호흡).
4. **폼/이력**: 보조. 접힘/펼침 가능한 secondary 섹션.

## 반응형 기준

- **≥1024px**: 4주 × 7일 그리드 데스크톱 뷰. 오늘 카드 옆에 팩터 스트립 columns.
- **768~1023px**: 카드 stacked, 그리드 유지 (셀 크기 축소).
- **<768px**: 팩터 스트립 세로. 4주 그리드는 주별 아코디언.

## 근거

- **왜 다크만?** 사용자가 주로 새벽/야간에 확인 (러너 컨텍스트) + Garmin/Strava 앱과 시각 연속성.
- **왜 safety orange?** 육상 트랙 lane 마킹 + 러닝 커뮤니티 컨벤션 (nike/asics 광고). 파랑/녹 fitness 상투 회피.
- **왜 큰 조판된 숫자?** 러너는 숫자에 강하게 반응 (거리·페이스·시간). 카드 UI 로 숫자를 작게 넣는 것보다 잡지 헤드라인 처럼 크게 넣는 게 심리적 임팩트.
- **왜 섹션 번호?** 정보량이 많은 페이지에서 위계와 리듬을 주는 편집 장치.

## 참조 파일

- `prototype.jsx` — 승인된 React 프로토타입 (Tailwind + inline styles, Next.js drop-in 가능)
