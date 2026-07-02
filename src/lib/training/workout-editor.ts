// M8 2.2: 개별 workout 편집 validation + apply.

import { z } from "zod";
import type { WorkoutType } from "@/app/training-plan/theme";

// Pace 표기 "m:ss" → sec/km 변환. 유효하지 않으면 null.
export function parsePace(s: string): number | null {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const min = parseInt(m[1], 10);
  const sec = parseInt(m[2], 10);
  if (sec >= 60) return null;
  const total = min * 60 + sec;
  if (total < 120 || total > 900) return null; // 2:00 ~ 15:00 /km 이외 값은 오입력 가능성
  return total;
}

export const WORKOUT_PATCH_SCHEMA = z
  .object({
    type: z
      .enum(["easy", "long", "tempo", "interval", "recovery", "rest"])
      .optional(),
    distanceKm: z.number().min(0).max(200).nullable().optional(),
    pace: z
      .string()
      .regex(/^\d{1,2}:\d{2}$/)
      .nullable()
      .optional(),
    zone: z
      .enum(["Z1", "Z2", "Z3-4", "Z5"])
      .nullable()
      .optional(),
    intervalDesc: z.string().max(200).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .strict();

export type WorkoutPatchInput = z.infer<typeof WORKOUT_PATCH_SCHEMA>;

// DB 저장용 필드 변환. pace 는 string → sec/km 로.
export function toWorkoutUpdate(
  input: WorkoutPatchInput
): Record<string, unknown> {
  const upd: Record<string, unknown> = {};
  if (input.type !== undefined) upd.type = input.type;
  if (input.distanceKm !== undefined) upd.distanceKm = input.distanceKm;
  if (input.pace !== undefined) {
    if (input.pace === null) upd.paceSecPerKm = null;
    else {
      const sec = parsePace(input.pace);
      if (sec === null) {
        throw new Error(`유효하지 않은 pace: ${input.pace} (m:ss, 2:00~15:00)`);
      }
      upd.paceSecPerKm = sec;
    }
  }
  if (input.zone !== undefined) upd.zone = input.zone;
  if (input.intervalDesc !== undefined) upd.intervalDesc = input.intervalDesc;
  if (input.notes !== undefined) upd.notes = input.notes;
  return upd;
}

// type 이 rest 로 바뀌면 distance/pace/zone/interval 은 null 로 강제.
export function normalizeRest(
  update: Record<string, unknown>,
  finalType: WorkoutType
): Record<string, unknown> {
  if (finalType !== "rest") return update;
  return {
    ...update,
    distanceKm: null,
    paceSecPerKm: null,
    zone: null,
    intervalDesc: null,
  };
}
