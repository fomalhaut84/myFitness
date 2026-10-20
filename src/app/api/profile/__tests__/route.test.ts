// #570: 프로필 PATCH — 역치파워 · 강도 기준 · 재계산
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
  recordMetricChange: vi.fn(),
  recomputeAllIntensity: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    userProfile: { upsert: mocks.upsert },
    $transaction: (fn: (tx: unknown) => unknown) => fn({ userProfile: { update: mocks.update } }),
  },
}));
vi.mock("@/lib/fitness/profile-history", () => ({ recordMetricChange: mocks.recordMetricChange }));
vi.mock("@/lib/fitness/recompute-intensity", () => ({ recomputeAllIntensity: mocks.recomputeAllIntensity }));
vi.mock("@/lib/fitness/calorie-balance", () => ({ recalculateAllCalorieBalances: vi.fn() }));

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
  mocks.recomputeAllIntensity.mockReset().mockResolvedValue({ total: 10, updated: 4 });
});

describe("PATCH /api/profile #570", () => {
  it("역치파워 수동 변경 → manual + 이력", async () => {
    const res = await patch({ thresholdPower: 310 });
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ thresholdPower: 310, thresholdPowerSource: "manual" });
    expect(mocks.recordMetricChange.mock.calls[0][0]).toMatchObject({ field: "thresholdPower", oldValue: 300, newValue: 310 });
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

  it("기준 변경 → 재계산 · 건수 응답", async () => {
    const res = await patch({ intensityBasis: "auto" });
    expect(mocks.recomputeAllIntensity).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ recomputed: 4 });
  });

  it("기준 그대로면 재계산하지 않는다", async () => {
    await patch({ intensityBasis: "hr" });
    expect(mocks.recomputeAllIntensity).not.toHaveBeenCalled();
  });

  // 회귀: #570 사전 리뷰 major 2 — 재계산 실패 후 같은 기준을 다시 저장해도 재계산이 돌지 않았다
  it("기준이 이미 저장된 뒤 재계산만 다시 요청", async () => {
    mocks.upsert.mockResolvedValue({ ...EXISTING, intensityBasis: "power" });
    const res = await patch({ intensityBasis: "power", recomputeIntensity: true });
    expect(mocks.recomputeAllIntensity).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ recomputed: 4 });
  });

  it("재계산 실패 → 설정은 저장 · recomputeError", async () => {
    mocks.recomputeAllIntensity.mockRejectedValue(new Error("db"));
    const res = await patch({ intensityBasis: "power" });
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalled();
    const json = await res.json();
    expect(json.recomputeError).toBeTruthy();
    expect(json.recomputed).toBeUndefined();
  });
});
