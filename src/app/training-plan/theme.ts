// Coach's Ledger — 트레이닝 플랜 페이지 전용 컬러/폰트 상수.
// 프로토타입 (docs/designs/168-training-plan-ui/prototype.jsx) 기준.
// 다른 페이지와 분리된 로컬 톤 — 여기서만 사용.

export const C = {
  bg: "#0B0B0D",
  panel: "#161618",
  panelHi: "#1D1D20",
  border: "#2E2E33",
  hi: "#F5F1E8",
  mid: "#D0CBBE",
  lo: "#9A9489",
  muted: "#3D3B36",
  primary: "#FF7A1A",
  completed: "#A5CB6E",
  missed: "#B85E4F",
  z1: "#6FAFEA",
  z2: "#A5CB6E",
  z34: "#F5B324",
  z5: "#FF7A1A",
} as const;

export const ZONE_COLOR: Record<string, string> = {
  Z1: C.z1,
  Z2: C.z2,
  "Z3-4": C.z34,
  Z5: C.z5,
};

export type WorkoutType =
  | "easy"
  | "long"
  | "tempo"
  | "interval"
  | "recovery"
  | "rest";

export const TYPE_LABEL_KO: Record<WorkoutType, string> = {
  easy: "이지",
  long: "롱런",
  tempo: "템포",
  interval: "인터벌",
  recovery: "회복",
  rest: "휴식",
};

// CSS 변수 참조 (next/font 로 로드 → layout 에서 variable 활성). Pretendard 는 CDN.
export const FONT_DISPLAY = "var(--font-big-shoulders), ui-sans-serif";
export const FONT_BODY = '"Pretendard", ui-sans-serif';
export const FONT_MONO = "var(--font-jb-mono), ui-monospace";
