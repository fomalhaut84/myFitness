"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "대시보드",
    href: "/",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="7" height="8" rx="1" />
        <rect x="11" y="2" width="7" height="5" rx="1" />
        <rect x="2" y="12" width="7" height="6" rx="1" />
        <rect x="11" y="9" width="7" height="9" rx="1" />
      </svg>
    ),
  },
  {
    label: "러닝/활동",
    href: "/activities",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="3.5" r="2" />
        <path d="M7 8.5l3 2 3-2" />
        <path d="M10 10.5v4" />
        <path d="M7 18l3-3.5 3 3.5" />
        <path d="M5 12l2-1.5" />
        <path d="M15 12l-2-1.5" />
      </svg>
    ),
  },
  {
    label: "수면",
    href: "/sleep",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16.5 11a7 7 0 1 1-8.5-6.8A5.5 5.5 0 0 0 16.5 11z" />
      </svg>
    ),
  },
  {
    label: "심박",
    href: "/heart",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 17s-7-4.35-7-8.5A4 4 0 0 1 10 5.5a4 4 0 0 1 7 3c0 4.15-7 8.5-7 8.5z" />
      </svg>
    ),
  },
  {
    label: "체성분",
    href: "/body",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="14" height="12" rx="2" />
        <path d="M7 1v4M13 1v4" />
        <circle cx="10" cy="11" r="2.5" />
      </svg>
    ),
  },
  {
    label: "생활 패턴",
    href: "/lifestyle",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17V7l4-4 4 4 4-4v10" />
        <path d="M3 17h14" />
      </svg>
    ),
  },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const sidebarRef = useRef<HTMLElement>(null);

  // 모바일에서 닫힌 상태일 때 inert로 포커스 차단
  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;

    const mql = window.matchMedia("(min-width: 768px)");

    function update() {
      if (!el) return;
      if (mql.matches || isOpen) {
        el.removeAttribute("inert");
      } else {
        el.setAttribute("inert", "");
      }
    }

    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [isOpen]);

  return (
    <>
      {/* 모바일 배경 오버레이 */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}

      {/* 사이드바 */}
      <aside
        ref={sidebarRef}
        className={`
          fixed top-0 left-0 z-50 h-full w-60
          bg-[#0a0a0a] border-r border-[#1e1e1e]
          flex flex-col
          transition-transform duration-200 ease-out
          md:translate-x-0
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* 브랜드 */}
        <div className="px-5 pt-7 pb-8">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M2 8l3 3 7-8"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="text-[15px] tracking-[0.08em] text-bright font-[family-name:var(--font-geist-mono)]">
              myFitness
            </span>
          </div>
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 px-3">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={`
                      relative flex items-center gap-3 px-3 py-2.5 rounded-lg
                      text-[13px] tracking-wide
                      transition-colors duration-150
                      ${
                        isActive
                          ? "text-bright bg-card"
                          : "text-sub hover:text-muted hover:bg-bg-raised"
                      }
                    `}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-accent" />
                    )}
                    <span className={isActive ? "text-accent" : ""}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* 하단: 싱크 상태 */}
        <div className="px-5 py-4 border-t border-[#1e1e1e]">
          <div className="flex items-center gap-2 text-[11px] text-dim tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span>Garmin 연동됨</span>
          </div>
        </div>
      </aside>
    </>
  );
}
