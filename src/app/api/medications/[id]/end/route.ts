// #544 (M18-3): 복용 종료 (오늘).
import { NextResponse } from "next/server";
import { todayKSTString } from "@/lib/garmin/utils";
import { describeError } from "@/lib/checkup/write";
import { endMedicationToday } from "@/lib/medication/write";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: Params) {
  const { id } = await ctx.params;
  try {
    const result = await endMedicationToday(id, todayKSTString());
    if (result === "not_found") return NextResponse.json({ error: "복약 기록을 찾을 수 없습니다" }, { status: 404 });
    if (result === "already_ended") return NextResponse.json({ error: "이미 끝난 복약입니다" }, { status: 409 });
    if (result === "not_started") return NextResponse.json({ error: "아직 시작하지 않은 복약입니다" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/medications/[id]/end] POST error:", describeError(error));
    return NextResponse.json({ error: "복용 종료를 저장하지 못했습니다" }, { status: 500 });
  }
}
