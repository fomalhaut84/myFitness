---
name: prisma-drift-fix
description: Prisma migrate dev 가 drift 감지로 실패할 때 (예 "We need to reset the public schema", data loss 위험) 수동 SQL migration 절차. schema.prisma 편집 → migration 파일 수동 작성 → psql -f apply → _prisma_migrations INSERT → npx prisma generate. `prisma migrate reset` 절대 금지 (data loss). 스키마 변경, 새 필드 추가, 인덱스/DEFAULT 조정 시 사용.
---

# Prisma Drift Fix

Prisma migration 이 drift 로 실패할 때 안전한 수동 SQL 경로.

## 언제 사용

- `npx prisma migrate dev --name <n>` 실행 시 "reset the public schema" 요구
- 이전 migration 이 수동 편집됨 (예: DEFAULT / INDEX / trigger 추가) → Prisma 이 이를 drift 로 감지
- 로컬 dev DB 만 문제. 프로덕션은 `prisma migrate deploy` 로 안전 (drift 검사 안 함)

## 절대 금지

- `prisma migrate reset` — data loss
- `prisma db push --accept-data-loss` — 위험

## 절차

### Step 1: schema.prisma 편집

원하는 변경 반영 (필드 추가/삭제/변경).

**Nullable 우선**: 기존 record 안전. `NOT NULL` 필드는 반드시 `DEFAULT` 명시.

### Step 2: Migration 파일 수동 작성

```bash
TS=$(date -u +"%Y%m%d%H%M%S")
mkdir -p prisma/migrations/${TS}_<name>
cat >prisma/migrations/${TS}_<name>/migration.sql <<'EOF'
-- <설명> (#<issue>)
-- <변경 이유>

ALTER TABLE "..." ADD COLUMN "..." ...;
CREATE INDEX ...;
EOF
```

패턴 예시:

```sql
-- 새 nullable 컬럼 추가 (안전)
ALTER TABLE "UserProfile"
  ADD COLUMN "targetAvgPace" DOUBLE PRECISION;

-- NOT NULL + DEFAULT 로 기존 row 백필
ALTER TABLE "ReportJob"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Partial unique index
CREATE UNIQUE INDEX "ReportJob_active_unique"
  ON "ReportJob"("category", "reportDate")
  WHERE status IN ('pending', 'running');

-- 기존 인덱스 drop 후 재생성
DROP INDEX "OldIndex_idx";
CREATE INDEX "NewIndex_idx" ON "Table"("newField");
```

### Step 3: 로컬 apply

```bash
psql -d myfitness -f prisma/migrations/${TS}_<name>/migration.sql
```

에러 확인. 실패 시 SQL 재작성.

### Step 4: `_prisma_migrations` 기록

Prisma 이 이 migration 을 "적용됨" 으로 인식하도록:

```bash
psql -d myfitness -c "
INSERT INTO _prisma_migrations
  (id, checksum, migration_name, started_at, applied_steps_count, finished_at)
VALUES
  ('${TS}_<slug>', 'manual', '${TS}_<name>', NOW(), 1, NOW())
ON CONFLICT DO NOTHING;
"
```

### Step 5: Client 갱신

```bash
npx prisma generate
```

`src/generated/prisma/*` 갱신 확인.

### Step 6: 검증

```bash
npm run typecheck
```

새 필드가 타입에 반영됐는지.

## 프로덕션 배포

`deploy/deploy.sh` 4단계에서 `npx prisma migrate deploy` 실행. 이 명령은 drift 검사 없이 pending migration 만 적용 → 로컬 수동 SQL 경로가 프로덕션에서는 자동.

**주의**: SQL 문법 에러가 있으면 프로덕션에서 실패. 로컬에서 반드시 apply 성공 확인.

## 실제 사례 (M12 #223)

```bash
# schema.prisma 에 UserProfile +4 nullable 필드 추가
# npx prisma migrate dev --name m12_personal_goals → drift 감지

# 수동 SQL 로 우회:
mkdir -p prisma/migrations/20260714020738_m12_personal_goals
cat >prisma/migrations/20260714020738_m12_personal_goals/migration.sql <<'EOF'
-- M12 (#223): 개인 목표 필드 (4 nullable)
ALTER TABLE "UserProfile"
  ADD COLUMN "targetAvgPace" DOUBLE PRECISION,
  ADD COLUMN "targetWeeklyKm" DOUBLE PRECISION,
  ADD COLUMN "targetVO2max" DOUBLE PRECISION,
  ADD COLUMN "personalGoalNote" TEXT;
EOF

psql -d myfitness -f prisma/migrations/20260714020738_m12_personal_goals/migration.sql
psql -d myfitness -c "INSERT INTO _prisma_migrations ... ON CONFLICT DO NOTHING;"
npx prisma generate
```

## 커밋

Migration 파일 + schema.prisma 함께 커밋. 별도 커밋 안 함.

## Rollback (극한 상황)

이미 적용된 migration 롤백은 어렵다. 예방이 최선.
- Down migration SQL 을 미리 작성 (`down.sql`)
- 프로덕션 배포 전 스테이징에서 검증
- Migration 은 additive-only (컬럼 추가 O, 삭제 X → nullable 후 추후 drop)
