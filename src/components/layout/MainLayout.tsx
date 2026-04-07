"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-bg text-bright">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* 모바일 헤더 */}
      <header className="fixed top-0 left-0 right-0 z-30 h-12 bg-bg/90 backdrop-blur-md border-b border-[#1e1e1e] flex items-center px-4 md:hidden">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 -ml-1.5 text-sub hover:text-bright transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
        <span className="ml-3 text-[13px] tracking-[0.08em] text-muted font-[family-name:var(--font-geist-mono)]">
          myFitness
        </span>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="md:ml-60 min-h-screen pt-12 md:pt-0">
        <div className="p-5 md:p-8 max-w-6xl">
          {children}
        </div>
      </main>
    </div>
  );
}
