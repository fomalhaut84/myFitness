// #455 F2: MCP get_personal_records — 웹 API 경유 · 페이스 포맷 · 실패는 errorPayload.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPersonalRecords } from "../personal-records";

const fetchMock = vi.fn();
const parse = (res: { content: { text: string }[]; isError?: boolean }) => ({ body: JSON.parse(res.content[0].text), isError: res.isError ?? false });

const payload = {
  lowerBound: "2020-06-01",
  today: "2026-09-24",
  byBucket: { "5k": { id: "a", ymd: "2024-03-09", name: "5K", distanceM: 5010, durationSec: 1363, avgPace: 272, race: false }, "10k": null, HM: null, FM: null },
  longest: { id: "b", ymd: "2024-03-17", name: "롱런", distanceM: 30120, durationSec: 10270, avgPace: 341, race: false },
  bestMonth: { ym: "2024-03", km: 210.5, count: 18, current: false },
  bestVo2max: { value: 52.3, ymd: "2024-02-01" },
  lowestRestingHR: { value: 46, ymd: "2024-05-05" },
  bestHrr2: { value: 48, ymd: "2026-08-10" },
  races: [{ id: "r", ymd: "2023-10-22", name: "하프", distanceM: 21100, durationSec: 6098, avgPace: 289 }],
};

describe("getPersonalRecords", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("APP_BASE_URL", "http://web.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("웹 API 응답에 paceMinKm 을 덧붙여 돌려준다", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload });
    const { body, isError } = parse(await getPersonalRecords());
    expect(isError).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("http://web.test/api/history/records");
    expect(body.byBucket["5k"].paceMinKm).toBe("4'32\"");
    expect(body.longest.paceMinKm).toBe("5'41\"");
    expect(body.races[0].paceMinKm).toBe("4'49\"");
    expect(body.bestHrr2).toEqual({ value: 48, ymd: "2026-08-10" });
    expect(typeof body._context).toBe("string");
  });

  it("웹 오류 · 형태 불일치 → errorPayload", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: "x", json: async () => ({ error: "boom" }) });
    expect(parse(await getPersonalRecords())).toMatchObject({ isError: true });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ nope: 1 }) });
    expect(parse(await getPersonalRecords()).isError).toBe(true);
  });
});
