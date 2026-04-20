# [Phase 1] Garmin Connect 연동 + 인증

## 목적

Garmin Connect에 인증하고 데이터를 조회할 수 있는 클라이언트 모듈을 구현한다.
토큰 캐싱으로 rate limit(429)을 방지하고, 세션 만료 시 자동 재인증을 처리한다.

## 요구사항

- [ ] `@flow-js/garmin-connect` 패키지 설치
- [ ] Garmin 클라이언트 래퍼 (`src/lib/garmin/client.ts`)
- [ ] OAuth 토큰 캐싱 (파일 기반, 재로그인 최소화)
- [ ] 세션 만료 시 자동 재인증
- [ ] 연결 테스트 스크립트 (`scripts/test-garmin.ts`)
- [ ] 환경변수: GARMIN_EMAIL, GARMIN_PASSWORD

## 기술 설계

### 패키지 선택

`@flow-js/garmin-connect` (v1.6.16+) — 원본 `garmin-connect`의 활발한 포크.
- OAuth1/OAuth2 토큰 캐싱 지원
- TypeScript 타입 내장
- 활발한 유지보수 (최근 업데이트 3일 전)

### 클라이언트 래퍼 설계

```typescript
// src/lib/garmin/client.ts
class GarminClient {
  // 싱글톤 인스턴스
  // 토큰 캐시 경로: .garmin-tokens/
  // login(): 토큰 캐시 로드 시도 → 실패 시 이메일/비밀번호 로그인
  // ensureAuth(): 인증 상태 확인, 만료 시 재인증
  // getClient(): 인증된 GarminConnect 인스턴스 반환
}
```

### 토큰 캐싱 전략

- `exportTokenToFile()` / `loadTokenByFile()`로 OAuth 토큰 파일 저장
- 저장 경로: `.garmin-tokens/` (gitignore에 추가)
- 로그인 성공 시 자동 저장, 다음 실행 시 자동 로드
- 토큰 만료/실패 시 재로그인 후 토큰 갱신

### 에러 처리

- 429 (Rate Limit): 토큰 캐시 사용으로 예방. 발생 시 60초 대기 후 재시도.
- 401 (Auth Failure): 토큰 캐시 삭제 → 이메일/비밀번호로 재로그인.
- 네트워크 오류: 3회 재시도 후 실패.

## 테스트 계획

- [ ] `npx tsx scripts/test-garmin.ts` → 로그인 성공 + 프로필 정보 출력
- [ ] 토큰 캐시 파일 생성 확인 (`.garmin-tokens/`)
- [ ] 2번째 실행 시 캐시된 토큰으로 로그인 (재인증 없이)
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과

## 제외 사항

- 데이터 싱크 로직 (이슈 #4)
- API routes (이슈 #5)
