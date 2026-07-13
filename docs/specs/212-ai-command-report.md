# M#212: /ai 커맨드 리포트 감지 + DB 저장

- **작성일**: 2026-07-13
- **타입**: feature
- **이슈**: #212

## 1. 배경

`/ai` 커맨드는 텍스트를 그대로 `askAdvisor` 로 넘겨 응답만 반환. `/ai 모닝 리포트 만들어줘` 같은 요청 시 DB 저장 없이 텍스트만.

사용자 요청: `/ai` 로 리포트 요청 시 감지 → 해당 `generateXReport` 호출 → DB 저장 + 텔레그램 응답.

## 2. 감지 로직

`parseReportRequest(text)`:
- 키워드 "리포트" 또는 "report" 필수 (자연 질문과 구분)
- 매칭:
  - `모닝` / `아침` / `morning` → morning
  - `이브닝` / `저녁` / `evening` → evening
  - `주간` / `이번주` / `weekly` → weekly
- 매칭 없으면 null → 기존 `askAdvisor` 흐름 유지

### 파싱 검증 (로컬)

```
"모닝 리포트 만들어줘"           → morning
"이브닝 리포트 생성"              → evening
"주간 리포트 만들어줘"            → weekly
"주간 리포트 다시 만들어"         → weekly
"이브닝 리포트 뽑아줘"            → evening
"generate morning report"        → morning
"이번 주 러닝 분석해줘"           → null (자연 질문)
"모닝 리포트 확인 부탁해"         → null (정중어만 있고 창조 동사 없음)
"morning report please explain"  → null (설명 요청)
"아침 리포트 부탁"                → null (창조 동사 명시 필요)
```

**주의**: 정중어 (`부탁`/`please`/`요청`) 는 진단/질문형에도 흔히 등장하므로
create intent 로 간주하지 않음. 리포트 생성 원할 시 **`만들어`/`생성`/`뽑아`/
`generate`** 등 명시적 동사 필요.

## 3. 흐름

1. `/ai <question>` → `handleAiQuestion`
2. `parseReportRequest(question)` 실행
3. 매칭 결과:
   - `null` → 기존 `askAdvisor` 흐름 (자연 질문)
   - `morning/evening/weekly` → `generateXReport(force=true)` 호출
     - force=true 이유: /ai 로 명시 요청은 항상 새로 생성
     - 기존 record 는 `$transaction([deleteMany, create])` 로 upsert-like
4. 결과 텍스트 텔레그램 전송 + "✅ X 리포트 저장 완료" 확인 메시지

## 4. 변경 파일

- `src/bot/commands/ai.ts` — parseReportRequest + 분기
- `docs/specs/212-ai-command-report.md` (본 문서)

## 5. 검증 (배포 후)

- `/ai 모닝 리포트 만들어줘` → DB update + 텔레그램 답변
- `/ai 이번 주 러닝 분석해줘` → 기존 흐름 (askAdvisor, DB 저장 X)
- 이미 오늘 리포트 있는 상태에서 재요청 → 새로 생성 후 update
- 웹 리포트 페이지 refresh → 새 리포트 반영 확인

## 6. 제외

- 커스텀 reportDate 지정 (오늘만)
- 주간 리포트의 특정 주 지정
- `/report` 별도 커맨드 (자연어 감지 방식 채택)
