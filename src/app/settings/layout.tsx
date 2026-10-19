// #552 U5: 설정 공통 — 프로필 · 프롬프트 탭
import SettingsTabs from "@/components/settings/SettingsTabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <SettingsTabs />
      {children}
    </div>
  );
}
