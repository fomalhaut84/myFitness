"use client";

// #330: /nutrition 페이지 날짜 네비게이션. 이전/다음 · 라벨 (클릭 시 date picker) · 오늘로.

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { MIN_HISTORY_YMD } from "@/lib/date";

interface Props {
  /** 선택된 date YYYY-MM-DD (KST) */
  selectedYmd: string;
  /** 오늘 KST YYYY-MM-DD */
  todayYmd: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
  const shifted = new Date(utcMidnight + days * DAY_MS);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];
function labelFor(ymd: string, todayYmd: string): string {
  if (ymd === todayYmd) return `오늘 · ${ymd}`;
  if (ymd === shiftYmd(todayYmd, -1)) return `어제 · ${ymd}`;
  const [y, m, d] = ymd.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
  const dow = new Date(utcMidnight);
  // KST weekday
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(dow);
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const kor = idx >= 0 ? WEEKDAY_LABEL[idx] : "";
  return `${ymd}${kor ? ` (${kor})` : ""}`;
}

export default function NutritionDateNav({ selectedYmd, todayYmd }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerValue, setPickerValue] = useState(selectedYmd);

  const openPicker = () => {
    setPickerValue(selectedYmd);
    setPickerOpen(true);
  };
  const closePicker = () => {
    setPickerOpen(false);
    setPickerValue(selectedYmd);
  };

  const navigateTo = useCallback(
    (ymd: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (ymd === todayYmd) params.delete("date");
      else params.set("date", ymd);
      const qs = params.toString();
      // scroll: false — 페이지 상단 스크롤 초기화 방지 (리스트 스크롤 위치 유지).
      router.push(qs ? `/nutrition?${qs}` : "/nutrition", { scroll: false });
    },
    [router, searchParams, todayYmd],
  );

  const prev = shiftYmd(selectedYmd, -1);
  const next = shiftYmd(selectedYmd, 1);
  const canGoNext = selectedYmd < todayYmd;
  // 사전 리뷰 P1-2: 하한 방어. selectedYmd = MIN 인 상태에서 이전 클릭 시 URL 이 하한
  // 아래로 갔다가 서버가 오늘 fallback → URL/화면 불일치. "이전" 버튼도 disabled.
  const canGoPrev = selectedYmd > MIN_HISTORY_YMD;

  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-card border border-border px-3 py-2">
      <button
        type="button"
        onClick={() => canGoPrev && navigateTo(prev)}
        disabled={!canGoPrev}
        aria-disabled={!canGoPrev}
        className={`text-[13px] font-[family-name:var(--font-geist-mono)] px-2 py-1 rounded border transition-colors ${
          canGoPrev
            ? "text-sub hover:text-bright border-border/60 hover:border-muted"
            : "text-dim border-border/40 cursor-not-allowed"
        }`}
      >
        ← 이전
      </button>
      <div className="relative flex flex-col items-center">
        <button
          type="button"
          onClick={() => (pickerOpen ? closePicker() : openPicker())}
          aria-expanded={pickerOpen}
          aria-haspopup="dialog"
          className="text-[13px] font-[family-name:var(--font-geist-mono)] text-bright hover:text-white px-2 py-1"
        >
          {labelFor(selectedYmd, todayYmd)}
        </button>
        {pickerOpen && (
          <div className="absolute top-full mt-1 z-10 rounded-lg border border-border bg-card px-2 py-2 shadow-lg">
            <input
              type="date"
              max={todayYmd}
              min={MIN_HISTORY_YMD}
              value={pickerValue}
              onChange={(e) => setPickerValue(e.target.value)}
              className="text-[13px] bg-transparent text-bright border border-border/60 rounded px-2 py-1 font-[family-name:var(--font-geist-mono)]"
            />
            <div className="mt-2 flex gap-1 justify-end">
              <button
                type="button"
                onClick={closePicker}
                className="text-[11px] font-[family-name:var(--font-geist-mono)] text-dim hover:text-bright px-2 py-0.5"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  if (pickerValue && pickerValue !== selectedYmd) navigateTo(pickerValue);
                }}
                className="text-[11px] font-[family-name:var(--font-geist-mono)] text-bright hover:text-white px-2 py-0.5 rounded border border-border/60"
              >
                이동
              </button>
            </div>
          </div>
        )}
        {selectedYmd !== todayYmd && (
          <button
            type="button"
            onClick={() => navigateTo(todayYmd)}
            className="mt-0.5 text-[10px] font-[family-name:var(--font-geist-mono)] text-sub hover:text-bright underline"
          >
            오늘로
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => canGoNext && navigateTo(next)}
        disabled={!canGoNext}
        aria-disabled={!canGoNext}
        className={`text-[13px] font-[family-name:var(--font-geist-mono)] px-2 py-1 rounded border transition-colors ${
          canGoNext
            ? "text-sub hover:text-bright border-border/60 hover:border-muted"
            : "text-dim border-border/40 cursor-not-allowed"
        }`}
      >
        다음 →
      </button>
    </div>
  );
}
