// M13 Phase 2 (#249): auto-adjust 제안에 대한 Telegram callback 처리.
// Accept/Reject/Snooze 3-way inline keyboard callback → decision update + Accept 시
// TrainingWorkout 실제 반영.

import type { Bot } from "grammy";
import prisma from "@/lib/prisma";
import { todayKST, ymdKST } from "@/lib/garmin/utils";
import { sanitizeError } from "../utils/error";
import { CALLBACK_PREFIX } from "./auto-adjust";

const SNOOZE_MS = 60 * 60 * 1000;
const NOTES_PREFIX = "M13 auto-adjust";

// #249 Codex bot PR #250 P2: callback TTL. cron 이 아직 expired 마킹 안 했더라도 이 시각 넘긴
// adjustment 는 callback 에서도 accept/snooze 거부. TTL_HOURS 는 cron 과 동일.
const TTL_HOURS = 8;

/** proposedAt 이 TTL 밖 (8h 초과 or 자정 KST 지남) 이면 true. */
function isTtlExpired(proposedAt: Date): boolean {
  const now = Date.now();
  if (now - proposedAt.getTime() > TTL_HOURS * 60 * 60 * 1000) return true;
  const midnight = new Date(`${ymdKST(todayKST())}T00:00:00+09:00`);
  if (proposedAt < midnight) return true;
  return false;
}

interface Adjustment {
  id: string;
  workoutId: string | null;
  decision: string;
  proposedType: string;
  proposedDistanceKm: number | null;
  proposedPaceSecPerKm: number | null;
  proposedZone: string | null;
  proposedIntervalDesc: string | null;
  originalType: string | null;
  originalDistanceKm: number | null;
  originalPaceSecPerKm: number | null;
  originalZone: string | null;
  originalIntervalDesc: string | null;
  originalNotes: string | null;
  reason: unknown;
}

/**
 * callback_data 형식 `auto_adjust:<action>:<adjustmentId>` 파싱.
 * 매치 안 되면 null (다른 callback 처리기가 있을 수 있음).
 */
function parseCallbackData(
  data: string,
): { action: "accept" | "reject" | "snooze"; adjustmentId: string } | null {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== CALLBACK_PREFIX) return null;
  const action = parts[1];
  if (action !== "accept" && action !== "reject" && action !== "snooze")
    return null;
  return { action, adjustmentId: parts[2] };
}

/** 조정 사유 문자열 (reason.adjustmentReason 우선, 없으면 rationale). */
function reasonText(reason: unknown): string | null {
  if (!reason || typeof reason !== "object") return null;
  const r = reason as { adjustmentReason?: string; rationale?: string };
  if (typeof r.adjustmentReason === "string" && r.adjustmentReason) {
    return r.adjustmentReason;
  }
  if (typeof r.rationale === "string" && r.rationale) return r.rationale;
  return null;
}

/**
 * Atomic decision transition (Codex bot PR #250 재리뷰 P1).
 * `updateMany` + WHERE decision IN [pending, snoozed] 로 conditional update.
 * count===0 이면 다른 callback 이 먼저 결정 → caller 는 no-op 안내.
 */
const ALREADY_DECIDED = "⚠️ 이미 다른 요청으로 결정된 제안입니다.";

const PLAN_ARCHIVED =
  "⚠️ 대상 workout 이 archived 된 plan 소속입니다. 조정을 반영하지 않았습니다.";
const STALE_EDIT =
  "⚠️ 이 제안 이후 workout 이 수동으로 편집됐습니다. 자동 조정을 반영하지 않았습니다.";

/** 트랜잭션 내부에서 workout update 가 race 로 실패했을 때 tx rollback 유도. */
class ConcurrentEditError extends Error {
  constructor() {
    super("workout snapshot no longer matches at update time");
  }
}

