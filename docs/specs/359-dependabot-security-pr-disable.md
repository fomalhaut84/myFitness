# Dependabot 자동 보안 PR 비활성화 — 자체 Security Audit 로 일원화

- **작성일**: 2026-09-03
- **타입**: chore
- **이슈**: #359
- **계기**: PR #353 (Dependabot 보안 PR) 이 브랜치 정책 위반 + PR #355 의 부분집합

## 1. 배경

v2.27.2 릴리즈 직후 Dependabot 이 보안 PR #353 을 열었다. 두 가지 문제가 있었다.

### 1-1. 브랜치 정책 위반

#353 의 base 가 `main` 이다. `.claude/rules/workflow.md` 상 hotfix 를 제외한 모든 변경은 `dev` 를 거쳐야 한다. 당시 열려 있던 릴리즈 PR #356 과 같은 파일(`package.json`, `package-lock.json`)을 건드려 충돌 위험도 있었다.

### 1-2. 커버리지가 자체 audit 보다 좁음

| 패키지 | #353 (Dependabot) | #355 (자체 대응) |
|---|---|---|
| `browserslist` | ✅ | ✅ |
| `fast-uri` | ✅ | ✅ |
| `postcss-selector-parser` | ✅ | ✅ |
| `qs` | ✅ | ✅ |
| `nanoid` | ❌ | ✅ |
| `deepmerge-ts` | ❌ | ✅ |

Dependabot 이 놓친 2건이 하필 **high** 였고, `deepmerge-ts` 는 `@prisma/config` → `prisma` 체인 3건을 함께 끌고 있었다. **#353 만 머지했으면 `npm audit` 은 계속 실패했을 것이다.**

## 2. `target-branch` 로는 해결 불가

당초 `.github/dependabot.yml` 에 `target-branch: dev` 를 넣는 안을 검토했으나, [GitHub 공식 문서](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference) 확인 결과 **`target-branch` 는 버전 업데이트에만 적용되고 보안 업데이트는 항상 default branch 를 타겟한다.**

> All pull requests for security updates are created with the chosen assignees, unless `target-branch` defines updates to a non-default branch.

조치 전 상태:

| 항목 | 상태 |
|---|---|
| `.github/dependabot.yml` | **없음** → 버전 업데이트 비활성 |
| `automated-security-fixes` | `enabled: true` → 보안 PR 자동 생성 |
| #353 브랜치 | `dependabot/npm_and_yarn/npm_and_yarn-4273a9cf50` (설정 파일 없이 생성 = 보안 업데이트) |

즉 `dependabot.yml` 을 추가했다면 **#353 같은 PR 은 그대로 main 으로 오면서**, 그때까지 꺼져 있던 버전 업데이트만 새로 켜져 PR 노이즈가 늘었을 것이다.

## 3. 결정

**Dependabot 자동 보안 PR 을 비활성화하고 취약점 대응을 자체 `Security Audit` 워크플로우로 일원화한다.**

취약점 **알림(Dependabot alerts)은 유지**한다 — 끄는 것은 자동 PR 생성뿐이다.

| 수단 | 조치 후 |
|---|---|
| Dependabot 취약점 알림 | 유지 (`vulnerability-alerts` 활성) |
| Dependabot 자동 보안 PR | **비활성화** (`automated-security-fixes` → `enabled: false`) |
| `.github/workflows/security-audit.yml` | 변경 없음 — 주간(월 03:00 UTC) + `package.json`/`package-lock.json` push |

## 4. 대체 수단이 이미 있고 더 낫다

`.github/workflows/security-audit.yml` 은

