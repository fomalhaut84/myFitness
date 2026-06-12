# Security: npm audit 후속 정합 (2026-06)

## 목적

v2.2.2 (#100)에서 Dependabot 알림 29건 일괄 해소 후, `npm audit`이 추가로 보고하는
6건(high 1 / moderate 5)을 마저 해소. Dependabot에는 등록되지 않은 항목으로 devDep 또는
MCP SDK transitive가 대부분이지만 audit 출력을 클린 상태로 유지.

## 영향 패키지 및 패치

| 패키지 | before | after | 심각도 | 의존 형태 | 패치 방식 |
|---|---|---|---|---|---|
| `fast-uri` | 3.1.0 | `^3.1.2` (resolved 3.1.2) | **high** | transitive (`@modelcontextprotocol/sdk` → `ajv`) | overrides |
| `ip-address` | 10.1.0 | `^10.1.1` (resolved 10.2.0) | moderate | transitive (mcp-sdk → `express-rate-limit`) | overrides |
| `brace-expansion@5` | 5.0.5 | `^5.0.6` (resolved 5.0.6) | moderate | **devDep** (typescript-eslint → minimatch@10) | scoped overrides |
| `postcss` (direct) | `^8` (8.5.8) | `^8.5.10` (resolved 8.5.15) | moderate | devDep | direct bump |
| `postcss` (전체 트리) | 8.4.31 (next 번들) | `$postcss` (resolved 8.5.15) | (next via) | overrides |

총 audit 보고: **6건 → 0건** (`npm audit` 출력 클린).

### scoped 오버라이드 주의

`brace-expansion`은 1.x / 2.x / 5.x가 공존: 5.x만 취약(GHSA-jxxr-4gwj-5jf2), 1.x는 영향 없음.
1.x를 강제로 5.x로 올리면 legacy `minimatch@3.x`의 `require('brace-expansion')` 호출이
`TypeError: expand is not a function`으로 깨짐. 따라서 npm overrides의 `pkg@<range>` scoped 문법으로
**5.x만** 5.0.6+로 강제. 1.x는 자연스럽게 1.1.15(최신, 비취약)로 해소됨.

```json
"brace-expansion@5": "^5.0.6"
```

### `$postcss` self-reference

`postcss`는 우리 직접 devDep + next 번들 + tailwindcss 의존이 모두 있는 다중 위치 패키지.
직접 devDep을 `^8.5.10`으로 bump해도 next는 자체적으로 `postcss@8.4.31`을 끌고 옴.
`"postcss": "$postcss"`는 npm overrides의 self-reference 문법으로 "모든 transitive postcss를
직접 의존 resolved 버전과 동일하게 강제" — next 트리 안의 postcss도 8.5.15로 통일.

## 요구사항

- [x] `package.json`:
  - `devDependencies.postcss` `^8` → `^8.5.10`
  - `overrides`에 추가:
    - `fast-uri: ^3.1.2`
    - `ip-address: ^10.1.1`
    - `brace-expansion@5: ^5.0.6` (scoped)
    - `postcss: $postcss`
- [x] `npm install` 후 `npm audit` 0 vulnerabilities
- [x] `npm run lint && typecheck && build` 통과
- [ ] 코드 리뷰 P1/P2 0건

## 테스트 계획

1. `npm install` → `npm audit` "found 0 vulnerabilities" 확인
2. `npm ls brace-expansion` → 5.x만 5.0.6 overridden, 1.x는 1.1.15
3. `npm ls postcss` → 전부 8.5.15
4. lint / typecheck / build 전체 통과
5. 머지 후 main → v2.2.3 패치 릴리즈

## 제외

- 비즈니스 로직 / DB / UI 변경 없음
- 직접 의존 추가 없음 (postcss devDep만 minor 캐럿 조정)
- next 다운그레이드 제안(`audit fix --force` → next@9.3.3) 무시 — postcss override로 동등 효과 + breaking 회피
