"use client";
// #552 U5: 설정 하위 탭 (프로필 · 프롬프트). 사이드바 "설정" 은 그대로 /settings/profile.
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "프로필", href: "/settings/profile" },
  { label: "프롬프트", href: "/settings/prompts" },
] as const;

export default function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="설정" className="mb-6 flex gap-1 border-b border-border">
      {TABS.map((t) => {
        const current = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px border-b-2 px-3.5 py-2 text-sm ${current ? "border-accent text-bright" : "border-transparent text-sub hover:text-bright"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
