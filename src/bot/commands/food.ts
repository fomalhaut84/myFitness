import prisma from "../prisma";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { estimateKcalFromText, type KcalEstimate } from "@/lib/nutrition/estimate-kcal";
import { markStaleRecalcDate } from "@/lib/nutrition/stale-recalc";
import { findRecentSameDescription } from "@/lib/nutrition/repeat-lookup";
import { buildFoodInlineKeyboard } from "./food-edit-callback";

/**
 * recalculateCalorieBalance 를 소규모 재시도. 최종 실패면 stale-recalc 큐에 date 를 기록해
 * 다음 cron tick 이 이어받게 함.
 */
async function recalcWithRetry(date: Date, retries: number): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await recalculateCalorieBalance(date, undefined, prisma);
      return true;
    } catch (err) {
      if (attempt === retries) {
        console.error(
          `[bot/food] recalculate 최종 실패 (date ${date.toISOString()}): ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          await markStaleRecalcDate(date);
        } catch (mErr) {
          console.error(
            `[bot/food] stale-recalc 큐 기록 실패: ${mErr instanceof Error ? mErr.message : String(mErr)}`,
          );
        }
        return false;
      }
      // 재시도 전 짧은 backoff
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
  return false;
}

const MEAL_PATTERNS = [
  { pattern: /^(아침|조식)/, type: "breakfast" },
  { pattern: /^(점심|중식)/, type: "lunch" },
  { pattern: /^(저녁|석식)/, type: "dinner" },
  { pattern: /^(간식|야식)/, type: "snack" },
];

const MEAL_LABELS: Record<string, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

const CONFIDENCE_LABEL: Record<KcalEstimate["confidence"], string> = {
  low: "낮음",
  med: "중간",
  high: "높음",
};

export function isFoodInput(text: string): boolean {
  return MEAL_PATTERNS.some((m) => m.pattern.test(text));
}

/**
 * 식단 접두사 뒤 description 이 실제 음식이 아니라 봇 명령/요청 문장일 때 감지.
 * 사용자가 `아침 리포트 새로 생성해줘` 같은 입력을 하면 이전엔 `아침` 접두사만 보고 음식으로
 * 저장 → 매 backfill tick 마다 AI 가 "음식 아님" 응답 → 영영 permanent-fail (사용자 실측).
 *
 * 판정:
 * - 문장 끝 `?` (음식 description 에 `?` 붙일 이유 없음)
 * - 요청/명령 어미 문장 끝 (~해줘, ~해봐, ~해주세요, ~부탁, ~알려줘, ~보여줘, ~봐줘)
 * - 물음 어미 문장 끝 (~뭐야, ~어때)
 * - 질문 단어 whitespace/문두/문말 boundary (왜, 어떻게) — Codex P2 (#289): 종결형이 아니라
 *   문장 중간에 오는 경우 (`리포트 왜 이상해?`) 도 캐치.
 *
 * Codex P2 이전 지적: 앞자리 keyword (만들/추천/보여/알려) 매칭은 명사 활용형 오탐하므로 제거.
 * 실제 음식 description 은 명사·수량 위주라 어미 패턴에 걸릴 확률 낮음.
 */
export function isCommandLikeDescription(description: string): boolean {
  const trimmed = description.trim();
  if (trimmed.length === 0) return false;
  // Codex P2 (#289): parseReportRequest 어휘와 정렬. 다만 '리포트' 자체는 문장 끝에 홀로 있을
  // 때만 (bare form). '리포트에서 추천한 샐러드' 같이 mid-sentence 는 실제 음식 description
  // 이므로 통과시킴.
  if (/(?:^|\s)(리포트|report)[\s.!?~]*$/i.test(trimmed)) return true;
  // Codex P2 (#289): 다시 만들[자아] 뒤에 인용/관형 접미사 (고/는/서/던) 오면 descriptive 형태.
  // '다시 만들자고 한 샌드위치' 등 오탐 방지.
  // Codex P2 (#289): 재생성 뒤 attributive 한/했/할 도 배제. '재생성한 식단' 등 descriptive.
  if (/(재생성(?![된됨돼한했할])|다시\s?만들[자아](?![고는서던])|\bcreate\b|\bgenerate\b|\brefresh\b)/i.test(trimmed)) return true;
  // Codex P2 (#289): 리포트/report/보고서 + imperative verb 조합은 어미 뒤에 추가 문장이
  // 붙어도 (예: '리포트 생성해줘 자세하게', '리포트 뽑아줘 내일 운동도 포함해서') 명령으로
  // 취급. 두 조건 동시 만족 요구로 '리포트에서 추천한 샐러드' 등 pure description 은 통과.
  // Codex P2 (#289 후속): parseReportRequest 처럼 descriptive 접미사 (진/준/된/돼 등 피동·관형
  // ·수여 형태) 를 negative lookahead 로 배제. '리포트에서 추천해준 샐러드', '리포트에서 생성된
  // 식단대로 먹음' 등 실제 음식 description 통과.
  // Codex P2 (#289): causal -서 (해줘서, 만들어서, 뽑아서, 추천해서) 배제. 각 imperative 뒤에
  // 서 가 오면 causal 접속 형태 (음식 description 안에서 흔함).
  // Codex P2 후속 (#289): 추천해줘서 처럼 root(추천해) 만 매칭해도 뒷 chain (줘서) 이 causal 인
  // 경우가 있음. root 뒤에 [줘봐] 오면 root alone 매칭 배제 + 별도 root+[줘봐](?![서]) 매칭.
  // Codex P2 (#289 후속): bare 해요/해주세요 는 declarative ('식사해요') 오탐 유발.
  // 명시적 verb root+aux 형태만 유지: X해줘, X해봐 (X = 생성/만들어/뽑아/추천/알려/보여).
  // Codex P2 (#289): descriptive/attributive 뒤에 whitespace + 주(honorific 주신/주시/주세) 도
  // 배제 위해 exclusion char class 앞에 \s* 허용. '추천해 주신 샐러드', '만들어 주신 도시락' 등
  // 오탐 방지.
  // Codex P2 (#289 후속): bare root alternatives 는 serial verb (만들어 먹은, 만들어 놓은),
  // attributive (알려준, 보여진) 등 descriptive 형태 오탐 위험 큼. 실제 사용자는 imperative
  // 를 대부분 aux (줘/봐/주세요) 와 함께 쓰므로 bare root 제거하고 aux 를 요구.
  // 유지: 생성 (noun request), 생성해/만들어 등에 (\\s*줘|봐|주세요) explicit aux 조합.
  // Codex P2 (#290): 이전에 bare root alt 를 전부 제거했지만 '리포트 만들어', '리포트 생성해'
  // 같은 bare imperative 는 실제 사용자 패턴. 문장 끝 anchor (?=[\\s.!?~]*$) 로 다시 도입.
  // sentence-end 조건이라 serial verb ('만들어 먹은 샌드위치') 나 attributive ('만들어진 도시락')
  // 는 자동 배제 됨 (next char 이 Korean 이면 lookahead fail).
  const REPORT_IMPERATIVE = new RegExp(
    `(` +
      // 생성 (noun 형태 명령 — '리포트 생성'). '생성해/된/됨/한/했' 배제 + 재생성 substring 배제.
      `(?<!재)생성(?!\\s*(?:해|[된됨돼되한했할]))|` +
      // Bare imperative at sentence end (문장부호까지만 허용).
      `만들어(?=[\\s.!?~]*$)|` +
      `생성해(?=[\\s.!?~]*$)|` +
      `뽑아(?=[\\s.!?~]*$)|` +
      `추천해(?=[\\s.!?~]*$)|` +
      // 각 root + explicit aux (줘/봐/주세요). aux 필수라 serial/attributive 오탐 없음.
      `만들어\\s*줘(?![서])|만들어\\s*봐(?![서])|만들어\\s*주세요|` +
      `생성해\\s*줘(?![서])|생성해\\s*봐(?![서])|생성해\\s*주세요|` +
      `뽑아\\s*줘(?![서])|뽑아\\s*봐(?![서])|뽑아\\s*주세요|` +
      `추천해\\s*줘(?![서])|추천해\\s*봐(?![서])|추천해\\s*주세요|` +
      `알려\\s*줘(?![서])|알려\\s*봐(?![서])|알려\\s*주세요|` +
      `보여\\s*줘(?![서])|보여\\s*봐(?![서])|보여\\s*주세요` +
      `)`,
  );
  if (/(리포트|\breport\b|보고서)/i.test(trimmed) && REPORT_IMPERATIVE.test(trimmed)) {
    return true;
  }
  // Codex P2 (#289): 명사형 요청 (문장 끝만). `추천받은/분석한/요약된` 같은 관형형 오탐 방지 위해 sentence-end anchor.
  if (/(추천|분석|요약|조언|평가)[\s.!?~]*$/.test(trimmed)) return true;
  // 문장 끝 물음표 (음식 description 에 `?` 붙일 이유 없음).
  if (/\?[\s.!~]*$/.test(trimmed)) return true;
  // 요청/명령 어미 (문장 끝 근처, 문장부호 무시).
  // Codex P2 (#289): 공손 종결 `-줘요` + bare imperative (`~해`, `~만들어`) + whitespace 허용 (`해 줘`).
  //  - root: 해/만들어/알려/보여/봐/추천해/뽑아 (뽑아 = 리포트 뽑아줘 등 report imperative)
  //  - required aux (\s?[줘봐] | \s?줄래 | \s?주세요 | \s?드리세요 | \s?드립?니다 | \s?드려요)
  //  - optional politeness marker (요)
  // Codex P2 (#289 후속): 줄래/줄래요 (~해줄래, ~알려줄래) 도 요청 어미.
  // Codex P2 (#289 후속): aux 필수 로 변경. bare '~해요' / '~만들어요' 는 declarative ('식사해요',
  //   '만들어요=만들고 있어요') 로도 흔해 오탐. bare imperative 는 REPORT_IMPERATIVE + 리포트 kw
  //   조합 or 부탁 등 다른 규칙이 담당.
  const CMD_ENDING = /(해|만들어|알려|보여|봐|추천해|뽑아)(\s?[줘봐]|\s?줄래|\s?주세요|\s?드리세요|\s?드립?니다|\s?드려요)(요)?[\s.!?~]*$/;
  if (CMD_ENDING.test(trimmed)) return true;
  // 부탁 계열 (bare + 공손).
  if (/부탁(드립?니다|드려요|해요?)?[\s.!?~]*$/.test(trimmed)) return true;
  // Codex P2 (#289): 질문/제안 어미 `-까(요)` (뭐 먹을까, 갈까요, 어떡할까) — 문장 끝 형태만.
  // 음식명에 `까` 로 끝나는 사례 드물어 오탐 위험 낮음.
  if (/까(요)?[\s.!?~]*$/.test(trimmed)) return true;
  // Codex P2 (#289): polite 문말 질문 어미 (나요/인가요).
  //  - '식단 괜찮나요', '칼로리 얼마인가요', '몇 kcal 인가요'
  //  - Codex P2 후속: bare '가요' 는 subject particle 가 + 존댓말 요 (예: '두 개가요') 오탐
  //    유발하므로 배제. '건가요' 형태는 usage 드물어 별도 커버 안 함.
  if (/(나요|인가요)[\s.!?~]*$/.test(trimmed)) return true;
  // 물음 어미 (문장 종결형).
  if (/(뭐야|어때)[\s.!?~]*$/.test(trimmed)) return true;
  // 질문 단어가 문장 중간/끝에 whitespace boundary 로 나오면 문장 자체가 질문.
  // "리포트 왜 이상해?", "김치찌개 어떻게 만들어" 등.
  if (/(^|\s)(왜|어떻게)(\s|$)/.test(trimmed)) return true;
  return false;
}

interface BotCtx {
  reply: (text: string, options?: Record<string, unknown>) => Promise<unknown>;
  /** grammy Context — replyWithChatAction 은 optional (테스트 mock 편의). */
  replyWithChatAction?: (action: "typing") => Promise<unknown>;
}

export async function handleFoodInput(
  ctx: BotCtx,
  text: string
) {
  const meal = MEAL_PATTERNS.find((m) => m.pattern.test(text));
  const mealType = meal?.type ?? "snack";
  const description = text.replace(meal?.pattern ?? "", "").trim();

  if (!description) {
    await ctx.reply("먹은 것을 함께 입력해주세요.\n예: 점심 김치찌개 밥 계란후라이");
    return;
  }

  // 명령/요청 문장이면 저장하지 않고 안내만. FoodLog 오염 (계속 backfill 재시도) 방지.
  // Codex P2 (#289): 자연어 fallback 은 detectReportRequest=false 라 접두사 제거만으론
  // 리포트 감지 안 됨. 리포트 감지를 켜는 `/ai <원문>` 을 안내.
  // Codex P2 (#289): 사용자가 '조식/석식/중식/야식' 같은 alias 를 썼으면 parseReportRequest 가
  // 인식 못 함 (아침/모닝, 저녁/이브닝 만). 정규화된 mealLabel 로 재구성해 안내.
  // Codex P2 (#289): 매우 긴 입력 (수천자) 은 응답이 Telegram 4096자 제한 초과.
  // - description 을 preview 로 짧게 자르되 (표시용 확인), retry 예시에는 embed 하지 않음
  //   → 사용자가 preview 를 그대로 복사하면 원문이 잘려 나가는 문제 회피.
  // - 대신 alias 정규화 안내와 /ai 접두사 사용법만 전달.
  // - 보고서 → 리포트 정규화 안내 (parseReportRequest 는 리포트/report 만 인식).
  if (isCommandLikeDescription(description)) {
    const mealLabel = MEAL_LABELS[mealType] ?? mealType;
    const PREVIEW_MAX = 120;
    const preview =
      description.length > PREVIEW_MAX
        ? description.slice(0, PREVIEW_MAX) + "…"
        : description;
    await ctx.reply(
      `"${mealLabel} ${preview}" 이 식단이 맞나요?\n` +
        `식단이면 음식 이름/양으로 다시 입력해주세요 (예: ${mealLabel} 김치찌개 밥 1공기).\n` +
        `AI 질문·명령·리포트 요청이면 원문 앞에 /ai 를 붙여 다시 보내주세요.\n` +
        `참고: 리포트 관련 요청은 "${mealLabel}" + "리포트" 단어 사용 (조식/석식/보고서 등 alias 는 인식 안 될 수 있음).`,
    );
    return;
  }

  const now = new Date();
  // 1) FoodLog 먼저 저장 (kcal=null). AI 추정 실패해도 기록은 남게.
  const log = await prisma.foodLog.create({
    data: { date: now, description, mealType, estimatedKcal: null },
    select: { id: true },
  });

  // 2a) #295 (M14 Phase 2 #2): 최근 30일 내 같은 description 로그가 있으면 그 kcal 재사용.
  //     AI 호출 스킵 → 즉시 응답, 일관성 유지 (MFP '밈 재작성' pain 해결).
  //     lookup 자체가 조회만이라 typing 인디케이터 없이 빠르게 완료.
  let repeatHit: Awaited<ReturnType<typeof findRecentSameDescription>> = null;
  try {
    // Codex P2 (#296): 로그 date (now) 기준 preceding 창 사용.
    repeatHit = await findRecentSameDescription(description, mealType, now);
  } catch (err) {
    console.warn(
      "[bot/food] repeat lookup 실패, AI 추정으로 폴백:",
      err instanceof Error ? err.message : String(err),
    );
  }

  // 사전 리뷰 P1-3: AI 호출 (~수초~15초) 중 사용자에게 "typing" 인디케이터 노출.
  // repeat hit 이면 AI 호출 스킵이라 필요 없지만 lookup 결과 확정 후에 판단.
  if (!repeatHit) {
    try {
      await ctx.replyWithChatAction?.("typing");
    } catch {
      // ignore
    }
  }

  // 2b) AI 로 kcal 추정 (실패 시 null). 완료까지 await — 사용자 응답은 한 번에.
  //     실패해도 log 저장은 이미 성공. repeat hit 있으면 스킵.
  let estimate: KcalEstimate | null = null;
  if (!repeatHit) {
    try {
      estimate = await estimateKcalFromText({ description, mealType });
    } catch (err) {
      console.warn(
        "[bot/food] kcal 추정 예외 (log 저장은 완료):",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // 3) 결정된 kcal (repeatHit 우선, 없으면 AI estimate) 을 조건부 update.
  //    Codex P2: update 가 transient 실패하면 결과를 null 로 되돌려 사용자 응답이 "실패" 경로로
  //    감. race 조건 (사용자 웹 정정 / description PATCH) 대응 위해 스냅샷 필드 매칭.
  const decidedKcal = repeatHit?.kcal ?? estimate?.kcal ?? null;
  if (decidedKcal !== null) {
    try {
      const updated = await prisma.foodLog.updateMany({
        where: {
          id: log.id,
          estimatedKcal: null,
          description,
          mealType,
        },
        data: { estimatedKcal: decidedKcal },
      });
      if (updated.count === 0) {
        // 사용자가 그 사이 수동 정정 or description 변경 → 반영 안 함. "실패" 경로.
        repeatHit = null;
        estimate = null;
      }
    } catch (err) {
      console.warn(
        "[bot/food] estimatedKcal update 실패:",
        err instanceof Error ? err.message : String(err),
      );
      repeatHit = null;
      estimate = null;
    }
  }

  // 4) 칼로리 밸런스 재계산. Codex P2 (#283): recalcWithRetry 로 즉시 재시도 + 실패 시 큐 mark →
  //    cron 이 이어받음 (kcal 이 성공 저장된 경우 backfill 은 이 row 를 다시 안 뽑기 때문).
  await recalcWithRetry(now, 1);

  // 5) 사용자 응답. #292 (M14 Phase 2 #1): inline keyboard [수정][삭제] 로 모바일 UX 개선.
  //    #295 (M14 Phase 2 #2): repeat hit 은 재사용 사실 명시로 투명성 확보 (실제 양이 다르면
  //    사용자가 [수정] 로 바로 정정 가능).
  const label = MEAL_LABELS[mealType];
  const lines = [`✅ ${label} 기록 완료`, `📝 ${description}`];
  if (repeatHit) {
    const dateLabel = repeatHit.date.toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
    });
    lines.push(
      `📊 약 ${repeatHit.kcal.toLocaleString("ko-KR")} kcal (${dateLabel} 기록 재사용)`,
    );
  } else if (estimate) {
    lines.push(
      `📊 약 ${estimate.kcal.toLocaleString("ko-KR")} kcal (신뢰도 ${CONFIDENCE_LABEL[estimate.confidence]})`,
    );
    if (estimate.notes) lines.push(`ℹ️ ${estimate.notes}`);
  } else {
    lines.push("⚠️ kcal 자동 추정 실패 — [수정] 버튼으로 직접 입력하세요");
  }
  await ctx.reply(lines.join("\n"), {
    reply_markup: buildFoodInlineKeyboard(log.id),
  });
}

/**
 * `/food_kcal <id> <kcal>` — 이전 로그의 kcal 을 사용자 지정 값으로 갱신.
 * id 는 handleFoodInput 응답에 노출된 것.
 */
export async function handleFoodKcalCommand(
  ctx: BotCtx,
  raw: string,
): Promise<void> {
  // "/food_kcal <id> <kcal>" 또는 "/food_kcal@botname <id> <kcal>"
  // 사전 리뷰 P0: regex 상한 (\d{1,5}) 을 이후 검증 (kcal <= 10000) 과 일치시켜 UX 통일.
  const m = raw.match(/^\/food_kcal(?:@\S+)?\s+(\S+)\s+(\d{1,5})\s*$/);
  if (!m) {
    await ctx.reply("사용법: /food_kcal <id> <kcal>\n예: /food_kcal ckabc123 650");
    return;
  }
  const [, id, kcalStr] = m;
  const kcal = parseInt(kcalStr, 10);
  if (!Number.isFinite(kcal) || kcal < 0 || kcal > 10000) {
    await ctx.reply("kcal 은 0~10000 범위 정수여야 합니다.");
    return;
  }
  try {
    const updated = await prisma.foodLog.update({
      where: { id },
      data: { estimatedKcal: kcal },
      select: { date: true, description: true, mealType: true },
    });
    // Codex P2: 재계산 실패해도 kcal 은 이미 저장됨 → 백필이 이 row 를 다시 안 뽑음 →
    // DailySummary 가 stale 로 남을 수 있음 (특히 historical 로그, cron 2일 창 밖).
    // 즉시 1회 재시도. 그래도 실패면 사용자에게 명시 경고.
    const recalcOk = await recalcWithRetry(updated.date, 1);
    const label = updated.mealType ? MEAL_LABELS[updated.mealType] ?? updated.mealType : "";
    const tail = recalcOk ? "" : "\n⚠️ 일일 요약 재계산 실패 — 잠시 후 자동 재시도됩니다.";
    await ctx.reply(
      `✏️ ${label} "${updated.description}" → ${kcal.toLocaleString("ko-KR")} kcal 로 수정됨${tail}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Record to update not found") || msg.includes("P2025")) {
      await ctx.reply(`해당 id 를 찾을 수 없습니다: ${id}`);
      return;
    }
    console.error("[bot/food_kcal] 수정 실패:", msg);
    await ctx.reply("kcal 수정 중 오류가 발생했습니다.");
  }
}
