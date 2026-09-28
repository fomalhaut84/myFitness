// #269 · #440: WMO weather interpretation code → 한국어 상태. 활동 상세 환경 섹션과 AI 평가 컨텍스트가 공유한다.
export function wmoLabel(code: number | null): string | null {
  if (code === null) return null;
  if (code === 0) return "맑음";
  if (code >= 1 && code <= 3) return "구름";
  if (code === 45 || code === 48) return "안개";
  if (code >= 51 && code <= 57) return "이슬비";
  if (code >= 61 && code <= 67) return "비";
  if (code >= 71 && code <= 77) return "눈";
  if (code >= 80 && code <= 82) return "소나기";
  if (code >= 85 && code <= 86) return "눈 소나기";
  if (code >= 95 && code <= 99) return "뇌우";
  return null;
}
