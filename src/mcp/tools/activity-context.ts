// #444 F4: MCP get_activity_context — 활동 상세 AI 평가 (#440) 와 같은 근거 섹션을 리포트가 도구로 본다.
// 웹 `GET /api/activities/[id]/context` 를 HTTP 로 경유한다 (splits 선례) — Garmin 세션 (`withReauth`) 은 웹 프로세스에만 두고,
// MCP 프로세스가 스플릿 조회로 Garmin 로그인을 시도하지 않게.
import prisma from "../prisma";
import { activityLookupClauses, errorPayload } from "./activity-id";

interface ContextSection {
  id: string;
  title: string;
  lines: string[];
}

interface ContextResponse {
  mode: "full" | "brief";
  sections: ContextSection[];
  omitted: { id: string; title: string; reason: string }[];
}

const CONTEXT_NOTE =
  "서버가 DB 에서 조립한 이 활동의 평가 근거 섹션입니다 (활동 상세 AI 평가와 같은 근거). mode=full 은 러닝 계열 (기본 · km 스플릿 · 강도 · 종료 후 회복 · 다이나믹스 · 추가 지표 · 환경 · 비교), brief 는 기본 지표만. " +
  "omitted 는 있어야 하는데 못 가져온 섹션 (예: Garmin 스플릿 조회 실패) — 결측과 구분. 비교 섹션의 델타는 음수 페이스 = 빨라짐, 음수 심박 = 낮아짐. 2분 HRR 은 양수 = 회복.";

function isContextResponse(value: unknown): value is ContextResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (v.mode === "full" || v.mode === "brief") && Array.isArray(v.sections) && Array.isArray(v.omitted);
}

function baseUrl(): string {
  // claude-advisor 가 MCP env 로 APP_BASE_URL 을 전달 (splits 와 동일)
  return process.env.APP_BASE_URL ?? "http://localhost:4200";
}

async function fetchContext(activityId: string): Promise<ContextResponse | { error: string }> {
  try {
    const res = await fetch(`${baseUrl()}/api/activities/${activityId}/context`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      return { error: `컨텍스트 조회 실패 (${res.status}): ${body?.error ?? res.statusText}` };
    }
    const body: unknown = await res.json();
    return isContextResponse(body) ? body : { error: "컨텍스트 응답 형태가 예상과 다릅니다" };
  } catch (err) {
    return { error: `컨텍스트 API 호출 실패: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 특정 활동의 평가 근거 전체. activityId 는 DB id(cuid) 또는 Garmin garminId 문자열 */
export async function getActivityContext(args: { activityId: string }) {
  const activityId = args.activityId?.trim();
  if (!activityId) return errorPayload("activityId가 필요합니다");

  let activity: { id: string } | null;
  try {
    activity = await prisma.activity.findFirst({ where: { OR: activityLookupClauses(activityId) }, select: { id: true } });
  } catch (err) {
    return errorPayload(`활동 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!activity) return errorPayload(`활동을 찾을 수 없습니다: ${activityId}`);

  const ctx = await fetchContext(activity.id);
  if ("error" in ctx) return errorPayload(ctx.error);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ _context: CONTEXT_NOTE, activityId: activity.id, ...ctx }, null, 2),
      },
    ],
  };
}
