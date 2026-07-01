# 트레이닝 플랜 UI — 디자인 결정사항

## 컨셉

**"Coach's Ledger" — Athletic Editorial Dark**

러닝 매거진 스프레드 + 트레이닝 로그북 + 스톱워치 UI 의 결합. 개인 어드바이저지만 "코치가 넘긴 오늘의 노트" 같은 정보 밀도와 손맛을 냄. 일반적인 fitness 앱의 미끈한 카드 UI 를 피하고, **타이포그래피 우선 + 표(tabular) 데이터 강조** 로 정보 위계 명확화.

**차별화 포인트**: 큰 조판된 숫자 (거리·페이스), 섹션 번호 (01/02/03), 시간표 같은 4주 그리드, 트랙 안전색(safety orange) 액센트.

## 톤 & 언어

- 다크 테마 기본 (asphalt/track 표면 연상)
- 한국어 UI, 라벨은 UPPERCASE + tracking (영어 마이크로카피 병용)
- 데이터 정확성 강조 (레이스 결과 리포트 감성)

## 컬러 시스템

| 역할 | HEX | 용도 |
|---|---|---|
| BG | `#0B0B0D` | 페이지 배경 (deep asphalt) |
| Panel | `#151517` | 카드 배경 |
| Panel border | `#26262A` | 카드 테두리 |
| Text hi | `#F0EBE0` | 주요 텍스트 (warm cream) |
| Text mid | `#B4AFA5` | 보조 텍스트 |
| Text lo | `#6B6560` | 마이크로카피 |
| Muted | `#3A3833` | rest / dimmed |
| **Primary accent** | `#FF6B00` | safety orange — 오늘·CTA·경고 |
| Completed | `#8FB65E` | 완료 (moss) |
| Missed | `#8B4A3F` | 누락 (rusted red-brown, 조용) |
| Z1 | `#5A9CE0` | recovery |
| Z2 | `#8FB65E` | easy / long |
| Z3-4 | `#F5B324` | tempo |
| Z5 | `#FF6B00` | interval |

Zone 별 색상은 **강도 그라디언트** (파랑→녹→노랑→오렌지). 사용자가 캘린더에서 한눈에 강도 분포 파악.

## 타이포그래피

| 역할 | 폰트 | 무게 |
|---|---|---|
| Display (숫자/거리/페이스) | **Big Shoulders Display** | 700~900 |
| 섹션 헤더 | **Instrument Serif** | 400 italic |
| 본문 (한글 포함) | **Pretendard** | 400/500/600 |
| 데이터 (표) | **JetBrains Mono** | 400/500 |

- **Big Shoulders**: 육상 트랙 넘버링 폰트 계열의 콘덴스드 sans. 조판된 큰 숫자에 어울림.
- **Instrument Serif**: 매거진 pull-quote 감성. rationale, section 넘버링 옆 라벨.
- **Pretendard**: 한글/영문 겸용 개방 한국 sans. body 안전 선택.
- **JetBrains Mono**: tabular figures 로 페이스/시간/km 정렬.

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
