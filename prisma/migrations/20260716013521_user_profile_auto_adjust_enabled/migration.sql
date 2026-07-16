-- M13 Phase 1 (#243): UserProfile.autoAdjustEnabled 필드 추가.
-- 기본 true (auto-adjust 사전 알림 활성). 사용자가 setting UI 에서 off 가능.

ALTER TABLE "UserProfile"
  ADD COLUMN "autoAdjustEnabled" BOOLEAN NOT NULL DEFAULT true;
