// 회귀: #570 사전 리뷰 major 1 — 파워 엔드포인트 실패가 프로필 싱크 전체를 실패로 만들어 weekly-report 가 activities 갭 필을 건너뛰었다
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("../../utils", () => ({ withRateLimit: (fn: () => unknown) => fn() }));

import type { GarminConnect } from "@flow-js/garmin-connect";
import { fetchPowerPayload } from "../user-profile";

describe("fetchPowerPayload", () => {
  it("엔드포인트 실패는 throw 하지 않고 undefined (미갱신)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = {
      get: vi.fn().mockRejectedValueOnce(new Error("404")).mockResolvedValueOnce({ functionalThresholdPower: 300 }),
    } as unknown as GarminConnect;
    await expect(fetchPowerPayload(client)).resolves.toEqual({ powerZones: undefined, latest: { functionalThresholdPower: 300 } });
  });
});
