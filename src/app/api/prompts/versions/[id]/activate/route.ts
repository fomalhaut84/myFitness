// #552 A4: 초안을 사용 중으로 — 검증 재실행 · 이전 사용 중은 보관 (트랜잭션)
import { NextResponse } from "next/server";
import { promptErrorResponse } from "@/lib/prompts/http";
import { activateVersion } from "@/lib/prompts/versions";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await activateVersion(id));
  } catch (error) {
    return promptErrorResponse(error, "POST activate", "버전을 활성화하지 못했습니다");
  }
}
