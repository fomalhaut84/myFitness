import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { resolveMaxHR } from "@/lib/fitness/zones";
import { recalculateAllCalorieBalances } from "@/lib/fitness/calorie-balance";
import {
  recordMetricChange,
  type MetricField,
} from "@/lib/fitness/profile-history";

/** "YYYY-MM-DD" 형식이면서 실제 달력상 유효한 날짜인지 검증 */
const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    );
  }, "유효하지 않은 날짜")
  .nullable()
  .optional();

const PATCH_SCHEMA = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  birthDate: birthDateSchema,
  height: z.number().positive().max(300).nullable().optional(),
  targetWeight: z.number().positive().max(500).nullable().optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식")
    .refine((s) => {
      const [y, m, d] = s.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      return (
        date.getUTCFullYear() === y &&
        date.getUTCMonth() === m - 1 &&
        date.getUTCDate() === d
      );
    }, "유효하지 않은 날짜")
    .nullable()
    .optional(),
  restingHRBase: z.number().int().min(20).max(150).nullable().optional(),
  maxHR: z.number().int().min(100).max(220).nullable().optional(),
  lthr: z.number().int().min(80).max(220).nullable().optional(),
  lthrPace: z.number().positive().max(1200).nullable().optional(), // sec/km
  targetCalories: z.number().int().min(500).max(5000).nullable().optional(),
});

const DEFAULT_NAME = "사용자";

/** "YYYY-MM-DD" 문자열을 서버 로컬 midnight Date로 파싱 (저장/검증 통일 경로). */
function parseLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * 싱글톤 UserProfile 조회 또는 생성.
 * `singleton` unique 제약으로 동시 요청 시에도 중복 row 생성 불가.
 */
async function getOrCreateProfile() {
  return prisma.userProfile.upsert({
    where: { singleton: true },
    update: {},
    create: { singleton: true, name: DEFAULT_NAME },
  });
}

export async function GET() {
  try {
    const profile = await getOrCreateProfile();
    return NextResponse.json({ profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = PATCH_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "유효하지 않은 입력", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // 싱글톤 보장: 없으면 생성, 있으면 그대로 (update/create는 아래에서 결정)
    const existing = await getOrCreateProfile();

    // 업데이트 후 예상 상태로 LTHR ≤ maxHR 검증.
    // maxHR 미설정 시 resolveMaxHR fallback(220-age 또는 190)과도 비교.
    const nextMaxHR =
      data.maxHR !== undefined ? data.maxHR : existing.maxHR;
    const nextLthr =
      data.lthr !== undefined ? data.lthr : existing.lthr;
    const nextBirthDate =
      data.birthDate !== undefined
        ? data.birthDate
          ? parseLocalDate(data.birthDate)
          : null
        : existing.birthDate;
    if (nextLthr !== null) {
      const compareMaxHR =
        nextMaxHR ??
        resolveMaxHR({ maxHR: null, birthDate: nextBirthDate ?? undefined });
      if (nextLthr > compareMaxHR) {
        return NextResponse.json(
          {
            error: `LTHR(${nextLthr})은 최대심박수(${compareMaxHR}${
              nextMaxHR === null ? " — 추정값" : ""
            })보다 작아야 합니다`,
          },
          { status: 400 }
        );
      }
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.birthDate !== undefined)
      updatePayload.birthDate = data.birthDate
        ? parseLocalDate(data.birthDate)
        : null;
    if (data.height !== undefined) updatePayload.height = data.height;
    if (data.targetWeight !== undefined)
      updatePayload.targetWeight = data.targetWeight;
    if (data.targetDate !== undefined)
      updatePayload.targetDate = data.targetDate
        ? parseLocalDate(data.targetDate)
        : null;
    if (data.restingHRBase !== undefined)
      updatePayload.restingHRBase = data.restingHRBase;
    if (data.maxHR !== undefined) {
      updatePayload.maxHR = data.maxHR;
      // source는 값이 실제로 변경됐을 때만 갱신 (form 전송이 unchanged field도 포함하므로
      // 매 저장마다 source가 manual로 뒤집히는 것 방지)
      if (data.maxHR !== existing.maxHR) {
        updatePayload.maxHRSource = data.maxHR === null ? null : "manual";
      }
    }
    if (data.lthr !== undefined) {
      updatePayload.lthr = data.lthr;
      if (data.lthr !== existing.lthr) {
        updatePayload.lthrSource = data.lthr === null ? null : "manual";
      }
    }
    if (data.lthrPace !== undefined) updatePayload.lthrPace = data.lthrPace;
    if (data.targetCalories !== undefined)
      updatePayload.targetCalories = data.targetCalories;

    // 변경 이력 기록 대상 필드 수집 (#85)
    const trackedFields: Array<{ field: MetricField; old: number | null; new: number | null }> = [];
    if (data.maxHR !== undefined && data.maxHR !== existing.maxHR) {
      trackedFields.push({ field: "maxHR", old: existing.maxHR, new: data.maxHR });
    }
    if (data.lthr !== undefined && data.lthr !== existing.lthr) {
      trackedFields.push({ field: "lthr", old: existing.lthr, new: data.lthr });
    }
    if (data.lthrPace !== undefined && data.lthrPace !== existing.lthrPace) {
      trackedFields.push({ field: "lthrPace", old: existing.lthrPace, new: data.lthrPace });
    }
    if (
      data.restingHRBase !== undefined &&
      data.restingHRBase !== existing.restingHRBase
    ) {
      trackedFields.push({
        field: "restingHRBase",
        old: existing.restingHRBase,
        new: data.restingHRBase,
      });
    }

    const profile = await prisma.userProfile.update({
      where: { id: existing.id },
      data: updatePayload,
    });

    // 수동 변경 history 기록
    for (const t of trackedFields) {
      await recordMetricChange({
        field: t.field,
        oldValue: t.old,
        newValue: t.new,
        source: "manual",
        reason: "user_edit",
      });
    }

    // M4-2: targetCalories 변경 시 모든 DailySummary의 칼로리 밸런스 재계산.
    // 히스토리가 수백 건이면 수 초 이상 걸릴 수 있으므로 fire-and-forget으로 백그라운드 실행.
    // (Node 런타임에서 프로세스가 계속 살아있으므로 완료 보장, 실패해도 다음 싱크/수동 재계산으로 복구)
    const targetCaloriesChanged =
      data.targetCalories !== undefined &&
      data.targetCalories !== existing.targetCalories;
    if (targetCaloriesChanged) {
      recalculateAllCalorieBalances()
        .then(({ processed, failed }) => {
          console.log(
            `[profile] targetCalories 변경 → 백그라운드 재계산: ${processed}건 성공, ${failed}건 실패`
          );
        })
        .catch((err) => {
          console.error(
            "[profile] 프로필 변경 후 칼로리 재계산 실패:",
            err instanceof Error ? err.message : String(err)
          );
        });
    }

    return NextResponse.json({ profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
