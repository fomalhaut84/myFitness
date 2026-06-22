# Dependabot 보안 패치 2026-06-22 (2차)

- **작성일**: 2026-06-22
- **타입**: chore (security)
- **베이스라인**: v2.2.4 머지 직후 main에 신규 alert 10건 발생

## 1. 알림 요약 (10건)

`gh api repos/.../dependabot/alerts?state=open` 결과:

| # | Severity | 패키지 | 취약 범위 | 패치 | scope | 비고 |
|---|---|---|---|---|---|---|
| 49 | **high** | form-data | `>=4.0.0, <4.0.6` | `4.0.6` | runtime | CRLF injection — multipart field names |
| 48 | medium | dompurify | `<=3.4.10` | `3.4.11` | runtime | `ALLOWED_ATTR` pollution via setConfig |
| 47 | low | dompurify | `<3.4.9` | `3.4.9` | runtime | Trusted Types policy survives clearConfig |
| 46 | medium | dompurify | `<=3.4.6` | `3.4.7` | runtime | IN_PLACE bypass via shadow root + template |
| 45 | medium | dompurify | `<3.4.7` | `3.4.7` | runtime | Hook mutation pollutes DEFAULT_ALLOWED_* |
| 44 | low | dompurify | `<=3.4.6` | **null (unpatched)** | runtime | IN_PLACE: attacker-controlled nodeName |
| 43 | medium | dompurify | `<=3.4.5` | `3.4.6` | runtime | Cross-realm IN_PLACE sanitization |
| 42 | medium | dompurify | `<=3.4.5` | `3.4.6` | runtime | IN_PLACE: clobbered root attributes |
| 41 | low | dompurify | `>=3.0.0, <=3.4.7` | `3.4.8` | runtime | SAFE_FOR_TEMPLATES bypass via template |
| 39 | low | esbuild | `>=0.27.3, <0.28.1` | `0.28.1` | development | Windows dev server arbitrary file read |

## 2. 현재 의존 트리

```
form-data:
  @flow-js/garmin-connect → axios@1.17.0 (overridden) → form-data@4.0.5
  @flow-js/garmin-connect → form-data@4.0.5

esbuild:
  esbuild@0.28.0  (direct devDep — 안전)
  tsx@4.21.0 → esbuild@0.27.7  (취약)

dompurify:
  dompurify@3.4.0  (direct dep, "^3.3.3" 선언)
```

## 3. 사용 패턴 검증 (#44 dismiss 근거)

`grep -r "DOMPurify.sanitize" src/` 결과 4곳, 모두 동일 패턴:

```tsx
DOMPurify.sanitize(marked.parse(content, { async: false }) as string)
```

- 옵션 객체 없이 호출 → 기본값 `IN_PLACE: false`
- 입력이 string이므로 새 fragment를 생성해 sanitize 후 string 반환
- 알림 #44(IN_PLACE 모드의 nodeName trust)는 발동 조건 자체가 성립하지 않음
- → **dismiss 사유: "tolerable_risk" (IN_PLACE 모드 미사용)**

다른 IN_PLACE 관련 알림(#42/43/46)은 `<=3.4.5` ~ `<=3.4.6` 범위라 3.4.11 업그레이드로 자동 해소.

## 4. 수정 계획

### 4.1 package.json

```diff
   "dependencies": {
-    "dompurify": "^3.3.3",
+    "dompurify": "^3.4.11",
     ...
   },
   "devDependencies": {
-    "esbuild": "^0.28.0",
+    "esbuild": "^0.28.1",
     ...
   },
   "overrides": {
     ...
+    "form-data": "^4.0.6",
+    "esbuild": "$esbuild",
+    "@babel/core": "^7.29.6",
+    "js-yaml": "^4.2.0"
   }
```

- esbuild는 direct devDep이라 override 직접 지정 시 EOVERRIDE 발생 → direct 버전을 0.28.1로 올리고 `$esbuild` self-reference로 transitive(`tsx → esbuild@0.27.7`)까지 통일.
- @babel/core, js-yaml은 Dependabot 알림에는 없지만 패키지 트리 갱신 후 `npm audit`이 추가 노출한 항목(둘 다 eslint devDep transitive). 같은 PR에서 함께 해소.

### 4.2 검증

- `npm install` → lockfile 갱신
- `npm ls form-data` → 모두 `4.0.6+` ✅ (4.0.6)
- `npm ls esbuild` → 모두 `0.28.1+` ✅ (0.28.1)
- `npm ls dompurify` → `3.4.11+` ✅ (3.4.11)
- `npm ls @babel/core` → `7.29.6+` ✅ (7.29.7)
- `npm ls js-yaml` → `4.2.0+` ✅ (4.2.0)
- `npm audit` → 0 vulnerabilities ✅
- `npm run lint && npm run typecheck && npm run build` 3종 통과 ✅

### 4.3 Dependabot 측

- alert #44 dismiss with comment ("IN_PLACE 모드 미사용 — 영향 없음")
- 나머지 9건: 패키지 업그레이드로 자동 해소되어 close됨

## 5. 테스트 계획

테스트 인프라 부재(이전 PR과 동일) — `lint/typecheck/build` 3종 + `npm audit 0` 으로 검증.

UI 회귀: dompurify 3.4.0 → 3.4.11은 maintenance patch 시리즈로 sanitize 출력 호환성 변경 없음. 영향 받는 4개 컴포넌트(sleep/ai/activity/reports)는 `marked.parse` → `DOMPurify.sanitize` → `dangerouslySetInnerHTML` 파이프라인 동일하게 작동.

## 6. 제외 사항

- 직접 코드 변경 없음 (package.json + lockfile만)
- DOMPurify 호출부의 옵션 명시(예: 명시적 `IN_PLACE: false`) — 본 PR scope 아님. 기본값이 안전하므로 보강은 후속 task.
- 새 알림 발생 시 별도 사이클로 처리.

## 7. 롤백

- `git revert <merge-sha>` 후 `npm ci` — 환경 변수/DB 영향 없음.
