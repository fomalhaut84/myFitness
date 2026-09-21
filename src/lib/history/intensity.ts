/**
 * #394 (M15-2): 달력 셀 색 강도 (1~5 단계). 순수.
 *
 * 스케일은 **뷰 범위 상대값** 이다 (연 뷰 = 그 해 일별 값, 월 뷰 = 그 달). 합계형은 0 기준, 평균·최고형은 min~max
 * 정규화 — 체중 71~73kg 을 0 기준으로 칠하면 전부 같은 색이 된다. 강도는 크기이지 좋고 나쁨이 아니다.
 */
export const INTENSITY_LEVELS = 5;
export type IntensityLevel = 1 | 2 | 3 | 4 | 5;

export function buildIntensityScale(values: readonly number[], zeroBased: boolean): (value: number) => IntensityLevel {
  if (values.length === 0) return () => 1;
  const max = Math.max(...values);
  const min = zeroBased ? 0 : Math.min(...values);
  const span = max - min;
  return (value) => {
    // 값이 전부 같으면 (span 0) 중간 단계 — 최저·최고 어느 쪽으로도 읽히지 않게
    if (span <= 0) return 3;
    const level = Math.ceil(((value - min) / span) * INTENSITY_LEVELS);
    return Math.min(INTENSITY_LEVELS, Math.max(1, level)) as IntensityLevel;
  };
}
