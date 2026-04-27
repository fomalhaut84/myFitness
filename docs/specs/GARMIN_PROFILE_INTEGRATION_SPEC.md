Garmin Connect API 통합 스펙

📋 개요

Claude Code가 사용자의 피트니스 프로필 데이터(최대 심박, 젖산역치 등)를 자동으로 DB와 Garmin Connect API에서 읽어올 수 있도록 하는 기능 개발 스펙입니다.

---

1️⃣ 데이터 소스 정의

| 데이터 | 출처 | 특징 |
|--------|------|------|
| 목표 체중 | DB (UserProfile) | 사용자 설정 |
| 최대 심박 (maxHR) | Garmin Connect API | 실측값, 시간 경과시 변함 |
| 젖산역치 (LTHR) | Garmin Connect API | 훈련에 따라 변함 |
| 심박 존 (Zones) | 계산 | maxHR 기반 자동 계산 |
| 러닝 페이스 존 | 계산 | LTHR 기반 자동 계산 |

---

2️⃣ Garmin Connect API 연동 스펙

2-1. API 데이터 조회

필요 데이터:
• maxHeartRate (bpm)
• lastHeartRateZoneCalculatedOn (계산 시점)
• heartRateZones (Garmin이 계산한 기본 존)
• LTHR (Training Load Pro, Premium 기능)

선택 데이터:
• estMaxHeartRate (추정값)
• restingHeartRate (기준 안정시 심박)

2-2. 갱신 주기

• 최대 심박: 월 1회 (큰 변화 아님)
• LTHR: 주 1회 (훈련에 따라 변함)
• 트리거: 명시적 갱신 또는 자동 스케줄

---

3️⃣ DB 스키마 확장

UserProfile 테이블 추가 필드

신규 필드:
• maxHR: Int (최대 심박 - bpm, Garmin에서)
• lthr: Int (젖산역치 심박 - bpm, Garmin에서)
• lthrPace: Float (LTHR 페이스 - sec/km, 계산값)
• garminSyncedAt: DateTime (마지막 동기화 시점)
• heartRateZonesRaw: Json (Garmin이 반환한 원본 존 데이터)

---

4️⃣ 자동 계산 로직

4-1. 심박 존 (Zone 1~5) - maxHR 기반

기준: maxHR = 176 bpm

• Zone 1 (회복): 4-2. 심박 존 (Zone 1~5) - LTHR 기반 (권장)

기준: LTHR = 157 bpm

• Zone 1: 120% LTHR = >188 bpm

4-3. 러닝 페이스 존

기준: LTHR 페이스

• Zone 1 (회복): >8'00"/km
• Zone 2 (이지런): 7'30"~8'00"/km
 Zone 3 (에어로빅): 7'00"~7'30"/km
• Zone 4 (역치): 6'30"~7'00"/km
• Zone 5 (VO2max): 5️⃣ MCP 도구 확장 스펙

신규 도구 1: get_user_profile()

DB와 Garmin에서 동기화된 사용자 프로필 조회

반환값:
• name: string
• targetWeight: number (kg)
• targetCalories: number (kcal)
• maxHR: number (Garmin에서)
• lthr: number (Garmin에서)
• lthrPace: number (sec/km, 계산)
• heartRateZones: 계산된 존 (z1~z5)
• paceZones: 계산된 페이스 존
• garminSyncedAt: Date

신규 도구 2: sync_garmin_profile()

Garmin Connect API에서 프로필 강제 동기화

파라미터:
• forceRefresh?: boolean (캐시 무시하고 강제 갱신)

반환값:
• success: boolean
• syncedAt: Date
• updates: { maxHR?, lthr? }
• message: string

---

6️⃣ 구현 순서

Phase 1: Garmin API 연동

위치: src/lib/garmin/auth.ts
• getGarminAccessToken(): Promise
• refreshGarminToken(): Promise

Phase 2: 프로필 조회 함수

위치: src/lib/garmin/profile.ts
• getGarminProfile(accessToken): Promise

Phase 3: DB 동기화

위치: src/lib/fitness/sync-garmin.ts
• syncUserProfileFromGarmin(userId): Promise

Phase 4: Zone 계산

위치: src/lib/fitness/zones.ts (확장)
• calculateHeartRateZones(maxHR, lthr?): ZoneDistribution
• calculatePaceZones(lthr, lthrPace?): PaceZoneDistribution

Phase 5: MCP 도구 추가

위치: src/mcp/tools/user-profile.ts
• tool_get_user_profile()
• tool_sync_garmin_profile()

Phase 6: API 엔드포인트

• GET /api/profile (확장)
• POST /api/profile/sync-garmin

Phase 7: 자동 동기화 스케줄

위치: src/jobs/sync-garmin-daily.ts
schedule: "0 2   0" (주 1회, 일요일 02:00 KST)
task: syncUserProfileFromGarmin()
---

7️⃣ 사용 흐름 (Claude Code)

Claude Code 시작
  → get_user_profile() 호출
  → DB에서 maxHR, lthr, 계산된 Zone 조회
  → 활동 분석 시 Zone 기준 사용
  → (선택) sync_garmin_profile() 수동 호출
  → Garmin에서 최신 값 동기화
  → DB 업데이트

---

8️⃣ 에러 처리 & 폴백

Garmin API 동기화 실패 시:
• 기존 DB 값 사용
• 추정값 계산 (예: Karvonen formula)
• 사용자 경고 로깅

동기화 실패 원인:
• Garmin API 장애
• 네트워크 오류
• 토큰 만료/갱신 실패
• 사용자 권한 문제

---

9️⃣ 보안 고려사항

1. 토큰 관리
   - .garmin-tokens 디렉토리 권한 제한 (600)
   - 토큰 갱신 실패 시 재인증 요청
   - 토큰 만료 전 자동 갱신

2. API 요청
   - Rate limiting 고려
   - 재시도 로직 (exponential backoff)
   - 타임아웃 설정 (5초)

3. 데이터 검증
   - 수신 데이터 타입 검증
   - 범위 체크 (maxHR: 100-220 bpm)
   - LTHR ≤ maxHR 검증

---

🔟 테스트 계획

Unit Tests:
• calculateHeartRateZones()
• calculatePaceZones()
• syncUserProfileFromGarmin()

Integration Tests:
• Garmin API 연동
• DB 동기화
• MCP 도구 동작

E2E Tests:
• Claude Code에서 get_user_profile() 호출
• 결과가 올바르게 반영되는지 확인

---

1️⃣1️⃣ 마이그레이션 전략

SQL:
ALTER TABLE "UserProfile"
ADD COLUMN "lthr" INTEGER,
ADD COLUMN "lthrPace" FLOAT,
ADD COLUMN "garminSyncedAt" TIMESTAMP,
ADD COLUMN "heartRateZonesRaw" JSONB;
---

1️⃣2️⃣ 참고

• Garmin Connect API 문서: https://developer.garmin.com/
• 기존 Garmin 연동 코드: .garmin-tokens/, src/lib/garmin/
• 기존 Zone 계산 코드: src/lib/fitness/zones.ts