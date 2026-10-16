// #532: 결과지 한 쪽의 추출 결과 (Claude 응답) 검증. 응답은 외부 데이터 — 길이 · 개수 상한 · 날짜 재검증. 순수.
import { z } from "zod";
import { isValidYmd } from "@/lib/history/buckets";

export const MAX_ITEMS_PER_PAGE = 150;
export const MAX_PAST_PER_ITEM = 10;
export const MAX_SECTIONS_PER_PAGE = 40;
export const MAX_FINDINGS_PER_SECTION = 30;

/** 빈 문자열 · 공백 · 누락 → null */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** 실제 날짜가 아니면 null — 2자리 연도 · 잘못 읽은 날짜는 버리지 않고 확인 화면이 사용자에게 날짜를 받는다 */
const optionalYmd = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v && isValidYmd(v) ? v : null));

export const EXTRACTED_PAST = z.object({
  date: optionalYmd,
  /** 결과지의 날짜 표기 원문 — date 를 못 정했을 때 사용자가 보고 고른다 */
  dateText: optionalText(30),
  value: z.string().trim().min(1).max(200),
});

export const EXTRACTED_ITEM = z.object({
  section: optionalText(30),
  label: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(200),
  unit: optionalText(30),
  ref: optionalText(100),
  flag: z.enum(["caution", "abnormal"]).nullish().transform((v) => v ?? null),
  note: optionalText(5000),
  followUp: optionalText(500),
  /** 날짜를 못 읽은 과거 값도 남긴다 (확인 화면에서 날짜를 받는다 · 옛 종이 결과지) */
  past: z.array(EXTRACTED_PAST).max(MAX_PAST_PER_ITEM).nullish().transform((v) => v ?? []),
});

export const EXTRACTED_SECTION = z.object({
  category: z.string().trim().min(1).max(30),
  findings: z.array(z.string().trim().min(1).max(2000)).max(MAX_FINDINGS_PER_SECTION).nullish().transform((v) => v ?? []),
});

export const EXTRACTED_PAGE = z.object({
  institution: optionalText(100),
  examDate: optionalYmd,
  sections: z.array(EXTRACTED_SECTION).max(MAX_SECTIONS_PER_PAGE).nullish().transform((v) => v ?? []),
  items: z.array(EXTRACTED_ITEM).max(MAX_ITEMS_PER_PAGE).nullish().transform((v) => v ?? []),
});

export type ExtractedItem = z.infer<typeof EXTRACTED_ITEM>;
export type ExtractedSection = z.infer<typeof EXTRACTED_SECTION>;
export type ExtractedPage = z.infer<typeof EXTRACTED_PAGE>;

/**
 * Claude `result` 텍스트 → 검증된 쪽 결과. JSON 하나만 달라고 해도 코드펜스 · 앞뒤 문장이 붙을 수 있어
 * 첫 `{` 부터 마지막 `}` 까지를 파싱한다. 실패는 null (호출자가 502).
 */
export function parseExtractResponse(text: string): ExtractedPage | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = EXTRACTED_PAGE.safeParse(json);
  return parsed.success ? parsed.data : null;
}
