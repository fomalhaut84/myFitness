// #315 (M14 Phase 2 #4): 자유 텍스트 → 오픈식약처 검색어 + 예상 섭취량(g) 추출.
// - Claude CLI `-p ... --output-format json` (기존 estimator 와 동일 패턴).
// - 결과 items 를 caller (MFDS estimator) 가 각각 API 조회 → scale.

import { spawn } from "child_process";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const DEFAULT_TIMEOUT_MS = 18_000;

export interface FoodQueryItem {
  /** MFDS 식품명 검색어 (표준 명칭 · 예: "김치찌개", "쌀밥") */
  query: string;
  /** 예상 섭취량 g (사용자 명시 or 한식 표준 1인분 추정) */
  quantityG: number;
  /**
   * true = description 에서 명시적 수량 (예: "300g", "1공기") 추출.
   * false = 한식 표준 1인분 추정 (AI inferred). Estimator 가 confidence 산정에 사용
   * (Codex P2 PR #316 5회차: inferred 이면 total 이 uncertain portion 에 스케일되므로
   * confidence 를 "high" 대신 "med" 로 낮춤).
   */
  explicit: boolean;
}

export interface ExtractFoodQueryInput {
  description: string;
  mealType?: string;
}

export interface ExtractFoodQueryOptions {
  timeoutMs?: number;
  spawnImpl?: typeof spawn;
}

const MEAL_TYPE_LABEL: Record<string, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

function buildPrompt(input: ExtractFoodQueryInput): string {
  const mealLine =
    input.mealType && MEAL_TYPE_LABEL[input.mealType]
      ? `식사 유형: ${MEAL_TYPE_LABEL[input.mealType]}\n`
      : "";
  return [
    "사용자 입력을 음식 항목별로 분해하고 각 항목의 검색어와 예상 섭취량(g)을 뽑아주세요.",
    "결과는 오픈식약처(식품의약품안전처) 식품영양성분DB 조회에 사용됩니다.",
    "",
    "규칙:",
    "- query: DB 에서 검색될 표준 식품명 (예: 김치찌개, 쌀밥, 삼겹살, 계란후라이).",
    "  * 재료·수식어 최소화 (예: '큰 사과' → '사과', '매운 김치찌개' → '김치찌개').",
    "  * 브랜드는 유지 (예: '스타벅스 아메리카노' → query 그대로).",
    "- quantityG: 사용자가 양 (300g, 1공기 등) 을 명시하면 그것을 g 으로 환산.",
    "  * 명시 안 되면 한식 표준 1인분 (밥 1공기 = 210g, 국/찌개 1대접 = 300g, 고기 1인분 = 150g,",
    "    반찬 1접시 = 50g, 라면 1봉지 = 500g 완성, 우유 1컵 = 200g, 사과 1개 = 200g 등).",
    "- explicit: 사용자가 양을 텍스트로 명시했으면 true, 표준 1인분으로 추정했으면 false.",
    "- 확실치 않은 항목도 최선의 추정으로 포함 (miss 는 caller 가 fallback).",
    "- 응답은 오직 JSON 하나만. 설명·마크다운·코드펜스 금지.",
    "",
    "응답 형식:",
    "{",
    '  "items": [',
    '    {"query": "김치찌개", "quantityG": 350, "explicit": false},',
    '    {"query": "쌀밥", "quantityG": 300, "explicit": true}',
    "  ]",
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
}

function toItem(raw: unknown): FoodQueryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    query?: unknown;
    quantityG?: unknown;
    quantity_g?: unknown;
    explicit?: unknown;
  };
  const q = typeof r.query === "string" ? r.query.trim() : "";
  if (!q) return null;
  const qtyRaw = r.quantityG ?? r.quantity_g;
  const qty = typeof qtyRaw === "number" && Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : null;
  if (qty === null) return null;
  // 상한 방어 (한 item 2kg 초과는 오답 취급).
  if (qty > 2000) return null;
  // explicit 필드 없거나 boolean 아니면 안전하게 false (inferred).
  const explicit = r.explicit === true;
  return { query: q, quantityG: qty, explicit };
}

export function parseExtractFoodQueryResponse(rawText: string): FoodQueryItem[] | null {
  const trimmed = rawText.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const body = parsed as AiJson;
  if (!Array.isArray(body.items) || body.items.length === 0) return null;
  // Codex P2 (PR #316 2회차): 일부 item 만 invalid (예: 3kg 초과 · malformed) 시 survivors 만
  // 반환하면 downstream all-or-nothing MFDS 가 loss 감지 못함 → meal 일부만 저장돼 total kcal
  // 왜곡. raw count 와 validated count 다르면 전체 reject → caller (AI text estimator) 폴백.
  const rawCount = body.items.length;
  const items = body.items.map(toItem).filter((x): x is FoodQueryItem => x !== null);
  if (items.length !== rawCount) return null;
  return items;
}

export async function extractFoodQuery(
  input: ExtractFoodQueryInput,
  opts: ExtractFoodQueryOptions = {},
): Promise<FoodQueryItem[] | null> {
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

  return new Promise<FoodQueryItem[] | null>((resolve) => {
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
      console.warn(`[extract-food-query] spawn 실패: ${err.message}`);
      resolve(null);
    });
    child.on("close", (code: number | null) => {
      if (code !== 0) {
        console.warn(
          `[extract-food-query] CLI exit code=${code}: ${stderr.slice(0, 200) || "(no stderr)"}`,
        );
        return resolve(null);
      }
      let outer: CliResult;
      try {
        outer = JSON.parse(stdout) as CliResult;
      } catch (err) {
        console.warn(
          `[extract-food-query] outer JSON parse 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
        return resolve(null);
      }
      if (outer.is_error) {
        console.warn(`[extract-food-query] CLI is_error subtype=${outer.subtype ?? "?"}`);
        return resolve(null);
      }
      const text = outer.result ?? "";
      const parsed = parseExtractFoodQueryResponse(text);
      if (!parsed) {
        console.warn(`[extract-food-query] AI 응답 파싱 실패: ${text.slice(0, 200)}`);
      }
      resolve(parsed);
    });
  });
}
