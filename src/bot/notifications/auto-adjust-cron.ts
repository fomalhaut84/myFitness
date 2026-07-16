// M13 Phase 2 (#249): auto-adjust 스누즈 재전송 + TTL expire cron.
// 5분 주기.
//   1) snoozed + snoozeUntil <= now → 원 조정 메시지 재전송 후 decision=pending, snoozeUntil=null
//   2) (pending|snoozed) + proposedAt+8h 초과 or 자정 KST 지남 → decision=expired

import type { Bot } from "grammy";
import prisma from "@/lib/prisma";
import { sanitizeError } from "../utils/error";
import { buildAutoAdjustKeyboard, escapeHtml, typeKo } from "./auto-adjust";
import { sendToAllWithKeyboard } from "./scheduler";
import { todayKST, ymdKST } from "@/lib/garmin/utils";

const TTL_HOURS = 8;

/** M:SS 포맷 (paceSecPerKm → 사용자 노출). */
function formatPace(sec: number | null | undefined): string | null {
  if (sec === null || sec === undefined) return null;
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** 조정 스냅샷을 재전송 메시지로 포맷. */
function formatSnoozeMessage(adj: {
  id: string;
  proposedType: string;
  proposedDistanceKm: number | null;
  proposedPaceSecPerKm: number | null;
  proposedZone: string | null;
  proposedIntervalDesc: string | null;
  reason: unknown;
}): string {
  const paceStr = formatPace(adj.proposedPaceSecPerKm);
  const parts: string[] = [escapeHtml(typeKo(adj.proposedType))];
  if (adj.proposedDistanceKm !== null) parts.push(`${adj.proposedDistanceKm}km`);
  if (paceStr) parts.push(`${escapeHtml(paceStr)}/km`);
  if (adj.proposedZone) parts.push(escapeHtml(adj.proposedZone));
  if (adj.proposedIntervalDesc) parts.push(escapeHtml(adj.proposedIntervalDesc));

  const reasonObj = adj.reason as
    | { adjustmentReason?: string; rationale?: string }
    | null;
  const reasonLine =
    reasonObj?.adjustmentReason ?? reasonObj?.rationale ?? null;

  return [
    `⏰ <b>Auto-adjust 재알림</b> (Snooze 만료)`,
    "",
    `<b>조정 제안</b>: ${parts.join(" · ")}`,
    ...(reasonLine ? ["", `<b>이유</b>: ${escapeHtml(reasonLine)}`] : []),
    "",
    `<i>아래 버튼으로 계획 반영 여부를 선택하세요.</i>`,
  ].join("\n");
}

/** KST 자정 timestamp (오늘 00:00 KST). 이후 pending 은 stale. */
function kstMidnightToday(): Date {
  const todayStr = ymdKST(todayKST());
  return new Date(`${todayStr}T00:00:00+09:00`);
}

/** 스누즈 재전송 1건 처리. best-effort — 실패해도 다른 건 진행. */
async function processSnoozed(
  bot: Bot,
  adj: {
    id: string;
    proposedType: string;
    proposedDistanceKm: number | null;
    proposedPaceSecPerKm: number | null;
    proposedZone: string | null;
    proposedIntervalDesc: string | null;
    reason: unknown;
  },
): Promise<void> {
  const message = formatSnoozeMessage(adj);
  const keyboard = buildAutoAdjustKeyboard(adj.id);
  const sendResult = await sendToAllWithKeyboard(bot, message, keyboard);
  if (sendResult.total === 0) {
    console.warn("[auto-adjust-cron] snooze 재전송 대상 없음");
    return;
  }
  if (sendResult.sent === 0) {
    throw new Error(
      `snooze 재전송 실패 (${sendResult.failed}/${sendResult.total})`,
    );
  }
  await prisma.workoutAdjustment.update({
    where: { id: adj.id },
    data: {
      decision: "pending",
      snoozeUntil: null,
      // 새 message id 로 교체 (이전 message 는 keyboard 유지되어 있으나 새 pending 이 canonical).
      telegramMessageId: sendResult.first
        ? String(sendResult.first.messageId)
        : null,
      telegramChatId: sendResult.first?.chatId ?? null,
    },
  });
  console.log(`[auto-adjust-cron] snooze 재전송 완료 adj=${adj.id}`);
}

/**
 * 스누즈 재전송 + TTL expire 사이클 (1 tick).
 * cron 이 아니라 캘러가 호출 — scheduler.ts 에서 setInterval 로 5분 주기 실행.
 */
export async function runAutoAdjustMaintenance(bot: Bot): Promise<void> {
  const now = new Date();
  const ttlCutoff = new Date(now.getTime() - TTL_HOURS * 60 * 60 * 1000);
  const midnight = kstMidnightToday();

  // 1) 자정 지남 or 8h 초과 pending/snoozed → expired.
  try {
    const expiredResult = await prisma.workoutAdjustment.updateMany({
      where: {
        decision: { in: ["pending", "snoozed"] },
        OR: [{ proposedAt: { lt: ttlCutoff } }, { proposedAt: { lt: midnight } }],
      },
      data: {
        decision: "expired",
        decidedAt: now,
        snoozeUntil: null,
      },
    });
    if (expiredResult.count > 0) {
      console.log(
        `[auto-adjust-cron] ${expiredResult.count} adjustment(s) expired`,
      );
    }
  } catch (err) {
    console.error(
      `[auto-adjust-cron] expire 실패: ${sanitizeError(err)}`,
    );
  }

  // 2) 재전송 due snooze. TTL expire 이후 남은 것만.
  try {
    const dueSnoozes = await prisma.workoutAdjustment.findMany({
      where: {
        decision: "snoozed",
        snoozeUntil: { lte: now },
      },
      select: {
        id: true,
        proposedType: true,
        proposedDistanceKm: true,
        proposedPaceSecPerKm: true,
        proposedZone: true,
        proposedIntervalDesc: true,
        reason: true,
      },
      take: 10, // 대량 rush 방지
    });
    for (const adj of dueSnoozes) {
      try {
        await processSnoozed(bot, adj);
      } catch (err) {
        console.error(
          `[auto-adjust-cron] snooze 재전송 실패 adj=${adj.id}: ${sanitizeError(err)}`,
        );
      }
    }
  } catch (err) {
    console.error(
      `[auto-adjust-cron] snooze 조회 실패: ${sanitizeError(err)}`,
    );
  }
}
