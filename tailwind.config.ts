import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // 임시: 디자인 시안 리뷰용 (docs/designs) — 승인 후 정식 구현으로 옮기면 이 라인 제거.
    "./docs/designs/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        bg: 'var(--bg)',
        'bg-raised': 'var(--bg-raised)',
        dim: 'var(--dim)',
        sub: 'var(--sub)',
        muted: 'var(--text)',
        bright: 'var(--bright)',
        card: 'var(--card)',
        'card-hover': 'var(--card-hover)',
        border: 'var(--border)',
        'border-hover': 'var(--border-hover)',
        surface: 'var(--surface)',
        'surface-hover': 'var(--surface-hover)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
      },
    },
  },
  plugins: [],
};
export default config;
