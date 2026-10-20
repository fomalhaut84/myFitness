// 회귀: #570 사전 리뷰 major 2 — cursor + skip 1 이 방금 채운 행을 기준으로 다음 행을 건너뛰어 배치마다 1행 누락
import { describe, expect, it, vi } from "vitest";

const updateManyCalls: unknown[] = [];
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
        updateMany: async (args: unknown) => {
          updateManyCalls.push(args);
          return { count: 2 };
        },
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

import { Prisma } from "@/generated/prisma/client";
import { RUNNING_ACTIVITY_WHERE } from "@/lib/activity/running-types";
import { computePowerIntensityFromRawData } from "../intensity";
import { clearNonRunningPowerIntensity, fillMissingPowerIntensity, powerColumnsForSync } from "../power-intensity-fill";

describe("fillMissingPowerIntensity", () => {
  it("배치 경계에서 행을 건너뛰지 않는다 · 재실행 0건", async () => {
    expect(await fillMissingPowerIntensity()).toEqual({ scanned: 450, filled: 450 });
    expect(rows.every((r) => r.filled)).toBe(true);
    expect(await fillMissingPowerIntensity()).toEqual({ scanned: 0, filled: 0 });
  });
});

// 회귀: #575 (릴리즈 PR #574 Codex P2) — 러닝을 다른 종류로 바꾼 활동에 옛 러닝 파워 값이 남았다
describe("powerColumnsForSync · clearNonRunningPowerIntensity", () => {
  const raw = { powerTimeInZone_1: 800, powerTimeInZone_2: 100, powerTimeInZone_3: 0, powerTimeInZone_4: 0, powerTimeInZone_5: 0 };

  it("러닝 외 종류 → 파워 컬럼 비움", () => {
    expect(powerColumnsForSync("cycling", null)).toMatchObject({ powerZoneDistribution: Prisma.DbNull, powerIntensityLabel: null });
  });

  it("러닝 + 계산 불가 → 쓰지 않음 (기존 값 유지) · 계산됨 → 값", () => {
    expect(powerColumnsForSync("running", null)).toEqual({});
    const intensity = computePowerIntensityFromRawData({ rawData: raw, activityType: "running", thresholdPower: 300 });
    expect(powerColumnsForSync("running", intensity)).toMatchObject({ powerIntensityLabel: "easy" });
  });

  it("남은 값 정리는 러닝 외 + 파워 값 있는 행만", async () => {
    expect(await clearNonRunningPowerIntensity()).toBe(2);
    const where = (updateManyCalls[0] as { where: { AND: Array<Record<string, unknown>> } }).where;
    expect(where.AND[0]).toEqual({ NOT: RUNNING_ACTIVITY_WHERE });
    expect(where.AND[1]).toEqual({ powerIntensityLabel: { not: null } });
  });
});
