// #527 (M18-1): 건강검진 회차 목록 · 생성.
// 로그에 검진 값을 남기지 않는다 (describeError — 에러 종류 · 코드만).

import { NextResponse } from "next/server";
import { todayKSTString } from "@/lib/garmin/utils";
import { listCheckups } from "@/lib/checkup/queries";
import { prepareCheckupWrite } from "@/lib/checkup/request";
import { createCheckup, describeError, isUniqueViolation } from "@/lib/checkup/write";

export async function GET() {
  try {
    const checkups = await listCheckups();
    return NextResponse.json({ checkups });
  } catch (error) {
    console.error("[api/checkups] GET error:", describeError(error));
    return NextResponse.json({ error: "검진 기록을 불러오지 못했습니다" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const prepared = prepareCheckupWrite(body, todayKSTString());
    if (!prepared.ok) return NextResponse.json(prepared.body, { status: prepared.status });

    const created = await createCheckup(prepared.input, prepared.rows);
    return NextResponse.json({ id: created.id, resultCount: prepared.rows.length }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: "같은 날짜의 검진 기록이 이미 있습니다" }, { status: 409 });
    }
    console.error("[api/checkups] POST error:", describeError(error));
    return NextResponse.json({ error: "검진 기록을 저장하지 못했습니다" }, { status: 500 });
  }
}
