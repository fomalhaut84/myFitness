// M13 Phase 1 (#243): auto-adjust 사전 알림.
// 아침 이른 시각 cron 이 recommendTodayWorkout() 을 실행 → 조정 필요 시 (recommendation.adjusted)
// Telegram push 로 사용자에게 사전 안내. Phase 1 은 read-only — TrainingPlan 미변경.
//
// Phase 2 에서 inline keyboard + accept/reject flow 추가 예정.

import type { Bot } from "grammy";
import prisma from "@/lib/prisma";
import { recommendTodayWorkout } from "@/mcp/tools/recommend-today-workout";
import { getInjuryRiskScore } from "@/mcp/tools/injury-risk";
import { sanitizeError } from "../utils/error";
import { sendToAll } from "./scheduler";

interface InjuryPayload {
  topFactors?: Array<{ factor: string; score: number; detail?: string }>;
}

interface RecommendationPayload {
  date: string;
  base: {
    source: "plan" | "fallback";
    type: string;
    distanceKm?: number;
    pace?: string;
    zone?: string;
    intervalDesc?: string;
    planId?: string;
  };
  recommendation: {
    type: string;
    distanceKm?: number;
    paceRange?: { min: string; max: string };
    zone?: string;
    intervalDesc?: string;
    adjusted: boolean;
    adjustmentReason?: string;
  };
  factors: {
    readiness: { score: number | null; label: string | null };
    injury: { score: number | null; label: string | null };
    plan: {
      hasActivePlan: boolean;
      todayWorkoutExists: boolean;
      todayIsRestPlanned: boolean;
      lthrPaceSource: string;
    };
  };
  rationale: string;
}

/** workoutType 을 한글로. Missing 시 원문 그대로. */
const TYPE_KO: Record<string, string> = {
  easy: "이지",
  long: "롱런",
  tempo: "템포",
  interval: "인터벌",
  recovery: "회복",
  rest: "휴식",
};

function typeKo(t: string): string {
  return TYPE_KO[t] ?? t;
}

function formatWorkoutLine(
  type: string,
  distanceKm: number | undefined,
  paceStr: string | undefined,
  paceRange: { min: string; max: string } | undefined,
  zone: string | undefined,
  intervalDesc: string | undefined,
): string {
  const parts: string[] = [typeKo(type)];
  if (distanceKm !== undefined) parts.push(`${distanceKm}km`);
  if (paceRange) parts.push(`${paceRange.min}~${paceRange.max}/km`);
  else if (paceStr) parts.push(`${paceStr}/km`);
  if (zone) parts.push(zone);
  if (intervalDesc) parts.push(intervalDesc);
  return parts.join(" · ");
}

/** injury factor 이름을 간단한 한글로 매핑 (스펙 F6: top 3 factors). */
const FACTOR_KO: Record<string, string> = {
  hrv_decline: "HRV 하락",
  acwr_load: "ACWR 부하",
  sleep_instability: "수면 불안정",
  resting_hr_rise: "안정시 심박 상승",
};

/**
 * recommendTodayWorkout payload → Telegram HTML 메시지 문자열.
 * factors + 원 계획 vs 조정 제안 대비 + rationale 요약.
 * topFactors 는 별도 인자로 받아 스펙 F6 (Top 3 factors) 반영.
 */
export function formatAutoAdjustMessage(
  payload: RecommendationPayload,
  topFactors: InjuryPayload["topFactors"] = [],
): string {
  const inj = payload.factors.injury;
  const rea = payload.factors.readiness;
  const injStr =
    inj.score !== null
      ? `${inj.score}${inj.label ? ` (${inj.label})` : ""}`
      : "N/A";
  const reaStr =
    rea.score !== null
      ? `${rea.score}${rea.label ? ` (${rea.label})` : ""}`
      : "N/A";

  const baseLine = formatWorkoutLine(
    payload.base.type,
    payload.base.distanceKm,
    payload.base.pace,
    undefined,
    payload.base.zone,
    payload.base.intervalDesc,
  );
  const recLine = formatWorkoutLine(
    payload.recommendation.type,
    payload.recommendation.distanceKm,
    undefined,
    payload.recommendation.paceRange,
    payload.recommendation.zone,
    payload.recommendation.intervalDesc,
  );

  const reason = payload.recommendation.adjustmentReason ?? "";
  const rationale = payload.rationale;

  const source =
    payload.base.source === "plan"
      ? "TrainingPlan"
      : "fallback (plan 없음)";

  const factorsLine =
    topFactors && topFactors.length > 0
      ? [
          "",
          `<b>주요 요인</b>:`,
          ...topFactors
            .slice(0, 3)
            .map(
              (f) =>
                `• ${FACTOR_KO[f.factor] ?? f.factor} ${f.score}${f.detail ? ` (${f.detail})` : ""}`,
            ),
        ]
      : [];

  return [
    `⚠️ <b>Auto-adjust 제안</b> (${payload.date})`,
    "",
    `<b>부상 위험</b>: ${injStr}`,
    `<b>Readiness</b>: ${reaStr}`,
    ...factorsLine,
    "",
    `<b>원 계획</b> (${source}): ${baseLine}`,
    `<b>조정 제안</b>: ${recLine}`,
    ...(reason ? ["", `<b>이유</b>: ${reason}`] : []),
    ...(rationale ? ["", rationale] : []),
    "",
    `<i>Phase 2 부터 Accept/Reject 버튼 제공 예정.</i>`,
  ].join("\n");
}

