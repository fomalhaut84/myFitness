// #544 (M18-3): 복약 목록 · 추가. 로그에 약 이름 · 용량을 남기지 않는다 (describeError).
import { NextResponse } from "next/server";
import { todayKSTString } from "@/lib/garmin/utils";
import { describeError } from "@/lib/checkup/write";
import { listMedications } from "@/lib/medication/queries";
import { prepareMedicationWrite } from "@/lib/medication/schema";
import { createMedication } from "@/lib/medication/write";

export async function GET() {
  try {
    return NextResponse.json({ medications: await listMedications() });
  } catch (error) {
    console.error("[api/medications] GET error:", describeError(error));
    return NextResponse.json({ error: "복약 기록을 불러오지 못했습니다" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const prepared = prepareMedicationWrite(body, todayKSTString());
    if (!prepared.ok) return NextResponse.json(prepared.body, { status: prepared.status });
    const created = await createMedication(prepared.input);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    console.error("[api/medications] POST error:", describeError(error));
    return NextResponse.json({ error: "복약 기록을 저장하지 못했습니다" }, { status: 500 });
  }
}
