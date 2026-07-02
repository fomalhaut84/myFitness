import { C } from "@/app/training-plan/theme";

export default function Loading() {
  return (
    <div className="p-6 md:p-12 space-y-12">
      <div className="space-y-3">
        <div className="h-4 w-24" style={{ background: C.muted }} />
        <div className="h-8 w-64" style={{ background: C.muted }} />
      </div>
      <div
        className="h-40"
        style={{ background: C.panel, border: `1px solid ${C.border}` }}
      />
      <div
        className="h-96"
        style={{ background: C.panel, border: `1px solid ${C.border}` }}
      />
    </div>
  );
}
