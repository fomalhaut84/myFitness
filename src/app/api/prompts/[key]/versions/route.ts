// #552 A3: 새 버전 (직접 수정) — 검증 통과 시 초안, activate 면 같은 트랜잭션에서 사용 중으로
import { NextResponse } from "next/server";
import { isPromptKey } from "@/lib/prompts/definitions";
import { CreateVersionSchema, invalidInput, promptErrorResponse } from "@/lib/prompts/http";
import { createVersion } from "@/lib/prompts/versions";

interface Params {
  params: Promise<{ key: string }>;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { key } = await params;
    if (!isPromptKey(key)) return NextResponse.json({ error: "없는 프롬프트입니다" }, { status: 404 });
    const parsed = CreateVersionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidInput(parsed.error);
    const created = await createVersion({ key, ...parsed.data });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return promptErrorResponse(error, "POST versions", "버전을 저장하지 못했습니다");
  }
}
