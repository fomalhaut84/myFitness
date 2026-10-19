// #552 M19-3 T2: 초안 시험 실행 — job 시작 후 runId 반환 (`GET /api/prompts/runs/[id]` 폴링). 실행 중이 있으면 409
import { NextResponse } from "next/server";
import { invalidInput, promptErrorResponse, TrialSchema } from "@/lib/prompts/http";
import { startTrial } from "@/lib/prompts/trial";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const parsed = TrialSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidInput(parsed.error);
    const run = await startTrial(id, parsed.data);
    return NextResponse.json({ runId: run.id }, { status: 202 });
  } catch (error) {
    return promptErrorResponse(error, "POST trial", "시험 실행을 시작하지 못했습니다");
  }
}
