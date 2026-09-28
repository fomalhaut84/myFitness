---
name: security-audit-fix
description: Security Audit 워크플로우 실패 · npm audit 취약점 · Dependabot 알림 대응 절차. "security audit 실패", "취약점 나왔어", "npm audit", "dependabot" 요청 시 사용. overrides 버전 상향으로 해결, 직접 의존성 major 업그레이드는 별도 판단.
---

# 의존성 취약점 대응

**자체 `Security Audit` 워크플로우로 일원화한다. Dependabot 자동 보안 PR 은 사용하지 않는다** (#359, 2026-09-03 비활성화).

| 수단 | 상태 |
|---|---|
| Dependabot 취약점 **알림** | 유지 |
| Dependabot 자동 보안 **PR** | **비활성화** |
| `.github/workflows/security-audit.yml` | 주간(월 03:00 UTC) + `package.json`/`package-lock.json` push 마다 실행 |

### 왜 Dependabot 자동 PR 을 끄는가

1. **브랜치 정책 위반** — 보안 업데이트는 항상 default branch(`main`)를 타겟한다. `target-branch: dev` 는 [버전 업데이트에만 적용](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)되므로 설정으로 막을 수 없다. hotfix 외 main 직접 변경은 금지.
2. **커버리지가 좁다** — PR #353 은 4건만 잡았고 `nanoid`·`deepmerge-ts`(high, `@prisma/config`→`prisma` 체인 3건 견인)를 놓쳤다. 그것만 머지했으면 `npm audit` 은 계속 실패했을 것이다. 자체 대응(PR #355)은 6건 전부 처리해 0건을 달성했다.

### 대응 절차

1. `Security Audit` 실패 또는 이슈 자동 생성 → 취약점 확인
2. `npm audit --json` 으로 취약 범위·유입 경로·패치 버전 파악
3. **`package.json` `overrides` 버전 상향**으로 해결 — 직접 의존성 major 업그레이드는 별도 판단
   - 같은 major 안의 패치본을 우선 (예: `fast-uri` 는 ajv 가 `^3.0.1` 을 요구하므로 4.x 가 아닌 3.1.7)
4. 런타임에 닿는 bump 는 실동작 검증 (`prisma generate` / `migrate status`, MCP `tools/list` 등)
5. `gh workflow run "Security Audit" --ref <branch>` 로 머지 전 검증
6. `dev` 로 PR

Dependabot 보안 PR 이 과거 이력으로 남아 있으면 close 한다. 자체 audit 이 상위집합이다.

