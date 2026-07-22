// #261: Activity 부분 수정. 현재는 routeTag (사용자 커스텀 코스명) 만 지원.
// 향후 다른 필드 추가 시 PATCH_SCHEMA 확장.

import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

const PATCH_SCHEMA = z.object({
  // 최대 60자, trim, 빈 문자열 → null 정규화 (프론트 empty input 클리어 지원).
  routeTag: z.string().trim().max(60).nullable().optional(),
});

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = PATCH_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "유효하지 않은 입력", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // 빈 문자열은 null 로 (프론트에서 태그 지우기 지원).
    const updatePayload: Record<string, unknown> = {};
    if (data.routeTag !== undefined) {
      updatePayload.routeTag = data.routeTag === "" ? null : data.routeTag;
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json(
        { error: "변경할 필드가 없습니다" },
        { status: 400 },
      );
    }

    const updated = await prisma.activity.update({
      where: { id },
      data: updatePayload,
      select: {
        id: true,
        routeTag: true,
      },
    });
    return NextResponse.json({ activity: updated });
  } catch (error) {
    // Prisma P2025: record not found — typed 검사 (Codex P1: substring 매칭은 fragile).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "활동을 찾을 수 없습니다" },
        { status: 404 },
      );
    }
    console.error(`[api/activities/${id}] PATCH error:`, error);
    // Codex P1: 원본 message 를 클라이언트에 반환하지 않는다 (SQL/스키마 정보 유출 방지).
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
