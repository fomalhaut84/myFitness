// #527 (M18-1): 건강검진 회차 상세 · 수정 (결과 전체 교체) · 삭제.

import { NextResponse } from "next/server";
import { todayKSTString } from "@/lib/garmin/utils";
import { getCheckupDetail } from "@/lib/checkup/queries";
import { prepareCheckupWrite } from "@/lib/checkup/request";
import { deleteCheckup, describeError, isNotFound, isUniqueViolation, replaceCheckup } from "@/lib/checkup/write";

interface Params {
  params: Promise<{ id: string }>;
}

const NOT_FOUND = { error: "검진 기록을 찾을 수 없습니다" };

export async function GET(_request: Request, ctx: Params) {
  const { id } = await ctx.params;
  try {
    const checkup = await getCheckupDetail(id);
    if (!checkup) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ checkup });
  } catch (error) {
    console.error(`[api/checkups/${id}] GET error:`, describeError(error));
    return NextResponse.json({ error: "검진 기록을 불러오지 못했습니다" }, { status: 500 });
  }
}

export async function PUT(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  try {
    const body = await request.json().catch(() => null);
    const prepared = prepareCheckupWrite(body, todayKSTString());
    if (!prepared.ok) return NextResponse.json(prepared.body, { status: prepared.status });

    const updated = await replaceCheckup(id, prepared.input, prepared.rows);
    return NextResponse.json({ id: updated.id, resultCount: prepared.rows.length });
  } catch (error) {
    if (isNotFound(error)) return NextResponse.json(NOT_FOUND, { status: 404 });
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: "같은 날짜의 검진 기록이 이미 있습니다" }, { status: 409 });
    }
    console.error(`[api/checkups/${id}] PUT error:`, describeError(error));
    return NextResponse.json({ error: "검진 기록을 저장하지 못했습니다" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: Params) {
  const { id } = await ctx.params;
  try {
    await deleteCheckup(id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (isNotFound(error)) return NextResponse.json(NOT_FOUND, { status: 404 });
    console.error(`[api/checkups/${id}] DELETE error:`, describeError(error));
    return NextResponse.json({ error: "검진 기록을 삭제하지 못했습니다" }, { status: 500 });
  }
}