/**
 * auto-adjust 사전 알림 실행 (cron 진입점).
 * - UserProfile.autoAdjustEnabled === false → skip
 * - recommendation.adjusted === false → skip (조용, 정상 컨디션)
 * - adjusted === true → Telegram push + AIAdvice 로그
 * 조용한 실패 방지: 오류 시 sendToAll 로 사용자 알림.
 */
export async function runAutoAdjustProposal(bot: Bot): Promise<void> {
  try {
    const profile = await prisma.userProfile.findFirst({
      select: { autoAdjustEnabled: true },
    });
    if (profile?.autoAdjustEnabled === false) {
      console.log("[auto-adjust] disabled by UserProfile.autoAdjustEnabled=false");
      return;
    }

    const result = await recommendTodayWorkout();
    const text = result.content[0]?.text ?? "{}";
    const payload = JSON.parse(text) as RecommendationPayload;

    if (!payload.recommendation.adjusted) {
      console.log(
        `[auto-adjust] adjusted=false — 조정 불필요, skip (date=${payload.date})`,
      );
      return;
    }

    // topFactors 는 부가 정보 (F6). 실패해도 조정 제안 자체는 전달되어야 함 (Codex P2 PR #245).
    // recommend-today-workout 이 이미 core 정보를 가지고 있으므로 injury fetch 는 best-effort.
    let topFactors: InjuryPayload["topFactors"] = [];
    try {
      const injuryResult = await getInjuryRiskScore();
      const injuryText = injuryResult.content[0]?.text ?? "{}";
      const injuryPayload = JSON.parse(injuryText) as InjuryPayload;
      topFactors = injuryPayload.topFactors ?? [];
    } catch (injErr) {
      console.warn(
        `[auto-adjust] injury topFactors fetch 실패 — 요인 라인 생략 후 진행: ${sanitizeError(injErr)}`,
      );
    }

    const message = formatAutoAdjustMessage(payload, topFactors);
    const sendResult = await sendToAll(bot, message);

    // 조용한 실패 방지 (기존 runReportCron 패턴): 전송 대상 없음 or 전부 실패 시 escalate.
    if (sendResult.total === 0) {
      console.warn(
        "[auto-adjust] 전송 대상 없음 (TELEGRAM_ALLOWED_CHAT_IDS 미설정?)",
      );
    } else if (sendResult.sent === 0) {
      throw new Error(
        `sendToAll: 모든 채팅 전송 실패 (failed=${sendResult.failed}/total=${sendResult.total})`,
      );
    }

    // AIAdvice audit trail. category=auto_adjust_proposal.
    // 전송은 이미 성공 → DB 실패가 outer catch 로 새면 사용자에게 오탐 실패 알림 감. 별도 격리.
    try {
      await prisma.aIAdvice.create({
        data: {
          category: "auto_adjust_proposal",
          reportDate: payload.date,
          prompt: "auto-adjust cron (recommendTodayWorkout)",
          response: message,
        },
      });
    } catch (dbErr) {
      console.error(
        `[auto-adjust] AIAdvice 저장 실패 (전송은 성공): ${sanitizeError(dbErr)}`,
      );
    }

    console.log(
      `[auto-adjust] proposal sent date=${payload.date} sent=${sendResult.sent}/${sendResult.total}`,
    );
  } catch (error) {
    const msg = sanitizeError(error);
    console.error(`[auto-adjust] 실패: ${msg}`);
    try {
      await sendToAll(bot, `❌ Auto-adjust 알림 실패: ${msg.slice(0, 500)}`);
    } catch (notifyErr) {
      console.error(
        `[auto-adjust] 에러 알림 전송도 실패: ${sanitizeError(notifyErr)}`,
      );
    }
  }
}
