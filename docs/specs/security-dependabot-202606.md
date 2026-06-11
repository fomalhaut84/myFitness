# Security: Dependabot 보안 패치 (2026-06)

## 목적

GitHub Dependabot 알림으로 보고된 npm 패키지 취약점 32건을 모두 해소.
전부 npm 생태계, runtime/transitive 의존성. 비즈니스 로직 변경 없음.

## 영향 패키지 및 패치 타겟

| 패키지 | 현재 | 타겟 (resolved) | 알림 수 | 의존 형태 | 패치 방식 |
|---|---|---|---|---|---|
| `next` | 16.2.4 | `^16.2.6` (resolved **16.2.9**) | 13 (high 7 / med 4 / low 2) | direct | package.json dependency bump |
| `axios` | 1.15.1 | `^1.16.0` (resolved **1.17.0**) | 8 (high 7 / med 1) | transitive (`@flow-js/garmin-connect`) | npm `overrides` |
| `qs` | 6.15.0 | `^6.15.2` (resolved **6.15.2**) | 1 (med) | transitive (`@flow-js/garmin-connect`, `@modelcontextprotocol/sdk` → express) | npm `overrides` |
| `hono` | 4.12.14 | `^4.12.21` (resolved **4.12.25**) | 7 (med 6 / low 1) | transitive (`@modelcontextprotocol/sdk`) | npm `overrides` |
| `eslint-config-next` | 16.2.4 | `^16.2.6` (resolved 16.2.9) | (next와 동기) | devDep | bump |

총 Dependabot open 알림: **29건 → 0건** 목표 (13 + 8 + 1 + 7 = 29).

### Lockfile 부수 효과

`axios 1.15.1 → 1.17.0` 갱신은 `https-proxy-agent@5.0.1`, `agent-base@6.0.2` transitive 의존을 lockfile에
신규 추가한다 (axios 1.17 패치 라인의 정규 의존). 코드/런타임에서 axios 직접 import 없고 사용처는
`@flow-js/garmin-connect` 1곳 한정이라 동작 영향 없음. 기록 목적으로 명시.

## 요구사항

- [ ] `package.json` 직접 의존: `next`, `eslint-config-next` `^16.2.6`로 bump
- [ ] `package.json` `overrides` 추가: `axios ^1.16.0`, `qs ^6.15.2`, `hono ^4.12.21`
- [ ] `npm install`로 lockfile 동기화
- [ ] `npm ls axios qs hono next` 출력에서 모든 인스턴스가 패치 버전 이상
- [ ] `npm run lint && npm run typecheck && npm run build` 통과
- [ ] `gh api ... /dependabot/alerts` 상 open 알림 0건 (자동 종료 확인)
- [ ] codex-cli 코드 리뷰 P1/P2 0건

## 기술 설계

### npm overrides

`@flow-js/garmin-connect`(1.6.16)와 `@modelcontextprotocol/sdk`(1.29.0)는 우리가 제어 못하므로
package.json overrides로 transitive 버전을 강제한다. 모두 minor/patch 범위라 API 호환.

```json
"overrides": {
  "axios": "^1.16.0",
  "qs": "^6.15.2",
  "hono": "^4.12.21"
}
```

### Next.js 16.2.4 → 16.2.6

- 16.2.5: 다수 SSRF/middleware bypass/cache poisoning/XSS 패치
- 16.2.6: segment-prefetch 경로 middleware bypass 후속 패치

App Router를 사용 중이며 middleware 없음. CSP nonce 미사용. 그래도 의존성 자체를 패치된 버전으로
올려 향후 추가 도입 시 안전 확보.

## 테스트 계획

1. `npm install` 후 `npm ls axios qs hono next` 확인
2. `npm run lint && npm run typecheck && npm run build` 통과
3. `npm audit --omit=dev` 출력에서 high/critical 0건 확인
4. dev 서버 부팅 후 `/` 페이지 SSR 정상, `/api/sync` 호출 한 번 정상 확인은 PR 머지 후 실서버에서 수행

## 제외 사항

- 비즈니스 로직 변경 없음
- DB 마이그레이션 없음
- UI 변경 없음
- garmin-connect upstream의 axios 버전 핀(SDK 의존) 변경은 upstream PR 영역으로 별도
