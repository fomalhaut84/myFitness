# [M2-5] 기존 UI에 신규 지표 노출

## 목적

M2-1에서 추출한 SpO2, 스트레스 세부, 호흡수 데이터를 기존 대시보드/심박 페이지에 통합.

## 요구사항

- [ ] 대시보드 요약 카드: SpO2 추가
- [ ] 30일 추세: SpO2 라인 차트
- [ ] 30일 추세: 스트레스 세부 분포 (고/중/저 스택 바 또는 라인)
- [ ] 심박 페이지: 호흡수 30일 추세

## 기술 설계

### 수정 파일
- `src/app/page.tsx` — SpO2 데이터 조회 추가
- `src/app/dashboard-client.tsx` — SpO2 카드 + 추세 차트 추가
- `src/app/heart/page.tsx` — 호흡수 데이터 조회
- `src/app/heart/heart-client.tsx` — 호흡수 추세 차트 추가

## 테스트 계획
- [ ] 대시보드에 SpO2 카드 표시
- [ ] 30일 SpO2/스트레스 추세 차트 표시
- [ ] 심박 페이지에 호흡수 추세 표시
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과
