import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { bumpHistoryCacheVersion } from "@/lib/history/cache";
import { todayKSTString } from "@/lib/garmin/utils";
import { parseDateOnlyKST } from "@/lib/date-input";
import { kstDayRange } from "@/lib/history/buckets";
import { computeBmi } from "@/lib/fitness/bmi";

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
    // #405: 미래 체중은 측정값이 아니다 — 기록 없는 설치에서 히스토리 하한을 미래로 밀던 입구를 막는다
    if (date > todayKSTString()) {
      return NextResponse.json({ error: "미래 날짜는 기록할 수 없습니다" }, { status: 400 });
    }
    const dayDate = parseDateOnlyKST(date); // #480: KST 자정 — Garmin 일별 키 · 히스토리 조회 키와 같은 규칙

    // BMI 계산 (키 정보 있으면)
    const profile = await prisma.userProfile.findFirst();
    const bmi = computeBmi(weight, profile?.height);

    const data = {
      weight,
      bmi,
      bodyFat: bodyFat ?? null,
      muscleMass: muscleMass ?? null,
      source: "manual",
    };

    // PR #485 Codex P2: 다른 TZ 호스트에서 옛 파서 (서버 로컬 자정) 로 쓴 행은 instant 가 달라 KST 키 upsert 가 못 찾고 같은 KST 날에
    // 두 행을 만든다 → 그 KST 하루 범위의 기존 행을 먼저 찾아 **그 행을 갱신하며 date 를 정규 키로 옮긴다** (정규 키 행이 있으면 그것 우선).
    // 없으면 upsert (동시 요청의 unique 경쟁은 upsert 가 처리).
    const { start, end } = kstDayRange(date);
    const sameDay = await prisma.bodyComposition.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: { date: "asc" },
      select: { id: true, date: true },
    });
    const target = sameDay.find((r) => r.date.getTime() === dayDate.getTime()) ?? sameDay[0];
    const record = target
      ? await prisma.bodyComposition.update({ where: { id: target.id }, data: { ...data, date: dayDate } })
      : await prisma.bodyComposition.upsert({
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
  } finally {
    // #394: 수동 쓰기는 SyncMetadata 를 안 건드린다 → 히스토리 캐시 버전을 올려 즉시 무효화 (PR #401 Codex P2).
    // finally 라 실패 시에도 올라가지만 캐시 미스 1회일 뿐이고, 커밋 **뒤에** 올라가는 순서를 보장한다.
    bumpHistoryCacheVersion();
  }
}
