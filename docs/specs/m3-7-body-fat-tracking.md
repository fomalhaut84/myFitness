# [M3-7] 체지방률 트래킹

## 목적

Garmin은 스마트 스케일 연동 없으면 체지방률을 제공하지 않음. 수동 입력 UI 제공.

## 요구사항

- [ ] 체중 페이지(`/body` 또는 `/weight-loss`)에 체지방률 수동 입력 모달
- [ ] BodyComposition.bodyFat 수동 입력 허용 (이미 필드 존재)
- [ ] 입력 소스 구분: `source: "garmin" | "manual"` 필드 추가
- [ ] 체지방률 추세 차트 (신규)
- [ ] 스마트 스케일 연동 조사 (선택, Garmin Index S2 등)

## 기술 설계

### 스키마 확장

```prisma
model BodyComposition {
  // 기존 필드
  source String @default("garmin") // "garmin" | "manual"
}
```

### 입력 UI

```
[체성분 기록] 버튼 → 모달
  - 날짜 (기본: 오늘)
  - 체중 (kg) — Garmin 데이터가 있으면 기본값
  - 체지방률 (%)
  - 근육량 (kg, 선택)
  - 저장
```

수동 입력 시 같은 날짜 기록이 있으면 upsert하되 source="manual"로 마킹.
Garmin 싱크 시 source="manual" 레코드는 덮어쓰지 않음.

## 테스트 계획

- [ ] 수동 입력 후 Garmin 싱크 → 데이터 유지 확인
- [ ] 체지방률 추세 차트 렌더링
- [ ] `npm run lint && npx tsc --noEmit && npm run build` 통과
