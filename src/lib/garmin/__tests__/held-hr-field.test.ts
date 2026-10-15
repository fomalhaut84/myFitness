// 회귀: #515 (PR #513 Codex 2회차 P2 · 릴리즈 PR #516 동일 지적) — Garmin 이 maxHR 을 비우는 경로의 보류를 프로필 카드가 표시하지 못했다.
// heldField 가 Garmin null 을 undefined (= 이번 싱크가 안 씀) 로 바꾸고 fallback 없이 판정했다
import { describe, expect, it } from "vitest";
import { extractGarminSyncCandidates, heldHrField } from "../profile-values";

describe("extractGarminSyncCandidates — 싱크가 쓸 Garmin 값 (null = 비움 · undefined = 알 수 없음)", () => {
  it("숫자는 그대로", () => {
    expect(extractGarminSyncCandidates({ maxHeartRateUsed: 175, lactateThresholdHeartRateUsed: 155 })).toEqual({
      maxHR: 175,
      lthr: 155,
    });
  });

  it("maxHR 키가 있고 null 이면 Garmin 이 비운 것 → null", () => {
    expect(extractGarminSyncCandidates({ maxHeartRateUsed: null }).maxHR).toBeNull();
  });

  it("maxHR 키가 없거나 형식이 틀리면 알 수 없음 → undefined", () => {
    expect(extractGarminSyncCandidates({}).maxHR).toBeUndefined();
    expect(extractGarminSyncCandidates({ maxHeartRateUsed: "175" }).maxHR).toBeUndefined();
    expect(extractGarminSyncCandidates(null).maxHR).toBeUndefined();
  });

  it("LTHR 이 존에서 null 이면 싱크는 user-settings 로 대체하므로 알 수 없음 → undefined", () => {
    expect(extractGarminSyncCandidates({ lactateThresholdHeartRateUsed: null }).lthr).toBeUndefined();
  });
});

describe("heldHrField — 싱크 판정 (findHrPairConflict) 을 카드에서 재현", () => {
  const base = {
    current: { maxHR: 185, lthr: 178 },
    sources: { maxHR: "garmin", lthr: "manual" },
    fallbackMaxHR: 175,
  };

  it("Garmin 이 maxHR 을 비우고 fallback 이 수동 LTHR 보다 낮으면 maxHR 보류", () => {
    expect(heldHrField({ ...base, candidates: { maxHR: null, lthr: undefined } })).toBe("maxHR");
  });

  it("fallback 이 수동 LTHR 이상이면 보류 없음", () => {
    expect(heldHrField({ ...base, fallbackMaxHR: 190, candidates: { maxHR: null, lthr: undefined } })).toBeNull();
  });

  it("수동 필드의 Garmin 값은 싱크가 쓰지 않으므로 판정에서 뺀다", () => {
    expect(
      heldHrField({
        current: { maxHR: 170, lthr: 160 },
        sources: { maxHR: "manual", lthr: "garmin" },
        fallbackMaxHR: 175,
        candidates: { maxHR: 150, lthr: 175 },
      })
    ).toBe("lthr");
  });
});
