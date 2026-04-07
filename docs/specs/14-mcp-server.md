# [Phase 4] MCP 서버 + AI 어드바이저 엔진 + AI 채팅 페이지

## 목적

Claude Code CLI가 피트니스 데이터를 조회할 수 있는 MCP 서버,
AI 어드바이저 엔진, AI 채팅 페이지를 한 번에 구현한다.

## 요구사항

### MCP 서버 (#14)
- [ ] 읽기 전용 MCP 도구 6개
- [ ] esbuild로 standalone CJS 빌드

### AI 어드바이저 엔진 (#15)
- [ ] Claude CLI (`claude -p`) subprocess 래퍼
- [ ] 피트니스 도메인 시스템 프롬프트
- [ ] MCP 설정 파일

### AI 채팅 페이지 (#16)
- [ ] `/ai` 채팅 UI
- [ ] 프리셋 질문 버튼 (#17)
- [ ] API: POST /api/ai

## 기술 설계

### MCP 도구

| 도구 | 설명 | 파라미터 |
|---|---|---|
| get_activities | 최근 활동 목록 | days?, type? |
| get_sleep | 수면 기록 | days? |
| get_heart_rate | 심박/HRV 추세 | days? |
| get_daily_stats | 걸음/칼로리/스트레스/바디배터리 | days? |
| get_body_composition | 체중/체지방 추세 | days? |
| get_trends | 주간/월간 집계 통계 | period (week/month) |

### AI 어드바이저

```typescript
// src/lib/ai/claude-advisor.ts
export async function askAdvisor(prompt: string): Promise<string>
// claude -p --output-format json 으로 subprocess 호출
// MCP config로 피트니스 데이터 접근
```

### 프리셋 템플릿

1. "이번 주 러닝 분석해줘"
2. "수면 패턴 개선 조언 해줘"
3. "심박 트렌드 분석해줘"
4. "컨디션 종합 체크해줘"
5. "다이어트 진행 상황 평가해줘"

## 테스트 계획

- [ ] MCP 서버 빌드 성공
- [ ] AI 채팅 페이지에서 질문 → 응답 확인
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과
