// #544 (M18-3): 복약 한 건 수정 · 삭제.
import { NextResponse } from "next/server";
import { todayKSTString } from "@/lib/garmin/utils";
import { describeError, isNotFound } from "@/lib/checkup/write";
import { prepareMedicationWrite } from "@/lib/medication/schema";
import { deleteMedication, updateMedication } from "@/lib/medication/write";

interface Params {
  params: Promise<{ id: string }>;
}

const NOT_FOUND = { error: "복약 기록을 찾을 수 없습니다" };

export async function PUT(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  try {
    const body = await request.json().catch(() => null);
    const prepared = prepareMedicationWrite(body, todayKSTString());
    if (!prepared.ok) return NextResponse.json(prepared.body, { status: prepared.status });
    await updateMedication(id, prepared.input);
    return NextResponse.json({ id });
  } catch (error) {
    if (isNotFound(error)) return NextResponse.json(NOT_FOUND, { status: 404 });
    console.error("[api/medications/[id]] PUT error:", describeError(error));
    return NextResponse.json({ error: "복약 기록을 저장하지 못했습니다" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: Params) {
  const { id } = await ctx.params;
  try {
    await deleteMedication(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isNotFound(error)) return NextResponse.json(NOT_FOUND, { status: 404 });
    console.error("[api/medications/[id]] DELETE error:", describeError(error));
    return NextResponse.json({ error: "복약 기록을 지우지 못했습니다" }, { status: 500 });
  }
}
