"use client";

import { C, FONT_BODY, FONT_DISPLAY } from "./theme";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="p-6 md:p-16 max-w-2xl">
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 800,
          fontSize: 48,
          color: C.missed,
          letterSpacing: "-0.02em",
        }}
      >
        오류
      </div>
      <p
        className="mt-4"
        style={{ fontFamily: FONT_BODY, fontSize: 15, color: C.hi, lineHeight: 1.7 }}
      >
        트레이닝 플랜 페이지를 불러오지 못했습니다.
      </p>
      <pre
        className="mt-6 p-4 overflow-auto"
        style={{
          fontFamily: '"JetBrains Mono", ui-monospace',
          fontSize: 12,
          color: C.lo,
          background: C.panel,
          border: `1px solid ${C.border}`,
        }}
      >
        {error.message}
      </pre>
      <button
        onClick={reset}
        className="mt-6 px-6 py-3"
        style={{
          background: C.primary,
          color: "#fff",
          fontFamily: FONT_DISPLAY,
          fontSize: 16,
          fontWeight: 800,
          border: "none",
          cursor: "pointer",
          textTransform: "uppercase",
        }}
      >
        다시 시도
      </button>
    </div>
  );
}
