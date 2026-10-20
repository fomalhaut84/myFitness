// 회귀: #570 사전 리뷰 major 2 — cursor + skip 1 이 방금 채운 행을 기준으로 다음 행을 건너뛰어 배치마다 1행 누락
import { describe, expect, it, vi } from "vitest";

type Row = { id: string; activityType: string; rawData: Record<string, number>; filled: boolean };
const rows: Row[] = Array.from({ length: 450 }, (_, i) => ({
  id: `a${String(i).padStart(4, "0")}`,
  activityType: "running",
  rawData: { powerTimeInZone_1: 600, powerTimeInZone_2: 300, powerTimeInZone_3: 0, powerTimeInZone_4: 0, powerTimeInZone_5: 0 },
  filled: false,
}));

vi.mock("@/lib/prisma", () => {
  type Where = { AND: Array<Record<string, unknown>> };
  const idGt = (where: Where) => {
    const c = where.AND.find((w) => "id" in w) as { id: { gt: string } } | undefined;
    return c?.id.gt;
  };
  return {
    default: {
      userProfile: { findFirst: async () => ({ thresholdPower: 300 }) },
      activity: {
        // 필터 (파워 미채움 · id > 마지막) + id 오름차순 + take — cursor/skip 은 지원하지 않는다 (쓰면 테스트가 깨진다)
        findMany: async (args: { where: Where; take: number; cursor?: unknown }) => {
          if (args.cursor) throw new Error("cursor 사용 금지");
          const gt = idGt(args.where);
          return rows
            .filter((r) => !r.filled && (gt === undefined || r.id > gt))
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, args.take);
        },
        update: (args: { where: { id: string } }) => ({ id: args.where.id }),
      },
      $transaction: async (ops: Array<{ id: string }>) => {
        for (const op of ops) {
          const r = rows.find((x) => x.id === op.id);
          if (r) r.filled = true;
        }
      },
    },
  };
});

import { fillMissingPowerIntensity } from "../power-intensity-fill";

describe("fillMissingPowerIntensity", () => {
  it("배치 경계에서 행을 건너뛰지 않는다 · 재실행 0건", async () => {
    expect(await fillMissingPowerIntensity()).toEqual({ scanned: 450, filled: 450 });
    expect(rows.every((r) => r.filled)).toBe(true);
    expect(await fillMissingPowerIntensity()).toEqual({ scanned: 0, filled: 0 });
  });
});
