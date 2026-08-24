import { NextResponse } from "next/server";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { estimateNutritionFromText } from "@/lib/nutrition/estimate-nutrition";
import { estimateNutritionFromMfds } from "@/lib/nutrition/estimate-nutrition-mfds";
import { estimateNutritionFromPhoto } from "@/lib/nutrition/estimate-nutrition-photo";
import { findRecentSameDescription } from "@/lib/nutrition/repeat-lookup";
import { scaleMacrosForNewKcal } from "@/lib/nutrition/scale-macros";
import { scaleItemsForNewKcal, type FoodItemBreakdown } from "@/lib/nutrition/food-items";

// #309 (M14 Phase 2 #5): 사진 업로드 상한 (client 에서 downscale 후 upload 하지만 방어).
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
// Codex P2 (PR #310 8회차): multipart body 는 image + boundary + header overhead 포함해 이미지
// 상한보다 항상 크다. Content-Length 상한을 image 상한 + 64KB 여유로 잡아 8MB 근접 이미지가
// framing overhead 로 413 튕기지 않게. image.size 후속 체크는 MAX_PHOTO_BYTES 유지.
const MAX_MULTIPART_BODY_BYTES = MAX_PHOTO_BYTES + 64 * 1024;
// Codex P2 (PR #310 2회차): HEIC 는 Claude Vision 이 처리 못 함 → 무조건 실패. whitelist 에서
// 제외해 명확한 4xx 반환. Client 도 HEIC 감지 시 사전 reject.
const ALLOWED_PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const MAX_RETRY = 3;
const RETRY_DELAY_MS = 50;