- 주간 + 의존성 파일 push 마다 실행
- `npm audit` → Critical/High/Moderate 집계
- 취약점 발견 시 **이슈 자동 생성** + 워크플로우 실패로 가시화
- `workflow_dispatch` 로 브랜치에서 머지 전 즉시 검증 가능 (#355 에서 활용)

대응은 `overrides` 로 수동이며, 전이 의존성까지 정확히 통제된다 — #355 가 실증했다.

### 4-1. 선결 조건 — audit 실행 실패를 fail-closed 로 (Codex P2, PR #360)

Dependabot 자동 PR 을 끄면 이 워크플로우가 **유일한 탐지 경로**가 된다. 그런데 기존 파서는 audit *실행 실패* 시 fail-**open** 이었다.

```bash
# 기존 — 죽은 코드
if [ ! -f audit-result.json ]; then ... exit 1; fi
HIGH=$(cat audit-result.json | jq -r '.metadata.vulnerabilities.high // 0' 2>/dev/null || echo "0")
```

`tee` 는 실행이 실패해도 파일을 만들기 때문에 `[ ! -f ]` 분기는 절대 타지 않는다. registry 장애 등으로 `{"error": {...}}` 페이로드가 오면 `// 0` 폴백이 세 카운트를 모두 0 으로 만들어 **워크플로우가 '취약점 없음' 으로 성공하고 이슈도 만들지 않는다.**

존재 여부가 아니라 **내용**을 검증하고, 판정할 수 없으면 실패시키도록 고쳤다.

| 입력 | 기존 | 수정 후 |
|---|---|---|
| 정상 · 취약점 0건 | 성공 | 성공 |
| 정상 · 취약점 N건 | 실패(의도) | 실패(의도) |
| `{"error": {...}}` (registry 장애) | **성공 (오탐)** | 실패 |
| 빈 파일 | **성공 (오탐)** | 실패 |
| JSON 아닌 출력 | **성공 (오탐)** | 실패 |
| `metadata.vulnerabilities` 누락 | **성공 (오탐)** | 실패 |

검증 순서: 파일 비어있지 않음 → 유효 JSON → `.error` 키 없음 → `.metadata.vulnerabilities` 가 객체 → 세 카운트가 정수. 실패 시 `audit-stderr.log` 와 결과 앞부분을 로그에 남긴다. `Upload audit results` 는 `if: always()` 라 아티팩트는 그대로 보존된다.

## 5. 대응 절차

1. `Security Audit` 실패 또는 이슈 자동 생성 → 취약점 확인
2. `npm audit --json` 으로 취약 범위·유입 경로·패치 버전 파악
3. **`package.json` `overrides` 버전 상향**으로 해결. 직접 의존성 major 업그레이드는 별도 판단
   - 같은 major 안의 패치본을 우선한다. 예: `fast-uri` 최신은 4.1.4 지만 ajv 가 `^3.0.1` 을 요구하므로 3.1.7 로 최소 상향
4. 런타임에 닿는 bump 는 실동작 검증 (`prisma generate` / `migrate status`, MCP `tools/list` 등)
5. `gh workflow run "Security Audit" --ref <branch>` 로 머지 전 검증
6. `dev` 로 PR

과거 이력으로 남은 Dependabot 보안 PR 은 close 한다. 자체 audit 이 상위집합이다.

## 6. 검증

| 항목 | 결과 |
|---|---|
| `automated-security-fixes` | `{"enabled": false, "paused": false}` |
| `vulnerability-alerts` | `204 No Content` (활성 유지) |
| PR #353 | close (Dependabot 이 v2.27.3 머지 후 "no longer updatable" 로 자동 정리) |
| audit 파서 fail-closed | 6개 입력 시나리오 검증 — 정상 2건 통과, 실패 4건 exit 1 |

## 7. 제외 사항

- Dependabot 취약점 **알림** 비활성화 — 알림은 유지한다
- `.github/dependabot.yml` 추가 — 보안 PR 을 못 막으면서 버전 업데이트 노이즈만 늘린다. 향후 정기 버전 업데이트가 필요해지면 `target-branch: dev` 와 함께 별도 검토
- 저장소 default branch 변경 — `main` 이 실서비스 브랜치이므로 불가
- **audit 실행 실패 시 이슈 자동 생성** — 현재는 워크플로우 실패(빨간 X + 알림)로만 가시화된다. 다만 이 워크플로우는 2026-08-17~09-03 7주간 실패 상태였는데도 방치됐고, 그 사이 이슈(#266)도 이미 생성돼 있었다. 즉 알림 채널을 늘리는 것이 해법이 아니므로 별도 이슈로 분리한다

## 8. 관련

- #354 / PR #355 — npm audit 취약점 8건 해소 (v2.27.3)
- `docs/specs/security-dependabot-202606.md`, `-2.md` — 이전 Dependabot 대응
