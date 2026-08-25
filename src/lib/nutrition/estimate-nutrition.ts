// #299 (M14 Phase 2 #3): 자유 텍스트 → Claude AI 로 kcal + 매크로 (P/C/F g) 추정.
// - 기존 estimate-kcal.ts 의 확장. CLI 호출 · 방어적 파싱 패턴 재사용.
// - 매크로는 부분 미측정 허용 — AI 가 항목별로 kcal 은 알아도 macro 는 모를 수 있음.
//   AI 응답 검증:
//     * kcal: 기존 규칙 (음수/상한/item-per-cap/합계 정합) 유지
//     * macros: item 별 null 허용, 하나라도 null 이면 total 도 null propagate
//     * item 별 P/C/F 모두 non-null 이면 P·4 + C·4 + F·9 ≈ item.kcal (±25%) 검증

import { spawn } from "child_process";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const DEFAULT_TIMEOUT_MS = 18_000; // 매크로 추가로 응답 길이 증가, 여유 마진.
const MAX_KCAL_SANITY = 5000;
const MAX_ITEM_KCAL = 3000;
const MAX_ITEM_GRAM = 500; // 1항목이 특정 매크로 500g 넘으면 오답.
// #322 사전 리뷰 P0: MFDS estimator 는 이미 MAX_ITEMS=15 로 fan-out 방어. AI 경로도 동일
// 상한 — hallucination · adversarial caption 으로 100+ items 반환 시 JSONB storage bloat
// 방지. 실사용에서 한 meal 이 15개 넘는 케이스는 rare.
const MAX_ITEMS = 15;
const MACRO_KCAL_TOLERANCE = 0.25; // P·4 + C·4 + F·9 ≈ kcal ±25%.

export interface NutritionEstimateInput {
  description: string;
  mealType?: string;
}

export interface NutritionItem {
  name: string;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface NutritionEstimate {
  kcal: number;
  /** 모든 item macro non-null 일 때 합계, 하나라도 null 이면 null. */
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  confidence: "low" | "med" | "high";
  items: NutritionItem[];
  notes?: string;
  raw?: string;
}

export interface EstimateNutritionOptions {
  timeoutMs?: number;
  spawnImpl?: typeof spawn;
}

const MEAL_TYPE_LABEL: Record<string, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

function buildPrompt(input: NutritionEstimateInput): string {
  const mealLine =
    input.mealType && MEAL_TYPE_LABEL[input.mealType]
      ? `식사 유형: ${MEAL_TYPE_LABEL[input.mealType]}\n`
      : "";
  return [
    "당신은 한국 식사의 kcal 과 매크로 (단백질/탄수화물/지방 g) 를 추정합니다.",
    "아래 사용자 입력을 항목별로 분해하고 1인분 기준으로 값을 매기세요.",
    "",
    "규칙:",
    "- 한식 표준 1인분 기준 (밥 1공기 300kcal · P6g · C66g · F1g / 김치찌개 1대접 350kcal · P22g · C15g · F20g 등).",
    "- 모르는 항목의 kcal/매크로는 해당 필드를 null 로.",
    "- 매크로 4·4·9 kcal/g 규칙에 근접해야 함 (P·4 + C·4 + F·9 ≈ 항목 kcal, ±25% 오차 허용).",
    "- confidence: low (불분명) | med (표준 한식) | high (kcal/매크로 잘 알려진 표준품).",
    "- 응답은 오직 JSON 하나만. 설명·마크다운·코드펜스 금지.",
    "",
    "응답 형식:",
    "{",
    '  "items": [',
    '    {"name": "김치찌개", "kcal": 350, "protein_g": 22, "carbs_g": 15, "fat_g": 20},',
    "    ...",
    "  ],",
    '  "total_kcal": <합계 정수>,',
    '  "total_protein_g": <합계 수치 or null>,',
    '  "total_carbs_g": <합계 수치 or null>,',
    '  "total_fat_g": <합계 수치 or null>,',
    '  "confidence": "low" | "med" | "high",',
    '  "notes": "가정한 양이나 참고 (선택)"',
    "}",
    "",
    mealLine + `입력: ${input.description}`,
  ].join("\n");
}

interface CliResult {
  result?: string;
  is_error?: boolean;
  subtype?: string;
}

interface AiJson {
  items?: Array<Record<string, unknown>>;
  total_kcal?: unknown;
  total_protein_g?: unknown;
  total_carbs_g?: unknown;
  total_fat_g?: unknown;
  confidence?: unknown;
  notes?: unknown;
}

function pickConfidence(v: unknown): "low" | "med" | "high" {
  if (v === "high" || v === "med" || v === "low") return v;
  return "low";
}

function toNumOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return null;
}

function toItem(raw: unknown): NutritionItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    name?: unknown;
    kcal?: unknown;
    protein_g?: unknown;
    carbs_g?: unknown;
    fat_g?: unknown;
  };
  const name = typeof r.name === "string" ? r.name : null;
  if (!name) return null;
  const kcal =
    typeof r.kcal === "number" && Number.isFinite(r.kcal) ? Math.round(r.kcal) : null;
  const proteinG = toNumOrNull(r.protein_g);
  const carbsG = toNumOrNull(r.carbs_g);
  const fatG = toNumOrNull(r.fat_g);
  // 상한 방어: 매크로 값이 이상하면 null 로 강등해 total propagate 로 신호.
  const safeP = proteinG !== null && proteinG > MAX_ITEM_GRAM ? null : proteinG;
  const safeC = carbsG !== null && carbsG > MAX_ITEM_GRAM ? null : carbsG;
  const safeF = fatG !== null && fatG > MAX_ITEM_GRAM ? null : fatG;
  return { name, kcal, proteinG: safeP, carbsG: safeC, fatG: safeF };
}

