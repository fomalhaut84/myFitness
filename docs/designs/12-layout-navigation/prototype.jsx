"use client";

import { useState } from "react";

/* ─── Design Notes ───
   Aesthetic: Industrial Minimalism × Athletic Precision

   - Sidebar feels like a sports watch interface: dark, precise, functional
   - Active state uses a left accent bar (2px) — like a pulse/heartbeat indicator
   - Typography: monospace for the brand mark (technical feel), sans for nav
   - Subtle surface elevation via border, not shadow (cleaner in dark themes)
   - Mobile: slide-in overlay with backdrop blur
   - Icons: custom SVG, stroke-based, 20px — thin and technical
─── */

const NAV_ITEMS = [
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
        <path d="M10 8.5v0" />
      </svg>
    ),
  },
];

/* ─── Sidebar Component ─── */
function Sidebar({ currentPath = "/", isOpen, onClose }) {
  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 z-50 h-full w-60
          bg-[#0a0a0a] border-r border-[#1e1e1e]
          flex flex-col
          transition-transform duration-200 ease-out
          md:translate-x-0
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Brand */}
        <div className="px-5 pt-7 pb-8">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-[#22c55e]/10 border border-[#22c55e]/20 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M2 8l3 3 7-8"
                  stroke="#22c55e"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span
              className="text-[15px] tracking-[0.08em] text-[#ededed]"
              style={{ fontFamily: "'Geist Mono', 'SF Mono', monospace" }}
            >
              myFitness
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const isActive = currentPath === item.href;
              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className={`
                      relative flex items-center gap-3 px-3 py-2.5 rounded-lg
                      text-[13px] tracking-wide
                      transition-colors duration-150
                      ${
                        isActive
                          ? "text-[#ededed] bg-[#161616]"
                          : "text-[#737373] hover:text-[#a3a3a3] hover:bg-[#111111]"
                      }
                    `}
                  >
                    {/* Active pulse bar */}
                    {isActive && (
                      <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-[#22c55e]" />
                    )}

                    <span className={isActive ? "text-[#22c55e]" : ""}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer: sync status indicator */}
        <div className="px-5 py-4 border-t border-[#1e1e1e]">
          <div className="flex items-center gap-2 text-[11px] text-[#525252] tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
            <span>Garmin 연동됨</span>
          </div>
        </div>
      </aside>
    </>
  );
}

/* ─── Mobile Header ─── */
function MobileHeader({ onMenuToggle }) {
  return (
    <header className="fixed top-0 left-0 right-0 z-30 h-12 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-[#1e1e1e] flex items-center px-4 md:hidden">
      <button
        onClick={onMenuToggle}
        className="p-1.5 -ml-1.5 text-[#737373] hover:text-[#ededed] transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>
      <span
        className="ml-3 text-[13px] tracking-[0.08em] text-[#a3a3a3]"
        style={{ fontFamily: "'Geist Mono', 'SF Mono', monospace" }}
      >
        myFitness
      </span>
    </header>
  );
}

/* ─── Main Layout ─── */
export default function MainLayout({ children, currentPath = "/" }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededed]">
      <Sidebar
        currentPath={currentPath}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <MobileHeader onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />

      {/* Main content */}
      <main className="md:ml-60 min-h-screen pt-12 md:pt-0">
        <div className="p-5 md:p-8 max-w-6xl">
          {children}
        </div>
      </main>
    </div>
  );
}
