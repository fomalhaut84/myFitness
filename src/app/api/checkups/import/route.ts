// #532: 결과지 가져오기 저장 — 회차별 병합 (없으면 생성 · 있으면 없는 항목 추가 · 체크한 항목만 교체). 한 트랜잭션.
// 로그 · 응답에 검진 값 · 추출 원문을 싣지 않는다 (describeError — 에러 종류 · 코드만).
import { NextResponse } from "next/server";
import { todayKSTString } from "@/lib/garmin/utils";
import { prepareImport } from "@/lib/checkup/import/request";
import { importCheckups } from "@/lib/checkup/import/write";
import { describeError, isUniqueViolation } from "@/lib/checkup/write";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const prepared = prepareImport(body, todayKSTString());
    if (!prepared.ok) return NextResponse.json(prepared.body, { status: prepared.status });

    const rounds = await importCheckups(prepared);
    return NextResponse.json({ rounds }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: "같은 날짜의 검진 기록이 동시에 저장됐습니다 — 다시 시도하세요" }, { status: 409 });
    }
    console.error("[api/checkups/import] POST error:", describeError(error));
    return NextResponse.json({ error: "결과지를 저장하지 못했습니다" }, { status: 500 });
  }
}
