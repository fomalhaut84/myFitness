// #552 M19-3: 개선안 · 시험 실행 상태 (폴링). 끝난 시험은 같은 대상의 최근 실제 결과를 함께 (T4)
import { NextResponse } from "next/server";
import { promptErrorResponse } from "@/lib/prompts/http";
import { getRun } from "@/lib/prompts/runs";
import { findActualResult } from "@/lib/prompts/trial";
import { trialTargetOf } from "@/lib/prompts/run-plan";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const run = await getRun(id);
    const target = run.status === "done" ? trialTargetOf(run) : null;
    const actual = target ? await findActualResult(target) : null;
    return NextResponse.json({ run, actual });
  } catch (error) {
    return promptErrorResponse(error, "GET run", "실행 상태를 불러오지 못했습니다");
  }
}