async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: "Serializable",
      });
    } catch (err) {
      const isSerializationFailure =
        err instanceof Error && err.message.includes("P2034");
      if (!isSerializationFailure || attempt === MAX_RETRY) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw new Error("Serializable retry exhausted");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get("days") ?? "7");
    const since = new Date();
    since.setDate(since.getDate() - (Number.isNaN(days) ? 7 : days));
    since.setHours(0, 0, 0, 0);

    const logs = await prisma.foodLog.findMany({
      where: { date: { gte: since } },
      orderBy: { date: "desc" },
    });

    return NextResponse.json({
      data: logs.map((l) => ({
        ...l,
        date: l.date.toISOString(),
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    return handlePhotoPost(request);
  }
  return handleJsonPost(request);
}

async function handleJsonPost(request: Request) {
  try {
    const body = await request.json();
    const { description, mealType, date } = body;

    if (!description || typeof description !== "string") {
      return NextResponse.json(
        { error: "description 필드가 필요합니다" },
        { status: 400 }
      );
    }

    // 사전 리뷰 P1-4: date 검증을 AI 호출 전에 해서 잘못된 date 에 15s AI 비용 낭비 방지.
    let foodDate = new Date();
    if (date) {
      foodDate = new Date(date);
      if (isNaN(foodDate.getTime())) {
        return NextResponse.json(
          { error: `유효하지 않은 날짜: ${date}` },
          { status: 400 }
        );
      }
    }

    // #295: repeat lookup 우선 — 최근 30일 동일 description 매치면 AI 스킵.
    // #299 (M14 Phase 2 #3): P/C/F 도 함께 재사용.
    let estimatedKcal: number | null = null;
    let proteinG: number | null = null;
    let carbsG: number | null = null;
    let fatG: number | null = null;
    let hitKcal: number | null = null;
    // #322 (M14 Phase 3 #2): estimator 산출 items 저장. repeat-lookup 은 item breakdown
    // 이 없어 null 유지, MFDS/AI text estimator 만 items 제공.
    let items: FoodItemBreakdown[] | null = null;
    try {
      // Codex P2 (PR #301 27회차): client 가 mealType 없이 보내면 undefined → 저장 시
      // `mealType ?? null` 로 null 저장. lookup 은 null-meal 클래스 매치되려면 null 로 전달해야
      // 함 (undefined 는 "no preference" 로 취급되어 null-meal 을 우선순위에서 배제).
      const hit = await findRecentSameDescription(description, mealType ?? null, foodDate);
      if (hit) {
        hitKcal = hit.kcal;
        estimatedKcal = hit.kcal;
        // Codex P2 (PR #300 15회차): complete tuple 만 채택. lookup 이 complete 우선하지만
        // window 내에 complete 매치가 없으면 partial 최신을 반환할 수 있음 → 부분값은 취하지 않고
        // AI 로 채움 (아래).
        if (hit.proteinG !== null && hit.carbsG !== null && hit.fatG !== null) {
          proteinG = hit.proteinG;
          carbsG = hit.carbsG;
          fatG = hit.fatG;
        }
        // #322 Codex P2 (PR #324 3회차): 원본 로그 items 도 재사용 (같은 description 이라
        // 스케일 불필요). MFDS/AI estimator 가 아래에서 items 를 다시 생성하면 그 값이 우선.
        if (hit.items !== null) items = hit.items;
      }
    } catch (lookupErr) {
      console.warn(
        "[api/food POST] repeat lookup 실패, AI 폴백:",
        lookupErr instanceof Error ? lookupErr.message : String(lookupErr),
      );
    }
    // #315 (M14 Phase 2 #4): repeat-lookup 다음 우선순위로 MFDS (오픈식약처) 조회.
    // hit 있으면 사용 (표준 데이터라 AI 추정보다 정확). miss 시에만 AI 폴백.
    // hit.kcal 이 있는데 macros 만 부족한 경우: MFDS 로 macros 채우고 hit.kcal 에 맞춰 스케일.
    const macrosIncomplete = proteinG === null || carbsG === null || fatG === null;
    // Codex P2 (릴리즈 PR #317 4회차): MFDS 결과 유무를 outer scope 에 track — AI 폴백
    // 단계에서 "MFDS 있음" 인 경우만 aiComplete guard 적용해 partial 소실 방지.
    let mfdsProvided = false;
    if (estimatedKcal === null || macrosIncomplete) {
      const mfds = await estimateNutritionFromMfds({ description, mealType });
      if (mfds) {
        mfdsProvided = true;
        // #322 사전 리뷰 P1: items 는 저장 top-level kcal 기준으로 스케일 (retain 방식과 정합).
        // 아래 else 분기 (hit.kcal 보존) 에선 hitKcal 로 스케일. estimatedKcal null 이면
        // MFDS total 이 그대로 top-level 이라 스케일 no-op (source=target).
        if (estimatedKcal === null) {
          items = mfds.items;
          estimatedKcal = mfds.kcal;
          proteinG = mfds.proteinG;
          carbsG = mfds.carbsG;
          fatG = mfds.fatG;
        } else {
          // hit.kcal 보존, MFDS macros 를 hit.kcal 로 스케일해 채움.
          const scaled = scaleMacrosForNewKcal(hitKcal, mfds.kcal, {
            proteinG: mfds.proteinG,
            carbsG: mfds.carbsG,
            fatG: mfds.fatG,
          });
          proteinG = scaled.proteinG;
          carbsG = scaled.carbsG;
          fatG = scaled.fatG;
          // #322 사전 리뷰 P1: items 도 top-level kcal (hitKcal) 로 스케일 — items 합계와
          // top-level kcal 정합. hitKcal 없으면 estimatedKcal (선재 값) 로 fallback.
          items = scaleItemsForNewKcal(hitKcal ?? estimatedKcal, mfds.kcal, mfds.items);
        }
      }
    }

    // Codex P2 (PR #300 15회차): 여전히 estimatedKcal null 이거나 macros 미완이면 AI text
    // estimator 폴백. hit.kcal 이 있는데 macros 만 부족한 경우: AI 로 macros 채우고 hit.kcal
    // 에 맞춰 스케일 (consistency 유지 · backfill retry 상한에 의존 안 함).
    // 사전 리뷰 P1 (feat/315-1): retainedKcal 은 hitKcal ?? estimatedKcal — MFDS 가 kcal 을
    // 채운 경로 (hitKcal=null 이지만 estimatedKcal != null) 도 안전하게 스케일 target 유지.
    // 이전엔 hitKcal 하나만 참조 → MFDS 채운 macros 가 scaleMacrosForNewKcal(null, ...) 로 전부 null 파괴.
    const stillIncomplete = estimatedKcal === null || proteinG === null || carbsG === null || fatG === null;
    if (stillIncomplete) {
      const estimate = await estimateNutritionFromText({ description, mealType });
      if (estimate) {
        if (estimatedKcal === null) {
          // AI 가 top-level kcal 도 제공 → items 스케일 no-op (source=target).
          items = estimate.items;
          estimatedKcal = estimate.kcal;
          proteinG = estimate.proteinG;
          carbsG = estimate.carbsG;
          fatG = estimate.fatG;
        } else {
          // Codex P2 (릴리즈 PR #317 3/4회차): bot/backfill 과 정합 — MFDS 가 있을 때만
          // AI complete guard 적용. AI 도 partial 이면 MFDS valid nutrients 유지.
          // MFDS 없는 경우 (repeat-lookup kcal 만) 는 AI partial 이라도 accept 해야 —
          // 이전엔 이 케이스도 aiComplete false 로 폐기 → macros 전부 null 저장.
          const aiComplete =
            estimate.proteinG !== null &&
            estimate.carbsG !== null &&
            estimate.fatG !== null;
          if (!mfdsProvided || aiComplete) {
            const retainedKcal = hitKcal ?? estimatedKcal;
            const scaled = scaleMacrosForNewKcal(retainedKcal, estimate.kcal, {
              proteinG: estimate.proteinG,
              carbsG: estimate.carbsG,
              fatG: estimate.fatG,
            });
            proteinG = scaled.proteinG;
            carbsG = scaled.carbsG;
            fatG = scaled.fatG;
            // #322 사전 리뷰 P1: items 도 retainedKcal 로 스케일. MFDS 가 이미 items 를
            // 채웠어도 이 AI 폴백에서 새 items 로 덮어써 새 kcal 정합화 (aiComplete guard
            // 통과했다는 건 AI 값 채택 = items 도 AI 기준).
            items = scaleItemsForNewKcal(retainedKcal, estimate.kcal, estimate.items);
          }
        }
      }
    }

    // M4-2: FoodLog 생성 + 칼로리 밸런스 재계산을 Serializable 트랜잭션에서 원자화.
    const log = await withSerializableRetry(async (tx) => {
      const created = await tx.foodLog.create({
        data: {
          date: foodDate,
          description,
          estimatedKcal,
          proteinG,
          carbsG,
          fatG,
          mealType: mealType ?? null,
          items: (items ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await recalculateCalorieBalance(foodDate, tx);
      return created;
    });

    return NextResponse.json({
      data: {
        ...log,
        date: log.date.toISOString(),
        createdAt: log.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// #309 (M14 Phase 2 #5): 사진 업로드 처리. Vision 응답 파싱 후 FoodLog 저장.
// 이미지는 temp 파일로 저장 (Claude CLI @-reference 필요) → 처리 후 즉시 삭제 (spec: 저장 안 함).
async function handlePhotoPost(request: Request) {
  // Codex P2 (PR #310 6회차): formData() 는 전체 body 를 메모리에 파싱한 뒤에야 image.size 로
  // 검증 → 악의적 client 가 무제한 payload 로 메모리 exhaust 시킬 수 있음. Content-Length 를
  // 파싱 전에 확인해 pre-reject. Content-Length 없는 chunked transfer 는 411 Length Required
  // (일반 브라우저 upload 는 항상 Content-Length 를 보냄).
  const contentLengthRaw = request.headers.get("content-length");
  if (!contentLengthRaw) {
    return NextResponse.json(
      { error: "Content-Length 헤더가 필요합니다" },
      { status: 411 },
    );
  }
  const contentLength = parseInt(contentLengthRaw, 10);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    return NextResponse.json(
      { error: `유효하지 않은 Content-Length: ${contentLengthRaw}` },
      { status: 400 },
    );
  }
  if (contentLength > MAX_MULTIPART_BODY_BYTES) {
    return NextResponse.json(
      {
        error: `업로드 크기가 상한(${MAX_PHOTO_BYTES / (1024 * 1024)}MB · 이미지 기준)을 초과합니다`,
      },
      { status: 413 },
    );
  }
  let tempPath: string | null = null;
  try {
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File)) {
      return NextResponse.json({ error: "image 필드가 필요합니다" }, { status: 400 });
    }
    const mime = (image.type || "").toLowerCase();
    if (mime && !ALLOWED_PHOTO_MIME.has(mime)) {
      return NextResponse.json(
        { error: `지원되지 않는 이미지 형식: ${mime}` },
        { status: 400 },
      );
    }
    if (image.size > MAX_PHOTO_BYTES) {
      return NextResponse.json(
        { error: `이미지 크기가 상한(${MAX_PHOTO_BYTES / (1024 * 1024)}MB)을 초과합니다` },
        { status: 400 },
      );
    }
    const caption = String(form.get("description") ?? "").trim() || undefined;
    const mealTypeRaw = form.get("mealType");
    const mealType = typeof mealTypeRaw === "string" && mealTypeRaw.trim() ? mealTypeRaw.trim() : undefined;
    const dateRaw = form.get("date");
    let foodDate = new Date();
    if (typeof dateRaw === "string" && dateRaw) {
      foodDate = new Date(dateRaw);
      if (isNaN(foodDate.getTime())) {
        return NextResponse.json({ error: `유효하지 않은 날짜: ${dateRaw}` }, { status: 400 });
      }
    }

    // temp 파일 (프로젝트 tmpdir 사용 · random 접미사).
    // Codex P2 (PR #310 7회차): umask 022 환경에서 default 는 0644 → 다른 로컬 사용자가 읽음.
    // 건강 데이터 프라이버시 위해 mode 0o600 + wx (exclusive create, 이름 충돌 시 EEXIST).
    const ext = mimeToExt(mime) || path.extname(image.name || "") || ".jpg";
    const rand = Math.random().toString(36).slice(2, 10);
    tempPath = path.join(os.tmpdir(), `mfp-photo-${Date.now()}-${rand}${ext}`);
    const buf = Buffer.from(await image.arrayBuffer());
    await fs.writeFile(tempPath, buf, { mode: 0o600, flag: "wx" });

    const estimate = await estimateNutritionFromPhoto({
      imagePath: tempPath,
      caption,
      mealType,
    });

    // Codex P2 (PR #310): Vision 실패 시 FoodLog 를 저장하면 kcal null + meaningless description
    // ("사진 (분석 실패)") 이 backfill 큐에 들어가 매 tick 텍스트 estimator 로 무한 재시도 (kcal
    // null 은 attempts 무제한). 저장 없이 422 로 실패 응답 → client 가 재시도 유도.
    // caption 이 있으면 사용자가 의미 있는 텍스트 로그 남긴 것이므로 저장 유지.
    if (!estimate && !caption) {
      return NextResponse.json(
        {
          error: "Vision 분석 실패 — 다시 시도하거나 텍스트로 입력해주세요",
        },
        { status: 422 },
      );
    }

    // description 결정: 사용자 caption 우선 → Vision items 요약 → fallback.
    const description = pickDescriptionFromEstimate(caption, estimate);

    const log = await withSerializableRetry(async (tx) => {
      const created = await tx.foodLog.create({
        data: {
          date: foodDate,
          description,
          estimatedKcal: estimate?.kcal ?? null,
          proteinG: estimate?.proteinG ?? null,
          carbsG: estimate?.carbsG ?? null,
          fatG: estimate?.fatG ?? null,
          mealType: mealType ?? null,
          // #322: Vision estimator items 저장 (사진 → 항목별 kcal/P/C/F 분해).
          items: (estimate?.items ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await recalculateCalorieBalance(foodDate, tx);
      return created;
    });

    return NextResponse.json({
      data: {
        ...log,
        date: log.date.toISOString(),
        createdAt: log.createdAt.toISOString(),
      },
      estimate: estimate
        ? {
            kcal: estimate.kcal,
            proteinG: estimate.proteinG,
            carbsG: estimate.carbsG,
            fatG: estimate.fatG,
            confidence: estimate.confidence,
            items: estimate.items,
            notes: estimate.notes,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/food POST multipart] 예외:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (tempPath) {
      await fs.unlink(tempPath).catch(() => {
        // ignore — temp 정리 실패는 치명적이지 않음.
      });
    }
  }
}

function mimeToExt(mime: string): string | null {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/heic") return ".heic";
  return null;
}

function pickDescriptionFromEstimate(
  caption: string | undefined,
  estimate: { items?: Array<{ name: string }> } | null,
): string {
  if (caption) return caption;
  if (estimate?.items && estimate.items.length > 0) {
    return estimate.items.map((i) => i.name).join(" · ");
  }
  return "사진 (분석 실패)";
}

