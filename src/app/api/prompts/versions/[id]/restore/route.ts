// #552 A5: 보관된 버전으로 되돌리기 — 본문을 복사한 새 버전 (restore) 을 만들어 사용 중으로. 옛 버전을 다시 켜지 않는다
import { NextResponse } from "next/server";
import { promptErrorResponse } from "@/lib/prompts/http";
import { restoreVersion } from "@/lib/prompts/versions";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await restoreVersion(id), { status: 201 });
  } catch (error) {
    return promptErrorResponse(error, "POST restore", "버전을 되돌리지 못했습니다");
  }
}
