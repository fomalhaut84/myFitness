// /training-plan 페이지 전용 폰트 로드 (next/font/local, 오프라인 빌드 대응).
// Google Fonts 대신 리포지토리에 커밋된 TTF 파일을 사용 — 외부 네트워크 불필요.

import localFont from "next/font/local";

// Barlow Condensed — 육상 트랙 넘버링/race bib 계열 콘덴스드 sans. 조판된 큰 숫자에 어울림.
export const bigShoulders = localFont({
  src: [
    {
      path: "./fonts/BarlowCondensed-Bold.ttf",
      weight: "700",
      style: "normal",
    },
    {
      path: "./fonts/BarlowCondensed-ExtraBold.ttf",
      weight: "800",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-big-shoulders",
});

export const jbMono = localFont({
  src: [
    {
      path: "./fonts/JetBrainsMono-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/JetBrainsMono-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-jb-mono",
});
