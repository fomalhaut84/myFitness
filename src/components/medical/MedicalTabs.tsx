// #544: /medical 검진 · 복약 탭 (`?tab=meds`).
import Link from "next/link";

export type MedicalTab = "checkups" | "meds";

const TABS: { key: MedicalTab; label: string; href: string }[] = [
  { key: "checkups", label: "검진", href: "/medical" },
  { key: "meds", label: "복약", href: "/medical?tab=meds" },
];

export default function MedicalTabs({ current }: { current: MedicalTab }) {
  return (
    <nav aria-label="건강 기록" className="mb-5 flex gap-1 border-b border-border">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px border-b-2 px-3.5 py-2 text-sm ${
            t.key === current ? "border-accent text-bright" : "border-transparent text-sub hover:text-bright"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
