import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";

export type MetricField =
  | "maxHR"
  | "lthr"
  | "lthrPace"
  | "vo2maxRunning"
  | "restingHRBase";

export type MetricSource = "manual" | "garmin";
export type MetricReason =
  | "user_edit"
  | "garmin_auto_detect"
  | "garmin_change_state"
  | "garmin_initial";

type Tx = Prisma.TransactionClient;

/**
 * 메트릭 변경 이력 기록.
 * - oldValue === newValue 면 skip (no-op).
 * - oldValue null + newValue 값 = 최초 설정.
 * - 둘 다 numeric (Float)이라 Int 필드(maxHR/lthr 등)도 안전 저장.
 */
export async function recordMetricChange(
  args: {
    field: MetricField;
    oldValue: number | null;
    newValue: number | null;
    source: MetricSource;
    reason?: MetricReason;
  },
  client: Tx | typeof prisma = prisma
): Promise<void> {
  if (args.oldValue === args.newValue) return;

  await client.metricChange.create({
    data: {
      field: args.field,
      oldValue: args.oldValue,
      newValue: args.newValue,
      source: args.source,
      reason: args.reason ?? null,
    },
  });
}
