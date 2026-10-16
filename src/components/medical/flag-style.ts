// #527 (2/2): 판정 색 — 앱에서 쓰는 주의 (amber-300) · 이상 (red-400) 두 단계 (디자인 노트).
import type { FlagTone } from "@/lib/checkup/view";

export const FLAG_TEXT: Record<"caution" | "abnormal", string> = {
  caution: "text-amber-300",
  abnormal: "text-red-400",
};

export const FLAG_PILL: Record<"caution" | "abnormal", string> = {
  caution: "bg-amber-900/40 text-amber-300",
  abnormal: "bg-red-900/40 text-red-400",
};

export const FLAG_DOT: Record<"caution" | "abnormal" | "none", string> = {
  caution: "bg-amber-300",
  abnormal: "bg-red-400",
  none: "bg-bright",
};

export function valueClass(tone: FlagTone): string {
  return tone ? FLAG_TEXT[tone] : "text-bright";
}
