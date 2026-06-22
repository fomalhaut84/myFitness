# 마일스톤 5 — AI 어드바이저 강화 + 리포트 개선

- **시작**: 2026-06-22
- **테마**: AI 출력 품질 향상 + 누적된 리포트 데이터에 대한 UX 정합
- **선행 의존**: M2-2 (리포트 시스템), M4-9 (AI 리포트 고도화), M4-11 (Garmin 프로필 자동 싱크)

## 배경

- 모닝/이브닝 리포트가 3개월 이상 누적되면서 `/reports` 페이지가 14건만 보여줘 그 이전 기록 접근 불가. 사용자가 페이지네이션 명시 요청.
- AI 어드바이저는 v0 수준 (Claude CLI `-p` + MCP server + 단일 sessionId). 다음 단계로 가려면 (a) 도구 표현력 확장, (b) 호출 비용 절감, (c) 멀티턴 맥락 안정화 필요.

## 하위 태스크 (4개)

### M5-1: 리포트 페이지 페이지네이션 — 우선순위 ★★★

> 사용자 명시 요청. 누적된 리포트 접근성 회복. 단순/즉시 효과.

**구현**
- `/api/reports` GET — `cursor` (createdAt ISO) + `limit` (default 14, max 50) 파라미터 추가. 응답에 `nextCursor` 포함. 기존 `days`/`date`/`type` 필터 호환 유지(cursor 우선).
- 페이지 — 첫 로드 14건 + 하단 "더 보기" 버튼으로 이어지는 14건. `nextCursor === null` 이면 버튼 숨김.
- 타입 필터 토글(전체/모닝/이브닝/주간) 추가 — 누적 데이터에서 특정 종류만 보기 편하게.
- API 응답 envelope: `{ data: Report[], nextCursor: string | null }` (기존 `{ data }` 호환 유지).

**산출물**
- `src/app/api/reports/route.ts` 수정
- `src/app/reports/page.tsx` 수정 (cursor state + 필터 토글)
- 스펙: `docs/specs/m5-1-reports-pagination.md` (별도)
- 예상 사이즈: 2-3 시간

### M5-2: MCP 도구 확장 — 우선순위 ★★★

> 현재 11개 도구는 "데이터 조회" 위주. AI가 직접 추론하기 어려운 파생 지표(트렌드/회복/예측)를 도구로 노출하면 프롬프트 토큰 절약 + 응답 정확도 향상.

**도구 후보** (세부는 별도 스펙)
- `get_readiness_score` — HRV + 안정시 HR + 수면 점수 + 어제 트레이닝 로드 → 0-100 회복 점수 (오늘 강도 추천 1줄 포함)
- `get_training_load_trend` — 7/14/28일 ACWR(acute:chronic workload ratio), 오버트레이닝/언더트레이닝 위험 라벨
- `get_pace_progression` — 동일 거리 구간(5k/10k) 페이스 추세, baseline 대비 % 변화
- `get_calendar_summary` — N일 데일리 요약(러닝 km, 수면 점수, 칼로리 밸런스) 한 줄씩 N건 일괄 조회

각 도구는 (a) 결정적 계산 (b) DB만 사용 (c) 100~500 토큰 응답 목표.

**산출물**
- `src/mcp/tools/readiness.ts` 등 신규 파일
- `src/mcp/server.ts` 등록
- 스펙: `docs/specs/m5-2-mcp-tools.md` (별도)
- 예상 사이즈: 4-6 시간 (도구 수 / 깊이에 따라)

### M5-3: 프롬프트 캐싱 — 우선순위 ★★

> Claude CLI `-p` 호출마다 시스템 프롬프트(173줄) + MCP 디스크립터 풀세트가 매번 전송. 캐시 활용으로 비용 ~70% 절감 가능.

**구현 옵션 조사**
- Claude CLI가 prompt caching 지원하는지 확인 (`--cache-control` 등 옵션)
- 미지원이면 SDK 호출로 일부 전환 검토 (`@anthropic-ai/sdk` + `cache_control: { type: "ephemeral" }`)
- 또는 시스템 프롬프트의 절반(가이드/규칙 텍스트) 만 캐시, 사용자별 동적 부분(현재 날짜/세션) 은 분리

**산출물**
- `src/lib/ai/claude-advisor.ts` 갱신 (또는 SDK 전환)
- 스펙: `docs/specs/m5-3-prompt-caching.md` (별도, 조사 단계 결과 반영)
- 예상 사이즈: 3-5 시간 (CLI 옵션 여부에 따라 큰 폭)

### M5-4: 멀티턴 컨텍스트 강화 — 우선순위 ★★

> 현재 `currentSessionId` 단일 전역 — 봇/웹 동시 사용 시 컨텍스트 오염, /reset 안 하면 누적 토큰 비대화.

**구현**
- 채널별 sessionId 분리 (web, telegram-bot, cron-morning, cron-evening, cron-weekly)
- 세션 TTL (예: 마지막 호출 후 6시간 무활동 시 자동 reset) + 토큰 한도(예: 100k 누적) 시 자동 reset
- AI 채팅 페이지에서 "새 대화 시작" 버튼 (수동 reset, 기존 `/reset` 텔레그램 커맨드와 통합)

**산출물**
- `src/lib/ai/claude-advisor.ts` — 세션 관리 객체화
- `src/lib/ai/session-store.ts` *(신규)* — 채널별 세션 + TTL/토큰 추적
- `src/app/ai/page.tsx` — 새 대화 버튼
- 스펙: `docs/specs/m5-4-multi-turn.md` (별도)
- 예상 사이즈: 4-6 시간

## 권장 진행 순서

```
M5-1 (페이지네이션) — 빠른 승리, 사용자 명시 1순위
M5-2 (MCP 도구 확장) — AI 품질 직접 영향, 다른 항목의 베이스라인
M5-3 (프롬프트 캐싱) — 비용 절감, 조사 비중 큼
M5-4 (멀티턴 컨텍스트) — 마지막 (세션 관리는 다른 변경 후 안정화하기 좋음)
```

## 제외 사항

- M4-8 (영양소 상세) — M4-3 (식단 데이터) 의존이라 별도 트랙
- 새 Claude 모델 fine-tuning / RAG — scope 초과
- 리포트 검색(전문 검색) — 페이지네이션 후 사용 패턴 보고 결정

## 성공 기준

- M5-1: 리포트 누적 90건 환경에서 페이지네이션 + 타입 필터 정상 동작, 첫 페이지 응답 200ms 이내
- M5-2: 최소 2개 도구 추가, AI 응답에서 실제 사용 확인(MCP 로그)
- M5-3: 평균 호출당 입력 토큰 30% 이상 감소 (또는 CLI 미지원 시 그 사유 + 차선책 채택)
- M5-4: 채널 분리 후 봇/웹 동시 사용 시 컨텍스트 격리 확인, TTL/reset 동작 검증
