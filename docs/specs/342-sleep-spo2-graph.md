# 야간 SpO2 그래프 (epoch 단위 시계열)

- **작성일**: 2026-08-27
- **타입**: feature
- **이슈**: #342
- **우선순위**: P2

## 1. 배경

#338 조사 중 `SleepRecord.rawData` 에 **epoch 단위 SpO2 원본**이 이미 보존되어 있음을 발견했다. Garmin Connect 앱의 수면 SpO2 그래프와 같은 소스다.

`rawData.wellnessEpochSPO2DataDTOList` — 야간당 **260~463개** 포인트:

```json
{
  "deviceId": 3441128119,
  "spo2Reading": 95,
  "calendarDate": "2026-04-01T00:00:00.0",
  "epochDuration": 60,
  "userProfilePK": 86560194,
  "epochTimestamp": "2026-04-01T14:34:00.0",
  "readingConfidence": 5
}
```

현재는 평균/최저/최고 3개 숫자만 노출된다 (v2.26.2). 최저값이 언제 · 얼마나 오래 · 몇 번 발생했는지는 볼 수 없어, 단발 dip 과 지속적 저산소 구간을 구별할 수 없다.

**추가 싱크 · 스키마 변경 불필요** — 데이터가 이미 DB 에 있다.

### 검증된 사실 (로컬 DB 관측)

- `epochDuration` 은 전 행 **60초 고정**
- epoch 최저값이 `dailySleepDTO.lowestSpO2Value` 와 정확히 일치 (04-01: 둘 다 84) → 그래프와 Stat 카드가 어긋나지 않음
- `readingConfidence` 는 **1~27 범위**로 관측됨. 1~5 척도가 아니며 의미가 문서화되어 있지 않음 (분포: conf=2 가 742건으로 최다, 값이 클수록 희소). **필터링 근거로 쓰지 않는다** — §4.4 참조

## 2. 목표

수면 상세 페이지에서 야간 SpO2 추이를 시계열로 확인할 수 있게 한다. 특히 **최저값이 발생한 시각과 지속 구간**을 읽을 수 있어야 한다.

## 3. 요구사항

- [x] F1: `rawData.wellnessEpochSPO2DataDTOList` 파싱 순수 함수 (`extractSleepSpO2Series`)
- [x] F2: `epochTimestamp` 를 UTC 로 정확히 해석 후 KST 표시
- [x] F3: 수면 상세 페이지에 SpO2 시계열 차트 (Recharts, 기존 차트 컨벤션 준수)
- [x] F4: 최저 지점 시각 강조
- [x] F5: 데이터 없는 야간 (미측정) 은 차트 자체를 렌더하지 않음
- [x] F6: 회귀 테스트 — 파싱 · TZ 해석 · 이상 shape 방어

## 4. 기술 설계

### 4.1 데이터 경로

스키마 변경 없음. `sleep/[date]/page.tsx` (서버 컴포넌트) 가 `record.rawData` 에서 시리즈를 추출해 클라이언트로 전달.

**페이로드 절감**: 원본 element 는 7개 필드 × 최대 463개. 클라이언트에는 `{ t: number, v: number }` 로 축약해 전달 (약 10KB 이하).

### 4.2 시각 해석 (⚠️ 핵심 함정)

`epochTimestamp` 는 `"2026-04-01T14:34:00.0"` — **타임존 접미사가 없는 GMT 문자열**이다.

`new Date("2026-04-01T14:34:00.0")` 은 JS 사양상 이 형식을 **로컬 타임존**으로 해석한다. 서버 TZ 에 따라 결과가 달라지고, KST 서버라면 9시간 밀린다.

→ **반드시 `"Z"` 를 붙여 UTC 로 명시 파싱**한다:
```ts
const ms = Date.parse(`${raw.epochTimestamp}Z`);
```

근거: `sleepMeasurementStartGMT` (`"2026-04-01T14:34:00.0"`) 와 첫 epoch 의 `epochTimestamp` 가 일치하고, 해당 야간의 `sleepStartTimestampGMT` 도 같은 instant 다. 즉 이 필드는 GMT 가 맞다.

이는 memory `project_garmin_api_naive_tz` (weight API 의 naive-TZ) 와 **다른 방향의 함정**이다. weight 쪽은 KST wall-clock 을 UTC 로 표기한 것이었고, 이쪽은 진짜 GMT 인데 표기만 누락된 것이다. 혼동하지 말 것.

정렬 보장도 필요 — API 순서를 신뢰하지 않고 `t` 기준 정렬한다.

### 4.3 차트 설계

