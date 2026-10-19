// #552 A4: 초안을 사용 중으로 — 검증 재실행 · 이전 사용 중은 보관 (트랜잭션)
import { NextResponse } from "next/server";
import { invalidInput, promptErrorResponse, SwitchVersionSchema } from "@/lib/prompts/http";
import { activateVersion } from "@/lib/prompts/versions";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    // 본문은 선택 — 빠진 도구 언급 확인 (TOOLS_REMOVED 409 뒤 재요청)
    const parsed = SwitchVersionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidInput(parsed.error);
    return NextResponse.json(await activateVersion(id, parsed.data.acknowledgeRemovedTools));
  } catch (error) {
    return promptErrorResponse(error, "POST activate", "버전을 활성화하지 못했습니다");
  }
}
