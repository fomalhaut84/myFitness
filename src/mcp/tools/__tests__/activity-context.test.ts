// #444 F4 · F9: MCP get_activity_context — id 해석 (cuid 또는 garminId) · 웹 API 경유 · 실패는 errorPayload.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
vi.mock("../../prisma", () => ({ default: { activity: { findFirst: (...args: unknown[]) => findFirst(...args) } } }));

import { activityLookupClauses, tryParseGarminId } from "../activity-id";
import { getActivityContext } from "../activity-context";

const fetchMock = vi.fn();

function parse(res: { content: { text: string }[]; isError?: boolean }) {
  return { body: JSON.parse(res.content[0].text), isError: res.isError ?? false };
}

describe("tryParseGarminId / activityLookupClauses", () => {
  it("숫자 문자열만 garminId 후보 · bigint 범위 밖은 제외", () => {
    expect(tryParseGarminId("12345")).toBe(BigInt(12345));
    expect(tryParseGarminId("cmabc123")).toBeNull();
    expect(tryParseGarminId("99999999999999999999")).toBeNull();
    expect(activityLookupClauses("cmabc123")).toEqual([{ id: "cmabc123" }]);
    expect(activityLookupClauses("777")).toEqual([{ id: "777" }, { garminId: BigInt(777) }]);
  });
});

describe("getActivityContext", () => {
  beforeEach(() => {
    findFirst.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("APP_BASE_URL", "http://web.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("빈 id 는 errorPayload · DB 조회 없음", async () => {
    const { body, isError } = parse(await getActivityContext({ activityId: "  " }));
    expect(isError).toBe(true);
    expect(body.error).toMatch(/activityId/);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("활동 없음 → errorPayload · fetch 없음", async () => {
    findFirst.mockResolvedValue(null);
    const { body, isError } = parse(await getActivityContext({ activityId: "999" }));
    expect(isError).toBe(true);
    expect(body.error).toContain("999");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("garminId 로 찾은 활동의 cuid 로 웹 API 를 부르고 응답을 그대로 돌려준다", async () => {
    findFirst.mockResolvedValue({ id: "cm_ctx1" });
    const payload = { mode: "full", sections: [{ id: "basic", title: "기본 지표", lines: ["거리 10.00 km"] }], omitted: [] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload });
    const { body, isError } = parse(await getActivityContext({ activityId: "123456" }));
    expect(isError).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("http://web.test/api/activities/cm_ctx1/context");
    expect(body.mode).toBe("full");
    expect(body.sections).toEqual(payload.sections);
    expect(body.activityId).toBe("cm_ctx1");
    expect(typeof body._context).toBe("string");
  });

  it("웹 API 오류 상태 → errorPayload (상태 코드 · 서버 메시지)", async () => {
    findFirst.mockResolvedValue({ id: "cm_ctx1" });
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: "Internal", json: async () => ({ error: "boom" }) });
    const { body, isError } = parse(await getActivityContext({ activityId: "cm_ctx1" }));
    expect(isError).toBe(true);
    expect(body.error).toContain("500");
    expect(body.error).toContain("boom");
  });

  it("fetch 자체 실패 · 응답 형태 불일치 → errorPayload", async () => {
    findFirst.mockResolvedValue({ id: "cm_ctx1" });
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(parse(await getActivityContext({ activityId: "cm_ctx1" })).body.error).toContain("ECONNREFUSED");
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ nope: 1 }) });
    expect(parse(await getActivityContext({ activityId: "cm_ctx1" })).isError).toBe(true);
  });
});
