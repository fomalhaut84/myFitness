// #309 (M14 Phase 2 #5): 텔레그램 음식 사진 handler.
// 사진 메시지 수신 → 최대 사이즈 download → temp 저장 → Vision → FoodLog 생성 → 3-버튼 답장.
// 이미지는 처리 후 즉시 삭제 (spec: 보관 안 함).

import fs from "fs/promises";
import { createWriteStream } from "fs";
import https from "https";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import type { Bot, Context } from "grammy";
import prisma from "../prisma";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { markStaleRecalcDate } from "@/lib/nutrition/stale-recalc";
import { estimateNutritionFromPhoto } from "@/lib/nutrition/estimate-nutrition-photo";
import { buildFoodInlineKeyboard } from "./food-edit-callback";
import { MEAL_LABELS, MEAL_PATTERNS, CONFIDENCE_LABEL } from "./food";
import { telegramAgent } from "../index";

const TG_FILE_HOST = "https://api.telegram.org/file/bot";
// Codex P1 (PR #310 3회차): grammy 는 IPv4-only agent 로 통신하는데 download 가 global fetch 면
// IPv6-preferred 로 stall 위험. https.request 로 telegramAgent 재사용.
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** KST 시간대별 mealType 추정. 사용자가 캡션으로 명시하지 않은 경우 fallback. */
function guessMealTypeByKstTime(now: Date = new Date()): string {
  const kstHour = Number(
    now.toLocaleString("en-US", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }),
  );
  if (kstHour >= 5 && kstHour < 11) return "breakfast";
  if (kstHour >= 11 && kstHour < 15) return "lunch";
  if (kstHour >= 15 && kstHour < 18) return "snack";
  if (kstHour >= 18 && kstHour < 22) return "dinner";
  return "snack";
}

function extractMealFromCaption(caption?: string): { mealType: string; residual: string } | null {
  if (!caption) return null;
  const trimmed = caption.trim();
  const meal = MEAL_PATTERNS.find((m) => m.pattern.test(trimmed));
  if (!meal) return null;
  const residual = trimmed.replace(meal.pattern, "").trim();
  return { mealType: meal.type, residual };
}

async function downloadTo(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { agent: telegramAgent, timeout: DOWNLOAD_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`텔레그램 파일 다운로드 실패 (${res.statusCode ?? "?"})`));
          return;
        }
        pipeline(res, createWriteStream(dest))
          .then(() => resolve())
          .catch(reject);
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`텔레그램 다운로드 timeout (${DOWNLOAD_TIMEOUT_MS}ms)`));
    });
    req.on("error", reject);
  });
}

export function registerFoodPhotoHandler(bot: Bot): void {
  bot.on("message:photo", async (ctx) => {
    try {
      await handleFoodPhoto(ctx);
    } catch (err) {
      console.error("[food-photo] handler 예외:", err);
      try {
        await ctx.reply("사진 처리 중 오류가 발생했습니다. 다시 시도해주세요.");
      } catch {
        // ignore
      }
    }
  });
}

