import type { ReactNode } from "react";
import { C } from "./theme";
import { bigShoulders, jbMono } from "./fonts";

// /training-plan 전용 layout — 페이지 배경/폰트 로드. 상위 MainLayout 안에서 렌더링.
// 프로토타입 톤 (Coach's Ledger) 을 로컬 스코프로 격리.

export default function TrainingPlanLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${bigShoulders.variable} ${jbMono.variable}`}>
      {/* Pretendard (한글 웹폰트) — next/font 미지원, CDN 사용. */}
      <link
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        rel="stylesheet"
      />
      <div
        className="-m-5 md:-m-8"
        style={{
          background: C.bg,
          color: C.hi,
          fontFamily: '"Pretendard", ui-sans-serif',
          backgroundImage:
            "radial-gradient(circle at 15% 0%, #FF7A1A08 0%, transparent 50%), radial-gradient(circle at 85% 100%, #5A9CE005 0%, transparent 50%)",
          minHeight: "calc(100vh - 3rem)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
