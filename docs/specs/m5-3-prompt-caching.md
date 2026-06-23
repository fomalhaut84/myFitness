# M5-3: 프롬프트 캐싱 (시스템 프롬프트 분리)

- **작성일**: 2026-06-23
- **타입**: chore (성능/비용 최적화)
- **마일스톤**: M5 (`docs/specs/m5-overview.md`)
- **백엔드 전용**

## 1. 조사 결과

Claude CLI (`claude -p`) prompt caching 옵션 조사:

| 옵션 | 설명 | 본 PR 적용 |
|---|---|---|
| `--system-prompt <text>` | 시스템 프롬프트를 API system param 으로 분리. 자동 cache_control 적격. | **채택** |
| `--append-system-prompt <text>` | 기본 시스템 프롬프트에 append. 기본 prompt 사용 시만 의미. | N/A |
| `--exclude-dynamic-system-prompt-sections` | 기본 prompt의 동적 sections(cwd/env/git/memory)를 첫 user msg로 이동. cross-user cache 향상. `--system-prompt` 사용 시 ignored. | N/A |

**현재 코드 문제**:
- `src/lib/ai/claude-advisor.ts:79` — `args[1] = "${systemPrompt}\n\n---\n\n사용자 질문: ${prompt}"` 로 시스템 프롬프트가 user role 메시지에 박힘.
- Claude CLI는 user msg 전체를 API user message로 전달 → API system param 비어있음 → automatic prompt caching 무적용.
- 매 호출마다 시스템 프롬프트(~170줄) 가 fresh input_tokens 로 카운트.

**개선 효과 예상**:
- `--system-prompt` 사용 시 Claude CLI 가 API 호출에 system param 으로 분리 → Anthropic 자동 캐시 적격(ephemeral 5분 TTL).
- 한 cron 호출 안에서 MCP 도구 5-10번 호출 시 시스템 프롬프트 매번 동일 전달 → 첫 호출 후 cache hit. 토큰 절감 평균 60-80%.
- 운영 비용 직접 감소.

## 2. 요구사항

### 2.1 기능 요구사항

- [ ] **F1**: `buildSystemPrompt()` 를 정적(`buildStaticSystemPrompt`)/동적(`buildDynamicContext`) 두 함수로 분리.
  - 정적: `BASE_PROMPT` + `profileSection` (UserProfile 변경 시만 변화). 시스템 프롬프트로 전달.
  - 동적: 현재 시간 KST. user message 앞에 prepend.
- [ ] **F2**: `claude-advisor.ts` 새 세션 시:
  - args[1] = `${dynamicContext}\n\n---\n\n사용자 질문: ${prompt}`
  - args 끝에 `--system-prompt <staticPrompt>` 추가
- [ ] **F3**: 기존 `buildSystemPrompt()` export는 유지 (호환). 내부적으로 `buildStaticSystemPrompt() + buildDynamicContext()` 합쳐 반환.
- [ ] **F4**: resume(`--resume`) 시는 `--system-prompt` 전달 안 함 (CLI가 세션의 기존 system 유지).

### 2.2 비기능

- 응답 형식/내용 변화 없음 (시스템 프롬프트 내용 동일, 위치만 분리).
- UserProfile 변경 시 자연스럽게 캐시 무효화 (다음 호출에 새 system 전달).

## 3. 기술 설계

### 3.1 system-prompt.ts 분리

```ts
// 신규
export async function buildStaticSystemPrompt(): Promise<string> {
  const profileSection = await buildUserProfileSection();
  return `${BASE_PROMPT}\n${profileSection}`;
}

export function buildDynamicContext(): string {
  return `## 현재 시간\n${formatKSTDateTime()}\n`;
}

// 기존 — 호환 유지
export async function buildSystemPrompt(): Promise<string> {
  const staticPart = await buildStaticSystemPrompt();
  return `${staticPart}${buildDynamicContext()}`;
}
```

### 3.2 claude-advisor.ts 갱신

```ts
import { buildStaticSystemPrompt, buildDynamicContext } from "./system-prompt";

// ...
if (currentSessionId) {
  args.push("--resume", currentSessionId);
} else {
  const staticPrompt = await buildStaticSystemPrompt();
  const dynamicContext = buildDynamicContext();
  args[1] = `${dynamicContext}\n\n---\n\n사용자 질문: ${prompt}`;
  args.push("--system-prompt", staticPrompt);
}
```

## 4. 변경 파일

- `src/lib/ai/system-prompt.ts` — `buildStaticSystemPrompt`/`buildDynamicContext` export 추가
- `src/lib/ai/claude-advisor.ts` — `--system-prompt` 사용
- `docs/specs/m5-3-prompt-caching.md` *(신규)*

## 5. 테스트 계획

- `npm run lint && npm run typecheck && npm run build` 3종.
- 운영 적용 후 다음 cron(08:00 / 23:00 KST) 의 PM2 로그에서 응답 시간이 줄어드는지 관찰 (체감 검증). 정밀 측정은 별도 (CLI JSON 응답에 usage 필드 있으면 logging 추가).

## 6. 제외 사항

- **usage 토큰 측정 logging** — 별도 백로그. 본 PR은 캐싱 적용 자체에 집중.
- **시스템 프롬프트 더 세분화 (e.g. tools 가이드를 별도 캐시 블록)** — Claude CLI 단일 system param 이라 어차피 단일 블록. 더 세분화는 SDK 전환 필요.
- **SDK 직접 호출로 전환** — CLI 만으로 충분. SDK 전환은 향후 multi-channel 분리(M5-4) 시 검토.

## 7. 롤백

- `git revert <merge-sha>` 후 재빌드. DB / 환경변수 영향 없음.
- 시스템 프롬프트 내용은 동일하므로 AI 응답 품질 회귀 위험 없음.