async function handleFoodPhoto(ctx: Context): Promise<void> {
  const message = ctx.message;
  if (!message?.photo || message.photo.length === 0) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    await ctx.reply("서버 설정 오류 (bot token 없음). 관리자에게 문의해주세요.");
    return;
  }

  // Codex P2 (PR #310 4회차): 자정 근처 사진이 download + Vision (최대 45s) 이 지나 다음날로
  // 저장되는 것 방지. message.date (텔레그램 unix seconds) 를 사진 촬영·전송 시점으로 사용.
  // fallback 은 handler 진입 시점 — Vision 대기 시간에 영향 안 받음.
  const photoTimestamp =
    typeof message.date === "number" ? new Date(message.date * 1000) : new Date();

  const largest = message.photo[message.photo.length - 1];

  // 즉시 사용자 피드백. Vision 이 30초 이상 걸릴 수 있어 무응답 방지.
  try {
    await ctx.replyWithChatAction?.("typing");
  } catch {
    // ignore
  }
  let ackMsgId: number | undefined;
  try {
    const ack = await ctx.reply("🖼️ 사진 분석 중… (약 20~40초 소요)");
    ackMsgId = ack.message_id;
  } catch {
    // ignore
  }

  // 캡션 파싱 → mealType + 잔여 description.
  // Codex P2 (PR #310 5회차): 무캡션 mealType 추정도 photoTimestamp 기준. handler 진입 시점 (now)
  // 을 쓰면 KST 식사 boundary (10:59 → 11:00 등) 근처 재처리 시 timestamp 와 mealType 불일치 →
  // repeat-lookup / backfill mealType 매칭 어긋남.
  const rawCaption = message.caption?.trim();
  const parsed = extractMealFromCaption(rawCaption);
  const mealType = parsed?.mealType ?? guessMealTypeByKstTime(photoTimestamp);
  const caption = (parsed?.residual ?? rawCaption)?.trim() || undefined;

  // 텔레그램 파일 다운로드 → temp.
  const rand = Math.random().toString(36).slice(2, 10);
  const tempPath = path.join(os.tmpdir(), `mfp-photo-${Date.now()}-${rand}.jpg`);
  try {
    const file = await ctx.api.getFile(largest.file_id);
    if (!file.file_path) {
      throw new Error("텔레그램 파일 경로 없음");
    }
    const url = `${TG_FILE_HOST}${token}/${file.file_path}`;
    await downloadTo(url, tempPath);

    const estimate = await estimateNutritionFromPhoto({
      imagePath: tempPath,
      caption,
      mealType,
    });

    // Codex P2 (PR #310): Vision 실패 + caption 없음 → FoodLog 저장 안 함 (kcal null +
    // meaningless description "사진 (분석 실패)" 이 backfill 큐에 들어가 매 tick 텍스트
    // estimator 로 무한 재시도). 사용자에게 재시도/텍스트 입력 안내만.
    if (!estimate && !caption) {
      await ctx.reply(
        "⚠️ Vision 분석 실패 — 사진을 다시 보내거나, 텍스트 (예: 아침 김치찌개 밥) 로 입력해주세요.",
      );
      return;
    }

    // description 결정: caption 우선 → Vision items 요약 → fallback.
    const description = caption
      ? caption
      : estimate?.items && estimate.items.length > 0
        ? estimate.items.map((i) => i.name).join(" · ")
        : "사진 (분석 실패)";

    const log = await prisma.foodLog.create({
      data: {
        date: photoTimestamp,
        description,
        mealType,
        estimatedKcal: estimate?.kcal ?? null,
        proteinG: estimate?.proteinG ?? null,
        carbsG: estimate?.carbsG ?? null,
        fatG: estimate?.fatG ?? null,
      },
      select: { id: true },
    });

    // 칼로리 밸런스 재계산. 실패 시 stale queue mark (기존 food.ts recalcWithRetry 로직 축약).
    try {
      await recalculateCalorieBalance(photoTimestamp, undefined, prisma);
    } catch (err) {
      console.warn(
        `[food-photo] recalc 실패, stale queue 등록: ${err instanceof Error ? err.message : String(err)}`,
      );
      try {
        await markStaleRecalcDate(photoTimestamp);
      } catch {
        // ignore
      }
    }

    // 응답 조립.
    const mealLabel = MEAL_LABELS[mealType] ?? mealType;
    const lines: string[] = [`✅ ${mealLabel} 기록 완료`, `📝 ${description}`];
    if (estimate) {
      lines.push(
        `📊 약 ${estimate.kcal.toLocaleString("ko-KR")} kcal (신뢰도 ${CONFIDENCE_LABEL[estimate.confidence]})`,
      );
      const p = estimate.proteinG;
      const c = estimate.carbsG;
      const f = estimate.fatG;
      if (p !== null && c !== null && f !== null) {
        lines.push(`🥩 P ${Math.round(p)}g · C ${Math.round(c)}g · F ${Math.round(f)}g`);
      }
      if (estimate.notes) lines.push(`ℹ️ ${estimate.notes}`);
    } else {
      lines.push("⚠️ Vision 분석 실패 — [🔢 kcal] 로 직접 입력하거나 [🗑️ 삭제] 후 다시 시도");
    }

    // 최종 응답 (ack 삭제는 아래 finally 에서 정리).
    await ctx.reply(lines.join("\n"), {
      reply_markup: buildFoodInlineKeyboard(log.id),
    });
  } finally {
    // 사전 리뷰 P1 (feat/309-1): ack 삭제를 finally 로. 이전엔 성공 경로에서만 삭제 →
    // getFile/download/Vision/DB 중 throw 시 "🖼️ 사진 분석 중…" 이 채팅에 영구히 남고
    // 상위 catch 의 에러 답장과 중첩되어 상태 혼란. 실패 경로에서도 반드시 정리.
    if (ackMsgId !== undefined && ctx.chat?.id !== undefined) {
      await ctx.api.deleteMessage(ctx.chat.id, ackMsgId).catch(() => {
        // ignore — 이미 삭제됐거나 권한 이슈
      });
    }
    await fs.unlink(tempPath).catch(() => {
      // ignore — temp 정리 실패는 치명적이지 않음
    });
  }
}
