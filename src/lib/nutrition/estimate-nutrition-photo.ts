// #309 (M14 Phase 2 #5): 음식 사진 → Claude Vision 으로 kcal + macros 추정.
// 텍스트 estimator (estimate-nutrition.ts) 와 동일한 NutritionEstimate shape 반환.
// Claude CLI 의 `@<path>` 문법으로 로컬 이미지 파일을 프롬프트에 참조 → Vision 처리.
//
// 응답 검증은 parseNutritionResponse 재사용 (item 별 4·4·9, macros null propagate).

import { spawn } from "child_process";
import { parseNutritionResponse, type NutritionEstimate } from "./estimate-nutrition";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
// Vision 은 텍스트 estimator (18s) 보다 느림. 45s 여유 마진.
const DEFAULT_TIMEOUT_MS = 45_000;

export interface NutritionPhotoInput {
  /** 절대 경로 (temp 파일). CLI 가 이 파일을 이미지 콘텐츠로 읽음. */
  imagePath: string;
  /** 사용자 부가 설명 (봇 캡션 or 웹 텍스트). Vision 에 컨텍스트로 전달. */
  caption?: string;
  /** breakfast · lunch · dinner · snack. Vision 이 양·구성 추정에 참고. */
  mealType?: string;
}

export interface EstimatePhotoOptions {
  timeoutMs?: number;
  spawnImpl?: typeof spawn;
}

const MEAL_TYPE_LABEL: Record<string, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

function buildPhotoPrompt(input: NutritionPhotoInput): string {
  const mealLine =
    input.mealType && MEAL_TYPE_LABEL[input.mealType]
      ? `식사 유형: ${MEAL_TYPE_LABEL[input.mealType]}\n`
      : "";
  const captionLine = input.caption?.trim()
    ? `사용자 캡션: ${input.caption.trim()}\n`
    : "";
  // Claude CLI 는 `@<path>` 를 파일 참조로 인식. 이미지 파일은 Vision 콘텐츠로 처리.
  // path 는 프롬프트 최상단에 단독 위치해야 안정적으로 인식됨.
  return [
    `@${input.imagePath}`,
    "",
    "위 이미지는 한국인이 촬영한 음식 사진입니다. 각 항목의 이름·양·kcal·매크로 (P/C/F g) 를 추정하세요.",
    "",
    "규칙:",
    "- 사진에서 식별되는 각 음식 항목을 items 배열로 분해.",
    "- 양 추정: 그릇 크기·plate 배치·젓가락 등 스케일 단서 활용. 불분명하면 표준 1인분 가정.",
    "- 한식 표준 1인분 (밥 1공기 300kcal · P6g · C66g · F1g / 김치찌개 1대접 350kcal · P22g · C15g · F20g 등).",
    "- 모르는 항목의 kcal/매크로는 해당 필드를 null 로.",
    "- 매크로 4·4·9 kcal/g 규칙에 근접 (P·4 + C·4 + F·9 ≈ 항목 kcal, ±25% 오차 허용).",
    "- 사진에서 항목 특정이 어려우면 confidence: low. 표준 한식으로 명확하면 med. 잘 알려진 표준품 (예: 스타벅스 톨 라떼) 이면 high.",
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
    captionLine + mealLine,
  ]
    .filter((s) => s !== "")
    .join("\n");
}

interface CliResult {
  result?: string;
  is_error?: boolean;
  subtype?: string;
}

export async function estimateNutritionFromPhoto(
  input: NutritionPhotoInput,
  opts: EstimatePhotoOptions = {},
): Promise<NutritionEstimate | null> {
  if (!input.imagePath) return null;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnFn = opts.spawnImpl ?? spawn;
  const prompt = buildPhotoPrompt(input);

  // Codex P1 (PR #310): `--tools "Read"` 는 caption/image 로 prompt-injection 되면 임의 서버
  // 파일 (예: .env) 을 읽어 items[].name / notes 에 실어 응답 가능 → API/봇이 그대로 노출.
  // `--tools ""` 로 tool 차단. Claude CLI 는 `@<path>` 를 pre-process 해 이미지 콘텐츠로
  // 삽입하므로 tool 없이도 Vision 작동.
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
      console.warn(`[nutrition-photo] spawn 실패: ${err.message}`);
      resolve(null);
    });
    child.on("close", (code: number | null) => {
      if (code !== 0) {
        console.warn(
          `[nutrition-photo] CLI exit code=${code}: ${stderr.slice(0, 200) || "(no stderr)"}`,
        );
        return resolve(null);
      }
      let outer: CliResult;
      try {
        outer = JSON.parse(stdout) as CliResult;
      } catch (err) {
        console.warn(
          `[nutrition-photo] outer JSON parse 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
        return resolve(null);
      }
      if (outer.is_error) {
        console.warn(`[nutrition-photo] CLI is_error subtype=${outer.subtype ?? "?"}`);
        return resolve(null);
      }
      const text = outer.result ?? "";
      const parsed = parseNutritionResponse(text);
      if (!parsed) {
        console.warn(`[nutrition-photo] AI 응답 파싱/검증 실패: ${text.slice(0, 200)}`);
      }
      resolve(parsed);
    });
  });
}
