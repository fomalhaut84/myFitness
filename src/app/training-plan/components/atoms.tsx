"use client";

import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../theme";

// 마이크로 라벨 (UPPERCASE tracked)
export function MicroLabel({
  children,
  color = C.lo,
  className = "",
}: {
  children: React.ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-block ${className}`}
      style={{
        fontFamily: FONT_BODY,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </span>
  );
}

// 섹션 헤더 (번호 + kicker + title + meta)
export function SectionHeader({
  number,
  kicker,
  title,
  meta,
}: {
  number: string;
  kicker: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="border-b border-white/5 pb-6 md:pb-8 mb-10 md:mb-14">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-4 md:gap-5">
          <span
            className="text-[48px] md:text-[64px]"
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 800,
              lineHeight: 0.9,
              color: C.primary,
              letterSpacing: "-0.02em",
            }}
          >
            {number}
          </span>
          <div className="flex flex-col gap-1">
            <span
              className="md:text-[13px]"
              style={{
                fontFamily: FONT_BODY,
                fontSize: 12,
                fontWeight: 500,
                color: C.mid,
                letterSpacing: "0.02em",
              }}
            >
              {kicker}
            </span>
            <span
              className="text-[22px] md:text-[28px]"
              style={{
                fontFamily: FONT_BODY,
                fontWeight: 700,
                lineHeight: 1.1,
                color: C.hi,
                letterSpacing: "-0.02em",
              }}
            >
              {title}
            </span>
          </div>
        </div>
        {meta && (
          <span
            className="text-[10px] md:text-[12px] w-full md:w-auto mt-2 md:mt-0 break-all"
            style={{
              fontFamily: FONT_MONO,
              color: C.lo,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {meta}
          </span>
        )}
      </div>
    </div>
  );
}

// 데이터 유닛 (label + 큰 값 + 단위)
type DataSize = "sm" | "md" | "lg" | "xl";
const SIZE_MAP: Record<DataSize, { v: number; l: number }> = {
  sm: { v: 20, l: 10 },
  md: { v: 32, l: 11 },
  lg: { v: 56, l: 12 },
  xl: { v: 84, l: 13 },
};

export function DataUnit({
  label,
  value,
  unit,
  color = C.hi,
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  color?: string;
  size?: DataSize;
}) {
  const s = SIZE_MAP[size];
  return (
    <div className="flex flex-col gap-1">
      <MicroLabel color={C.lo}>{label}</MicroLabel>
      <div className="flex items-baseline gap-1.5">
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: s.v,
            lineHeight: 0.9,
            color,
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            style={{
              fontFamily: FONT_BODY,
              fontSize: s.v * 0.28,
              fontWeight: 500,
              color: C.lo,
            }}
          >
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