async function handleAccept(adj: Adjustment): Promise<string> {
  if (!adj.workoutId) {
    // Phase 2 는 workoutId 없이 제안 발송 안 함. defensive.
    return "workoutId 가 없어 계획을 반영할 수 없습니다.";
  }
  const reason = reasonText(adj.reason);
  const adjustLine = reason ? `${NOTES_PREFIX}: ${reason}` : NOTES_PREFIX;
  const notes = adj.originalNotes
    ? `${adjustLine}\n\n${adj.originalNotes}`
    : adjustLine;

  // 트랜잭션 내부: (1) plan 활성 + workout 값이 여전히 스냅샷과 일치하는지 확인
  // (2) conditional adjustment update (3) workout update — atomic snapshot WHERE.
  // 하나라도 실패 시 rollback.
  let outcome:
    | { updated: true }
    | {
        updated: false;
        reason: "not_active" | "stale_edit" | "already_decided";
      };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      // (1) workout row 최신 상태 fetch. active plan 소속 + 원 스냅샷과 값 일치 확인.
      const current = await tx.trainingWorkout.findFirst({
        where: { id: adj.workoutId!, plan: { status: "active" } },
        select: {
          id: true,
          type: true,
          distanceKm: true,
          paceSecPerKm: true,
          zone: true,
          intervalDesc: true,
          notes: true,
          autoAdjusted: true,
        },
      });
      if (!current) return { updated: false, reason: "not_active" as const };
      if (
        current.type !== adj.originalType ||
        current.distanceKm !== adj.originalDistanceKm ||
        current.paceSecPerKm !== adj.originalPaceSecPerKm ||
        current.zone !== adj.originalZone ||
        current.intervalDesc !== adj.originalIntervalDesc ||
        current.notes !== adj.originalNotes ||
        current.autoAdjusted
      ) {
        return { updated: false, reason: "stale_edit" as const };
      }

      // (2) conditional adjustment update (동시 콜백 race).
      const upd = await tx.workoutAdjustment.updateMany({
        where: { id: adj.id, decision: { in: ["pending", "snoozed"] } },
        data: {
          decision: "accepted",
          decidedAt: new Date(),
          snoozeUntil: null,
        },
      });
      if (upd.count === 0)
        return { updated: false, reason: "already_decided" as const };

      // (3) atomic snapshot-guarded workout update. read-committed 하에서 (1) 이후 커밋된
      // web edit / plan 재생성/취소도 잡아냄. WHERE 에 원 필드 + plan.status="active"
      // 전체 매칭 → 불일치 시 count=0 → throw 로 rollback.
      // Codex bot PR #250 6/8라운드 P2.
      const wUpd = await tx.trainingWorkout.updateMany({
        where: {
          id: adj.workoutId!,
          type: adj.originalType,
          distanceKm: adj.originalDistanceKm,
          paceSecPerKm: adj.originalPaceSecPerKm,
          zone: adj.originalZone,
          intervalDesc: adj.originalIntervalDesc,
          notes: adj.originalNotes,
          autoAdjusted: false,
          plan: { status: "active" },
        },
        data: {
          type: adj.proposedType,
          distanceKm: adj.proposedDistanceKm,
          paceSecPerKm: adj.proposedPaceSecPerKm,
          zone: adj.proposedZone,
          intervalDesc: adj.proposedIntervalDesc,
          notes,
          autoAdjusted: true,
        },
      });
      if (wUpd.count === 0) throw new ConcurrentEditError();
      return { updated: true };
    });
  } catch (err) {
    if (err instanceof ConcurrentEditError) return STALE_EDIT;
    throw err;
  }
  if (outcome.updated)
    return "✅ 오늘 workout 을 조정된 값으로 반영했습니다.";
  if (outcome.reason === "not_active") return PLAN_ARCHIVED;
  if (outcome.reason === "stale_edit") return STALE_EDIT;
  return ALREADY_DECIDED;
}

async function handleReject(adj: Adjustment): Promise<string> {
  const upd = await prisma.workoutAdjustment.updateMany({
    where: { id: adj.id, decision: { in: ["pending", "snoozed"] } },
    data: {
      decision: "rejected",
      decidedAt: new Date(),
      snoozeUntil: null,
    },
  });
  return upd.count > 0
    ? "❌ 조정 제안을 거절했습니다. 원 계획을 유지합니다."
    : ALREADY_DECIDED;
}

