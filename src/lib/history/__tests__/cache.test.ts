// #394 (M15-2): summary 메모리 캐시. 키 = 파라미터 + syncStamp + 수동 쓰기 버전, TTL · 용량 제한.
import { describe, expect, it, vi } from "vitest";
import { createHistoryCache, summaryCacheKey } from "../cache-core";

function setup(opts?: { ttlMs?: number; maxEntries?: number }) {
  const state = { stamp: "s1", now: 1_000 };
  const cache = createHistoryCache(
    { getSyncStamp: async () => state.stamp, now: () => state.now },
    opts,
  );
  return { cache, state };
}

describe("createHistoryCache", () => {
  it("같은 키 재호출은 loader 를 다시 부르지 않는다", async () => {
    const { cache } = setup();
    const load = vi.fn(async () => ({ v: 1 }));
    expect(await cache.get("k", load)).toEqual({ v: 1 });
    expect(await cache.get("k", load)).toEqual({ v: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  // 회귀: PR #401 Codex P2 — POST /api/body-composition 은 SyncMetadata 를 안 건드려 lastSyncAt 키만으론
  // 저장 직후에도 옛 체중이 TTL 동안 남는다. 수동 쓰기 route 가 버전을 올리면 즉시 새 값이어야 한다.
  it("수동 쓰기(version bump) 직후 새 값을 반환한다", async () => {
    const { cache } = setup();
    let weight = 71.2;
    const load = vi.fn(async () => ({ weight }));
    expect(await cache.get("k", load)).toEqual({ weight: 71.2 });
    weight = 70.8;
    cache.bump();
    expect(await cache.get("k", load)).toEqual({ weight: 70.8 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("syncStamp(lastSyncAt) 가 바뀌면 재조회", async () => {
    const { cache, state } = setup();
    const load = vi.fn(async () => 1);
    await cache.get("k", load);
    state.stamp = "s2";
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("TTL 경과 후 재조회, 경과 전은 캐시", async () => {
    const { cache, state } = setup({ ttlMs: 100 });
    const load = vi.fn(async () => 1);
    await cache.get("k", load);
    state.now += 99;
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(1);
    state.now += 2;
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("loader reject 는 캐시에 남지 않는다", async () => {
    const { cache } = setup();
    const load = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce(7);
    await expect(cache.get("k", load)).rejects.toThrow("db down");
    expect(await cache.get("k", load)).toBe(7);
  });

  it("동시 호출은 한 번만 조회한다", async () => {
    const { cache } = setup();
    const load = vi.fn(async () => 1);
    await Promise.all([cache.get("k", load), cache.get("k", load), cache.get("k", load)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("용량 초과 시 가장 오래된 엔트리부터 제거", async () => {
    const { cache } = setup({ maxEntries: 2 });
    const load = vi.fn(async () => 1);
    await cache.get("a", load);
    await cache.get("b", load);
    await cache.get("c", load); // a 제거
    expect(cache.size()).toBe(2);
    await cache.get("b", load);
    expect(load).toHaveBeenCalledTimes(3);
    await cache.get("a", load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});

describe("summaryCacheKey", () => {
  const base = { granularity: "year", from: "2020-06-16", to: "2026-09-21", clampedFrom: false, clampedTo: false } as const;

  it("metrics 순서와 무관하게 같은 키", () => {
    expect(summaryCacheKey({ ...base, metrics: ["weight", "runningKm"] }, "2026-09-21")).toBe(
      summaryCacheKey({ ...base, metrics: ["runningKm", "weight"] }, "2026-09-21"),
    );
  });

  it("today 가 바뀌면 다른 키 (자정 넘김 — totalDays 가 달라진다)", () => {
    expect(summaryCacheKey({ ...base, metrics: ["weight"] }, "2026-09-21")).not.toBe(
      summaryCacheKey({ ...base, metrics: ["weight"] }, "2026-09-22"),
    );
  });

  it("granularity · 범위가 다르면 다른 키", () => {
    const k = summaryCacheKey({ ...base, metrics: ["weight"] }, "2026-09-21");
    expect(summaryCacheKey({ ...base, granularity: "month", metrics: ["weight"] }, "2026-09-21")).not.toBe(k);
    expect(summaryCacheKey({ ...base, from: "2021-01-01", metrics: ["weight"] }, "2026-09-21")).not.toBe(k);
  });
});
