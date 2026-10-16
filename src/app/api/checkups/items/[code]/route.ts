// #527 (M18-1): 항목 추이 — 회차별 값 · 기준범위 · 판정 (오름차순). #544: + 관련 복약 · 회차별 함께 볼 약.

import { NextResponse } from "next/server";
import { getItemTrend } from "@/lib/checkup/queries";
import { describeError } from "@/lib/checkup/write";
import { listMedications } from "@/lib/medication/queries";
import { itemMedications } from "@/lib/medication/link";

interface Params {
  params: Promise<{ code: string }>;
}

const CODE_RE = /^(?:[a-z0-9_]{1,40}|custom:[0-9a-z가-힣]{1,100})$/; // MAX_CUSTOM_SLUG

/** custom code 는 한글 — 세그먼트가 인코딩된 채로 오면 풀고, 잘못된 % 시퀀스는 그대로 둬 정규식이 거른다. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function GET(_request: Request, ctx: Params) {
  const { code: raw } = await ctx.params;
  const code = safeDecode(raw);
  if (!CODE_RE.test(code)) {
    return NextResponse.json({ error: "유효하지 않은 항목 코드" }, { status: 400 });
  }
  try {
    const [trend, meds] = await Promise.all([getItemTrend(code), listMedications()]);
    if (!trend) return NextResponse.json({ error: "이 항목의 검진 기록이 없습니다" }, { status: 404 });
    return NextResponse.json({ trend, medications: itemMedications(meds, code, trend.points) });
  } catch (error) {
    console.error("[api/checkups/items] GET error:", describeError(error));
    return NextResponse.json({ error: "항목 추이를 불러오지 못했습니다" }, { status: 500 });
  }
}
