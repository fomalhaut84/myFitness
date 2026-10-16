// #527: 검진 입력 검증 (API · 폼 공용). 결과값 · 기준범위는 결과지 원문 문자열로 받는다 — 해석은 build.ts. 순수.
import { z } from "zod";
import { isValidYmd } from "@/lib/history/buckets";
import { CHECKUP_FLAGS } from "./flag";

export const CHECKUP_KINDS = ["national", "comprehensive", "other"] as const;
export const CHECKUP_SOURCES = ["manual", "capture", "pdf", "photo"] as const;

const MAX_RESULTS = 300;
const MAX_FINDINGS = 100;

const ymd = z.string().refine(isValidYmd, "YYYY-MM-DD 형식의 실제 날짜여야 합니다");
/** 빈 문자열 · 공백은 "값 없음" (null) — 폼이 비운 칸을 "" 로 보내도 카탈로그 기본값이 쓰이게 (PR #528 Codex P2) */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const CHECKUP_RESULT_INPUT = z.object({
  /** 생략하면 label 로 카탈로그 매칭 → 없으면 custom code */
  itemCode: z.string().trim().min(1).max(120).optional(),
  label: z.string().trim().min(1, "항목명이 필요합니다").max(100),
  /** 카탈로그 밖 항목의 분류 (카탈로그 항목은 무시) */
  category: z.string().trim().min(1).max(30).optional(),
  /** 결과값 원문 — 판독문은 note 로 (본문 크기 상한 · #527 사전 리뷰 info) */
  value: z.string().trim().min(1, "결과값이 필요합니다").max(200),
  unit: optionalText(30),
  ref: optionalText(100),
  flag: z.enum(CHECKUP_FLAGS).nullable().optional(),
  note: optionalText(5000),
  followUp: optionalText(500),
  followUpDue: ymd.nullable().optional(),
});

export const CHECKUP_INPUT = z.object({
  date: ymd,
  institution: optionalText(100),
  kind: z.enum(CHECKUP_KINDS),
  source: z.enum(CHECKUP_SOURCES).default("manual"),
  summary: optionalText(5000),
  findings: z
    .array(
      z.object({
        category: z.string().trim().min(1).max(30),
        text: z.string().trim().min(1).max(2000),
        flag: z.enum(CHECKUP_FLAGS).nullable().optional(),
      }),
    )
    .max(MAX_FINDINGS)
    .nullable()
    .optional(),
  results: z.array(CHECKUP_RESULT_INPUT).min(1, "결과가 하나 이상 필요합니다").max(MAX_RESULTS),
});

export type CheckupResultInput = z.infer<typeof CHECKUP_RESULT_INPUT>;
export type CheckupInput = z.infer<typeof CHECKUP_INPUT>;
