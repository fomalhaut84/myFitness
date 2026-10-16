// #544: 복약 입력 검증 (API · 폼 공용). 순수.
import { z } from "zod";
import { isValidYmd } from "@/lib/history/buckets";
import { getCheckupItem } from "@/lib/checkup/items";

export const MEDICATION_KINDS = ["prescription", "supplement"] as const;
export const MEDICATION_REGIMENS = ["long_term", "short_term"] as const;
export type MedicationKind = (typeof MEDICATION_KINDS)[number];
export type MedicationRegimen = (typeof MEDICATION_REGIMENS)[number];

export const MAX_RELATED_ITEMS = 20;
/** build.ts 의 custom code 형식과 같다 (match.normalizeLabel 출력 · MAX_CUSTOM_SLUG) */
const CUSTOM_CODE_RE = /^custom:[0-9a-z가-힣]{1,100}$/;

const ymd = z.string().refine(isValidYmd, "YYYY-MM-DD 형식의 실제 날짜여야 합니다");
/** 빈 문자열 · 공백 → null (폼이 비운 칸) */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export function isItemCode(code: string): boolean {
  return getCheckupItem(code) !== undefined || CUSTOM_CODE_RE.test(code);
}

export const MEDICATION_INPUT = z
  .object({
    name: z.string().trim().min(1, "이름이 필요합니다").max(100),
    kind: z.enum(MEDICATION_KINDS),
    regimen: z.enum(MEDICATION_REGIMENS),
    ingredient: optionalText(100),
    dose: optionalText(100),
    frequency: optionalText(100),
    startDate: ymd,
    endDate: ymd.nullable().optional(),
    purpose: optionalText(200),
    prescriber: optionalText(100),
    note: optionalText(2000),
    relatedItems: z
      .array(z.string().trim().refine(isItemCode, "알 수 없는 검진 항목입니다"))
      .max(MAX_RELATED_ITEMS)
      .default([])
      .transform((codes) => [...new Set(codes)]),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "종료일이 시작일보다 빠릅니다" });
    }
    if (v.regimen === "short_term" && !v.endDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "단기 복용은 종료일이 필요합니다" });
    }
  });

export type MedicationInput = z.output<typeof MEDICATION_INPUT>;
export type MedicationInputBody = z.input<typeof MEDICATION_INPUT>;

export type PreparedMedication =
  | { ok: true; input: MedicationInput }
  | { ok: false; status: 400; body: { error: string; issues?: unknown } };

/** POST · PUT 공통 — 검증 + 미래 시작일 거부 (오늘은 호출자가 준다) */
export function prepareMedicationWrite(body: unknown, todayYmd: string): PreparedMedication {
  const parsed = MEDICATION_INPUT.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message;
    return { ok: false, status: 400, body: { error: first ?? "유효하지 않은 입력", issues: parsed.error.issues } };
  }
  if (parsed.data.startDate > todayYmd) {
    return { ok: false, status: 400, body: { error: "시작일이 오늘 뒤입니다" } };
  }
  return { ok: true, input: parsed.data };
}
