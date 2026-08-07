// #283 (M14 Phase 1): 자유 텍스트 음식 설명 → Claude AI 로 kcal 추정.
// - Claude CLI 를 single-shot 으로 호출. MCP·세션·retry 없음 (기존 claude-advisor 는 heavy).
// - 실패 시 null 반환 — 상위 (봇 / API) 는 log 저장 자체는 성공 유지.
// - 프롬프트: 한국 음식 · 1인분 기준 · JSON 응답 강제. 이상값 (음수 / 5000 kcal 초과) reject.

import { spawn } from "child_process";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_KCAL_SANITY = 5000; // 5000 kcal 초과는 1인분 아님 (거의 확실히 오답)

export interface KcalEstimateInput {
  description: string;
  mealType?: string;
}

export interface KcalItem {
  name: string;
  kcal: number | null;
}

export interface KcalEstimate {
  kcal: number;
  confidence: "low" | "med" | "high";
  items: KcalItem[];
  notes?: string;
  raw?: string;
}

export interface EstimateOptions {
  timeoutMs?: number;
  /** for testing — mock spawn */
  spawnImpl?: typeof spawn;
}

const MEAL_TYPE_LABEL: Record<string, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

function buildPrompt(input: KcalEstimateInput): string {
  const mealLine =
    input.mealType && MEAL_TYPE_LABEL[input.mealType]
      ? `식사 유형: ${MEAL_TYPE_LABEL[input.mealType]}\n`
      : "";
  return [
    "당신은 한국 식사의 kcal 을 추정합니다. 아래 사용자 입력을 항목별로 분해하고 1인분 기준 kcal 을 매기세요.",
    "",
    "규칙:",
    "- 한식 기준으로 통상 1인분 크기를 가정 (밥 1공기 = 300kcal, 국물 요리 1대접 등).",
    "- 모르는 항목은 kcal 을 null 로.",
    "- confidence 는 low(불분명) | med (표준 한식) | high (kcal 잘 알려진 표준품) 중 선택.",
    "- 응답은 오직 JSON 하나만. 설명·마크다운·코드펜스 금지.",
    "",
    "응답 형식:",
    '{',
    '  "items": [{"name": "김치찌개", "kcal": 350}, ...],',
    '  "total_kcal": <합계 정수>,',
    '  "confidence": "low" | "med" | "high",',
    '  "notes": "가정한 양이나 참고 (선택)"',
    '}',
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
  items?: Array<{ name?: unknown; kcal?: unknown }>;
  total_kcal?: unknown;
  confidence?: unknown;
  notes?: unknown;
}

function toItem(raw: unknown): KcalItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { name?: unknown; kcal?: unknown };
  const name = typeof r.name === "string" ? r.name : null;
  if (!name) return null;
  let kcal: number | null = null;
  if (typeof r.kcal === "number" && Number.isFinite(r.kcal)) kcal = Math.round(r.kcal);
  return { name, kcal };
}

function pickConfidence(v: unknown): "low" | "med" | "high" {
  if (v === "high" || v === "med" || v === "low") return v;
  return "low";
}

/** AI 응답 문자열 → kcal 추정치. 파싱 실패나 이상값 시 null. */
export function parseKcalResponse(rawText: string): KcalEstimate | null {
  if (!rawText) return null;
  // Claude CLI 가 --output-format json 을 감쌌으면 이미 result 안에 문자열이 들어있음.
  // 여기 오는 rawText 는 AI 응답 본문 (result). JSON 만이라고 지시했지만 방어적으로 처리.
  const trimmed = rawText.trim();
  // 코드 펜스 제거
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(stripped);
  } catch {
    // JSON 아니면 응답 안에서 { ... } 블록 추출 시도
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      parsedUnknown = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  // Codex P1: JSON 이 "null" / 문자열 / 배열 등 non-object 로 유효 파싱되면 이후 dereference
  // 가 throw → estimateKcalFromText 의 close 핸들러에서 uncaughtException 유출. 여기서 방어.
  if (!parsedUnknown || typeof parsedUnknown !== "object" || Array.isArray(parsedUnknown)) {
    return null;
  }
  const body = parsedUnknown as AiJson;
  const totalRaw = body.total_kcal;
  const total =
    typeof totalRaw === "number" && Number.isFinite(totalRaw) ? Math.round(totalRaw) : null;
  if (total === null || total < 0 || total > MAX_KCAL_SANITY) return null;
  const items = Array.isArray(body.items)
    ? body.items.map(toItem).filter((x): x is KcalItem => x !== null)
    : [];
  // Codex P2 (#283): 어느 항목이라도 kcal 이 null 이면 total 은 부분 합계라 신뢰 불가.
  // 이 값을 저장하면 대시보드가 하루 총량으로 오해. reject → cron backfill 이 재시도, 또는
  // 사용자가 /food_kcal 수동 입력.
  if (items.some((it) => it.kcal === null)) {
    return null;
  }
  return {
    kcal: total,
    confidence: pickConfidence(body.confidence),
    items,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    raw: stripped,
  };
}

/** Claude CLI 를 single-shot 으로 호출해 kcal 추정. */
export async function estimateKcalFromText(
  input: KcalEstimateInput,
  opts: EstimateOptions = {},
): Promise<KcalEstimate | null> {
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
    // MCP 도구 필요 없음. --tools "" 로 built-in 도 차단.
    "--tools",
    "",
  ];

  return new Promise<KcalEstimate | null>((resolve) => {
    const child = spawnFn(CLAUDE_BIN, args, {
      timeout: timeoutMs,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Codex/사전 리뷰 P1-1: stdin 을 닫아야 CLI 가 EOF 확인 후 처리. 없으면 매 호출 15s
    // timeout 대기 후 SIGTERM 으로만 종료 (claude-advisor.ts:312 와 동일 패턴).
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
      console.warn(`[kcal] spawn 실패: ${err.message}`);
      resolve(null);
    });
    child.on("close", (code: number | null) => {
      if (code !== 0) {
        console.warn(
          `[kcal] CLI exit code=${code}: ${stderr.slice(0, 200) || "(no stderr)"}`,
        );
        return resolve(null);
      }
      let outer: CliResult;
      try {
        outer = JSON.parse(stdout) as CliResult;
      } catch (err) {
        console.warn(
          `[kcal] outer JSON parse 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
        return resolve(null);
      }
      if (outer.is_error) {
        console.warn(`[kcal] CLI is_error subtype=${outer.subtype ?? "?"}`);
        return resolve(null);
      }
      const text = outer.result ?? "";
      const parsed = parseKcalResponse(text);
      if (!parsed) {
        console.warn(`[kcal] AI 응답 파싱/검증 실패: ${text.slice(0, 200)}`);
      }
      resolve(parsed);
    });
  });
}
