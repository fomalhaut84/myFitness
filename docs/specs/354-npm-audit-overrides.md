# npm audit 취약점 8건 해소 — overrides 버전 상향

- **작성일**: 2026-09-03
- **타입**: chore
- **이슈**: #354

## 1. 배경

`Security Audit` 워크플로우가 **2026-08-17 이후 모든 실행에서 실패**하고 있다 (main/dev 양쪽, 최소 5회 연속). 워크플로우 버그가 아니라 `Fail workflow if vulnerabilities found` 스텝이 의도대로 동작한 것이다.

```
취약점 요약: Critical=0, High=6, Moderate=1, Total=7
::error::보안 취약점이 발견되었습니다. 이슈를 확인하고 조치하세요.
```

`npm audit` 실행·파싱·이슈 생성(#266)은 모두 정상. 8/17 에 새 advisory 가 공개됐고 이후 조치가 없었다.

### 실질 위험도

취약점 8건 전부 전이 의존성이며, DoS 또는 신뢰할 수 없는 입력을 전제한다. 단일 사용자 + Nginx basic auth + Garmin 은 우리가 요청을 보내는 쪽이라 실질 노출은 낮다. `fast-uri` SSRF 계열도 ajv 의 `format: uri` **검증** 경로라 요청을 발신하지 않는다.

### 그럼에도 고치는 이유

7주째 실패하는 워크플로우는 신호 역할을 못 한다. 현 상태로는 실제로 위험한 advisory 가 떠도 기존 실패와 구분되지 않는다. **CI 를 다시 신호로 되돌리는 것**이 이 작업의 목적이다.

## 2. 목표

`npm audit` 을 0건으로 만들어 `Security Audit` 워크플로우를 통과 상태로 복구한다. breaking change 없이, 런타임 동작 변경 없이 수행한다.

## 3. 취약점 목록

| 패키지 | 심각도 | 유입 경로 | 노출 시점 | 취약 범위 | 현재 |
|---|---|---|---|---|---|
| `fast-uri` | high ×4 | `@modelcontextprotocol/sdk` → ajv | 런타임 (MCP) | 3.0.0 – 3.1.5 | 3.1.5 |
| `qs` | moderate ×2 | `@flow-js/garmin-connect`, express | 런타임 (Garmin) | 2.2.5 – 6.15.3 | 6.15.2 |
| `nanoid` | high | postcss → next | 빌드 | <3.3.18 | 3.3.17 |
| `browserslist` | high ×2 | `@babel/core` | 빌드 | <=4.28.6 | 4.28.2 |
| `deepmerge-ts` | high | `@prisma/config` → prisma | 빌드/CLI | <8.0.0 | 7.1.5 |
| `postcss-selector-parser` | low | tailwindcss | 빌드 | 6.1.0 – 6.1.2 | 6.1.2 |
| `@prisma/config` / `prisma` | high | 직접 의존성 | 빌드/CLI | 6.13.0-dev.1 – 8.1.0-dev.4 | 6.19.3 |

## 4. 요구사항

- [ ] F1: `npm audit` 결과 0건 (critical/high/moderate/low 전부)
- [ ] F2: `package.json` `overrides` 버전 상향으로 해결 — 직접 의존성 major bump 없음
- [ ] F3: `deepmerge-ts` major bump 후 Prisma CLI 정상 동작 검증
- [ ] F4: MCP 서버 스키마 검증 정상 동작 검증 (`fast-uri` 상향 영향)
- [ ] F5: `Security Audit` 워크플로우 통과

## 5. 기술 설계

### 5.1 overrides 상향

이 프로젝트는 이미 `overrides` 로 전이 의존성 취약점을 잡는 패턴을 쓰고 있다 (`qs`, `fast-uri` 포함). 그 override 가 낡아 새 advisory 범위에 다시 걸린 것이므로, 같은 패턴으로 버전만 올린다.

| 패키지 | 현재 override | 변경 | 종류 |
|---|---|---|---|
| `qs` | `^6.15.2` | `^6.16.0` | minor |
| `fast-uri` | `^3.1.2` | `^3.1.7` | patch |
| `browserslist` | (없음) | `^4.28.8` | 신규 |
| `nanoid` | (없음) | `^3.3.18` | 신규 |
| `postcss-selector-parser` | (없음) | `^6.1.4` | 신규 |
| `deepmerge-ts` | (없음) | `^8.0.2` | 신규 (major) |

### 5.2 major bump 회피 근거

**`fast-uri` 는 3.x 계열에 패치본(3.1.7)이 있다.** 최신은 4.1.4 지만 ajv 가 `fast-uri@^3.0.1` 을 요구하므로 4.x override 는 MCP 스키마 검증을 깨뜨릴 수 있다. 3.1.7 로 최소 상향한다.

**`nanoid` 도 3.3.18 로 최소 상향** — 최신 6.0.1 은 postcss 가 요구하는 3.x 범위를 벗어난다.

### 5.3 `prisma` — 패치 릴리즈 부재

`prisma`/`@prisma/config` 의 취약 범위는 `8.1.0-dev.4` 까지인데 npm 최신 stable 이 그 아래다. **고칠 수 있는 prisma 버전이 아직 없다.** 실제 취약점은 `@prisma/config` 가 물고 있는 `deepmerge-ts` (stack exhaustion, GHSA-ggr8-5vv4-36mx) 이므로, `deepmerge-ts` override 로 근본을 끊는다. 이것이 통하면 `prisma`/`@prisma/config` 항목도 함께 해소된다.

`deepmerge-ts` 7.1.5 → 8.0.2 는 major bump 다. `@prisma/config` 가 8.x 를 수용하는지 검증이 필요하며, 실패 시 대안은 §7 참조.

## 6. 변경 파일

| 파일 | 변경 |
|---|---|
| `package.json` | `overrides` 6건 추가/상향 |
| `package-lock.json` | 재생성 |
| `docs/specs/354-npm-audit-overrides.md` | 본 문서 |

## 7. 테스트 계획

```bash
npm audit                       # 0건
npm run lint && npm run typecheck && npm run build
npx prisma generate             # deepmerge-ts major bump 검증
npx prisma migrate status       # @prisma/config 로딩 검증
npm run verify:food-edit-pending
```

MCP 스키마 검증 (`fast-uri` 상향 영향):

```bash
node dist/mcp/server.cjs        # 기동 + tools/list 응답 확인
```

**`deepmerge-ts` 8.x 가 `@prisma/config` 와 호환되지 않을 경우 대안:**

1. `deepmerge-ts` override 를 제외하고 나머지 6건만 해소 → audit 은 prisma 체인 3건이 남음
2. 워크플로우에 해당 advisory 만 예외 처리하고 스펙에 근거·재검토 시점 기록
3. prisma 패치 릴리즈 대기 (upstream 이슈 추적)

## 8. 제외 사항

- 직접 의존성의 major 업그레이드 (`next`, `prisma`, `react` 등) — 별도 작업
- `npm audit fix --force` — breaking change 유발, 사용 금지
- 워크플로우 자체 수정 (임계치 조정 등) — 취약점을 숨기는 방향이라 하지 않음. 단 §7 대안 2 는 예외
