# [M4-1] 최대심박수/LTHR 저장 및 활용

## 목적

사용자의 실측 최대심박수(maxHR)와 젖산역치 심박수(LTHR)를 저장하여 개인화된 Zone 분석.

## 현재 문제
- `estimatedMaxHR`은 `220 - age` 공식 또는 하드코딩 190 사용
- 실측 maxHR(176)과 큰 차이 → Zone 분류 부정확
- LTHR(157) 없이 템포/역치 구간 분석 불가

## 요구사항

- [ ] UserProfile 스키마 확장
  - `maxHR Int?` — 최대 심박수 (bpm)
  - `lthr Int?` — 젖산역치 심박수 (bpm)
  - `lthrPace Float?` — LTHR 페이스 (sec/km)
  - `targetCalories Int?` — 일일 칼로리 목표
- [ ] 프로필 편집 UI (`/profile` 또는 설정 페이지)
- [ ] HR Zone 계산 로직을 LTHR 기반으로 변경
  - Zone 1: < 80% LTHR (회복)
  - Zone 2: 80-89% LTHR (이지런)
  - Zone 3: 89-94% LTHR (에어로빅)
  - Zone 4: 94-99% LTHR (템포/역치)
  - Zone 5: ≥ 100% LTHR (인터벌/VO2max)
- [ ] 기존 `RunningAnalysis` 컴포넌트에 개인 Zone 적용
- [ ] AI 시스템 프롬프트에 개인 Zone 정보 주입

## 기술 설계

### 스키마 마이그레이션

```prisma
model UserProfile {
  // ... 기존 필드
  maxHR          Int?     // 176
  lthr           Int?     // 157
  lthrPace       Float?   // 321 (5:21/km)
  targetCalories Int?     // 1890
}
```

### Zone 계산 유틸

```typescript
// src/lib/fitness/zones.ts
export function calculateHRZone(hr: number, lthr: number): number {
  const pct = hr / lthr;
  if (pct >= 1.0) return 5;
  if (pct >= 0.94) return 4;
  if (pct >= 0.89) return 3;
  if (pct >= 0.80) return 2;
  return 1;
}
```

### AI 프롬프트 주입

```typescript
// system-prompt.ts
const userZones = await getUserZones();
prompt += `
## 개인 Zone 기준 (실측)
- 최대 심박: ${userZones.maxHR} bpm
- LTHR: ${userZones.lthr} bpm
- Zone 1: <${Math.round(userZones.lthr * 0.80)} bpm
- Zone 2: ${Math.round(userZones.lthr * 0.80)}-${Math.round(userZones.lthr * 0.89)} bpm
...
`;
```

## 테스트 계획
- [ ] `npx prisma migrate dev` 성공
- [ ] 프로필 UI에서 maxHR/LTHR 저장
- [ ] 러닝 분석 페이지에서 개인 Zone 기반 HR 분포 표시
- [ ] AI 리포트에서 "Zone 4 러닝" 등 정확한 분류
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과
