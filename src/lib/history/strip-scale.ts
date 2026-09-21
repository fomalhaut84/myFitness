/**
 * #394 (M15-2): 월 뷰 일별 스트립의 막대 높이 (%). 순수.
 *
 * 합계형은 0 기준. 평균형은 0 기준이면 전부 같은 높이가 되므로 **최솟값 조금 아래** 를 바닥으로 한다.
 * 바닥은 비율 곱(`min * 0.97`)이 아니라 **범위 기준 오프셋** 으로 잡는다 — 음수(`calorieBalance`)에 비율을 곱하면
 * 바닥이 최솟값 **위로** 올라가 막대가 평탄화된다 (사전 리뷰 major 2).
 */
export const STRIP_FLOOR_PADDING = 0.15;
export const STRIP_MIN_BAR_PERCENT = 4;
const FLAT_BAR_PERCENT = 50;

export function buildStripScale(values: readonly number[], zeroBased: boolean): (value: number) => number {
  if (values.length === 0) return () => 0;
  const max = Math.max(...values);
  const min = Math.min(...values);
  // 합계형이라도 음수가 섞이면 0 기준이 성립하지 않는다 → 범위 기준으로
  const floor = zeroBased && min >= 0 ? 0 : min - (max - min) * STRIP_FLOOR_PADDING;
  const span = max - floor;
  return (value) => {
    if (span <= 0) return FLAT_BAR_PERCENT;
    return Math.min(100, Math.max(STRIP_MIN_BAR_PERCENT, ((value - floor) / span) * 100));
  };
}
