// /training-plan 페이지 전용 폰트 로드 (next/font/google).

import { Barlow_Condensed, JetBrains_Mono } from "next/font/google";

// Barlow Condensed — 육상 트랙 넘버링/race bib 계열 콘덴스드 sans. 조판된 큰 숫자에 어울림.
export const bigShoulders = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  display: "swap",
  variable: "--font-big-shoulders",
});

export const jbMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-jb-mono",
});
