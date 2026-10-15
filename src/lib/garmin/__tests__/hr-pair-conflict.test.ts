// 회귀: #510 (pleiades 수용 리뷰 Codex P2) — 한쪽만 manual 이면 자동 싱크가 LTHR ≤ maxHR 불변식을 우회했다
import { describe, expect, it } from "vitest";
import { findHrPairConflict } from "../profile-values";

const keep = undefined; // 이번 싱크가 쓰지 않는 필드

describe("findHrPairConflict", () => {
  it("수동 maxHR 170 · Garmin LTHR 175 → LTHR 갱신을 보류한다 (정방향)", () => {
    expect(
      findHrPairConflict({
        maxHR: { current: 170, source: "manual", garmin: keep },
        lthr: { current: 160, source: "garmin", garmin: 175 },
      })
    ).toBe("lthr");
  });

  it("수동 LTHR 175 · Garmin maxHR 170 → maxHR 갱신을 보류한다 (역방향)", () => {
    expect(
      findHrPairConflict({
        maxHR: { current: 180, source: "garmin", garmin: 170 },
        lthr: { current: 175, source: "manual", garmin: keep },
      })
    ).toBe("maxHR");
  });

  it("LTHR = maxHR 은 허용 (API 검증과 같은 기준)", () => {
    expect(
      findHrPairConflict({
        maxHR: { current: 170, source: "manual", garmin: keep },
        lthr: { current: 160, source: "garmin", garmin: 170 },
      })
    ).toBeNull();
  });

  it("둘 다 Garmin 이 쓰면 Garmin 값끼리라 보류하지 않는다", () => {
    expect(
      findHrPairConflict({
        maxHR: { current: 180, source: "garmin", garmin: 170 },
        lthr: { current: 160, source: "garmin", garmin: 175 },
      })
    ).toBeNull();
  });

  it("source null 인 필드는 수동 보호가 아니므로 충돌 판정 대상이 아니다", () => {
    expect(
      findHrPairConflict({
        maxHR: { current: 170, source: null, garmin: keep },
        lthr: { current: 160, source: "garmin", garmin: 175 },
      })
    ).toBeNull();
  });

  it("한쪽이 null 이면 비교하지 않는다", () => {
    expect(
      findHrPairConflict({
        maxHR: { current: null, source: null, garmin: keep },
        lthr: { current: null, source: "garmin", garmin: 175 },
      })
    ).toBeNull();
    expect(
      findHrPairConflict({
        maxHR: { current: 170, source: "manual", garmin: keep },
        lthr: { current: 160, source: "garmin", garmin: null },
      })
    ).toBeNull();
  });

  it("역방향: Garmin maxHR 이 비어 있던 값을 수동 LTHR 보다 낮게 채우면 보류", () => {
    expect(
      findHrPairConflict({
        maxHR: { current: null, source: null, garmin: 170 },
        lthr: { current: 175, source: "manual", garmin: keep },
      })
    ).toBe("maxHR");
  });

  it("둘 다 수동이면 싱크가 쓰지 않으므로 보류 대상 없음", () => {
    expect(
      findHrPairConflict({
        maxHR: { current: 170, source: "manual", garmin: keep },
        lthr: { current: 175, source: "manual", garmin: keep },
      })
    ).toBeNull();
  });

  // 회귀: PR #513 Codex P2 — Garmin 이 maxHR 을 비우면 API 와 달리 fallback 과 비교하지 않았다
  it("Garmin 이 maxHR 을 비우면 fallback(나이 기반) 과 비교해 수동 LTHR 보다 낮으면 보류", () => {
    expect(
      findHrPairConflict(
        {
          maxHR: { current: 185, source: "garmin", garmin: null },
          lthr: { current: 178, source: "manual", garmin: keep },
        },
        175
      )
    ).toBe("maxHR");
  });

  it("fallback 이 수동 LTHR 이상이면 비우기를 허용", () => {
    expect(
      findHrPairConflict(
        {
          maxHR: { current: 185, source: "garmin", garmin: null },
          lthr: { current: 170, source: "manual", garmin: keep },
        },
        175
      )
    ).toBeNull();
  });

  it("이번 싱크가 아무것도 쓰지 않으면 기존 상태는 판정하지 않는다", () => {
    expect(
      findHrPairConflict({
        maxHR: { current: 170, source: "manual", garmin: keep },
        lthr: { current: 175, source: "garmin", garmin: keep },
      })
    ).toBeNull();
  });
});
