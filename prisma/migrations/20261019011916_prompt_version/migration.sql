-- #552 (M19-1): 프롬프트 버전 (신규 테이블 1 — 기존 데이터 영향 없음). 첫 행은 앱 시작 시 ensureDefaults 가 코드 기본값으로 넣는다.
-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "basedOnId" TEXT,
    "codeHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptVersion_key_status_idx" ON "PromptVersion"("key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_key_version_key" ON "PromptVersion"("key", "version");


-- 키당 사용 중 (active) 버전 1개 — 활성화 트랜잭션이 이전 active 를 archived 로 바꾼 뒤 새 active 를 둔다 (Prisma 미추적)
CREATE UNIQUE INDEX "PromptVersion_active_unique" ON "PromptVersion"("key") WHERE "status" = 'active';

-- 값 제약 (Prisma 미추적 — memory: source 컬럼 CHECK 패턴). 새 키 · 값은 migration 에서 제약 교체.
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_key_check" CHECK ("key" IN ('system', 'morning_report', 'evening_report', 'weekly_report', 'activity_eval', 'activity_eval_brief'));
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_status_check" CHECK ("status" IN ('draft', 'active', 'archived'));
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_source_check" CHECK ("source" IN ('code_default', 'manual', 'ai_suggestion', 'restore'));
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_version_check" CHECK ("version" >= 1);
-- 사용 중 버전은 활성화 시각 필수 (초안은 null · 보관은 마지막 활성화 시각 유지)
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_activated_check" CHECK ("status" <> 'active' OR "activatedAt" IS NOT NULL);
