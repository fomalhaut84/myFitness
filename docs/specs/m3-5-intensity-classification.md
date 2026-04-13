# [M3-5] 운동 강도 자동 분류

## 목적

LTHR 기반으로 각 활동의 HR Zone 분포 및 자동 강도 라벨링을 수행하여,
사용자·AI가 "Zone 4 인터벌", "한계치 런" 등을 해석 없이 바로 인지.

의존: M3-1 (LTHR/maxHR 저장)

## 요구사항

- [ ] Activity 스키마 확장
  - `zoneDistribution Json?` — {z1, z2, z3, z4, z5} 초 단위
  - `estimatedZone Int?` — 대표 Zone (1~5)
  - `intensityScore Float?` — 강도 점수 (0~100)
  - `intensityLabel String?` — "recovery", "easy", "tempo", "threshold", "interval", "max"
- [ ] 계산 로직 `src/lib/fitness/intensity.ts`
- [ ] Activity 싱크 시 자동 계산 (HR 시계열 필요 시 별도 조회)
- [ ] Backfill 스크립트 (기존 활동 재분류)
- [ ] 활동 상세 페이지에 Zone 분포 + 라벨 표시
- [ ] MCP `get_activity` 응답에 포함

## 기술 설계

### Zone 경계 (LTHR 기반)

```
Z1 < 0.81 × LTHR  (recovery)
Z2 0.81–0.89 × LTHR (easy)
Z3 0.90–0.93 × LTHR (tempo)
Z4 0.94–0.99 × LTHR (threshold)
Z5 ≥ 1.00 × LTHR (VO2max/anaerobic)
```

### 계산 헬퍼

```typescript
// src/lib/fitness/intensity.ts
export function computeZoneDistribution(
  hrSeries: number[],
  lthr: number
): Record<"z1"|"z2"|"z3"|"z4"|"z5", number> {
  const boundaries = [0.81, 0.90, 0.94, 1.00].map((r) => r * lthr);
  const dist = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

  for (const hr of hrSeries) {
    if (hr < boundaries[0]) dist.z1++;
    else if (hr < boundaries[1]) dist.z2++;
    else if (hr < boundaries[2]) dist.z3++;
    else if (hr < boundaries[3]) dist.z4++;
    else dist.z5++;
  }
  return dist;
}

export function classifyIntensity(
  dist: Record<"z1"|"z2"|"z3"|"z4"|"z5", number>,
  durationSec: number
): { zone: number; label: string; score: number } {
  const total = Object.values(dist).reduce((s, v) => s + v, 0) || 1;
  const pct = {
    z1: dist.z1 / total,
    z2: dist.z2 / total,
    z3: dist.z3 / total,
    z4: dist.z4 / total,
    z5: dist.z5 / total,
  };

  // 가중 평균 Zone
  const weighted =
    pct.z1 * 1 + pct.z2 * 2 + pct.z3 * 3 + pct.z4 * 4 + pct.z5 * 5;
  const zone = Math.round(weighted);

  // 라벨
  let label = "easy";
  if (pct.z5 > 0.15) label = pct.z4 + pct.z5 > 0.4 ? "interval" : "max";
  else if (pct.z4 > 0.3) label = "threshold";
  else if (pct.z3 > 0.3) label = "tempo";
  else if (pct.z1 > 0.7) label = "recovery";

  // 강도 점수 (TRIMP 유사)
  const score = Math.min(100, weighted * 20);

  return { zone, label, score };
}
```

### HR 시계열 소스

- 우선: Activity.rawData에 HR 시계열이 있는지 확인
- 없으면: Garmin `/activity-service/activity/{id}/details` 조회 후 캐싱

## 테스트 계획

- [ ] 단위 테스트: 알려진 HR 시계열 → Zone 분포 일치
- [ ] 사용자 04-08 한계치 런 → "threshold" 라벨 확인
- [ ] Backfill 스크립트 성공
- [ ] `npm run lint && npx tsc --noEmit && npm run build` 통과

## 제외 사항

- 페이스 Zone (러닝 페이스 기반) — 별도 이슈
- Power Zone (러닝 파워미터 미보유)
