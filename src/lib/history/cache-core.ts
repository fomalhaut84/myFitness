/**
 * #394 (M15-2): 히스토리 메모리 캐시 코어. 순수 (DB · 시계는 deps 로 주입) — prisma 에 묶인 싱글턴은 `cache.ts`.
 *
 * 프로덕션 실측 (#393 F12): 6년 `granularity=year` 전 지표 웜 1.09~1.22s. 병목은 DB 가 아니라 Node 측
 * Prisma 행 역직렬화 (약 11,500행) 라 결과를 통째로 캐시한다.
 *
 * 전체 키 = `<호출자 키>|<syncStamp>|<version>`
 * - syncStamp: `max(SyncMetadata.lastSyncAt)`. 싱크가 어느 프로세스에서 돌든 DB 값이라 보인다.
 * - version: 수동 쓰기 route 가 `bump()`. `POST /api/body-composition` 등은 SyncMetadata 를 안 건드려
 *   stamp 만으론 저장 직후에도 옛 값이 TTL 동안 남는다 (PR #401 Codex P2).
 * stamp · version 이 바뀌면 옛 엔트리는 다시 조회되지 않고 TTL · 용량으로만 빠진다.
 *
 * Promise 를 저장해 동시 요청이 한 번만 조회하게 하고, reject 는 즉시 제거한다.
 * 캐시된 값은 공유되므로 호출자는 변형하지 않는다.
 */
import type { SummaryParams } from "./summary-params";

export const HISTORY_CACHE_TTL_MS = 10 * 60 * 1000;
export const HISTORY_CACHE_MAX_ENTRIES = 64;

export interface HistoryCacheDeps {
  getSyncStamp: () => Promise<string>;
  now: () => number;
}

export interface HistoryCache {
  get<T>(key: string, load: () => Promise<T>): Promise<T>;
  /** 수동 쓰기 직후 호출 — 이후 조회는 전부 새 키. */
  bump(): void;
  size(): number;
}

interface Entry {
  value: Promise<unknown>;
  expiresAt: number;
}

export function createHistoryCache(
  deps: HistoryCacheDeps,
  opts: { ttlMs?: number; maxEntries?: number } = {},
): HistoryCache {
  const ttlMs = opts.ttlMs ?? HISTORY_CACHE_TTL_MS;
  const maxEntries = opts.maxEntries ?? HISTORY_CACHE_MAX_ENTRIES;
  // Map 은 삽입 순서를 유지한다 — 첫 키가 가장 오래된 엔트리.
  const entries = new Map<string, Entry>();
  let version = 0;

  function evict(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    async get<T>(key: string, load: () => Promise<T>): Promise<T> {
      const stamp = await deps.getSyncStamp();
      const fullKey = `${key}|${stamp}|${version}`;
      const now = deps.now();
      const hit = entries.get(fullKey);
      if (hit && hit.expiresAt > now) return hit.value as Promise<T>;

      const value = load();
      entries.delete(fullKey);
      entries.set(fullKey, { value, expiresAt: now + ttlMs });
      evict(now);
      value.catch(() => {
        if (entries.get(fullKey)?.value === value) entries.delete(fullKey);
      });
      return value;
    },
    bump() {
      version += 1;
    },
    size() {
      return entries.size;
    },
  };
}

/** metrics 순서 무관. today 포함 — 자정을 넘기면 totalDays · 버킷 목록이 달라진다. */
export function summaryCacheKey(params: SummaryParams, today: string): string {
  return JSON.stringify([
    "summary",
    params.granularity,
    params.from,
    params.to,
    params.clampedFrom,
    params.clampedTo,
    [...params.metrics].sort(),
    today,
  ]);
}
