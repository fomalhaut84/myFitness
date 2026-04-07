"use client";

import { useState } from "react";

const PRESETS = [
  { label: "이번 주 러닝 분석", prompt: "이번 주 러닝 활동을 분석해줘. 거리, 페이스, 심박 데이터를 기반으로 평가해줘.", category: "exercise" },
  { label: "수면 패턴 분석", prompt: "최근 2주간 수면 데이터를 보고 수면 질 개선 조언을 해줘.", category: "sleep" },
  { label: "심박 트렌드", prompt: "최근 30일 안정시 심박수와 HRV 추세를 분석해줘.", category: "heart" },
  { label: "컨디션 체크", prompt: "오늘의 바디배터리, 스트레스, 수면, 안정시 심박수를 종합해서 컨디션을 평가해줘.", category: "lifestyle" },
  { label: "다이어트 진행", prompt: "체중 변화 추세와 칼로리 소모 패턴을 분석해서 다이어트 조언을 해줘.", category: "diet" },
];

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage(prompt: string, category?: string) {
    if (!prompt.trim() || loading) return;

    const userMsg: Message = { role: "user", content: prompt };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, category }),
      });

      const data = await res.json();

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `오류: ${data.error}` },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.result },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "네트워크 오류가 발생했습니다." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">
      <div className="p-5 md:p-8 pb-0">
        <h1 className="text-2xl font-semibold mb-1">AI 어드바이저</h1>
        <p className="text-dim text-sm">Garmin 데이터 기반 맞춤 분석</p>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto p-5 md:px-8 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="py-12">
            <p className="text-dim text-[13px] text-center mb-6">
              질문을 입력하거나 프리셋을 선택하세요
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => sendMessage(p.prompt, p.category)}
                  className="px-3 py-2 rounded-lg bg-card border border-border text-[12px] text-sub hover:text-bright hover:border-border-hover transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-3xl ${msg.role === "user" ? "ml-auto" : ""}`}
          >
            <div
              className={`rounded-xl p-4 text-[14px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-accent/10 text-bright ml-auto max-w-md"
                  : "bg-card border border-border"
              }`}
            >
              {msg.role === "assistant" ? (
                <div
                  className="prose prose-invert prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: msg.content }}
                />
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-dim text-[13px]">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            분석 중...
          </div>
        )}
      </div>

      {/* 입력 영역 */}
      <div className="p-5 md:px-8 border-t border-border">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input, "general");
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="질문을 입력하세요..."
            disabled={loading}
            className="flex-1 bg-surface border border-border rounded-lg px-4 py-2.5 text-[14px] text-bright placeholder:text-dim focus:outline-none focus:border-accent/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 rounded-lg bg-accent text-[#0a0a0a] text-[13px] font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            전송
          </button>
        </form>
      </div>
    </div>
  );
}
