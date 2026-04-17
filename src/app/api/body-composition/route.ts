import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";

const POST_SCHEMA = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식")
    .refine((s) => {
      const [y, m, d] = s.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return (
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d
      );
    }, "유효하지 않은 날짜"),
  weight: z.number().positive().max(500),
  bodyFat: z.number().min(1).max(80).nullable().optional(),
  muscleMass: z.number().positive().max(200).nullable().optional(),
});

function parseLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = POST_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "유효하지 않은 입력", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { date, weight, bodyFat, muscleMass } = parsed.data;
    const dayDate = parseLocalDate(date);

    // BMI 계산 (키 정보 있으면)
    const profile = await prisma.userProfile.findFirst();
    const heightM = profile?.height ? profile.height / 100 : null;
    const bmi =
      heightM && heightM > 0
        ? Number((weight / (heightM * heightM)).toFixed(1))
        : null;

    const data = {
      weight,
      bmi,
      bodyFat: bodyFat ?? null,
      muscleMass: muscleMass ?? null,
      source: "manual",
    };

    const record = await prisma.bodyComposition.upsert({
      where: { date: dayDate },
      update: data,
      create: { date: dayDate, ...data },
    });

    return NextResponse.json({
      data: {
        ...record,
        date: record.date.toISOString(),
        createdAt: record.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