async function handleSnooze(adj: Adjustment): Promise<string> {
  const snoozeUntil = new Date(Date.now() + SNOOZE_MS);
  const upd = await prisma.workoutAdjustment.updateMany({
    where: { id: adj.id, decision: { in: ["pending", "snoozed"] } },
    data: {
      decision: "snoozed",
      snoozeUntil,
    },
  });
  if (upd.count === 0) return ALREADY_DECIDED;
  // Codex P3 PR #250 9라운드: KST 명시 (서버 TZ 가 UTC 일 경우 사용자에게 22:30 처럼
  // 잘못 보이는 것 방지).
  const kstStr = snoozeUntil.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  });
  return `💤 1시간 뒤 (~${kstStr}) 재알림합니다.`;
}

/**
 * grammy bot 에 callback handler 등록. `bot.callbackQuery(/^auto_adjust:/, ...)` 로 매칭.
 * decision 이 이미 결정된 상태면 no-op (idempotent — 중복 클릭 안전).
 */
export function registerAutoAdjustCallback(bot: Bot): void {
  bot.callbackQuery(new RegExp(`^${CALLBACK_PREFIX}:`), async (ctx) => {
    const data = ctx.callbackQuery.data ?? "";
    const parsed = parseCallbackData(data);
    if (!parsed) {
      await ctx.answerCallbackQuery({ text: "알 수 없는 요청입니다." });
      return;
    }
    try {
      const adj = await prisma.workoutAdjustment.findUnique({
        where: { id: parsed.adjustmentId },
        select: {
          id: true,
          workoutId: true,
          decision: true,
          proposedAt: true,
          proposedType: true,
          proposedDistanceKm: true,
          proposedPaceSecPerKm: true,
          proposedZone: true,
          proposedIntervalDesc: true,
          originalType: true,
          originalDistanceKm: true,
          originalPaceSecPerKm: true,
          originalZone: true,
          originalIntervalDesc: true,
          originalNotes: true,
          reason: true,
        },
      });
      if (!adj) {
        await ctx.answerCallbackQuery({ text: "이미 만료된 제안입니다." });
        return;
      }
      // 이미 최종 상태면 no-op. Snooze 는 pending 처럼 재결정 허용.
      if (
        adj.decision === "accepted" ||
        adj.decision === "rejected" ||
        adj.decision === "expired"
      ) {
        await ctx.answerCallbackQuery({
          text: `이미 처리됨: ${adj.decision}`,
        });
        return;
      }
      // Codex bot PR #250 재리뷰 P2: TTL 체크. cron 이 아직 expired 마킹 못 한 경우에도
      // callback 에서 accept/snooze 거부. best-effort 로 decision=expired 마킹.
      if (isTtlExpired(adj.proposedAt)) {
        try {
          await prisma.workoutAdjustment.updateMany({
            where: {
              id: adj.id,
              decision: { in: ["pending", "snoozed"] },
            },
            data: {
              decision: "expired",
              decidedAt: new Date(),
              snoozeUntil: null,
            },
          });
        } catch (expireErr) {
          console.warn(
            `[auto-adjust-callback] TTL expire mark 실패 (무시): ${sanitizeError(expireErr)}`,
          );
        }
        await ctx.answerCallbackQuery({
          text: "⏰ 제안 유효 시간이 지났습니다. 계획을 반영하지 않았습니다.",
        });
        return;
      }
      let notice: string;
      if (parsed.action === "accept") notice = await handleAccept(adj);
      else if (parsed.action === "reject") notice = await handleReject(adj);
      else notice = await handleSnooze(adj);

      await ctx.answerCallbackQuery({ text: notice });
      try {
        // Accept/Reject 시 keyboard 제거 (중복 클릭 방지). Snooze 는 유지 (재알림 후 재결정).
        if (parsed.action !== "snooze") {
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
        }
      } catch (editErr) {
        // 오래된 메시지는 편집 실패 — 무시.
        console.warn(
          `[auto-adjust-callback] keyboard 편집 실패 (무시): ${sanitizeError(editErr)}`,
        );
      }
    } catch (error) {
      console.error(
        `[auto-adjust-callback] 처리 실패 adj=${parsed.adjustmentId}: ${sanitizeError(error)}`,
      );
      await ctx.answerCallbackQuery({
        text: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.",
      });
    }
  });
}