function macrosConsistentWithKcal(it: NutritionItem): boolean {
  if (it.kcal === null) return true;
  const allNull =
    it.proteinG === null && it.carbsG === null && it.fatG === null;
  if (allNull) return true;
  const tol = Math.max(30, it.kcal * MACRO_KCAL_TOLERANCE);
  const allNonNull =
    it.proteinG !== null && it.carbsG !== null && it.fatG !== null;
  if (allNonNull && it.proteinG !== null && it.carbsG !== null && it.fatG !== null) {
    // 완전 매크로 — 정확 ±tol 매칭. TS 좁히기 위해 재검사.
    const computed = it.proteinG * 4 + it.carbsG * 4 + it.fatG * 9;
    return Math.abs(computed - it.kcal) <= tol;
  }
  // Codex P2 (PR #300 8회차): 부분 매크로 — 알려진 macros 만으로도 이미 item kcal + tol 을
  // 초과하면 명백히 오답 (예: 100 kcal + P=100g + C=100g + F=null → 이미 800 kcal 확정).
  const knownLowerBound =
    (it.proteinG ?? 0) * 4 + (it.carbsG ?? 0) * 4 + (it.fatG ?? 0) * 9;
  return knownLowerBound <= it.kcal + tol;
}

export function parseNutritionResponse(rawText: string): NutritionEstimate | null {
  if (!rawText) return null;
  const trimmed = rawText.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      parsedUnknown = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!parsedUnknown || typeof parsedUnknown !== "object" || Array.isArray(parsedUnknown)) {
    return null;
  }
  const body = parsedUnknown as AiJson;
  const totalRaw = body.total_kcal;
  const total =
    typeof totalRaw === "number" && Number.isFinite(totalRaw) ? Math.round(totalRaw) : null;
  if (total === null || total < 0 || total > MAX_KCAL_SANITY) return null;
  if (!Array.isArray(body.items) || body.items.length === 0) return null;
  // #322 사전 리뷰 P0: items 상한. MFDS 와 동일 (MAX_ITEMS=15).
  if (body.items.length > MAX_ITEMS) return null;
  const rawCount = body.items.length;
  const items = body.items.map(toItem).filter((x): x is NutritionItem => x !== null);
  if (items.length !== rawCount) return null;
  // kcal null 있으면 응답 부분합 신뢰 불가.
  if (items.some((it) => it.kcal === null)) return null;
  if (items.some((it) => it.kcal !== null && (it.kcal! < 0 || it.kcal! > MAX_ITEM_KCAL))) {
    return null;
  }
  const itemsSum = items.reduce((s, it) => s + (it.kcal ?? 0), 0);
  const kcalTolerance = Math.max(30, Math.round(total * 0.05));
  if (Math.abs(itemsSum - total) > kcalTolerance) return null;
  // 각 item 의 macros 가 non-null 이면 4·4·9 규칙 정합 확인. 실패 시 응답 무효.
  if (!items.every(macrosConsistentWithKcal)) return null;

  // 총 매크로 = 모든 item macro non-null 일 때만 합계. 하나라도 null → null propagate.
  const allP = items.every((it) => it.proteinG !== null);
  const allC = items.every((it) => it.carbsG !== null);
  const allF = items.every((it) => it.fatG !== null);
  const sumP = allP
    ? Math.round(items.reduce((s, it) => s + (it.proteinG ?? 0), 0) * 10) / 10
    : null;
  const sumC = allC
    ? Math.round(items.reduce((s, it) => s + (it.carbsG ?? 0), 0) * 10) / 10
    : null;
  const sumF = allF
    ? Math.round(items.reduce((s, it) => s + (it.fatG ?? 0), 0) * 10) / 10
    : null;

  return {
    kcal: total,
    proteinG: sumP,
    carbsG: sumC,
    fatG: sumF,
    confidence: pickConfidence(body.confidence),
    items,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    raw: stripped,
  };
}

export async function estimateNutritionFromText(
  input: NutritionEstimateInput,
  opts: EstimateNutritionOptions = {},
): Promise<NutritionEstimate | null> {
  const description = input.description?.trim();
  if (!description) return null;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnFn = opts.spawnImpl ?? spawn;
  const prompt = buildPrompt(input);

  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--model",
    "sonnet",
    "--max-turns",
    "1",
    "--tools",
    "",
  ];

  return new Promise<NutritionEstimate | null>((resolve) => {
    const child = spawnFn(CLAUDE_BIN, args, {
      timeout: timeoutMs,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err: Error) => {
      console.warn(`[nutrition] spawn 실패: ${err.message}`);
      resolve(null);
    });
    child.on("close", (code: number | null) => {
      if (code !== 0) {
        console.warn(
          `[nutrition] CLI exit code=${code}: ${stderr.slice(0, 200) || "(no stderr)"}`,
        );
        return resolve(null);
      }
      let outer: CliResult;
      try {
        outer = JSON.parse(stdout) as CliResult;
      } catch (err) {
        console.warn(
          `[nutrition] outer JSON parse 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
        return resolve(null);
      }
      if (outer.is_error) {
        console.warn(`[nutrition] CLI is_error subtype=${outer.subtype ?? "?"}`);
        return resolve(null);
      }
      const text = outer.result ?? "";
      const parsed = parseNutritionResponse(text);
      if (!parsed) {
        console.warn(`[nutrition] AI 응답 파싱/검증 실패: ${text.slice(0, 200)}`);
      }
      resolve(parsed);
    });
  });
}
