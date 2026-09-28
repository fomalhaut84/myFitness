// #397: 심박 존 5색 · 이름 — 활동 상세 (`activity-detail-client.tsx`) 와 같은 범주 색. 서버 · 클라이언트 양쪽이 import 하므로 "use client" 없는 일반 모듈.
export const ZONE_COLORS = ["#a3a3a3", "#22c55e", "#60a5fa", "#f59e0b", "#ef4444"] as const;
export const ZONE_NAMES = ["회복", "이지", "에어로빅", "역치", "VO2max"] as const;
