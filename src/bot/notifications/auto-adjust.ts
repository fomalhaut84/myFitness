// M13 Phase 1 (#243) + Phase 2 (#249): auto-adjust 사전 알림.
// 아침 이른 시각 cron 이 recommendTodayWorkout() 을 실행 → 조정 필요 시 (recommendation.adjusted)
// Telegram push 로 사용자에게 사전 안내.
//
// Phase 1 은 read-only. Phase 2 부터 inline keyboard (Accept/Reject/Snooze) + WorkoutAdjustment
// 이력 저장 + Accept 시 TrainingWorkout 실제 update + Snooze DB 재전송 flow 추가.

import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import prisma from "@/lib/prisma";
import { recommendTodayWorkout } from "@/mcp/tools/recommend-today-workout";
import { getInjuryRiskScore } from "@/mcp/tools/injury-risk";
import { preSyncForReport } from "@/lib/daily-report";
import { todayKST, ymdKST } from "@/lib/garmin/utils";
import { sanitizeError } from "../utils/error";
import { sendToAll, sendToAllWithKeyboard, type SendKeyboardResult } from "./scheduler";

/** M13 Phase 2 callback_data prefix. 형식: `auto_adjust:<action>:<adjustmentId>` */
export const CALLBACK_PREFIX = "auto_adjust";

/** "M:SS" → sec. 실패 시 null. */
function parsePaceMinSec(s: string): number | null {
  const m = /^(\d+):(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(sec) || sec >= 60) return null;
  return min * 60 + sec;
}

/**
 * 조정 제안의 대표 pace (sec/km) 추출.
 * recommendation.paceRange 는 { min: "M:SS", max: "M:SS" } 형식. 평균을 취해 단일 값 저장.
 * paceRange 없고 조정 후 type 이 원 type 그대로면 base.pace 재사용 (조정 후에도 페이스 동일한 케이스).
 * 조정 type 이 rest 또는 원 type 과 다르면 fallback 하지 않고 null (PR #250 pre-review P1).
 * 예: 원 easy 5:00 + rest 로 조정 → paceSecPerKm=null (rest 인데 페이스 stale 방지).
 */
function extractProposedPaceSec(
  rec: { type: string; paceRange?: { min: string; max: string } },
  payload: { base: { type: string; pace?: string } },
): number | null {
  if (rec.type === "rest") return null;
  if (rec.paceRange) {
    const lo = parsePaceMinSec(rec.paceRange.min);
    const hi = parsePaceMinSec(rec.paceRange.max);
    if (lo !== null && hi !== null) return Math.round((lo + hi) / 2);
    if (lo !== null) return lo;
    if (hi !== null) return hi;
  }
  // paceRange 없을 때는 원 계획 그대로 유지되는 경우에만 base pace fallback.
  if (rec.type === payload.base.type && payload.base.pace) {
    return parsePaceMinSec(payload.base.pace);
  }
  return null;
}

/** Phase 2: Accept/Reject/Snooze 3-way inline keyboard 구성. */
export function buildAutoAdjustKeyboard(adjustmentId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Accept", `${CALLBACK_PREFIX}:accept:${adjustmentId}`)
    .text("❌ Reject", `${CALLBACK_PREFIX}:reject:${adjustmentId}`)
    .text("💤 Snooze 1h", `${CALLBACK_PREFIX}:snooze:${adjustmentId}`);
}

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

/**
 * Telegram HTML parse mode 에서 안전한 escape (Codex bot PR #250 재리뷰 P2).
 * dynamic 값 (rationale, factor detail, workout notes 등) 에 < > & 가 있으면 parse
 * 실패 → 메시지 전체 전송 실패 → 사용자에게 keyboard 도달 X. 모든 사용자 노출 문자열을
 * escape 후 조합.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** workoutType 을 한글로. Missing 시 원문 그대로. cron 재알림에서도 재사용 (PR #250 P1). */
export const TYPE_KO: Record<string, string> = {
  easy: "이지",
  long: "롱런",
  tempo: "템포",
  interval: "인터벌",
  recovery: "회복",
  rest: "휴식",
};

