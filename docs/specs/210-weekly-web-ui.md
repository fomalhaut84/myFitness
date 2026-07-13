# M#210: 주간 리포트 웹 UI (생성/재생성)

- **작성일**: 2026-07-13
- **타입**: feature
- **이슈**: #210

## 1. 배경

현재 웹 리포트 페이지 (`/reports`) 는 모닝/이브닝만 생성/재생성 가능. 주간 리포트는 cron 만 실행하고 웹에서 수동 트리거 불가. 실패 시 사용자 재생성 수단 없음.

## 2. 백엔드 상태

- POST `/api/reports` — `type: "weekly"` 지원 (기존)
- `startWeeklyReportJob({force, reportDate})` — 이미 구현 (기존)
- SSE `/api/reports/stream?jobId` — job 종류 무관 (기존)
- 유일한 제약: reportDate 명시가 morning/evening 만 허용 → weekly 도 허용하도록 확장

## 3. 요구사항

- [x] **F1**: 리포트 페이지 "주간 생성" 버튼 (모닝/이브닝 옆)
- [x] **F2**: `canRegenerate` 조건에 `weekly_report` 포함
- [x] **F3**: `POST /api/reports` — weekly 도 reportDate 명시 허용 (재생성용)
- [x] **F4**: mount scan candidates 는 이미 `weekly_report` (오늘) 포함 — 변경 없음

## 4. 변경 파일

- `src/app/reports/reports-client.tsx` — 버튼 + canRegenerate
- `src/app/api/reports/route.ts` — weekly reportDate 허용
- `docs/specs/210-weekly-web-ui.md` (본 문서)

## 5. 검증 (배포 후)

- "주간 생성" 버튼 → jobId → SSE 완료 → 리포트 카드 표시
- 주간 리포트 카드의 "재생성" 버튼 클릭 → 새 job → 완료
- 페이지 이탈 후 재방문 → 진행중 job 있으면 SSE 재개 (weekly 포함)

## 6. 제외

- Weekly 는 매주 한 번 생성이라 캘린더/과거 조회 UI 는 불필요
- 이슈 C (/ai 커맨드 저장) 는 별도

## 7. 참고

- 이슈 #191 (리포트 job + SSE) — 인프라
- 이슈 #203 (v2.9.2) — Weekly 백엔드 안정화
