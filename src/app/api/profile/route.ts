import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";

const PATCH_SCHEMA = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식")
    .nullable()
    .optional(),
  height: z.number().positive().max(300).nullable().optional(),
  targetWeight: z.number().positive().max(500).nullable().optional(),
  restingHRBase: z.number().int().min(20).max(150).nullable().optional(),
  maxHR: z.number().int().min(100).max(230).nullable().optional(),
  lthr: z.number().int().min(60).max(220).nullable().optional(),
  lthrPace: z.number().positive().max(1200).nullable().optional(), // sec/km
  targetCalories: z.number().int().min(500).max(8000).nullable().optional(),
});

const DEFAULT_NAME = "사용자";

export async function GET() {
  try {
    let profile = await prisma.userProfile.findFirst();
    if (!profile) {
      profile = await prisma.userProfile.create({
        data: { name: DEFAULT_NAME },
      });
    }
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

    const existing = await prisma.userProfile.findFirst();

    // lthr은 maxHR을 초과할 수 없음 (현재 값 또는 업데이트 후 값 기준)
    const effectiveMaxHR =
      data.maxHR !== undefined ? data.maxHR : (existing?.maxHR ?? null);
    const effectiveLthr =
      data.lthr !== undefined ? data.lthr : (existing?.lthr ?? null);
    if (
      effectiveMaxHR !== null &&
      effectiveLthr !== null &&
      effectiveLthr > effectiveMaxHR
    ) {
      return NextResponse.json(
        { error: "LTHR은 최대심박수보다 작아야 합니다" },
        { status: 400 }
      );
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.birthDate !== undefined)
      updatePayload.birthDate = data.birthDate
        ? new Date(data.birthDate)
        : null;
    if (data.height !== undefined) updatePayload.height = data.height;
    if (data.targetWeight !== undefined)
      updatePayload.targetWeight = data.targetWeight;
    if (data.restingHRBase !== undefined)
      updatePayload.restingHRBase = data.restingHRBase;
    if (data.maxHR !== undefined) updatePayload.maxHR = data.maxHR;
    if (data.lthr !== undefined) updatePayload.lthr = data.lthr;
    if (data.lthrPace !== undefined) updatePayload.lthrPace = data.lthrPace;
    if (data.targetCalories !== undefined)
      updatePayload.targetCalories = data.targetCalories;

    const profile = existing
      ? await prisma.userProfile.update({
          where: { id: existing.id },
          data: updatePayload,
        })
      : await prisma.userProfile.create({
          data: {
            name: data.name ?? DEFAULT_NAME,
            ...updatePayload,
          },
        });

    return NextResponse.json({ profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
