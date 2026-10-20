// #570: 프로필 PATCH — 역치파워 · 강도 기준
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
  recordMetricChange: vi.fn(),
  bump: vi.fn(),
  fill: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    userProfile: { upsert: mocks.upsert },
    $transaction: (fn: (tx: unknown) => unknown) => fn({ userProfile: { update: mocks.update } }),
  },
}));
vi.mock("@/lib/fitness/profile-history", () => ({ recordMetricChange: mocks.recordMetricChange }));
vi.mock("@/lib/fitness/calorie-balance", () => ({ recalculateAllCalorieBalances: vi.fn() }));
vi.mock("@/lib/history/cache", () => ({ bumpHistoryCacheVersion: mocks.bump }));
vi.mock("@/lib/fitness/power-intensity-fill", () => ({ fillMissingPowerIntensity: mocks.fill }));

import { PATCH } from "../route";

const EXISTING = {
  id: "p1",
  maxHR: 190,
  lthr: 170,
  lthrPace: 300,
  birthDate: null,
  restingHRBase: null,
  targetCalories: null,
  thresholdPower: 300,
  thresholdPowerSource: "garmin",
  intensityBasis: "hr",
};

function patch(body: unknown) {
  return PATCH(new Request("http://x/api/profile", { method: "PATCH", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.upsert.mockReset().mockResolvedValue(EXISTING);
  mocks.update.mockReset().mockImplementation(({ data }) => ({ ...EXISTING, ...data }));
  mocks.recordMetricChange.mockReset();
  mocks.bump.mockReset();
  mocks.fill.mockReset().mockResolvedValue({ scanned: 3, filled: 3 });
});

describe("PATCH /api/profile #570", () => {
  it("역치파워 수동 변경 → manual + 이력", async () => {
    const res = await patch({ thresholdPower: 310 });
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ thresholdPower: 310, thresholdPowerSource: "manual" });
    expect(mocks.recordMetricChange.mock.calls[0][0]).toMatchObject({ field: "thresholdPower", oldValue: 300, newValue: 310 });
  });

  // 회귀: PR #573 Codex P2 — 역치파워를 처음 넣어도 과거 러닝 파워 값이 다음 싱크까지 비어 있었다
  it("역치파워 저장 시 비어 있는 과거 파워 값을 바로 채운다 · 실패해도 저장은 성공", async () => {
    await patch({ thresholdPower: 310 });
    expect(mocks.fill).toHaveBeenCalledTimes(1);
    expect(mocks.bump).toHaveBeenCalledTimes(1);
    mocks.fill.mockRejectedValueOnce(new Error("db"));
    expect((await patch({ thresholdPower: 320 })).status).toBe(200);
  });

  it("역치파워를 비우거나 그대로면 채우지 않는다", async () => {
    await patch({ thresholdPower: null });
    await patch({ thresholdPower: 300 });
    expect(mocks.fill).not.toHaveBeenCalled();
  });

  it("같은 값 재전송은 source 를 바꾸지 않는다", async () => {
    await patch({ thresholdPower: 300 });
    expect(mocks.update.mock.calls[0][0].data.thresholdPowerSource).toBeUndefined();
    expect(mocks.recordMetricChange).not.toHaveBeenCalled();
  });

  it("범위 밖 · 정수 아님 → 400", async () => {
    expect((await patch({ thresholdPower: 20 })).status).toBe(400);
    expect((await patch({ thresholdPower: 300.5 })).status).toBe(400);
    expect((await patch({ intensityBasis: "pace" })).status).toBe(400);
  });

  it("되돌리기와 값 변경을 같은 요청에서 → 400", async () => {
    expect((await patch({ thresholdPower: 310, revertToGarmin: ["thresholdPower"] })).status).toBe(400);
  });

  it("되돌리기 → source garmin", async () => {
    mocks.upsert.mockResolvedValue({ ...EXISTING, thresholdPowerSource: "manual" });
    await patch({ revertToGarmin: ["thresholdPower"] });
    expect(mocks.update.mock.calls[0][0].data.thresholdPowerSource).toBe("garmin");
  });

  it("기준 변경은 설정만 저장한다 (강도 값 덮어쓰기 없음)", async () => {
    const res = await patch({ intensityBasis: "auto" });
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ intensityBasis: "auto" });
    expect(mocks.bump).toHaveBeenCalledTimes(1);
  });

  it("기준 그대로면 캐시를 건드리지 않는다", async () => {
    await patch({ intensityBasis: "hr" });
    expect(mocks.bump).not.toHaveBeenCalled();
  });
});