기존 컨벤션 (`src/components/sleep/SleepScoreChart.tsx`) 준수:
- `bg-card border border-border rounded-xl p-5` 컨테이너, `text-[11px] text-dim tracking-wider uppercase` 헤더
- Recharts `ResponsiveContainer` + 다크 테마 Tooltip (`#1e1e1e` / `#333333` / `#ededed`)
- 축 `tick={{ fontSize: 9, fill: "#525252" }}`, `axisLine={false} tickLine={false}`

SpO2 고유 사항:
- **Y축 기본 하한 `80`** — `[0, 100]` 이면 실제 변동(83~100)이 하단에 눌려 안 보인다. 80 미만 값이 있으면 `[min-2, 100]` 으로 확장. **하한을 고정하지 않는다** — Recharts 기본 `allowDataOverflow={false}` 가 domain 을 데이터에 맞춰 되늘리므로 고정은 무효이고, `allowDataOverflow={true}` 로 잘라내면 실측 저점이 사라져 Stat 카드와 어긋난다 (Codex P2). 눈금은 `spo2ChartYAxis` 가 하한에 맞춰 생성해 확장 구간이 무라벨로 남지 않게 함
- **X축은 수치 시간축** (`type="number" scale="time"` + `tickFormatter`). 카테고리 축(`HH:mm` 문자열)을 쓰면 살아남은 포인트가 등간격 배치되어 센서 dropout 이 압축된다 — 60분 공백이 1분 간격과 같은 거리로 그려져 "얼마나 오래" 판독을 훼손 (Codex P2)
- **10분 초과 공백은 `v: null` 로 선을 끊는다** (`connectNulls={false}`). 수치 축만으로 간격은 이미 정확하므로, 끊기는 "보간조차 신뢰 불가" 를 뜻하는 별개 신호. 실측상 5~6분 공백은 야간당 2~3회 있는 정상 재측정 주기라 임계 미만
- 90% 기준선 (`ReferenceLine`) — 다만 §4.5 의 해석 주의를 label 로 함께 표기
- 최저 지점에 `ReferenceDot` + 툴팁에 시각 명시

### 4.4 `readingConfidence` 취급

의미가 불명확하고 (1~27, 문서 없음) 저신뢰 구간을 걸러낼 근거가 없다. **필터링·시각적 구분에 사용하지 않는다.** 임의 임계로 데이터를 숨기면 최저값이 그래프에서 사라져 Stat 카드(84)와 그래프가 어긋나는 더 나쁜 문제가 된다.

향후 의미가 확인되면 별도 이슈로 재검토.

### 4.5 해석 주의 (프로젝트 정책 정합)

v2.26.2 에서 확정한 대로, **최저 SpO2 에 절대 임계 경고를 걸지 않는다** (사용자 baseline 83~88). 90% 기준선은 참조용 눈금일 뿐 "이 아래는 위험" 이라는 의미가 아니며, 차트 하단에 그 취지를 한 줄로 명시한다.

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/garmin/sleep-spo2-series.ts` | 신설 — epoch 시리즈 파싱 |
| `src/components/sleep/SpO2TimelineChart.tsx` | 신설 — Recharts 차트 |
| `src/app/sleep/[date]/page.tsx` | 시리즈 추출 후 전달 |
| `src/app/sleep/[date]/sleep-detail-client.tsx` | 차트 렌더 |
| `scripts/test-sleep-spo2-series.ts` | 신설 — 회귀 테스트 |
| `docs/designs/342-sleep-spo2-chart/` | 디자인 시안 + 노트 |

## 6. 테스트 계획

- 실제 shape 파싱 → 포인트 수 · 값 · 정렬
- **TZ**: `"2026-04-01T14:34:00.0"` → `Date.UTC(2026,3,1,14,34)` 와 일치 (서버 TZ 무관)
- epoch 최저값이 `dailySleepDTO.lowestSpO2Value` 와 일치
- 비정렬 입력 → 시각 오름차순 정렬
- 범위 밖 `spo2Reading` (0 / 101) 폐기
- 빈 배열 · 키 부재 · 배열 아님 · null → 빈 시리즈 (크래시 없음)
- 3-check

## 7. 제외 사항

- epoch 데이터의 **DB 컬럼 저장** — `rawData` 로 충분. 별도 테이블/컬럼은 과설계
- 심박 (`sleepHeartRate`) · 수면 단계 (`sleepLevels`) 오버레이 — 별도 이슈 (데이터는 이미 있음)
- 저산소 이벤트 자동 탐지 · 알림 — 별도 이슈
- 여러 날짜 비교 뷰
