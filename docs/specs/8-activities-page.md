# [Phase 2] 러닝 활동 페이지

## 목적

활동 목록과 개별 활동 상세를 볼 수 있는 페이지 구현.
러닝 중심으로 페이스, HR존, 거리 등의 데이터를 시각화.

## 요구사항

- [ ] 활동 목록 페이지 (`/activities`)
  - 최근 활동 리스트 (20건 기본, 더보기)
  - 활동 타입 필터 (전체/러닝/근력/기타)
  - 각 항목: 이름, 날짜, 거리, 시간, 페이스, 평균HR
- [ ] 활동 상세 페이지 (`/activities/[id]`)
  - 핵심 지표 카드: 거리, 시간, 페이스, 칼로리, 평균/최대HR, 고도, 트레이닝 이펙트
  - 월간 러닝 요약 (이번 달 총 거리, 횟수, 평균 페이스)
- [ ] API: GET /api/activities, GET /api/activities/[id]

## 기술 설계

### API

```
GET /api/activities?type=running&limit=20&offset=0
GET /api/activities/:id
```

### 컴포넌트 구조

```
src/components/activity/
├── ActivityList.tsx      # 활동 목록
├── ActivityCard.tsx      # 목록 내 개별 항목
├── ActivityDetail.tsx    # 상세 지표 카드들
└── MonthlyRunSummary.tsx # 월간 러닝 요약
```

### 포맷 규칙

- 거리: km (소수점 2자리)
- 페이스: min'sec"/km
- 시간: Xh Xm 또는 Xm Xs
- HR: bpm (정수)
- 고도: m (정수)
- 트레이닝 이펙트: 1.0~5.0 (소수점 1자리)

## 테스트 계획

- [ ] 활동 목록 페이지 정상 표시
- [ ] 활동 상세 페이지 정상 표시
- [ ] 타입 필터 동작
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과
