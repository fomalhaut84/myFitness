// #552 A5: 보관된 버전으로 되돌리기 — 본문을 복사한 새 버전 (restore) 을 만들어 사용 중으로. 옛 버전을 다시 켜지 않는다
import { NextResponse } from "next/server";
import { invalidInput, promptErrorResponse, SwitchVersionSchema } from "@/lib/prompts/http";
import { restoreVersion } from "@/lib/prompts/versions";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    // 본문은 선택 — 빠진 도구 언급 확인 (TOOLS_REMOVED 409 뒤 재요청)
    const parsed = SwitchVersionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidInput(parsed.error);
    return NextResponse.json(await restoreVersion(id, parsed.data.acknowledgeRemovedTools), { status: 201 });
  } catch (error) {
    return promptErrorResponse(error, "POST restore", "버전을 되돌리지 못했습니다");
  }
}