export function typeKo(t: string): string {
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
  const parts: string[] = [escapeHtml(typeKo(type))];
  if (distanceKm !== undefined) parts.push(`${distanceKm}km`);
  if (paceRange)
    parts.push(
      `${escapeHtml(paceRange.min)}~${escapeHtml(paceRange.max)}/km`,
    );
  else if (paceStr) parts.push(`${escapeHtml(paceStr)}/km`);
  if (zone) parts.push(escapeHtml(zone));
  if (intervalDesc) parts.push(escapeHtml(intervalDesc));
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
      ? `${inj.score}${inj.label ? ` (${escapeHtml(inj.label)})` : ""}`
      : "N/A";
  const reaStr =
    rea.score !== null
      ? `${rea.score}${rea.label ? ` (${escapeHtml(rea.label)})` : ""}`
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
          ...topFactors.slice(0, 3).map((f) => {
            const name = escapeHtml(FACTOR_KO[f.factor] ?? f.factor);
            const detail = f.detail ? ` (${escapeHtml(f.detail)})` : "";
            return `• ${name} ${f.score}${detail}`;
          }),
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
    ...(reason ? ["", `<b>이유</b>: ${escapeHtml(reason)}`] : []),
    ...(rationale ? ["", escapeHtml(rationale)] : []),
    "",
    `<i>아래 버튼으로 계획 반영 여부를 선택하세요.</i>`,
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

    // Codex P2 (PR #245 #4709832686): 06:30 cron 이 06:00 웹 sync 완료 전 or
    // 사용자가 sync 이후 sleep 업로드하면 stale readiness/injury data 로 잘못된
    // 조정 제안 or 필요한 down-scale skip. 모닝 리포트와 동일한 preSyncForReport
    // 재사용 (sleep/daily_stats/heart_rate/activities 어제~오늘 range).
    // 실패 시 warn 후 진행 (기존 daily-report 패턴 그대로).
    await preSyncForReport();

    const result = await recommendTodayWorkout();
    const text = result.content[0]?.text ?? "{}";
    const payload = JSON.parse(text) as RecommendationPayload;

    // Codex P2 (PR #245 #4709917570): 계획된 rest / race day 는 recommendTodayWorkout 이
    // fallback easy 를 base 로 쓰기 때문에 injury 상승 시 adjusted=true 로 잘못 트리거.
    // M13 스펙 "제외 사항" 에 race day 자동 조정 제외 명시. plan.todayIsRestPlanned 우선 skip.
    if (payload.factors.plan.todayIsRestPlanned) {
      console.log(
        `[auto-adjust] todayIsRestPlanned=true — 계획된 rest/race day, skip (date=${payload.date})`,
      );
      return;
    }

    // M13 Phase 2 (#249): 실제 계획된 workout 이 있을 때만 제안 (no-plan / no-workout fallback skip).
    // Accept 시 update 대상 없으면 audit 만 남고 사용자 혼란 → 발송 자체 skip.
    if (
      !payload.factors.plan.hasActivePlan ||
      !payload.factors.plan.todayWorkoutExists
    ) {
      console.log(
        `[auto-adjust] no active plan / no today workout — Phase 2 skip (date=${payload.date})`,
      );
      return;
    }

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

    // M13 Phase 2: 오늘 실제 TrainingWorkout 조회. Accept 시 이 row 를 update.
    // planWorkout.type/distanceKm 은 payload 에 있지만 workoutId 는 없어 별도 조회.
    // 원 필드 스냅샷도 함께 fetch (Accept 시 덮어씀에 따른 데이터 손실 방지, PR #250 P2).
    const todayStr = ymdKST(todayKST());
    const todayWorkout = await prisma.trainingWorkout.findFirst({
      where: {
        date: new Date(`${todayStr}T00:00:00.000Z`),
        plan: { status: "active" },
      },
      select: {
        id: true,
        type: true,
        distanceKm: true,
        paceSecPerKm: true,
        zone: true,
        intervalDesc: true,
        notes: true,
      },
    });
    if (!todayWorkout) {
      // hasActivePlan/todayWorkoutExists 로 이미 gated 됐지만 race condition 대비.
      console.warn(
        `[auto-adjust] TrainingWorkout row 조회 실패 (date=${todayStr}) — skip`,
      );
      return;
    }

    const message = formatAutoAdjustMessage(payload, topFactors);
    const rec = payload.recommendation;

    // M13 Phase 2: WorkoutAdjustment insert (decision=pending). 전송 실패 시 별도 처리.
    const adjustment = await prisma.workoutAdjustment.create({
      data: {
        workoutId: todayWorkout.id,
        decision: "pending",
        proposedType: rec.type,
        proposedDistanceKm: rec.distanceKm ?? null,
        proposedPaceSecPerKm: extractProposedPaceSec(rec, payload),
        proposedZone: rec.zone ?? null,
        proposedIntervalDesc: rec.intervalDesc ?? null,
        // 원 workout 스냅샷 (Accept 되면 in-place update 로 소실 → rollback/감사용).
        originalType: todayWorkout.type,
        originalDistanceKm: todayWorkout.distanceKm,
        originalPaceSecPerKm: todayWorkout.paceSecPerKm,
        originalZone: todayWorkout.zone,
        originalIntervalDesc: todayWorkout.intervalDesc,
        originalNotes: todayWorkout.notes,
        reason: {
          injury: payload.factors.injury,
          readiness: payload.factors.readiness,
          topFactors,
          adjustmentReason: rec.adjustmentReason ?? null,
          rationale: payload.rationale,
        },
      },
    });

    const keyboard = buildAutoAdjustKeyboard(adjustment.id);
    const sendResult: SendKeyboardResult = await sendToAllWithKeyboard(
      bot,
      message,
      keyboard,
    );

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

    // Callback 매칭용 message id / chat id 저장. best-effort — 실패해도 사용자 알림 유지.
    if (sendResult.first) {
      try {
        await prisma.workoutAdjustment.update({
          where: { id: adjustment.id },
          data: {
            telegramMessageId: String(sendResult.first.messageId),
            telegramChatId: sendResult.first.chatId,
          },
        });
      } catch (dbErr) {
        console.error(
          `[auto-adjust] adjustment ${adjustment.id} messageId 저장 실패: ${sanitizeError(dbErr)}`,
        );
      }
    }

    // AIAdvice audit trail. category=auto_adjust_proposal. 별도 격리 (기존 패턴).
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
      `[auto-adjust] proposal sent date=${payload.date} sent=${sendResult.sent}/${sendResult.total} adjustment=${adjustment.id}`,
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
